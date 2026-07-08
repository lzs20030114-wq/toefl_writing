#!/usr/bin/env node
// Nightly quality regression monitor (deterministic — no LLM).
//
// Runs AFTER R1+R2 each night (GitHub Actions, ~04:30 Beijing). Catches the
// failure modes the per-night gate CANNOT see:
//   1. STALE      — R1 didn't run at all last night (cron died / PAT expired /
//                   quota exhausted). Per-night gate is silent because there's
//                   no batch to gate.
//   2. PERSON_DRIFT — the FINAL committed BS state still has person-prefilled
//                   above the gate (means R1's gate fired but R2 didn't fix it).
//   3. TREND_DOWN — every night individually passes, but the trailing average
//                   of diversity/quality is sliding down (slow rot).
//   4. MACHINERY  — the measurement itself broke / tpo_source.md corrupted
//                   (re-measures TPO ground truth, same as the CI test).
//
// Outputs:
//   - appends a row to data/.quality-history.jsonl (the trend record)
//   - writes data/.quality-monitor-report.md (human-readable)
//   - prints REGRESSION=yes|no and reasons to stdout for the workflow to read
//
// Exit code is always 0; regression is signalled via the report + a
// "regression=" line the workflow greps. (Non-zero would fail the GH job and
// muddy "did the monitor run?" vs "is there a regression?".)

import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname, join, basename } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { scoreBatch, PERSON_PREFILLED_GATE, isDistractorCollapsed, isPromptAddressingLow, PROMPT_SECOND_PERSON_GATE } from "../lib/quality/scoreBatch.mjs";
// Content-fingerprint dedup (CJS → default import + destructure, same as scripts/merge-staging.mjs).
// Reused for BOTH staging↔bank reconciliation and the live-bank dup self-check so "same content"
// has ONE definition across the merge layer and this monitor.
import contentDedup from "../lib/gen/contentDedup.js";
const { createDedupIndex, checkDuplicate, addToIndex, contentKey, extractText } = contentDedup;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const META = resolve(ROOT, "data/.routine-meta.json");
const HISTORY = resolve(ROOT, "data/.quality-history.jsonl");
const REPORT = resolve(ROOT, "data/.quality-monitor-report.md");
const TPO = resolve(ROOT, "data/buildSentence/tpo_source.md");

// Thresholds for the post-incident hardening checks (QUESTION-PIPELINE-REVIEW-2026-07-07 §7 P0-3).
const BANK_STALE_HOURS = 48;        // a live bank file un-updated longer than this = merging stalled
const STAGING_BACKLOG_GROWTH = 100; // backlog grows by >this over the 7-day minimum = hard alert (~2 nights' output)
const CONTENT_DUP_MIN_COUNT = 5;    // per-bank exact-dup count at/above this = hard alert
const CONTENT_DUP_MIN_RATE = 0.02;  // ...or an exact-dup RATE at/above this (2%)

const NOW = new Date();
const reasons = [];

function readJSON(p, fb = null) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fb; } }

// ── 1. Load latest meta + freshness ─────────────────────────────────────
const meta = readJSON(META);
let staleHours = null;
let session = null, completedAt = null;
if (!meta) {
  reasons.push("STALE: data/.routine-meta.json missing — R1 may have never run.");
} else {
  session = meta.session_id || null;
  completedAt = meta.completed_at || meta.r2_completed_at || null;
  if (completedAt) {
    staleHours = (NOW - new Date(completedAt)) / 3.6e6;
    if (staleHours > 28) {
      reasons.push(`STALE: last routine completed ${staleHours.toFixed(1)}h ago (>28h) — R1 likely did not run last night.`);
    }
  } else {
    reasons.push("STALE: meta has no completed_at timestamp.");
  }
}

// ── 2. Score current BS batch (person + diversity + quality) ─────────────
let bsPersonFrac = null, bsDiv = null, bsQual = null, overallDiv = null, overallQual = null;
let bsTopDistractorFrac = null, bsDistinctDistractors = null;
let bsSingleWordChunkRatio = null, bsAvgEffChunks = null, bsSecondPersonFrac = null;
if (meta && session) {
  try {
    const scores = scoreBatch(ROOT, session, meta.results || {});
    overallDiv = scores.overall.diversity;
    overallQual = scores.overall.quality;
    const bs = scores.perBank.bs;
    if (bs && bs.diversity && bs.diversity.detail && typeof bs.diversity.detail.personFrac === "number") {
      const det = bs.diversity.detail;
      bsPersonFrac = det.personFrac;
      bsDiv = bs.diversity.score;
      bsQual = bs.quality.score;
      bsTopDistractorFrac = det.topDistractorFrac ?? null;
      bsDistinctDistractors = det.distinctDistractors ?? null;
      bsSingleWordChunkRatio = det.singleWordChunkRatio ?? null;
      bsAvgEffChunks = det.avgEffChunks ?? null;
      bsSecondPersonFrac = det.secondPersonFrac ?? null;
      if (isPromptAddressingLow(det)) {
        reasons.push(`PROMPT_FRAME_DRIFT: BS prompts addressing the test-taker dropped to ${Math.round((det.secondPersonFrac || 0) * 100)}% "you" (TPO ~72%, gate ${Math.round(PROMPT_SECOND_PERSON_GATE * 100)}%) — prompts went third-person/detached. R1 flagged it but R2 didn't fix. Recalibrate the prompt-frame block.`);
      }
      // Chunk over-bundling drift (soft — visibility, not a hard fail). TPO is
      // ~77% single-word, ~6 chunks. Flag if we drift well below (over-bundled).
      if (typeof bsSingleWordChunkRatio === "number" && bsSingleWordChunkRatio < 0.35) {
        reasons.push(`CHUNK_DRIFT: BS single-word-chunk ratio ${Math.round(bsSingleWordChunkRatio * 100)}% (TPO ~77%), avg ${(bsAvgEffChunks || 0).toFixed(1)} chunks/item (TPO ~6) — over-bundling into fewer/longer chunks. Soft signal; recalibrate the chunk-rule prompt block, don't auto-retry.`);
      }
      if (bsPersonFrac > PERSON_PREFILLED_GATE) {
        reasons.push(`PERSON_DRIFT: BS person-as-prefilled is ${Math.round(bsPersonFrac * 100)}% (> ${Math.round(PERSON_PREFILLED_GATE * 100)}% gate) in the FINAL committed batch — R1 flagged it but R2 did not bring it down. Prompt may need strengthening.`);
      } else if (bsPersonFrac < 0.10) {
        // Over-correction: too LOW is as wrong as too high (TPO is ~30%).
        // Soft visibility note (not a hard fail) — see calibration-fix lesson B.
        reasons.push(`INFO PERSON_LOW: BS person-as-prefilled is only ${Math.round(bsPersonFrac * 100)}% (TPO ~30%) — possible over-correction / soft-dimension wobble. Watch the trend; act only if persistent.`);
      }
      if (isDistractorCollapsed(det)) {
        reasons.push(`DISTRACTOR_DRIFT: BS distractors collapsed in the FINAL committed batch (${det.distinctDistractors} distinct, top "${det.topDistractor}" ${Math.round((det.topDistractorFrac || 0) * 100)}%) — R1 flagged it but R2 did not diversify. Real TPO spreads across the auxiliary family + morphological/negation twins.`);
      }
    } else {
      // Metrics missing = monitoring is BLIND, not "all good". This used to be an INFO
      // (filtered out of hardReasons) — the 07-01/07-06 all-null history rows were
      // swallowed exactly this way while the merge layer was down (§2.1 of the 07-07 review).
      reasons.push(`SCORE_MISSING: could not score BS for session ${session} (staging absent) — nightly quality metrics are blind this run; verify the routine actually landed its batch.`);
    }
  } catch (e) {
    reasons.push(`SCORE_FAILURE: scoreBatch threw (${e.message}) — quality metrics missing for this run. Treat as a monitoring outage, not a pass.`);
  }
}

// ── 3. Machinery self-test: re-measure TPO ground truth ──────────────────
let tpoRatio = null;
if (existsSync(TPO)) {
  try {
    const raw = readFileSync(TPO, "utf8").split(/\r?\n/);
    const items = [];
    let cur = null;
    for (const line of raw) {
      const qm = line.match(/^__(\d+)\\?\.__\s*(.*)/);
      if (qm) { if (cur && cur.template) items.push(cur); cur = { template: "" }; continue; }
      if (cur && line.includes("\\_")) cur.template += (cur.template ? " " : "") + line.trim();
    }
    if (cur && cur.template) items.push(cur);
    const PRON = /^(i|he|she|they|we)$/i;
    const COMMON = new Set(["unfortunately","yes","no","some","the","this","that","these","those","many","few","several","all","most","every","each","could","would","should","can","will","did","do","does","is","was","were","have","has","yet","fun","when","why","what","where","how","to","in","on","at"]);
    const isPerson = (seg) => seg.split(/\s+/).some((w) => {
      const c = w.replace(/[^A-Za-z']/g, "");
      return PRON.test(c) || (/^[A-Z][a-z]+$/.test(c) && !COMMON.has(c.toLowerCase()));
    });
    let person = 0;
    for (const it of items) {
      let t = it.template.replace(/\\_/g, "_").replace(/\\\./g, ".").replace(/\s+/g, " ").trim();
      t = t.replace(/__[^_]*__/g, " ").replace(/\s+/g, " ").trim();
      const segs = t.split(/_{2,}/).map((p) => p.replace(/[.?!,;:]/g, "").trim()).filter(Boolean);
      if (segs.some(isPerson)) person++;
    }
    if (items.length >= 50) {
      tpoRatio = person / items.length;
      if (tpoRatio < 0.25 || tpoRatio > 0.45) {
        reasons.push(`MACHINERY: TPO person-ratio measured ${Math.round(tpoRatio * 100)}% — outside expected 25-45% band. tpo_source.md or the measurement may be corrupted; the 30% target is no longer trustworthy.`);
      }
    } else {
      reasons.push(`MACHINERY: only parsed ${items.length} TPO items (<50) — tpo_source.md may be truncated.`);
    }
  } catch (e) {
    reasons.push(`MACHINERY: failed to re-measure TPO (${e.message}).`);
  }
} else {
  reasons.push("MACHINERY: tpo_source.md missing — ground-truth calibration cannot be verified.");
}

// ── 3.5 Merge-layer hardening (QUESTION-PIPELINE-REVIEW-2026-07-07 §7 P0-3) ──────────
// The 06-30 → 07-07 merge stall (9 banks frozen, ~388 staged items piling up) was
// invisible to every check above: routine-meta said "completed" and every other metric
// is BS-only. These checks watch the MERGE layer itself, not just the BS batch.

// (a) BANK_STALE — a live bank whose last git commit is older than BANK_STALE_HOURS means
// merging stalled for that type. Git time, not fs mtime: CI checkouts reset mtime (the
// monitor workflow uses fetch-depth: 0, so full history is available). interview.json is
// excluded — manual type, never wired into the automated pipeline (§7 P1-11). Known blind
// spot: audio-backfill commits also touch listening/speaking banks and can mask a content
// stall, but backfill only fires when new items landed, so acceptable.
const MONITORED_BANKS = [
  "data/reading/bank/ctw.json", "data/reading/bank/ap.json",
  "data/reading/bank/rdl-short.json", "data/reading/bank/rdl-long.json",
  "data/listening/bank/lcr.json", "data/listening/bank/lc.json",
  "data/listening/bank/la.json", "data/listening/bank/lat.json",
  "data/speaking/bank/repeat.json",
  "data/buildSentence/questions.json",
  "data/academicWriting/prompts.json",
  "data/emailWriting/prompts.json",
];
let oldestBankHours = null, oldestBankFile = null;
{
  const staleList = [];
  for (const rel of MONITORED_BANKS) {
    const abs = resolve(ROOT, rel);
    if (!existsSync(abs)) { reasons.push(`BANK_STALE: ${rel} is MISSING from the repo.`); continue; }
    let ts = null;
    try {
      const out = execSync(`git log -1 --format=%ct -- "${rel}"`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (out) ts = Number(out) * 1000;
    } catch { /* no git available (rare local case) → fs mtime fallback below */ }
    if (ts == null) {
      try { ts = statSync(abs).mtimeMs; reasons.push(`INFO: git timestamp unavailable for ${rel} — fell back to fs mtime (unreliable in CI).`); } catch { ts = null; }
    }
    if (ts == null) continue;
    const hours = (NOW - ts) / 3.6e6;
    if (oldestBankHours == null || hours > oldestBankHours) { oldestBankHours = hours; oldestBankFile = basename(rel); }
    if (hours > BANK_STALE_HOURS) staleList.push(`${basename(rel)} ${hours.toFixed(0)}h`);
  }
  if (staleList.length > 0) {
    reasons.push(`BANK_STALE: ${staleList.length} bank file(s) not updated in >${BANK_STALE_HOURS}h (${staleList.join(", ")}) — merging appears STALLED for these types. This is the 06-30 incident signature; check the 盲审/merge routine before assuming it's fine.`);
  }
}

// (b) STAGING_BACKLOG — count staged items whose id is NOT in the corresponding live bank
// ("id 反查", the same methodology that sized the 388-item pileup in the review). Raw
// file/item counts would false-alarm forever: merged staging files are never cleaned up
// (legacy — .done/ archiving exists but is barely used), so only the not-yet-in-bank
// remainder is backlog. Items with no id count as unmerged (merge mints ids on the fly,
// so an id-less staged item can never be PROVEN merged — rare, and erring loud is the point).
let stagingBacklog = 0;
const backlogByType = {};
{
  const STAGING_SECTIONS = [
    { dir: "data/reading/staging",   bankDir: "data/reading/bank",   map: { ap: ["ap.json"], ctw: ["ctw.json"], rdl: ["rdl-long.json", "rdl-short.json"] } },
    { dir: "data/listening/staging", bankDir: "data/listening/bank", map: { lcr: ["lcr.json"], la: ["la.json"], lc: ["lc.json"], lat: ["lat.json"] } },
    { dir: "data/speaking/staging",  bankDir: "data/speaking/bank",  map: { repeat: ["repeat.json"], rpt: ["repeat.json"], interview: ["interview.json"], intv: ["interview.json"] } },
  ];
  const idCache = new Map(); // abs bank path → Set(item ids)
  const bankIdsFor = (bankDir, files) => {
    const ids = new Set();
    for (const bf of files) {
      const p = resolve(ROOT, bankDir, bf);
      if (!idCache.has(p)) {
        const bank = readJSON(p);
        idCache.set(p, new Set(((bank && bank.items) || []).map((i) => i && i.id).filter(Boolean)));
      }
      for (const id of idCache.get(p)) ids.add(id);
    }
    return ids;
  };
  for (const sec of STAGING_SECTIONS) {
    const dirAbs = resolve(ROOT, sec.dir);
    if (!existsSync(dirAbs)) continue;
    for (const f of readdirSync(dirAbs)) { // non-recursive → the .done/ archive dir is naturally skipped
      if (!f.endsWith(".json")) continue;
      const prefix = (f.match(/^([a-z]+)-/) || [])[1] || "";
      const bankFiles = sec.map[prefix];
      if (!bankFiles) continue;
      const staged = readJSON(join(dirAbs, f));
      const items = (staged && staged.items) || [];
      if (items.length === 0) continue;
      const ids = bankIdsFor(sec.bankDir, bankFiles);
      for (const it of items) {
        if (!it) continue;
        if (!it.id || !ids.has(it.id)) {
          stagingBacklog++;
          backlogByType[prefix] = (backlogByType[prefix] || 0) + 1;
        }
      }
    }
  }
  // Verdict is GROWTH-based, not absolute: legacy staging is never cleaned up and the
  // 07-07 bank dedup (1472 removed) orphaned old staging ids forever, so the absolute
  // count sits at ~1600 even when everything is healthy — an absolute threshold would be
  // permanently red. Instead compare against the 7-day minimum from the history file: a
  // stalled merge with the generator still running grows the backlog ~50/night, so a
  // >STAGING_BACKLOG_GROWTH rise (~2 nights) fires within days while legacy stock stays quiet.
  const breakdown = Object.entries(backlogByType).map(([k, v]) => `${k} ${v}`).join(", ");
  let backlogBaseline = null;
  if (existsSync(HISTORY)) {
    const rows = readFileSync(HISTORY, "utf8").split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const vals = rows.slice(-7).map((r) => r.staging_backlog).filter((v) => typeof v === "number");
    if (vals.length > 0) backlogBaseline = Math.min(...vals);
  }
  const backlogGrowth = backlogBaseline != null ? stagingBacklog - backlogBaseline : null;
  if (backlogGrowth != null && backlogGrowth > STAGING_BACKLOG_GROWTH) {
    reasons.push(`STAGING_BACKLOG: unmerged staging grew +${backlogGrowth} over the 7-day low (${backlogBaseline} → ${stagingBacklog}; ${breakdown}) — the 盲审/merge routine is likely down while generation keeps running.`);
  } else if (stagingBacklog > 0) {
    reasons.push(`INFO STAGING: ${stagingBacklog} staged item(s) not id-matched to any live bank (${breakdown}) — includes legacy/rejected stock; verdict is growth-based (+${backlogGrowth ?? "n/a"} vs 7-day low, alert at +${STAGING_BACKLOG_GROWTH}).`);
  }
}

// (c) CONTENT_DUP — exact-fingerprint self-check over the live banks, using the SAME
// normalization as the merge layer (contentDedup). The merge layer dedups since PR #6 and
// the 07-07 cleanup zeroed the stock (1472 removed), so any NEW duplicate here means
// something wrote to a bank AROUND the dedup gate (admin deploy, manual edit) — this
// check is a bypass detector, not a generator-quality metric.
let bankDupTotal = null;
{
  const DUP_BANKS = [
    ["data/reading/bank/ctw.json", "ctw"], ["data/reading/bank/ap.json", "ap"],
    ["data/reading/bank/rdl-short.json", "rdl"], ["data/reading/bank/rdl-long.json", "rdl"],
    ["data/listening/bank/lcr.json", "lcr"], ["data/listening/bank/lc.json", "lc"],
    ["data/listening/bank/la.json", "la"], ["data/listening/bank/lat.json", "lat"],
    ["data/speaking/bank/repeat.json", "repeat"],
    ["data/academicWriting/prompts.json", "discussion"],
    ["data/emailWriting/prompts.json", "email"],
    ["data/buildSentence/questions.json", "bs"],
  ];
  const flagged = [];
  for (const [rel, type] of DUP_BANKS) {
    const data = readJSON(resolve(ROOT, rel));
    let items = Array.isArray(data) ? data : (data && data.items) || [];
    if (data && Array.isArray(data.question_sets)) items = data.question_sets.flatMap((s) => (s && s.questions) || []); // BS bank shape
    if (items.length === 0) continue;
    const seen = new Set();
    let dups = 0;
    for (const it of items) {
      const key = contentKey(extractText(type, it));
      if (!key) continue;
      if (seen.has(key)) dups++; else seen.add(key);
    }
    bankDupTotal = (bankDupTotal ?? 0) + dups;
    const rate = dups / items.length;
    if (dups >= CONTENT_DUP_MIN_COUNT || rate >= CONTENT_DUP_MIN_RATE) {
      flagged.push(`${basename(rel)} ${dups}/${items.length} (${(rate * 100).toFixed(1)}%)`);
    }
  }
  if (flagged.length > 0) {
    reasons.push(`CONTENT_DUP: duplicate content re-appeared in live bank(s): ${flagged.join(", ")} — the merge layer dedups since PR #6, so something is writing around it. Find the bypass before it re-pollutes the banks.`);
  } else if ((bankDupTotal ?? 0) > 0) {
    reasons.push(`INFO DUP: ${bankDupTotal} duplicate item(s) across live banks — below the per-bank alert thresholds (≥${CONTENT_DUP_MIN_COUNT} items or ≥${CONTENT_DUP_MIN_RATE * 100}%). Watch the trend.`);
  }
}

// ── 4. Append history row + trend analysis ───────────────────────────────
const today = NOW.toISOString().slice(0, 10);
// Only trust overall scores when BS staging was actually scored. If staging
// is absent (bsPersonFrac null), the per-bank 0-scores would pollute the
// trend, so record null instead of a misleading low number.
const scored = bsPersonFrac != null;
const row = {
  date: today,
  session,
  stale_hours: staleHours != null ? Number(staleHours.toFixed(1)) : null,
  overall_diversity: scored ? overallDiv : null,
  overall_quality: scored ? overallQual : null,
  bs_person_frac: bsPersonFrac != null ? Number(bsPersonFrac.toFixed(3)) : null,
  bs_distractor_top_frac: bsTopDistractorFrac != null ? Number(bsTopDistractorFrac.toFixed(3)) : null,
  bs_distinct_distractors: bsDistinctDistractors,
  bs_single_word_chunk_frac: bsSingleWordChunkRatio != null ? Number(bsSingleWordChunkRatio.toFixed(3)) : null,
  bs_avg_eff_chunks: bsAvgEffChunks != null ? Number(bsAvgEffChunks.toFixed(2)) : null,
  bs_second_person_frac: bsSecondPersonFrac != null ? Number(bsSecondPersonFrac.toFixed(3)) : null,
  bs_diversity: bsDiv,
  bs_quality: bsQual,
  // Merge-layer hardening metrics (§3.5) — trended so a slow re-pollution is visible.
  staging_backlog: stagingBacklog,
  bank_dup_total: bankDupTotal,
  oldest_bank_hours: oldestBankHours != null ? Number(oldestBankHours.toFixed(1)) : null,
};

// Read existing history, dedup today (re-runs overwrite the day's row)
let history = [];
if (existsSync(HISTORY)) {
  history = readFileSync(HISTORY, "utf8").split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
history = history.filter((r) => r.date !== today);
history.push(row);
// Keep last 60 rows
const trimmed = history.slice(-60);
writeFileSync(HISTORY, trimmed.map((r) => JSON.stringify(r)).join("\n") + "\n");

// Trend: compare avg diversity of last 3 vs prior 3 (need ≥6 rows w/ values)
const withDiv = trimmed.filter((r) => typeof r.overall_diversity === "number");
if (withDiv.length >= 6) {
  const last3 = withDiv.slice(-3);
  const prior3 = withDiv.slice(-6, -3);
  const avg = (a) => a.reduce((s, r) => s + r.overall_diversity, 0) / a.length;
  const drop = avg(prior3) - avg(last3);
  if (drop > 8) {
    reasons.push(`TREND_DOWN: overall diversity 3-day avg fell ${drop.toFixed(1)} pts (${avg(prior3).toFixed(0)} → ${avg(last3).toFixed(0)}). Slow regression — gate thresholds or prompt may need review.`);
  }
}
// Person-frac trend (BS)
const withPerson = trimmed.filter((r) => typeof r.bs_person_frac === "number");
if (withPerson.length >= 6) {
  const last3 = withPerson.slice(-3);
  const avgP = last3.reduce((s, r) => s + r.bs_person_frac, 0) / last3.length;
  if (avgP > 0.42) {
    reasons.push(`TREND_DOWN: BS person-prefilled 3-day avg is ${Math.round(avgP * 100)}% — creeping toward the ${Math.round(PERSON_PREFILLED_GATE * 100)}% gate (TPO target 30%). Individual nights may pass but the trend is drifting up.`);
  }
}
// Chunk single-word-ratio trend (BS) — chunk granularity is intentionally NOT
// hard-gated (over-tightening risks over-split ambiguity), so we watch the
// TREND instead of any single batch. TPO is ~77%; flag when the 3-day average
// over-bundles below 55%. A single low batch (e.g. 48%) is just wobble.
const withChunk = trimmed.filter((r) => typeof r.bs_single_word_chunk_frac === "number");
if (withChunk.length >= 3) {
  const last3 = withChunk.slice(-3);
  const avgC = last3.reduce((s, r) => s + r.bs_single_word_chunk_frac, 0) / last3.length;
  if (avgC < 0.55) {
    reasons.push(`TREND_DOWN: BS chunk single-word ratio 3-day avg is ${Math.round(avgC * 100)}% (TPO ~77%) — sustained over-bundling into fewer/longer chunks. Recalibrate the chunk-rule prompt block; this is the soft-dimension drift the gate doesn't catch.`);
  }
}

// ── 5. Verdict + report ──────────────────────────────────────────────────
const hardReasons = reasons.filter((r) => !r.startsWith("INFO"));
const regression = hardReasons.length > 0;
const staleDetected = hardReasons.some((r) => r.startsWith("STALE"));

const lines = [];
lines.push(`# 题库质量监控 — ${today}`);
lines.push("");
lines.push(regression ? "## ⚠️ 检测到退化 / 异常" : "## ✅ 一切正常");
lines.push("");
lines.push("**最新一轮**");
lines.push(`- Session: \`${session || "(无)"}\``);
lines.push(`- 完成于: ${completedAt || "(无)"} ${staleHours != null ? `(${staleHours.toFixed(1)}h 前)` : ""}`);
lines.push(`- 整体多样性: ${overallDiv ?? "—"}/100 · 整体质量: ${overallQual ?? "—"}/100`);
lines.push(`- BS 人物当 prefilled: ${bsPersonFrac != null ? Math.round(bsPersonFrac * 100) + "%" : "—"} (闸 ${Math.round(PERSON_PREFILLED_GATE * 100)}%, TPO 30%)`);
lines.push(`- TPO 校准自检: ${tpoRatio != null ? Math.round(tpoRatio * 100) + "% (应在 25-45%)" : "未能测量"}`);
lines.push(`- Bank 新鲜度: 最旧 ${oldestBankFile || "?"} ${oldestBankHours != null ? oldestBankHours.toFixed(0) + "h 前更新" : "—"} (阈 ${BANK_STALE_HOURS}h)`);
lines.push(`- Staging 未合并积压: ${stagingBacklog} 条 (含存量死档; 判警看 7 日增量 >${STAGING_BACKLOG_GROWTH})`);
lines.push(`- Live 库内容重复: ${bankDupTotal ?? "—"} 条`);
lines.push("");
if (regression) {
  lines.push("**问题清单**");
  for (const r of hardReasons) lines.push(`- ${r}`);
  lines.push("");
  if (staleDetected) {
    lines.push("**自动修复**: R1 routine 似乎没跑 — 本监控已 dispatch 兜底 workflow `nightly-bank-refresh.yml` (DeepSeek 管线) 保证题库当天仍有新题。请检查 claude.ai routine 是否被禁用 / PAT 是否过期。");
  } else {
    lines.push("**建议**: 上述为质量趋势/机制问题,不宜盲目自动重生成。请人工查看 — 多半是 prompt 需加强或 gate 阈值需复核。");
  }
} else {
  lines.push("最新一轮通过全部检查;趋势平稳。无需操作。");
}
lines.push("");
lines.push("---");
lines.push(`历史: 最近 ${trimmed.length} 天记录在 data/.quality-history.jsonl`);
const recent = trimmed.slice(-7);
if (recent.length) {
  lines.push("");
  lines.push("| 日期 | 整体多样性 | 整体质量 | BS人物prefilled |");
  lines.push("| --- | --- | --- | --- |");
  for (const r of recent) {
    lines.push(`| ${r.date} | ${r.overall_diversity ?? "—"} | ${r.overall_quality ?? "—"} | ${r.bs_person_frac != null ? Math.round(r.bs_person_frac * 100) + "%" : "—"} |`);
  }
}
writeFileSync(REPORT, lines.join("\n") + "\n");

// ── 6. stdout signals for the workflow ───────────────────────────────────
console.log(lines.join("\n"));
console.log("");
console.log(`regression=${regression ? "yes" : "no"}`);
console.log(`stale=${staleDetected ? "yes" : "no"}`);
