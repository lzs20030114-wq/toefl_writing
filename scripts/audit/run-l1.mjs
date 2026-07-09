#!/usr/bin/env node
// L1 — 客观题答案正确性全量二审（FULL-QUALITY-AUDIT-PLAN-2026-07-09 第二层）。
// 独立 AI(DeepSeek)不看答案键自己作答，与标准答案比对；fail-closed 出嫌疑清单，不自动删。
//   阅读 ap/rdl-short/rdl-long/ctw — lib/readingGen/answerAuditor(合库层同款)
//   听力 lat/lc/la/lcr           — lib/listeningGen/*Auditor(§7 P1-9 首次接线)
//   BS/写作主观题不在本层(BS 生成期已有 consistency 检查; 主观题走 L2)。
//
// 断点续跑：进度落 L1-state.json(每 10 条保存)；重跑跳过已有结论、只重试 error。
// 时间预算：MAX_MINUTES(默认 300)到点优雅收尾写报告——GH Actions 超时前自己停，
// 提交 state 后再次 dispatch 即接着跑。
//
// 用法：DEEPSEEK_API_KEY=... node scripts/audit/run-l1.mjs [--banks=ap,lcr] [--limit=N]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATE = "2026-07-09";
const OUT_DIR = join(ROOT, "data/claudeGen/reports", `FULL-AUDIT-${DATE}`);
mkdirSync(OUT_DIR, { recursive: true });
const STATE_PATH = join(OUT_DIR, "L1-state.json");

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const MAX_MS = (Number(process.env.MAX_MINUTES) || 300) * 60000;
const T0 = Date.now();

const rd = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

// 听力审计器的注入式 callAI —— 与 answerAuditor 内置客户端同款(deepseek-chat, 低温)。
async function listeningCallAI(prompt, maxTokens = 2000) {
  const { callDeepSeekViaCurl } = require("../../lib/ai/deepseekHttp.js");
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");
  const payload = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "You are a TOEFL listening comprehension expert. Answer precisely and concisely. Return only valid JSON." },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    max_tokens: maxTokens,
  };
  const result = await callDeepSeekViaCurl({ apiKey, payload, timeoutMs: 60000 });
  return typeof result === "string" ? result : (result?.choices?.[0]?.message?.content || JSON.stringify(result));
}

const { auditRDLItem, auditCTWItem } = require("../../lib/readingGen/answerAuditor.js");
const { auditLATItem } = require("../../lib/listeningGen/latAuditor.js");
const { auditLCItem } = require("../../lib/listeningGen/lcAuditor.js");
const { auditLAItem } = require("../../lib/listeningGen/laAuditor.js");
const { auditLCRItem } = require("../../lib/listeningGen/lcrAuditor.js");

// verdict 归一：ok / suspect(答案不一致) / ambiguous(多解嫌疑) / error(暂态, 重跑会重试)
function fromReading(a) {
  if (a?.error) return { v: "error", d: String(a.error).slice(0, 120) };
  if ((a?.criticalFlags || 0) > 0) return { v: "suspect", d: `criticalFlags=${a.criticalFlags}` };
  return { v: "ok" };
}
function fromListening(a) {
  if (a?.error) return { v: "error", d: String(a.errorMsg || "audit error").slice(0, 120) };
  if (a?.match === false) return { v: "suspect", d: (a.details || []).map((x) => JSON.stringify(x)).join("; ").slice(0, 200) };
  if (a?.ambiguous === true) return { v: "ambiguous", d: (a.details || []).map((x) => JSON.stringify(x)).join("; ").slice(0, 200) };
  return { v: "ok" };
}

const BANKS = [
  { key: "ap", path: "data/reading/bank/ap.json", audit: async (it) => fromReading(await auditRDLItem({ ...it, text: it.passage })) },
  { key: "rdl-short", path: "data/reading/bank/rdl-short.json", audit: async (it) => fromReading(await auditRDLItem(it)) },
  { key: "rdl-long", path: "data/reading/bank/rdl-long.json", audit: async (it) => fromReading(await auditRDLItem(it)) },
  { key: "ctw", path: "data/reading/bank/ctw.json", audit: async (it) => fromReading(await auditCTWItem(it)) },
  { key: "lat", path: "data/listening/bank/lat.json", audit: async (it) => fromListening(await auditLATItem(it, listeningCallAI)) },
  { key: "lc", path: "data/listening/bank/lc.json", audit: async (it) => fromListening(await auditLCItem(it, listeningCallAI)) },
  { key: "la", path: "data/listening/bank/la.json", audit: async (it) => fromListening(await auditLAItem(it, listeningCallAI)) },
  { key: "lcr", path: "data/listening/bank/lcr.json", audit: async (it) => fromListening(await auditLCRItem(it, listeningCallAI)) },
];
const pick = args.banks ? String(args.banks).split(",").map((s) => s.trim()) : null;
const banks = pick ? BANKS.filter((b) => pick.includes(b.key)) : BANKS;

const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {};
const saveState = () => writeFileSync(STATE_PATH, JSON.stringify(state, null, 1));

let outOfTime = false;
for (const b of banks) {
  if (outOfTime) break;
  const items = (rd(b.path).items || []).slice(0, LIMIT);
  const done = (state[b.key] ||= {});
  const todo = items.filter((it) => !done[it.id] || done[it.id].v === "error");
  console.log(`\n═══ ${b.key}: ${items.length} 条, 待审 ${todo.length} ═══`);
  let n = 0;
  for (const it of todo) {
    if (Date.now() - T0 > MAX_MS) { console.log("⏱ 到达时间预算, 优雅收尾(state 已存, 再次运行续跑)"); outOfTime = true; break; }
    let verdict;
    try { verdict = await b.audit(it); } catch (e) { verdict = { v: "error", d: String(e.message).slice(0, 120) }; }
    done[it.id] = verdict;
    n++;
    if (verdict.v !== "ok") console.log(`  ${verdict.v === "error" ? "⏸" : "✗"} ${it.id}: ${verdict.v}${verdict.d ? " — " + verdict.d.slice(0, 100) : ""}`);
    if (n % 10 === 0) { saveState(); console.log(`  … ${n}/${todo.length}`); }
  }
  saveState();
}

// ── 报告 ──────────────────────────────────────────────────────────────
const L = [`# L1 答案正确性二审 — ${DATE}`, "", "| 库 | 已审 | ok | suspect | ambiguous | error(待重试) |", "|---|---|---|---|---|---|"];
const suspects = {};
let allDone = true;
for (const b of BANKS) {
  const total = (rd(b.path).items || []).length;
  const done = state[b.key] || {};
  const cnt = { ok: 0, suspect: 0, ambiguous: 0, error: 0 };
  for (const [id, r] of Object.entries(done)) {
    cnt[r.v] = (cnt[r.v] || 0) + 1;
    if (r.v === "suspect" || r.v === "ambiguous") ((suspects[b.key] ||= [])).push({ id, ...r });
  }
  const audited = Object.keys(done).length;
  if (audited - cnt.error < total) allDone = false;
  L.push(`| ${b.key} | ${audited}/${total} | ${cnt.ok} | ${cnt.suspect} | ${cnt.ambiguous} | ${cnt.error} |`);
}
L.push("", allDone ? "**状态：全部审完。**" : "**状态：未完(时间预算/暂态错误)——再次运行会从断点续跑。**");
L.push("", "嫌疑明细见 L1-suspects.json；fail-closed 原则：嫌疑仅入清单待 L3 人审，不自动删。");
writeFileSync(join(OUT_DIR, "L1-report.md"), L.join("\n") + "\n");
writeFileSync(join(OUT_DIR, "L1-suspects.json"), JSON.stringify(suspects, null, 1));
console.log("\n" + L.join("\n"));
