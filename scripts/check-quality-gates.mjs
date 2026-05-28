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
import { scoreBatch } from "../lib/quality/scoreBatch.mjs";

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
const BANK_ORDER = ["bs", "discussion", "email", "reading-ap", "reading-ctw", "reading-rdl-short", "reading-rdl-long"];
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
        const original = { bs: 20, discussion: 4, email: 4, "reading-ap": 5, "reading-ctw": 6, "reading-rdl-short": 4, "reading-rdl-long": 2 };
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

  if (divPass && qualPass) {
    summary.push(`  ✓ ${bank}: 多样性 ${s.diversity.score}≥${divGate}, 质量 ${s.quality.score}≥${qualGate}`);
    continue;
  }

  // Failed — generate hints
  const hints = [];
  const failures = [];

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
      const original = { bs: 20, discussion: 4, email: 4, "reading-ap": 5, "reading-ctw": 6, "reading-rdl-short": 4, "reading-rdl-long": 2 };
      return Math.ceil((original[bank] || 4) / 2);
    })(),
  });

  summary.push(`  ✗ ${bank}: ${failures.join(", ")} — will retry`);
}

const out = {
  session_id: meta.session_id,
  generated_at: new Date().toISOString(),
  needs_retry: retryBanks.length > 0,
  overall_scores: scores.overall,
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
