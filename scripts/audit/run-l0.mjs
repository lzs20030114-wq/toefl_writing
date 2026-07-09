#!/usr/bin/env node
// L0 — 全库确定性质量扫描（FULL-QUALITY-AUDIT-PLAN-2026-07-09 第一层，0 LLM/0 网络）。
// 检查：①13 库逐题 validator 存量全扫 ②内容重复(exact+近重复, 合库层同口径)
// ③MCQ 形态：答案位分布 + 正确项最长率(阈 40%, §7 P1-7) ④库级 BS 干扰词分布
// (R2 发现①：批级检测器对存量沉淀全盲, 库级阈 20%) ⑤难度字段覆盖 ⑥听力 audio_url 覆盖。
// 产出：data/claudeGen/reports/FULL-AUDIT-<date>/L0-report.md + L0-suspects.json。
// 用法：node scripts/audit/run-l0.mjs
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATE = "2026-07-09";
const OUT_DIR = join(ROOT, "data/claudeGen/reports", `FULL-AUDIT-${DATE}`);
mkdirSync(OUT_DIR, { recursive: true });

const { createDedupIndex, checkDuplicate, addToIndex } = require("../../lib/gen/contentDedup.js");
const rd = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const wc = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

// ── 库清单与逐题 validator ─────────────────────────────────────────────
const V = {
  ap: (it) => require("../../lib/readingGen/apValidator.js").validateAPItem(it),
  rdl: (it) => require("../../lib/readingGen/rdlValidator.js").validateRDLItem(it),
  ctw: (it) => require("../../lib/readingGen/ctwValidator.js").validateCTWItem(it), // 库内已挖空，直接验
  lat: (it) => require("../../lib/listeningGen/latValidator.js").validateLAT(it),
  lc: (it) => require("../../lib/listeningGen/lcValidator.js").validateLC(it),
  la: (it) => require("../../lib/listeningGen/laValidator.js").validateLA(it),
  lcr: (it) => require("../../lib/listeningGen/lcrValidator.js").validateLCR(it),
  repeat: (it) => require("../../lib/speakingGen/speakingValidator.js").validateRepeatSet(it),
  interview: (it) => require("../../lib/speakingGen/speakingValidator.js").validateInterviewSet(it),
};
const BANKS = [
  { key: "ctw", path: "data/reading/bank/ctw.json", dedup: "ctw", vet: V.ctw },
  { key: "ap", path: "data/reading/bank/ap.json", dedup: "ap", vet: V.ap },
  { key: "rdl-short", path: "data/reading/bank/rdl-short.json", dedup: "rdl", vet: V.rdl },
  { key: "rdl-long", path: "data/reading/bank/rdl-long.json", dedup: "rdl", vet: V.rdl },
  { key: "lcr", path: "data/listening/bank/lcr.json", dedup: "lcr", vet: V.lcr },
  { key: "lc", path: "data/listening/bank/lc.json", dedup: "lc", vet: V.lc },
  { key: "la", path: "data/listening/bank/la.json", dedup: "la", vet: V.la },
  { key: "lat", path: "data/listening/bank/lat.json", dedup: "lat", vet: V.lat },
  { key: "repeat", path: "data/speaking/bank/repeat.json", dedup: "repeat", vet: V.repeat },
  { key: "interview", path: "data/speaking/bank/interview.json", dedup: "interview", vet: V.interview },
];

const suspects = {}; // check → bank → [ids/明细]
const mark = (check, bank, entry) => { ((suspects[check] ||= {})[bank] ||= []).push(entry); };
const L = []; // 报告行
L.push(`# L0 全库确定性扫描 — ${DATE}`, "");
L.push(`> 口径：validator=各型生产同款；重复=contentDedup(合库层同口径, exact+近重复);`);
L.push(`> 正确项最长率阈 40%(§7 P1-7)；答案位单字母占比阈 40%；库级干扰词阈 20%(R2①)。`);
L.push(`> 音频只查 audio_url 字段覆盖——storage 对象存在性需 Supabase 连接，本轮跳过。`, "");

// ── ①② 阅读/听力/口语 10 库：validator + 重复 ────────────────────────
L.push("## ① 逐题 validator 存量全扫 + ② 内容重复", "");
L.push("| 库 | 条数 | validator 不过 | 重复(exact/近) |");
L.push("|---|---|---|---|");
for (const b of BANKS) {
  const items = rd(b.path).items || [];
  let bad = 0;
  for (const it of items) {
    let r;
    try { r = b.vet(it) || {}; } catch (e) { r = { valid: false, errors: ["threw: " + e.message] }; }
    if (r.pass === false || r.valid === false) {
      bad++;
      mark("validator", b.key, { id: it.id, errors: (r.errors || []).slice(0, 3).join("; ").slice(0, 160) });
    }
  }
  const idx = createDedupIndex([], b.dedup);
  let exact = 0, near = 0;
  for (const it of items) {
    const dup = checkDuplicate(idx, it, b.dedup);
    if (dup.dup) {
      dup.reason === "exact" ? exact++ : near++;
      mark("duplicate", b.key, { id: it.id, matchId: dup.matchId, reason: dup.reason });
    } else addToIndex(idx, it, b.dedup);
  }
  L.push(`| ${b.key} | ${items.length} | ${bad} | ${exact}/${near} |`);
}

// 写作三库：schema/normalizer + 重复
const { normalizeDiscItem, normalizeEmailItem } = require("../../lib/gen/deployGate.js");
const { validateQuestion } = require("../../lib/questionBank/buildSentenceSchema.js");
const bs = rd("data/buildSentence/questions.json");
const bsQs = bs.question_sets.flatMap((s) => (s.questions || []).map((q) => ({ ...q, _set: s.set_id })));
let bsBad = 0;
for (const q of bsQs) {
  const v = validateQuestion(q);
  if (v.fatal.length || v.format.length) { bsBad++; mark("validator", "bs", { id: q.id, errors: [...v.fatal, ...v.format].join("; ").slice(0, 160) }); }
}
const bsIdx = createDedupIndex([], "bs");
let bsExact = 0, bsNear = 0;
for (const q of bsQs) {
  const dup = checkDuplicate(bsIdx, q, "bs");
  if (dup.dup) { dup.reason === "exact" ? bsExact++ : bsNear++; mark("duplicate", "bs", { id: q.id, matchId: dup.matchId, reason: dup.reason }); }
  else addToIndex(bsIdx, q, "bs");
}
L.push(`| bs(题级) | ${bsQs.length} | ${bsBad} | ${bsExact}/${bsNear} |`);
for (const [key, path, norm, type] of [["disc", "data/academicWriting/prompts.json", normalizeDiscItem, "discussion"], ["email", "data/emailWriting/prompts.json", normalizeEmailItem, "email"]]) {
  const items = rd(path);
  let bad = 0;
  for (const it of items) if (!norm(it)) { bad++; mark("validator", key, { id: it.id }); }
  const idx = createDedupIndex([], type);
  let exact = 0, near = 0;
  for (const it of items) {
    const dup = checkDuplicate(idx, it, type);
    if (dup.dup) { dup.reason === "exact" ? exact++ : near++; mark("duplicate", key, { id: it.id, matchId: dup.matchId, reason: dup.reason }); }
    else addToIndex(idx, it, type);
  }
  L.push(`| ${key} | ${items.length} | ${bad} | ${exact}/${near} |`);
}
L.push("");

// ── ③ MCQ 形态：答案位 + 正确项最长率 ─────────────────────────────────
L.push("## ③ MCQ 形态（答案位分布 · 正确项最长率）", "");
L.push("| 库 | 题数 | 答案位 A/B/C/D | 单字母最高 | 正确项最长率 | 判定 |");
L.push("|---|---|---|---|---|---|");
for (const b of BANKS.filter((x) => ["ap", "rdl-short", "rdl-long", "lcr", "lc", "la", "lat"].includes(x.key))) {
  const items = rd(b.path).items || [];
  const qs = items.flatMap((it) => (Array.isArray(it.questions) ? it.questions : [it]).map((q) => ({ q, _item: it.id })));
  const pos = {}; let longest = 0, judged = 0;
  for (const { q, _item } of qs) {
    const ans = q.answer ?? q.correct_answer;
    const opts = q.options && typeof q.options === "object" ? q.options : null;
    if (!ans || !opts || !opts[ans]) continue;
    judged++;
    pos[ans] = (pos[ans] || 0) + 1;
    const lens = Object.entries(opts).map(([k, v]) => [k, wc(v)]);
    const maxLen = Math.max(...lens.map((x) => x[1]));
    const isLongest = wc(opts[ans]) === maxLen && lens.filter((x) => x[1] === maxLen).length === 1;
    if (isLongest) longest++;
  }
  const letters = ["A", "B", "C", "D"].map((k) => pos[k] || 0);
  const maxShare = judged ? Math.max(...letters) / judged : 0;
  const longRate = judged ? longest / judged : 0;
  const flags = [];
  if (maxShare > 0.40) flags.push("答案位偏斜");
  if (longRate > 0.40) flags.push("最长项露馅");
  if (flags.length) mark("mcq-shape", b.key, { maxShare: +maxShare.toFixed(3), longestRate: +longRate.toFixed(3), flags });
  L.push(`| ${b.key} | ${judged} | ${letters.join("/")} | ${(maxShare * 100).toFixed(1)}% | ${(longRate * 100).toFixed(1)}% | ${flags.length ? "⚠ " + flags.join("+") : "ok"} |`);
}
L.push("");

// ── ④ 库级 BS 干扰词分布（R2 发现① 的存量口径） ──────────────────────
const dCounts = {}; let dN = 0;
for (const q of bsQs) { const d = String(q.distractor || "").toLowerCase().trim(); if (!d) continue; dCounts[d] = (dCounts[d] || 0) + 1; dN++; }
const dTop = Object.entries(dCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
const dTopFrac = dN ? dTop[0][1] / dN : 0;
L.push("## ④ 库级 BS 干扰词分布（存量口径, 阈 20%）", "");
L.push(`- n=${dN}, distinct=${Object.keys(dCounts).length}, top5: ${dTop.map(([w, c]) => `${w} ${(c / dN * 100).toFixed(1)}%`).join(", ")}`);
L.push(`- 判定: ${dTopFrac > 0.20 ? "⚠ 单词独大超阈" : "ok"} (top "${dTop[0][0]}" ${(dTopFrac * 100).toFixed(1)}%)`, "");
if (dTopFrac > 0.20) mark("bank-distractor", "bs", { top: dTop[0][0], frac: +dTopFrac.toFixed(3) });

// ── ⑤ 难度字段覆盖 + ⑥ 听力 audio_url 覆盖 ───────────────────────────
L.push("## ⑤ 难度字段覆盖 · ⑥ 音频 URL 覆盖", "");
L.push("| 库 | difficulty 有值 | audio_url 有值 |");
L.push("|---|---|---|");
for (const b of BANKS) {
  const items = rd(b.path).items || [];
  const diff = items.filter((i) => i.difficulty != null && i.difficulty !== "").length;
  const isListening = ["lcr", "lc", "la", "lat"].includes(b.key);
  const audio = isListening ? items.filter((i) => typeof i.audio_url === "string" && i.audio_url).length : null;
  if (isListening && audio < items.length) {
    for (const i of items) if (!i.audio_url) mark("audio-missing", b.key, { id: i.id });
  }
  L.push(`| ${b.key} | ${diff}/${items.length} | ${audio == null ? "—" : `${audio}/${items.length}`} |`);
}
L.push("");

// ── 汇总 ──────────────────────────────────────────────────────────────
const totalSuspects = Object.values(suspects).reduce((n, byBank) => n + Object.values(byBank).reduce((m, a) => m + a.length, 0), 0);
L.push("## 汇总", "");
for (const [check, byBank] of Object.entries(suspects)) {
  L.push(`- **${check}**: ${Object.entries(byBank).map(([b, a]) => `${b} ${a.length}`).join(", ")}`);
}
if (totalSuspects === 0) L.push("- 全部检查零嫌疑。");
L.push("", `嫌疑明细：L0-suspects.json（共 ${totalSuspects} 条）`);

writeFileSync(join(OUT_DIR, "L0-report.md"), L.join("\n") + "\n");
writeFileSync(join(OUT_DIR, "L0-suspects.json"), JSON.stringify(suspects, null, 1));
console.log(L.join("\n"));
console.log(`\n→ ${OUT_DIR}/L0-report.md`);
