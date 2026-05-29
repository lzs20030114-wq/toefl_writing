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

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { scoreBatch, PERSON_PREFILLED_GATE } from "../lib/quality/scoreBatch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const META = resolve(ROOT, "data/.routine-meta.json");
const HISTORY = resolve(ROOT, "data/.quality-history.jsonl");
const REPORT = resolve(ROOT, "data/.quality-monitor-report.md");
const TPO = resolve(ROOT, "data/buildSentence/tpo_source.md");

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
if (meta && session) {
  try {
    const scores = scoreBatch(ROOT, session, meta.results || {});
    overallDiv = scores.overall.diversity;
    overallQual = scores.overall.quality;
    const bs = scores.perBank.bs;
    if (bs && bs.diversity && bs.diversity.detail && typeof bs.diversity.detail.personFrac === "number") {
      bsPersonFrac = bs.diversity.detail.personFrac;
      bsDiv = bs.diversity.score;
      bsQual = bs.quality.score;
      if (bsPersonFrac > PERSON_PREFILLED_GATE) {
        reasons.push(`PERSON_DRIFT: BS person-as-prefilled is ${Math.round(bsPersonFrac * 100)}% (> ${Math.round(PERSON_PREFILLED_GATE * 100)}% gate) in the FINAL committed batch — R1 flagged it but R2 did not bring it down. Prompt may need strengthening.`);
      }
    } else {
      // staging for this session not present (cleaned) — not necessarily a problem
      reasons.push(`INFO: could not score BS for session ${session} (staging absent) — skipping person/diversity check this run.`);
    }
  } catch (e) {
    reasons.push(`INFO: scoreBatch failed (${e.message}) — skipping diversity check.`);
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
  bs_diversity: bsDiv,
  bs_quality: bsQual,
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
