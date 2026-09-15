#!/usr/bin/env node
/**
 * 造句补题一条龙（**本机跑**：要 `.codex-tmp/realbank/` 的中间产物 + 写作 PDF 原图）。
 *
 * **造句补题只有一条路：看图，不是重扫**（loss_ledger --plan 的作业单原话）。
 * 写作 PDF 没有文字层，structured.json 的 build 段只有 `{n, sentence}` 答案句 ——
 * 重扫（structure_set --only-failed）把那几块再跑一遍，拿到的还是答案句，build_bank 照样按 thin 丢掉。
 * 2026-09-15 实测：把账本列的 10 套「管线丢题」全重扫一遍，bs 入库量 533 → 533，一题没多。
 * 题面（模板 + 乱序词块）只存在于考试界面截图里，只能靠 extract_bs_pages.py 识图拿。
 *
 * 所以这个入口按四步走：
 *   ① 缓存复验（extract_bs_pages.py --no-ocr）：**零调用**，只拿已有识图缓存重跑机械校验。
 *     判据改过之后，原先拒收的题可能这一遍就过了 —— 不花钱，永远先跑它。
 *   ② 识图（extract_bs_pages.py）：**要花钱**（¥0.01/张），所以默认只报价（--dry-run），
 *     加 --ocr 才真跑，且逐卷 --only，按缺口从大到小。
 *   ③ build_bank --only-bs：只落 bs.json + 别名账本，不碰其余三科
 *     （全量重建会一次改掉四科，那是另一个要拍板的决定 —— build_bank 自己的注释就是这么写的）。
 *   ④ assemble_sets + loss_ledger --freeze：装回原卷槽位、重冻防退化基线。
 *     **漏了 freeze，下次悄悄变少没人发现**。
 *
 * 安全绳：③④之后会对比 bs 入库量，**掉了就拒绝重冻基线**并报错退出 —— 补题补成负数
 * （新题把旧题挤掉、复核清单失配）是这条产线反复踩过的坑，不能让它悄悄过去。
 *
 * 用法：
 *   node scripts/realbank/bs_recover.mjs                 # 预检 + 打印将要执行的每一步，不动手
 *   node scripts/realbank/bs_recover.mjs --run           # 真跑（①③④；②只报价，不花钱）
 *   node scripts/realbank/bs_recover.mjs --run --ocr     # 连识图一起跑（会花钱，先看①②报的张数）
 *   node scripts/realbank/bs_recover.mjs --run --only-rebuild   # 跳过①②，只走③④
 *   --py <路径>   Python 解释器（默认 env REALBANK_PY，再默认 "python"；Windows 常是 D:/python/python）
 *   --limit <n>   ①②各最多处理几套（先试水）
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

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

/**
 * 当前入库的造句槽位数。**从 sets.json 现算**，不读 loss-ledger.json ——
 * 那份账本要到第 ⑤ 步 loss_ledger --freeze 才重写，而对账发生在第 ④ 步之后：
 * 读它永远读到上一轮的旧值，于是每次都报 "+0"（2026-09-15 连骗了三轮）。
 * buildLedger 是 loss_ledger 自己用的那支纯函数，口径一致。
 */
const { buildLedger } = require("./loss_attribution.js");
const bsGot = () => {
  const sets = readJson(path.join(BANK, "sets.json"));
  if (!sets) return null;
  try {
    const byType = buildLedger({ sets }).byType || {};
    const bs = byType.bs || Object.values(byType).find((b) => b.type === "bs");
    return bs ? bs.got : null;
  } catch { return null; }
};

/* ── 目标清单：全部从账本现算，不写死 ────────────────────────────────── */
const loss = readJson(path.join(BANK, "loss-ledger.json"), { rows: [], tasks: [] });
const drops = readJson(path.join(BANK, "drop-ledger.json"), { rows: [] });
const gt = readJson(path.join(ROOT, "data", "realExam2026", "writing", "buildSentence.json"), { items: [] });
const bank = readJson(path.join(BANK, "writing", "bs.json"), { items: [] }).items || [];
const aliases = (readJson(path.join(BANK, "writing", "id-aliases.json"), { aliases: [] }).aliases || [])
  .filter((a) => a.from_type === "bs");

// 识图目标 = 所有还缺造句的卷（账本的归因桶对造句没有分辨力：pipeline_loss 那一桶
// 同样只能靠看图，见头注）。按缺口从大到小排，逐卷 --only 才好按张数拍板。
const gaps = (loss.rows || [])
  .filter((r) => r.type === "bs" && r.missing > 0)
  .map((r) => ({ set: r.set, missing: r.missing, cause: Object.keys(r.charged || {}).join("+") }))
  .sort((a, b) => b.missing - a.missing);

// 佐证：题面没抽出来的（thin）与 GT 证实存在而库里连答案句都没有的 —— 用来判断这一卷值不值得先扫
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
const evidence = ocrTargets;
const ocr = gaps.map((g) => ({ ...g, ...(evidence.get(g.set) || { thin: 0, gtMissing: 0 }) }));

/* ── 预检 ─────────────────────────────────────────────────────────────── */
const structured = fs.existsSync(TMP) ? fs.readdirSync(TMP).filter((f) => f.endsWith(".structured.json")).length : 0;
const problems = [];
if (!fs.existsSync(TMP)) problems.push(`.codex-tmp/realbank/ 不在 —— 中间产物不进 git，这一步只能在本机跑（或先 artifacts_sync.mjs --pull）`);
else if (structured < 40) problems.push(`.codex-tmp/realbank/ 只有 ${structured} 份 structured 产物，像是没拉全 —— 先 artifacts_sync.mjs --pull，否则重建会把库打回几十题`);

console.log(`造句补题（看图，不是重扫）　　structured 产物 ${structured} 份 · 当前入库 bs ${bsGot() ?? "?"} 题`);
console.log(`\n识图目标：${ocr.length} 套 / 共缺 ${ocr.reduce((n, r) => n + r.missing, 0)} 题`);
console.log(`   ${"卷".padEnd(19)} 缺  归因            题面没抽出  GT证实缺`);
ocr.slice(0, 14).forEach((r) => console.log(
  `   ${String(r.set).padEnd(20)}${String(r.missing).padStart(2)}  ${String(r.cause).padEnd(16)}${String(r.thin).padStart(6)}${String(r.gtMissing).padStart(9)}`
));
if (ocr.length > 14) console.log(`   …另 ${ocr.length - 14} 套`);
console.log(`   （① --no-ocr 缓存复验零调用；② 真识图 ¥0.01/张，先看它报的张数）`);

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
  step("① 缓存复验（零调用：只拿已有识图缓存重跑机械校验）", PY, ["scripts/realbank/extract_bs_pages.py", "--no-ocr"]);
  step("② 识图报价（不调 API）", PY, ["scripts/realbank/extract_bs_pages.py", "--dry-run"]);
  // 真识图逐卷 --only，按缺口从大到小 —— 一次全送出去，钱花在哪一卷上就说不清了。
  if (OCR) take(ocr).forEach((r, i) => step(`②.${i + 1} 识图 ${r.set}（缺 ${r.missing}）`, PY, ["scripts/realbank/extract_bs_pages.py", "--only", r.set]));
  else console.log("\n（未加 --ocr：识图只报了价，一分钱没花。确认张数/费用后再加 --ocr 重跑）");
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
