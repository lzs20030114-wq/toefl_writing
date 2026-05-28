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
};
const BANK_FILES = {
  bs: "data/buildSentence/questions.json",
  discussion: "data/academicWriting/prompts.json",
  email: "data/emailWriting/prompts.json",
  "reading-ap": "data/reading/bank/ap.json",
  "reading-ctw": "data/reading/bank/ctw.json",
  "reading-rdl-short": "data/reading/bank/rdl-short.json",
  "reading-rdl-long": "data/reading/bank/rdl-long.json",
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
    return 0;
  } catch { return 0; }
}

// ── Build per-bank result rows ───────────────────────────────────────
// meta.results is keyed by bank name. Each value is:
//   { generated, accepted, pass, retried_after_fail, topics, failure_reason }
const results = meta.results || {};

const bankOrder = ["bs", "discussion", "email", "reading-ap", "reading-ctw", "reading-rdl-short", "reading-rdl-long"];

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
console.log(`日期: **${today}** · 模型: Claude Opus 4.7 · 用时: ${meta.duration_minutes || "—"} 分钟`);
console.log(`📊 **多样性 ${scores.overall.diversity}/100  ·  质量 ${scores.overall.quality}/100**\n`);

// Per-bank line summary
for (const r of rows) {
  // Join with " · " so individual topics that contain "/" (e.g. "物理 / 声学")
  // remain visually distinct.
  const topicSnippet = r.topics.length > 0
    ? `  (${r.topics.slice(0, 4).join(" · ")}${r.topics.length > 4 ? " ..." : ""})`
    : "";
  const noteSnippet = r.note ? `  — ${r.note}` : "";
  const s = scores.perBank[r.bank];
  const totalForBank = r.accepted + r.r2_items_added;
  const scoreSnippet = (s && totalForBank > 0)
    ? `  [多样性 ${s.diversity.score} / 质量 ${s.quality.score}]`
    : "";
  if (totalForBank === 0) {
    console.log(`${r.icon} **${r.label}** — 0 道${noteSnippet}`);
  } else if (r.r2_items_added > 0) {
    console.log(`${r.icon} **${r.label}** — ${r.accepted}+${r.r2_items_added} 道${topicSnippet}${scoreSnippet}${noteSnippet}`);
  } else {
    console.log(`${r.icon} **${r.label}** — ${r.accepted} 道${topicSnippet}${scoreSnippet}${noteSnippet}`);
  }
}

console.log(`\n题库总数: **${totalBefore} → ${totalNow}**\n`);

// Highlight (one-liner from agent)
if (meta.highlight) {
  console.log(`本批亮点: ${meta.highlight}\n`);
}

// Sample preview — show 1-2 favorites
const favs = rows.filter((r) => r.favorite && r.accepted > 0);
if (favs.length > 0) {
  console.log("## 样题预览\n");
  // Always show BS favorite if available
  const bsFav = favs.find((r) => r.bank === "bs");
  if (bsFav) {
    const f = bsFav.favorite;
    console.log(`**造句:**`);
    console.log(`> ${f.prompt || ""}`);
    console.log(`> 答案: ${f.answer || ""}\n`);
  }
  // One more random favorite from a different category
  const otherFav = favs.find((r) => r.bank !== "bs");
  if (otherFav) {
    const f = otherFav.favorite;
    console.log(`**${otherFav.label}${f.subtopic ? ` (${f.subtopic})` : ""}:**`);
    if (f.preview) console.log(`> ${f.preview.slice(0, 200)}${f.preview.length > 200 ? "..." : ""}\n`);
  }
}

// Score breakdown — per-bank detail. Always rendered so you can see WHY a
// score is what it is, not just the number.
console.log("## 评分明细\n");
console.log("| 品类 | 多样性 | 质量 |");
console.log("| --- | --- | --- |");
for (const r of rows) {
  const s = scores.perBank[r.bank];
  if (!s || r.accepted === 0) {
    console.log(`| ${r.label} | — | — |`);
    continue;
  }
  const divDetail = s.diversity.breakdown.join(" · ");
  const qualDetail = s.quality.breakdown.join(" · ");
  console.log(`| ${r.label} | **${s.diversity.score}** — ${divDetail} | **${s.quality.score}** — ${qualDetail} |`);
}
console.log("");
console.log("> *多样性 100 = 所有维度 distinct / 均衡;质量 100 = 每道题都落在 TPO 校准的目标区间。整体分按本批 item 数加权平均。*\n");

// Anomaly / retry log
const anomalies = [];
for (const r of retriedRows) anomalies.push(`- **${r.label}**: 第一轮失败 (${r.failure_reason || "原因略"}), routine 自动重试,第二轮通过 ✓`);
for (const r of failedRows) anomalies.push(`- ⚠️ **${r.label}**: 两轮都失败. 原因: ${r.failure_reason || "未知"}`);
if (anomalies.length > 0) {
  console.log("## 异常 / 自愈记录\n");
  console.log(anomalies.join("\n"));
  console.log("");
  if (failedRows.length > 0) {
    console.log("如果某品类连续 3 天失败, 请手动跑现有 nightly workflow 兜底:");
    console.log("https://github.com/lzs20030114-wq/toefl_writing/actions/workflows/nightly-bank-refresh.yml");
    console.log("");
  }
} else {
  console.log("异常: 无\n");
}

// Footer — metadata for traceability
console.log("---");
console.log(`Session: \`${meta.session_id || "?"}\``);
if (meta.commit_sha) {
  console.log(`Commit: [${meta.commit_sha.slice(0, 7)}](https://github.com/lzs20030114-wq/toefl_writing/commit/${meta.commit_sha})`);
}
console.log("下次自动运行: 明早 03:00 北京");
