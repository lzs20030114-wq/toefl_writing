#!/usr/bin/env node
/**
 * 一次性回填：把造句跨卷重复的别名补进 data/realBank/writing/id-aliases.json。
 *
 * 为什么要有这个脚本：别名的正主是 build_bank.mjs（见 ./bs_aliases.js），但它要读
 * `.codex-tmp/realbank/` 的结构化产物 —— 那份产物只在本机、不进仓库，云端会话跑不了全量重建。
 * 而这些别名的两个输入其实都已经在仓库里：
 *   · 被丢掉的那一份的 id + 答案句 → data/realBank/drop-ledger.json（build_bank --dry 的逐题账本）
 *   · 留下的那一条                → data/realBank/writing/bs.json
 * 所以这里按同一套判据（答案句归一化，./bs_aliases.js 的 bsAliasEntries）把边重建出来，
 * 产出与 build_bank 下次全量重建会写的那一份应当逐字相同 —— 真跑一遍全量重建会原样覆盖它。
 *
 * 用法：
 *   node scripts/realbank/bs_aliases_backfill.mjs            # 写文件
 *   node scripts/realbank/bs_aliases_backfill.mjs --dry-run  # 只打印摘要
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  WRITING_ALIAS_PURPOSE, BS_ALIAS_REASON, bsAnswerKey, bsAliasEntries, bsDupSetEdges, bsGroundTruthEdges,
} = require("./bs_aliases.js");

const ROOT = process.cwd();
const BANK = path.join(ROOT, "data", "realBank");
const ALIAS_FILE = path.join(BANK, "writing", "id-aliases.json");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const dropLedger = readJson(path.join(BANK, "drop-ledger.json"));
const lossLedger = readJson(path.join(BANK, "loss-ledger.json"));
const bank = readJson(path.join(BANK, "writing", "bs.json")).items || [];
const prev = fs.existsSync(ALIAS_FILE) ? readJson(ALIAS_FILE) : { aliases: [] };

const setDate = new Map();
const setSlugOf = new Map();
for (const r of lossLedger.rows || []) {
  if (r.set && r.date && !setDate.has(r.set)) setDate.set(r.set, r.date);
  if (r.set && r.slug && !setSlugOf.has(r.set)) setSlugOf.set(r.set, r.slug);
}

const byAnswer = new Map();
const byId = new Map();
for (const it of bank) {
  byId.set(String(it.id), it);
  const k = bsAnswerKey(it.answer);
  if (k && !byAnswer.has(k)) byAnswer.set(k, it);
}

/* ① 答案句跨卷重复（drop-ledger 逐题记了 id + 答案句） */
const edges = [];
const unmatched = [];
for (const row of dropLedger.rows || []) {
  if (row.code !== "wDroppedDupBs" || row.type !== "bs" || !row.id) continue;
  const answer = (/重复：(.*)$/.exec(row.detail || "") || [])[1];
  const kept = answer ? byAnswer.get(bsAnswerKey(answer)) : null;
  if (!kept) { unmatched.push(`${row.id}｜${row.detail}`); continue; }
  edges.push({
    from: row.id, to: kept.id, reason: BS_ALIAS_REASON.DUP_ANSWER,
    fromSource: row.set, fromDate: setDate.get(row.set) || null,
  });
}

/* ② 整份写作源文件与更早一套相同而被跳过的卷（造句按题号逐题对应） */
const dupSets = (dropLedger.rows || [])
  .filter((r) => r.code === "wDroppedDupSet" && r.section === "writing")
  .map((r) => ({ setname: r.set, kept: (/与 (.+?) 写作文件相同/.exec(r.detail || "") || [])[1] }))
  .filter((d) => d.setname && d.kept);
edges.push(...bsDupSetEdges({
  dupSets, items: bank,
  slugOf: (s) => setSlugOf.get(s) || "x",
  dateOf: (s) => setDate.get(s) || null,
}));

/* ③ 真题 ground truth 记着这一卷考过、库里也有那个答案句的（源料体检扣下的几卷全靠这条路） */
const gt = (() => {
  try { return readJson(path.join(ROOT, "data", "realExam2026", "writing", "buildSentence.json")).items || []; }
  catch { return []; }
})();
const baseAliases = bsAliasEntries(edges);
const gtEdges = bsGroundTruthEdges({
  gtItems: gt, items: bank, aliases: baseAliases,
  slugOf: (s) => setSlugOf.get(s) || null,
  dateOf: (s) => setDate.get(s) || null,
});

const bsAliases = bsAliasEntries([...edges, ...gtEdges]);

/* ── 体检：别名必须指向库里活着的题，from 不能与库里已有 id 撞车 ── */
const problems = [];
for (const a of bsAliases) {
  if (!byId.has(a.to)) problems.push(`${a.from} → ${a.to}：保留方不在库里`);
  if (byId.has(a.from)) problems.push(`${a.from}：库里已有同 id 的题，不该记别名`);
  if (!a.from_source) problems.push(`${a.from}：缺 from_source（assemble_sets 会整条丢掉）`);
  if (!a.from_date) problems.push(`${a.from}：缺 from_date`);
  const slug = (/^bs_(.+)_\d+$/.exec(a.from) || [])[1];
  if (slug && setSlugOf.get(a.from_source) && slug !== setSlugOf.get(a.from_source)) {
    problems.push(`${a.from}：slug 与 ${a.from_source} 对不上（${setSlugOf.get(a.from_source)}）`);
  }
}

const kept = (prev.aliases || []).filter((a) => a && a.from_type !== "bs");
const aliases = [...kept, ...bsAliases];

console.log(`造句别名回填：边 ${edges.length + gtEdges.length} 条 → 账本 ${bsAliases.length} 条`);
console.log(`  按答案句重复 ${bsAliases.filter((a) => a.reason === BS_ALIAS_REASON.DUP_ANSWER).length} 条`
  + `／整卷源文件相同 ${bsAliases.filter((a) => a.reason === BS_ALIAS_REASON.DUP_SET).length} 条`
  + `／真题 ground truth 对照 ${bsAliases.filter((a) => a.reason === BS_ALIAS_REASON.GT_SAME_ITEM).length} 条`
  + `（涉及 ${new Set(bsAliases.map((a) => a.from_source)).size} 套卷）`);
console.log(`  邮件 / 讨论原有别名保留 ${kept.length} 条 → 合计 ${aliases.length} 条`);
if (unmatched.length) console.log(`  ⚠ 对不上保留方的 ${unmatched.length} 条：\n    ${unmatched.slice(0, 5).join("\n    ")}`);
if (problems.length) {
  console.error(`  ✗ 体检不过 ${problems.length} 条：\n    ${problems.slice(0, 10).join("\n    ")}`);
  process.exit(1);
}

if (process.argv.includes("--dry-run")) { console.log("  (--dry-run，未写文件)"); process.exit(0); }
fs.writeFileSync(ALIAS_FILE, JSON.stringify({
  generated_by: "scripts/realbank/build_bank.mjs",
  _purpose: WRITING_ALIAS_PURPOSE,
  aliases,
}, null, 2), "utf8");
console.log(`  → ${path.relative(ROOT, ALIAS_FILE)}`);
