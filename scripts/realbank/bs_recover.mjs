#!/usr/bin/env node
/**
 * 造句补题一条龙（**本机跑**：要 `.codex-tmp/realbank/` 的中间产物 + 写作 PDF 原图）。
 *
 * 为什么单独做这个入口：补造句要按顺序过五道手续，少一道就白干或悄悄退化 ——
 *   ① 零 token 重扫（structure_set --only-failed）：造句走「零 token 路」，答案句就在答案 PDF 里，
 *     不调模型、不花钱（structure_set 头注写着）。管线丢题那一桶全靠它。
 *     圈定 `--sections writing --types build`：同卷里别的 flagged 块（阅读 CTW / 选择题）是**要花钱**的，
 *     不圈会被顺带重扫 —— structure_set 自己的注释就警告过这一点。
 *   ② 识图（extract_bs_pages.py）：写作 PDF 没有文字层，题面（模板 + 词块）只在考试界面截图里。
 *     **要花钱**（¥0.01/张），所以默认只报价，加 --ocr 才真跑。
 *   ③ build_bank --only-bs：只落 bs.json + 别名账本，不碰其余三科
 *     （全量重建会一次改掉四科，那是另一个要拍板的决定 —— build_bank 自己的注释就是这么写的）。
 *   ④ assemble_sets：把新题装回原卷槽位，别名同步还槽。
 *   ⑤ loss_ledger --freeze：重冻防退化基线。**漏了这一步，下次悄悄变少没人发现**。
 *
 * 安全绳：③④之后会对比 bs 入库量，**掉了就拒绝重冻基线**并报错退出 —— 补题补成负数
 * （新题把旧题挤掉、复核清单失配）是这条产线反复踩过的坑，不能让它悄悄过去。
 *
 * 用法：
 *   node scripts/realbank/bs_recover.mjs                 # 预检 + 打印将要执行的每一步，不动手
 *   node scripts/realbank/bs_recover.mjs --run           # 真跑（①③④⑤；②只报价）
 *   node scripts/realbank/bs_recover.mjs --run --ocr     # 连识图一起跑（会花钱，先看它报的张数）
 *   node scripts/realbank/bs_recover.mjs --run --only-rebuild   # 跳过①②，只走③④⑤
 *   --py <路径>   Python 解释器（默认 env REALBANK_PY，再默认 "python"；Windows 常是 D:/python/python）
 *   --limit <n>   ①②各最多处理几套（先试水）
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const ROOT = process.cwd();
const BANK = path.join(ROOT, "data", "realBank");
const TMP = path.join(ROOT, ".codex-tmp", "realbank");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, dflt) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const RUN = has("--run");
const OCR = has("--ocr");
const ONLY_REBUILD = has("--only-rebuild");
const PY = val("--py", process.env.REALBANK_PY || "python");
const LIMIT = Number(val("--limit", "0")) || 0;

const readJson = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
const bsGot = () => {
  const l = readJson(path.join(BANK, "loss-ledger.json"));
  return l?.byType?.bs?.got ?? (Object.values(l?.byType || {}).find((b) => b.type === "bs") || {}).got ?? null;
};

/* ── 目标清单：全部从账本现算，不写死 ────────────────────────────────── */
const loss = readJson(path.join(BANK, "loss-ledger.json"), { rows: [], tasks: [] });
const drops = readJson(path.join(BANK, "drop-ledger.json"), { rows: [] });
const gt = readJson(path.join(ROOT, "data", "realExam2026", "writing", "buildSentence.json"), { items: [] });
const bank = readJson(path.join(BANK, "writing", "bs.json"), { items: [] }).items || [];
const aliases = (readJson(path.join(BANK, "writing", "id-aliases.json"), { aliases: [] }).aliases || [])
  .filter((a) => a.from_type === "bs");

// ① 管线丢题：账本已经按「这一科还有 flagged 块可重扫」排好了
const rescan = (loss.tasks || []).filter((t) => t?.types?.bs).map((t) => ({ set: t.set, n: t.types.bs }));

// ② 识图目标：题面没抽出来的（thin）+ GT 证实存在而库里连答案句都没有的
const key = (s) => String(s || "").toLowerCase().replace(/[.,!?;:]/g, "").replace(/\s+/g, " ").trim();
const bankKeys = new Set(bank.map((b) => key(b.answer)));
const owned = new Map();
const own = (s, k) => { if (!owned.has(s)) owned.set(s, new Set()); owned.get(s).add(k); };
bank.forEach((b) => own(b.source, key(b.answer)));
aliases.forEach((a) => { const t = bank.find((b) => b.id === a.to); if (t) own(a.from_source, key(t.answer)); });
const ocrTargets = new Map();
const bump = (set, field) => {
  if (!ocrTargets.has(set)) ocrTargets.set(set, { set, thin: 0, gtMissing: 0 });
  ocrTargets.get(set)[field] += 1;
};
(drops.rows || []).forEach((r) => { if (r.type === "bs" && r.code === "wSkippedThin" && r.n > 0) for (let i = 0; i < r.n; i += 1) bump(r.set, "thin"); });
(gt.items || []).forEach((g) => {
  const k = key(g.target);
  if (!k || (owned.get(g.source) || new Set()).has(k) || bankKeys.has(k)) return;
  bump(g.source, "gtMissing");
});
const ocr = [...ocrTargets.values()].sort((a, b) => (b.thin + b.gtMissing) - (a.thin + a.gtMissing));

/* ── 预检 ─────────────────────────────────────────────────────────────── */
const structured = fs.existsSync(TMP) ? fs.readdirSync(TMP).filter((f) => f.endsWith(".structured.json")).length : 0;
const problems = [];
if (!fs.existsSync(TMP)) problems.push(`.codex-tmp/realbank/ 不在 —— 中间产物不进 git，这一步只能在本机跑（或先 artifacts_sync.mjs --pull）`);
else if (structured < 40) problems.push(`.codex-tmp/realbank/ 只有 ${structured} 份 structured 产物，像是没拉全 —— 先 artifacts_sync.mjs --pull，否则重建会把库打回几十题`);

console.log(`造句补题一条龙　　structured 产物 ${structured} 份 · 当前入库 bs ${bsGot() ?? "?"} 题`);
console.log(`\n① 零 token 重扫（structure_set --only-failed）：${rescan.length} 套 / ${rescan.reduce((n, r) => n + r.n, 0)} 题`);
rescan.forEach((r) => console.log(`   ${String(r.set).padEnd(20)} 缺 ${r.n}`));
console.log(`\n② 识图（extract_bs_pages.py，¥0.01/张）：${ocr.length} 套 / 题面没抽出来 ${ocr.reduce((n, r) => n + r.thin, 0)} + GT 证实库里没有 ${ocr.reduce((n, r) => n + r.gtMissing, 0)}`);
ocr.slice(0, 12).forEach((r) => console.log(`   ${String(r.set).padEnd(20)} thin ${r.thin} · GT ${r.gtMissing}`));
if (ocr.length > 12) console.log(`   …另 ${ocr.length - 12} 套`);

if (problems.length) {
  console.log(`\n✗ 预检不过：\n   ${problems.join("\n   ")}`);
  if (RUN) process.exit(3);
}
if (!RUN) { console.log(`\n（预检模式，未执行。加 --run 真跑；连识图一起跑再加 --ocr）`); process.exit(problems.length ? 3 : 0); }

/* ── 执行 ─────────────────────────────────────────────────────────────── */
const before = bsGot();
const step = (label, cmd, args) => {
  console.log(`\n▶ ${label}\n  ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, shell: false });
  if (r.status !== 0) console.log(`  ⚠ 退出码 ${r.status}（继续往下走，最后用入库量对账）`);
  return r.status === 0;
};
const node = process.execPath;
const take = (arr) => (LIMIT ? arr.slice(0, LIMIT) : arr);

if (!ONLY_REBUILD) {
  take(rescan).forEach((r, i) => step(`①.${i + 1} 重扫 ${r.set}（零 token）`, node, ["scripts/realbank/structure_set.mjs", r.set, "--sections", "writing", "--types", "build", "--only-failed"]));
  // 识图：默认只报价。真跑也逐套 --only，避免一次把全库的图都送出去。
  step("② 识图报价（不调 API）", PY, ["scripts/realbank/extract_bs_pages.py", "--dry-run"]);
  if (OCR) take(ocr).forEach((r, i) => step(`②.${i + 1} 识图 ${r.set}`, PY, ["scripts/realbank/extract_bs_pages.py", "--only", r.set]));
  else console.log("\n（未加 --ocr：识图只报了价，没花钱。确认张数/费用后再加 --ocr 重跑）");
}

step("③ 落库（只动 bs.json + 别名账本）", node, ["scripts/realbank/build_bank.mjs", "--only-bs"]);
step("④ 装回整卷", node, ["scripts/realbank/assemble_sets.mjs"]);

const mid = bsGot();
console.log(`\n■ 入库量对账：bs ${before} → ${mid}`);
if (mid == null || before == null) { console.log("✗ 读不到账本里的 bs 入库量，不敢重冻基线"); process.exit(1); }
if (mid < before) {
  console.log(`✗ 补题补成了负数（少了 ${before - mid} 题）—— 拒绝重冻基线。`);
  console.log(`  先查：新题是不是把旧题挤掉了（build_bank 的去重/复核清单失配），data/realBank/drop-ledger.json 有逐题原因。`);
  process.exit(1);
}
step("⑤ 重冻防退化基线", node, ["scripts/realbank/loss_ledger.mjs", "--freeze"]);
console.log(`\n✓ 完成：bs ${before} → ${mid}（+${mid - before}）。别忘了跑测试再提交：npx jest __tests__/real-bank-data.test.js`);
