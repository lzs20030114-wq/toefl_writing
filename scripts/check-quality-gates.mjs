#!/usr/bin/env node
// Reads data/.routine-meta.json + the just-committed staging files,
// runs scoreBatch, then decides PER BANK whether the batch passed quality
// gates. Banks that fail get written into data/.pending-retry.json with
// specific actionable hints for the next routine pass.
//
// Output side-effects:
//   - data/.pending-retry.json (always written; "retry_banks":[] when all pass)
//   - exit 0 always (status communicated via the file content, not exit code)
//
// Called by R1 after Phase 3 (meta written) and before commit. R2 reads
// the file and acts on it. compute-quality-report can also read it to
// show "retry pending" in the email.
//
// Threshold philosophy:
//   - Diversity gate is the primary signal — quality (per-item compliance
//     with schema) is already enforced by mergeClaude.mjs
//   - Per-bank thresholds reflect HOW MUCH variance is acceptable for
//     each bank's batch size. BS (20 items) has more headroom for
//     uniformity than Email (4 items) where 1 weird item = 25% of batch.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { scoreBatch, isPersonOveruse, PERSON_PREFILLED_GATE, isDistractorCollapsed, DISTRACTOR_TOP_FRAC_GATE, DISTRACTOR_MIN_DISTINCT, isPromptAddressingLow, PROMPT_SECOND_PERSON_GATE } from "../lib/quality/scoreBatch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const META_PATH = join(ROOT, "data/.routine-meta.json");
const OUT_PATH = join(ROOT, "data/.pending-retry.json");

// Per-bank diversity thresholds. Set lower than 100 to allow natural
// variance; set high enough that genuinely uniform batches get caught.
// Reading banks have small N so gate is looser; BS with 20 items has the
// tightest gate.
const DIVERSITY_GATE = {
  bs:                90,  // 20 items — most signal, easiest to score
  discussion:        80,  // 4 items — small N, more variance
  email:             80,  // 4 items — small N
  "reading-ap":      85,  // 5 items
  "reading-ctw":     85,  // 6 items
  "reading-rdl-short": 80, // 4 items
  "reading-rdl-long":  70, // 2 items — too small to gate strictly
  // Listening + Speaking (added 2026-05-31) — lenient, small N / new types.
  "listening-lat":   70,
  "listening-lc":    72,
  "listening-la":    72,
  "listening-lcr":   75,
  "speaking-repeat": 70,
  "speaking-interview": 70, // wired 2026-07-09 — 2 sets/night, small N
};

// Quality gate is more forgiving — these are basic adherence checks that
// already pass through mergeClaude's schema validator. Set lower bound
// just in case something slips through.
const QUALITY_GATE = {
  bs:                95,
  discussion:        90,
  email:             90,
  "reading-ap":      90,
  "reading-ctw":     90,
  "reading-rdl-short": 85,
  "reading-rdl-long":  85,
  "listening-lat":   80,
  "listening-lc":    80,
  "listening-la":    80,
  "listening-lcr":   80,
  "speaking-repeat": 80,
  "speaking-interview": 80,
};

function readJSON(p, fallback = null) {
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch { return fallback; }
}

const meta = readJSON(META_PATH);
if (!meta) {
  console.error("❌ data/.routine-meta.json not found — routine must write it before this script runs");
  // Don't crash; just emit empty pending-retry so the routine continues
  writeFileSync(OUT_PATH, JSON.stringify({
    session_id: null,
    needs_retry: false,
    retry_banks: [],
    note: "Could not read .routine-meta.json — gate skipped",
  }, null, 2));
  process.exit(0);
}

const scores = scoreBatch(ROOT, meta.session_id || "", meta.results || {});

// Decide per bank
const retryBanks = [];
const BANK_ORDER = ["bs", "discussion", "email", "reading-ap", "reading-ctw", "reading-rdl-short", "reading-rdl-long", "listening-lat", "listening-lc", "listening-la", "listening-lcr", "speaking-repeat", "speaking-interview"];
const summary = [];

for (const bank of BANK_ORDER) {
  const bankResult = meta.results?.[bank];

  // If R1 didn't generate at all (accepted=0), schedule a full retry — R2
  // will produce a fresh batch from scratch. Different from "merged some but
  // diversity is borderline" case below.
  if (!bankResult || (bankResult.accepted || 0) === 0) {
    if (!bankResult) {
      summary.push(`  ${bank}: skipped (not in this batch)`);
      continue;
    }
    // accepted=0 means R1 generated but all rejected — clear retry signal
    retryBanks.push({
      bank,
      diversity_score: 0,
      diversity_threshold: DIVERSITY_GATE[bank] ?? 75,
      quality_score: 0,
      quality_threshold: QUALITY_GATE[bank] ?? 80,
      failures: ["R1 accepted=0 (full failure)"],
      diversity_breakdown: ["R1 produced 0 valid items"],
      quality_breakdown: [bankResult.failure_reason || "schema rejection"],
      hints: [
        `R1 generated ${bankResult.generated || 0} items but all were rejected. Failure reason: "${bankResult.failure_reason || "unknown"}". Generate fresh items strictly following the print-bank-prompt rules — pay extra attention to schema compliance.`,
      ],
      items_to_supplement: (() => {
        const original = { bs: 20, discussion: 4, email: 4, "reading-ap": 5, "reading-ctw": 6, "reading-rdl-short": 4, "reading-rdl-long": 2, "listening-lat": 4, "listening-lc": 5, "listening-la": 5, "listening-lcr": 8, "speaking-repeat": 3, "speaking-interview": 2 };
        return original[bank] || 4;  // Full count, not half
      })(),
    });
    summary.push(`  ✗ ${bank}: R1 fully failed (0 accepted) — R2 will regenerate from scratch`);
    continue;
  }

  const s = scores.perBank[bank];
  if (!s) {
    summary.push(`  ${bank}: no score computed (no staging file?)`);
    continue;
  }

  const divGate = DIVERSITY_GATE[bank] ?? 75;
  const qualGate = QUALITY_GATE[bank] ?? 80;
  const divPass = s.diversity.score >= divGate;
  const qualPass = s.quality.score >= qualGate;

  // Dedicated person-prefilled gate (BS only). A batch can clear the overall
  // diversity gate yet still over-use a person as the prefilled hint. Real TPO
  // is ~30%; we flag > 45% for retry. This is INDEPENDENT of the diversity
  // score so it can't be masked by strong scores on other axes.
  let personOveruse = false;
  let distractorCollapsed = false;
  let promptAddressingLow = false;
  if (bank === "bs" && s.diversity.detail) {
    personOveruse = isPersonOveruse(s.diversity.detail.personFrac);
    distractorCollapsed = isDistractorCollapsed(s.diversity.detail);
    promptAddressingLow = isPromptAddressingLow(s.diversity.detail);
  }

  if (divPass && qualPass && !personOveruse && !distractorCollapsed && !promptAddressingLow) {
    summary.push(`  ✓ ${bank}: 多样性 ${s.diversity.score}≥${divGate}, 质量 ${s.quality.score}≥${qualGate}${bank === "bs" ? `, 人物prefilled ${Math.round((s.diversity.detail.personFrac||0)*100)}%, 干扰词 ${s.diversity.detail.distinctDistractors}种, 题面you ${Math.round((s.diversity.detail.secondPersonFrac||0)*100)}%` : ""}`);
    continue;
  }

  // Failed — generate hints
  const hints = [];
  const failures = [];

  if (personOveruse) {
    const pct = Math.round(s.diversity.detail.personFrac * 100);
    failures.push(`人物当prefilled ${pct}% > ${Math.round(PERSON_PREFILLED_GATE * 100)}%`);
    hints.push(`人物当 prefilled 过多 (${pct}%, TPO 只有 30%). 关键: 答案可以照样有人物主语 (TPO 82% 都有), 但把 'he/she/名字' 留成可拖的 chunk, prefilled 改锚在非主语词上 — 动词短语 ('wanted to know'/'found out'), 介词短语 ('to me'/'in the basement'), 物体 NP ('The desk'/'The shipment'), 或句首副词 ('Unfortunately,'). 这批 ${pct}% 用人物当 prefilled, 目标降到 30% 左右.`);
  }

  if (distractorCollapsed) {
    const d = s.diversity.detail;
    const topPct = Math.round((d.topDistractorFrac || 0) * 100);
    failures.push(`干扰词塌缩 (${d.distinctDistractors}种, top "${d.topDistractor}" ${topPct}%)`);
    hints.push(`干扰词多样性塌缩: 只有 ${d.distinctDistractors} 种 distinct, "${d.topDistractor}" 占 ${topPct}% (上限: 单词≤${Math.round(DISTRACTOR_TOP_FRAC_GATE*100)}%, 至少 ${DISTRACTOR_MIN_DISTINCT} 种). 真 TPO 干扰词在助动词家族里铺开 (did/do/does/is/are/was/were/can/have/had/am) + 少量形态twin (took→taken, go→going) + 否定twin (not→no). 这批塌缩到单一词, 每 10 道一个干扰词最多用 3 次, 目标 6+ 种 distinct.`);
  }

  if (promptAddressingLow) {
    const pct = Math.round((s.diversity.detail.secondPersonFrac || 0) * 100);
    failures.push(`题面对话化不足 (${pct}% 含 you, < ${Math.round(PROMPT_SECOND_PERSON_GATE * 100)}%)`);
    hints.push(`题面问法太"第三人称旁观": 只有 ${pct}% 的 prompt 含 "you/your" (真 TPO 72%). BS 题面是一段对话的一方, 应直接对考生说话. 把题面写成对考生提问: "Did you enjoy...?", "Where did you find...?", "What did the recruiter ask you?", "Are you going...?" — 目标 ~70% 的题面含 "you". 避免 "What did Adrian ask about lunch?" 这种没有 you 的第三人称报告.`);
  }

  if (!divPass) {
    failures.push(`多样性 ${s.diversity.score} < ${divGate}`);
    // Bank-specific hint extraction from breakdown / detail
    if (bank === "bs" && s.diversity.detail) {
      const { pfTypeCounts, pfMaxFrac, distinctPfTypes, distinctNames, distinctScenarios, itemCount } = s.diversity.detail;
      if (distinctNames < itemCount * 0.75) {
        hints.push(`角色名重复严重 (${distinctNames}/${itemCount} distinct) — use 15+ distinct character names from: Olivia, Harold, Mariana, Hector, Margot, Emma, Julian, Matthew, Alison, Juan, Angelina, Professor Cho, Naomi, Diane`);
      }
      if (pfMaxFrac > 0.6) {
        const topType = Object.entries(pfTypeCounts).sort((a, b) => b[1] - a[1])[0];
        hints.push(`prefilled 单一化 (${topType[0]} 占 ${Math.round(pfMaxFrac * 100)}%) — spread across 5+ TPO types: subject-pronoun, subject-np, adverb-opener, prep-phrase, verb-phrase, mid-noun-or-adj, conjunction-wh`);
      }
      if (distinctPfTypes < 3) {
        hints.push(`prefilled 类型太少 (only ${distinctPfTypes} types) — include items with 'Unfortunately,', 'to me', 'wanted to know', 'fun', empty []`);
      }
    } else if (bank === "discussion") {
      hints.push("多样性 < gate — vary courses, opening styles, and student name pools more aggressively");
    } else if (bank === "email") {
      hints.push("多样性 < gate — pick from 6 EMAIL_CATEGORIES (A-F), don't cluster on Academic+Workplace");
    } else if (bank.startsWith("reading-")) {
      hints.push("多样性 < gate — choose distinct topic/subtopic combos; avoid same discipline twice");
    }
  }

  if (!qualPass) {
    failures.push(`质量 ${s.quality.score} < ${qualGate}`);
    hints.push(`质量校验有偏差: ${s.quality.breakdown.join(", ")} — recheck schema compliance`);
  }

  retryBanks.push({
    bank,
    diversity_score: s.diversity.score,
    diversity_threshold: divGate,
    quality_score: s.quality.score,
    quality_threshold: qualGate,
    failures,
    diversity_breakdown: s.diversity.breakdown,
    quality_breakdown: s.quality.breakdown,
    hints,
    items_to_supplement: (() => {
      // R2 should add fewer items than R1 originally generated
      // (R2 supplements, doesn't replace)
      const original = { bs: 20, discussion: 4, email: 4, "reading-ap": 5, "reading-ctw": 6, "reading-rdl-short": 4, "reading-rdl-long": 2, "listening-lat": 4, "listening-lc": 5, "listening-la": 5, "listening-lcr": 8, "speaking-repeat": 3, "speaking-interview": 2 };
      return Math.ceil((original[bank] || 4) / 2);
    })(),
  });

  summary.push(`  ✗ ${bank}: ${failures.join(", ")} — will retry`);
}

// ── BS frozen difficulty gate (visibility, NON-BLOCKING) ─────────────────
// 2026-06-16: surface the real-exam frozen-standard verdict on the live BS bank
// into the nightly report + quality-monitor trend. This script never blocks (exit
// 0 always); the ENFORCING copies of this gate live in mergeClaude.mjs /
// appendBSSets.mjs at the actual merge point. Once the bank is gate-clean and
// BS_GATE_ENFORCE is flipped on there, a FAIL here means the merge gate let
// something slip and warrants investigation. Detail is logged to
// data/claudeGen/reports/bs-quality-history.jsonl by the scorer itself.
let bsDifficultyGate = "unknown";
try {
  execSync(`node ${join(ROOT, "scripts/bs-difficulty-scorer.mjs")} --gate ${join(ROOT, "data/buildSentence/questions.json")}`, { stdio: "ignore" });
  bsDifficultyGate = "PASS";
  summary.push("  ✓ bs(难度冻结门): PASS");
} catch {
  bsDifficultyGate = "FAIL";
  summary.push("  ⚠ bs(难度冻结门): FAIL — 现库未达真题校准标准 (run: node scripts/bs-difficulty-scorer.mjs --gate data/buildSentence/questions.json)");
}

const out = {
  session_id: meta.session_id,
  generated_at: new Date().toISOString(),
  needs_retry: retryBanks.length > 0,
  overall_scores: scores.overall,
  bs_difficulty_gate: bsDifficultyGate,
  retry_banks: retryBanks,
};

writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));

console.log("Quality gate check complete:");
summary.forEach((line) => console.log(line));
console.log("");
if (retryBanks.length > 0) {
  console.log(`📝 ${retryBanks.length} bank(s) below threshold → R2 will retry. See ${OUT_PATH}`);
} else {
  console.log(`✅ All banks passed quality gate.`);
}
console.log(`📊 Overall: diversity ${scores.overall.diversity}/100, quality ${scores.overall.quality}/100`);
