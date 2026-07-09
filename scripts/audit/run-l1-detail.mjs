#!/usr/bin/env node
// L1.5 — 嫌疑复审明细（FULL-AUDIT L1 的补充跑批）。
// L1 全量跑完后 state 只留了 "criticalFlags=N" 摘要，具体哪道小题/哪个空、AI 给了什么
// 全被丢掉，没法直接进 L3 人审。本脚本只对 L1 嫌疑清单(182 条)用同款 auditor 复审一遍，
// 保留完整逐题明细 + 复现性标记（复审未复现的嫌疑=边缘案例，人审可降级），
// 产出 JSON + 可直接人审的 markdown。fail-closed：只出明细，不动题库。
//
// 输入：data/claudeGen/reports/FULL-AUDIT-2026-07-09/l3/suspect-input.json
//       （= L1-suspects.json 全部审完版的快照，{bank: [{id, v, d}]}）
// 输出：同目录 L1-suspect-details.json / L1-suspect-details.md / L1-detail-state.json
//
// 断点续跑：state 每 5 条落盘；重跑跳过已有结论、只重试 error。
// 用法：DEEPSEEK_API_KEY=... node scripts/audit/run-l1-detail.mjs [--banks=ctw,ap] [--limit=N]
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = join(ROOT, "data/claudeGen/reports/FULL-AUDIT-2026-07-09/l3");
const INPUT_PATH = join(OUT_DIR, "suspect-input.json");
const STATE_PATH = join(OUT_DIR, "L1-detail-state.json");

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const MAX_MS = (Number(process.env.MAX_MINUTES) || 120) * 60000;
const T0 = Date.now();

const rd = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

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

const BANKS = {
  "ap": { path: "data/reading/bank/ap.json", kind: "mcq", audit: (it) => auditRDLItem({ ...it, text: it.passage }) },
  "rdl-short": { path: "data/reading/bank/rdl-short.json", kind: "mcq", audit: (it) => auditRDLItem(it) },
  "rdl-long": { path: "data/reading/bank/rdl-long.json", kind: "mcq", audit: (it) => auditRDLItem(it) },
  "ctw": { path: "data/reading/bank/ctw.json", kind: "ctw", audit: (it) => auditCTWItem(it) },
  "lat": { path: "data/listening/bank/lat.json", kind: "listening", audit: (it) => auditLATItem(it, listeningCallAI) },
  "lc": { path: "data/listening/bank/lc.json", kind: "listening", audit: (it) => auditLCItem(it, listeningCallAI) },
  "la": { path: "data/listening/bank/la.json", kind: "listening", audit: (it) => auditLAItem(it, listeningCallAI) },
  "lcr": { path: "data/listening/bank/lcr.json", kind: "listening", audit: (it) => auditLCRItem(it, listeningCallAI) },
};

const input = JSON.parse(readFileSync(INPUT_PATH, "utf8"));
const pick = args.banks ? String(args.banks).split(",").map((s) => s.trim()) : null;

const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {};
const saveState = () => writeFileSync(STATE_PATH, JSON.stringify(state, null, 1));

// listening auditor 抛错时返回 {error:true}；reading auditor 返回 {error:"..."}——统一判 error
const isErr = (r) => !!(r && r.error);

let outOfTime = false;
for (const [bank, suspects] of Object.entries(input)) {
  if (outOfTime) break;
  if (pick && !pick.includes(bank)) continue;
  const cfg = BANKS[bank];
  if (!cfg) { console.log(`⚠ 未知库 ${bank}, 跳过`); continue; }
  const byId = new Map((rd(cfg.path).items || []).map((it) => [it.id, it]));
  const done = (state[bank] ||= {});
  const todo = suspects.slice(0, LIMIT).filter((s) => !done[s.id] || isErr(done[s.id]));
  console.log(`\n═══ ${bank}: 嫌疑 ${suspects.length} 条, 待复审 ${todo.length} ═══`);
  let n = 0;
  for (const s of todo) {
    if (Date.now() - T0 > MAX_MS) { console.log("⏱ 到达时间预算, 优雅收尾(state 已存, 再次运行续跑)"); outOfTime = true; break; }
    const item = byId.get(s.id);
    if (!item) { done[s.id] = { error: `item ${s.id} not found in bank` }; continue; }
    let result;
    try { result = await cfg.audit(item); } catch (e) { result = { error: String(e.message).slice(0, 200) }; }
    done[s.id] = result;
    n++;
    if (n % 5 === 0) { saveState(); console.log(`  … ${n}/${todo.length}`); }
  }
  saveState();
}

// ── 复现性归类 + 渲染 ────────────────────────────────────────────────
// reproduced: 复审仍出同类嫌疑；not_reproduced: 复审干净(边缘案例, 人审可降级); error: 待重试
function classify(kind, r) {
  if (isErr(r)) return "error";
  if (kind === "mcq" || kind === "ctw") return (r.criticalFlags || 0) > 0 ? "reproduced" : "not_reproduced";
  return r.match === false ? "reproduced" : (r.ambiguous === true ? "ambiguous" : "not_reproduced");
}

const optionsBlock = (q) => q && q.options
  ? Object.entries(q.options).map(([k, v]) => `    - ${k}. ${v}`).join("\n")
  : "    (选项缺失)";

const M = [`# L1 嫌疑复审明细 — ${new Date().toISOString().slice(0, 10)}`, "",
  "L1 全量二审的 182 条嫌疑，用同款 auditor 复审并保留完整明细。",
  "**复现性**：`复现`=两轮独立作答都不同意答案键(优先人审)；`未复现`=复审干净(边缘案例, 可降级)；`error`=待重试。", ""];
const detailOut = {};
const summary = [];

for (const [bank, suspects] of Object.entries(input)) {
  const cfg = BANKS[bank];
  const done = state[bank] || {};
  const byId = cfg ? new Map((rd(cfg.path).items || []).map((it) => [it.id, it])) : new Map();
  const cnt = { reproduced: 0, not_reproduced: 0, ambiguous: 0, error: 0, pending: 0 };
  const rows = [];
  for (const s of suspects) {
    const r = done[s.id];
    if (!r) { cnt.pending++; continue; }
    const cls = classify(cfg?.kind, r);
    cnt[cls]++;
    detailOut[bank] = detailOut[bank] || {};
    detailOut[bank][s.id] = { l1: s, rerun: r, cls };
    if (cls === "not_reproduced" || cls === "error") { rows.push(`### ${s.id} — ${cls === "error" ? "⏸ error(待重试)" : "✅ 复审未复现(L1: " + (s.d || "").slice(0, 60) + ")"}`); continue; }
    const item = byId.get(s.id);
    rows.push(`### ${s.id} — ✗ ${cls === "ambiguous" ? "多解嫌疑" : "复现"}（L1: ${(s.d || "").slice(0, 60)}）`);
    if (cfg.kind === "mcq") {
      for (const qr of r.results || []) {
        const critical = (qr.flags || []).some((f) => f.severity === "critical");
        if (!critical && qr.match !== false) continue;
        const qi = Number(String(qr.question).replace(/\D/g, "")) - 1;
        const q = item?.questions?.[qi];
        rows.push(`- **${qr.question}**: 答案键 **${qr.markedAnswer}** vs AI **${qr.aiAnswer}** (置信 ${qr.aiConfidence})`);
        rows.push(`  - 题干: ${q?.stem || qr.stem}`);
        rows.push(optionsBlock(q));
        const mm = (qr.flags || []).find((f) => f.type === "ANSWER_MISMATCH");
        if (mm) rows.push(`  - AI 理由: ${String(mm.detail).slice(0, 400)}`);
      }
    } else if (cfg.kind === "ctw") {
      for (const br of r.results || []) {
        if (br.match) continue;
        const critical = (br.flags || []).some((f) => f.severity === "critical");
        rows.push(`- 空 ${br.blank} [${critical ? "**critical: AI 词吻合词首碎片→多解嫌疑**" : "info: AI 词不合碎片(模型答错, 非题目问题)"}]: 碎片 \`${br.fragment}\` 原词 **${br.expected}** vs AI **${br.aiAnswer}**`);
      }
    } else {
      for (const d of r.details || []) {
        if (d.match !== false && !d.ambiguous) continue;
        const q = item?.questions?.[d.questionIndex];
        rows.push(`- **Q${(d.questionIndex ?? 0) + 1}**${d.match === false ? " 答案不一致" : " 多解嫌疑"}: 答案键 **${d.ourAnswer}** vs AI **${d.aiAnswer}**; 评级 ${JSON.stringify(d.ratings || {})}`);
        if (q?.stem) { rows.push(`  - 题干: ${q.stem}`); rows.push(optionsBlock(q)); }
        if (d.reasoning) rows.push(`  - AI 理由: ${String(d.reasoning).slice(0, 400)}`);
      }
    }
  }
  summary.push({ bank, total: suspects.length, ...cnt });
  M.push(`## ${bank}（嫌疑 ${suspects.length}: 复现 ${cnt.reproduced} / 未复现 ${cnt.not_reproduced} / 多解 ${cnt.ambiguous} / error ${cnt.error} / 未跑 ${cnt.pending}）`, "", ...rows, "");
}

M.splice(4, 0, "", "| 库 | 嫌疑 | 复现 | 未复现 | 多解 | error | 未跑 |", "|---|---|---|---|---|---|---|",
  ...summary.map((s) => `| ${s.bank} | ${s.total} | ${s.reproduced} | ${s.not_reproduced} | ${s.ambiguous} | ${s.error} | ${s.pending} |`), "");

const allDone = summary.every((s) => s.error === 0 && s.pending === 0);
M.push(allDone ? "**状态：复审全部完成。**" : "**状态：未完(时间预算/暂态错误)——再次运行会从断点续跑。**");
writeFileSync(join(OUT_DIR, "L1-suspect-details.json"), JSON.stringify(detailOut, null, 1));
writeFileSync(join(OUT_DIR, "L1-suspect-details.md"), M.join("\n") + "\n");
console.log("\n" + summary.map((s) => `${s.bank}: 复现 ${s.reproduced}/${s.total}, 未复现 ${s.not_reproduced}, error ${s.error}, 未跑 ${s.pending}`).join("\n"));
console.log(allDone ? "\n✓ 复审全部完成" : "\n⏸ 未完 — 再次运行续跑");
