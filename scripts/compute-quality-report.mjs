#!/usr/bin/env node
// Generates the Chinese-language email body that the Claude routine commits as
// data/.last-nightly-summary.md and the send-nightly-email.yml workflow then
// emails to the user.
//
// Reads:
//   - data/.routine-meta.json (written by the routine agent: session id,
//     per-pass counts per bank, "favorites" sample picks, highlight phrase,
//     PASS 2 retry log)
//   - staging files matching the session id (for topic extraction + sample
//     content)
//   - 7 main bank files (for "total now" counts and bank delta verification)
//
// Outputs:
//   - markdown to stdout — the agent redirects this to
//     data/.last-nightly-summary.md before committing
//
// Design constraints (per user spec):
//   - Total readable in 30 seconds
//   - No technical jargon
//   - One emoji per bank line (🟢 success / 🟡 retry-succeeded / 🔴 failed)
//   - Subject line at top tells full status at-a-glance
//   - Detailed diagnostic block ONLY when something is off (acceptance <80%
//     OR PASS 2 still failed)

import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { scoreBatch } from "../lib/quality/scoreBatch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const META_PATH = join(ROOT, "data/.routine-meta.json");

function readJSON(p, fallback = null) {
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch { return fallback; }
}

const meta = readJSON(META_PATH);
if (!meta) {
  // Bail out gracefully — produce a minimal error report so the email still
  // sends with useful info.
  console.log(`# ❌ 凌晨题库失败 — ${new Date().toISOString().slice(0, 10)}\n`);
  console.log("Routine 没有写出 `data/.routine-meta.json`,大概率 agent 在 Phase 2 之前就挂了。");
  console.log("\n建议: 打开 [routine session log](https://claude.ai/code/routines) 看错误。");
  process.exit(0);
}

// ── Bank label maps ──────────────────────────────────────────────────
const BANK_DISPLAY = {
  bs: "造句 (BS)",
  discussion: "学术讨论",
  email: "邮件写作",
  "reading-ap": "阅读 AP",
  "reading-ctw": "阅读 CTW",
  "reading-rdl-short": "阅读 RDL-短",
  "reading-rdl-long": "阅读 RDL-长",
  "listening-lat": "听力 讲座",
  "listening-lc": "听力 对话",
  "listening-la": "听力 通知",
  "listening-lcr": "听力 短回应",
  "speaking-repeat": "口语 跟读",
};
const BANK_FILES = {
  bs: "data/buildSentence/questions.json",
  discussion: "data/academicWriting/prompts.json",
  email: "data/emailWriting/prompts.json",
  "reading-ap": "data/reading/bank/ap.json",
  "reading-ctw": "data/reading/bank/ctw.json",
  "reading-rdl-short": "data/reading/bank/rdl-short.json",
  "reading-rdl-long": "data/reading/bank/rdl-long.json",
  "listening-lat": "data/listening/bank/lat.json",
  "listening-lc": "data/listening/bank/lc.json",
  "listening-la": "data/listening/bank/la.json",
  "listening-lcr": "data/listening/bank/lcr.json",
  "speaking-repeat": "data/speaking/bank/repeat.json",
};

function bankTotal(bankKey) {
  const f = BANK_FILES[bankKey];
  if (!f) return 0;
  try {
    const j = readJSON(join(ROOT, f));
    if (bankKey === "bs") {
      return (j?.question_sets || []).reduce((s, set) => s + (set.questions?.length || 0), 0);
    }
    if (Array.isArray(j)) return j.length;
    if (Array.isArray(j?.items)) return j.items.length;
    if (Array.isArray(j?.sets)) return j.sets.length; // speaking-repeat bank
    return 0;
  } catch { return 0; }
}

// ── Build per-bank result rows ───────────────────────────────────────
// meta.results is keyed by bank name. Each value is:
//   { generated, accepted, pass, retried_after_fail, topics, failure_reason }
const results = meta.results || {};

const bankOrder = ["bs", "discussion", "email", "reading-ap", "reading-ctw", "reading-rdl-short", "reading-rdl-long", "listening-lat", "listening-lc", "listening-la", "listening-lcr", "speaking-repeat"];

function statusFor(r) {
  if (!r) return { icon: "⚪", note: "未执行" };
  if (r.accepted > 0 && r.r2_supplemented) return { icon: "🟡", note: `R2 补 +${r.r2_items_added || 0}` };
  if (r.accepted > 0 && !r.retried_after_fail) return { icon: "🟢", note: "" };
  if (r.accepted > 0 && r.retried_after_fail) return { icon: "🟡", note: "第二轮救回" };
  return { icon: "🔴", note: r.failure_reason || "失败" };
}

const rows = bankOrder.map((bank) => {
  const r = results[bank] || {};
  const st = statusFor(r);
  return {
    bank,
    label: BANK_DISPLAY[bank],
    icon: st.icon,
    note: st.note,
    // accepted = R1's count. r2_items_added is R2's supplement (if any).
    // Total displayed = accepted + (r2_items_added || 0).
    accepted: r.accepted || 0,
    r2_items_added: r.r2_items_added || 0,
    generated: r.generated || 0,
    topics: Array.isArray(r.topics) ? r.topics : [],
    favorite: r.favorite || null,
    failure_reason: r.failure_reason || null,
    retried_after_fail: !!r.retried_after_fail,
    r2_supplemented: !!r.r2_supplemented,
  };
});

// ── Aggregate ─────────────────────────────────────────────────────────
// totalAccepted = R1's count + R2's supplements
const totalAccepted = rows.reduce((s, r) => s + r.accepted + r.r2_items_added, 0);
const failedRows = rows.filter((r) => (r.accepted + r.r2_items_added) === 0);
const retriedRows = rows.filter((r) => r.retried_after_fail && r.accepted > 0);
const r2SupplementedRows = rows.filter((r) => r.r2_supplemented);

// ── Score this batch (diversity + quality) ────────────────────────────
// Reads each bank's staging file and scores it against a "perfect batch"
// (all axes distinct/balanced + every item inside TPO-calibrated ranges).
// Overall = item-weighted average across banks.
const scores = scoreBatch(ROOT, meta.session_id || "", results);

// ── Independent answer-audit receipt (if the audit routine ran) ───────
// Written by scripts/routine-audit.mjs apply. If it's missing or for a different
// session, the audit did NOT run for this batch — we say "二审 未运行" plainly so a
// structural "质量 100" never masquerades as verified answer-correctness.
const audit = readJSON(join(ROOT, "data/.audit-report.json"));
// Match R1's session OR R2's (on retry nights R2's inline audit overwrites the
// receipt with its own session id, while meta.session_id stays R1's).
const auditValid = !!(audit && audit.totals && (audit.session === meta.session_id || audit.session === meta.r2_session_id));
const auditSummary = auditValid
  ? `二审 ${audit.totals.matched}/${audit.totals.questions} 一致${audit.totals.rejected_items ? ` · 剔除 ${audit.totals.rejected_items} 道` : ""}`
  : "二审 未运行";

// Total bank size before and after
const totalNowByBank = Object.fromEntries(bankOrder.map((b) => [b, bankTotal(b)]));
const totalNow = Object.values(totalNowByBank).reduce((s, v) => s + v, 0);
const totalBefore = totalNow - totalAccepted;

// Overall status header
let header;
if (failedRows.length === 0 && retriedRows.length === 0 && r2SupplementedRows.length === 0) {
  header = `✅ 题库更新成功 — 今天加了 ${totalAccepted} 道`;
} else if (failedRows.length === 0 && r2SupplementedRows.length > 0) {
  header = `✅ 题库更新成功 — 今天加了 ${totalAccepted} 道(${r2SupplementedRows.length} 个品类 R2 补救)`;
} else if (failedRows.length === 0 && retriedRows.length > 0) {
  header = `✅ 题库更新成功 — 今天加了 ${totalAccepted} 道(${retriedRows.length} 个品类第二轮才过)`;
} else if (totalAccepted > 0) {
  header = `⚠️ 题库部分更新 — 加了 ${totalAccepted} 道,${failedRows.length} 个品类失败`;
} else {
  header = `❌ 凌晨题库失败 — 0 道入库`;
}

// ── Print the email body ──────────────────────────────────────────────
const today = (meta.completed_at || new Date().toISOString()).slice(0, 10);

console.log(`# ${header}\n`);
console.log(`${today} · 用时 ${meta.duration_minutes || "—"} 分钟`);
console.log(`📊 多样性 ${scores.overall.diversity} · 质量 ${scores.overall.quality} · ${auditSummary}\n`);

// Per-bank one-liners: count + topics. Scores are NOT shown here — only the
// "需要注意" block below surfaces a score, and only when it's actually low.
for (const r of rows) {
  const totalForBank = r.accepted + r.r2_items_added;
  if (totalForBank === 0) {
    console.log(`${r.icon} ${r.label} — 0 道${r.note ? `  (${r.note})` : ""}`);
    continue;
  }
  const cnt = r.r2_items_added > 0 ? `${r.accepted}+${r.r2_items_added}` : `${r.accepted}`;
  const topicSnippet = r.topics.length > 0
    ? `  (${r.topics.slice(0, 4).join(" · ")}${r.topics.length > 4 ? " …" : ""})`
    : "";
  console.log(`${r.icon} ${r.label} — ${cnt} 道${topicSnippet}`);
}

console.log(`\n题库总数: ${totalBefore} → ${totalNow}`);
if (meta.highlight) console.log(`亮点: ${meta.highlight}`);

// Sample preview — one BS + one other, kept short.
const favs = rows.filter((r) => r.favorite && r.accepted > 0);
const bsFav = favs.find((r) => r.bank === "bs");
const otherFav = favs.find((r) => r.bank !== "bs");
if (bsFav || otherFav) {
  console.log("\n## 样题");
  if (bsFav) console.log(`- 造句: ${bsFav.favorite.prompt || ""} → ${bsFav.favorite.answer || ""}`);
  if (otherFav && otherFav.favorite.preview) {
    console.log(`- ${otherFav.label}: ${otherFav.favorite.preview.slice(0, 140)}${otherFav.favorite.preview.length > 140 ? "…" : ""}`);
  }
}

// ── 需要注意 — ONLY the banks/issues that need a human look ──────────────
// Replaces the always-on 12-row breakdown table. A bank shows up here only if it
// failed, was retried, scored below a soft threshold, or had an item dropped by
// the answer-audit. Clean batches print "全部正常".
const notes = [];
for (const r of rows) {
  const s = scores.perBank[r.bank];
  const total = r.accepted + r.r2_items_added;
  if (total === 0) { notes.push(`🔴 ${r.label}: 未入库 — ${r.failure_reason || "失败"}`); continue; }
  if (r.retried_after_fail) notes.push(`🟡 ${r.label}: 第一轮失败,第二轮救回`);
  if (!s) continue;
  if (s.diversity.score < 90) notes.push(`🟡 ${r.label}: 多样性 ${s.diversity.score} — ${s.diversity.breakdown.join(" · ")}`);
  if (s.quality.score < 90) notes.push(`🟡 ${r.label}: 质量 ${s.quality.score} — ${s.quality.breakdown.join(" · ")}`);
}
// Answer-audit: list dropped items, or warn loudly if the audit never ran.
if (auditValid) {
  for (const m of (audit.rejected || [])) {
    const bankTag = m.file.replace(/-routine.*$/, "").replace(/-r2.*$/, "");
    notes.push(`🔴 二审剔除 (${bankTag}): 标注=${m.marked} / 模型=${m.claude} — ${m.stem || ""}`);
  }
} else {
  notes.push(`⚠️ 二审未运行 — 本批"质量"仅代表结构合规,答案正确性未独立核验`);
}

console.log("\n## 需要注意");
console.log(notes.length ? notes.join("\n") : "全部正常 ✓");
if (failedRows.length > 0) {
  console.log("\n连续失败可手动兜底: https://github.com/lzs20030114-wq/toefl_writing/actions/workflows/nightly-bank-refresh.yml");
}

// Footer
console.log("\n---");
console.log(`Session: \`${meta.session_id || "?"}\` · 下次 03:00 北京`);
