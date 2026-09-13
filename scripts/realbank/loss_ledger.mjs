#!/usr/bin/env node
/**
 * 真题丢题账本 —— 把「还有多少真题没进库、缺在哪、为什么缺」变成一张常驻清单。
 *
 * 零 token、确定性、只读仓库里已有的账本文件，所以任何机器（包括云端会话）都能跑。
 *
 * 为什么需要它：见 ./loss_attribution.js 头注。一句话 —— 2026-09 连修几轮丢题都是
 * 「用户撞见 → 抢救那一个题型」，因为从来没有一张覆盖全科的缺口清单；
 * 修完阅读，听力/写作的同类缺口照旧没人看见。
 *
 * 输入（全部在 git 里）：
 *   data/realBank/sets.json                     每套卷每个槽位的 need/got（蓝图口径）
 *   data/realBank/review-holds.json             复核扣下清单
 *   data/realBank/source-flags.json             源料体检
 *   data/realBank/reading/consolidation.json    跨卷合并账本
 *
 * 产物：
 *   data/realBank/loss-ledger.json              机器可读（byType / bySection / rows / tasks）
 *   stdout                                      人看的汇总表 + 最该补的若干套卷
 *
 * 用法：
 *   node scripts/realbank/loss_ledger.mjs                  # 打印 + 写账本
 *   node scripts/realbank/loss_ledger.mjs --dry-run        # 只打印不写
 *   node scripts/realbank/loss_ledger.mjs --top 30         # 多列几条补题任务
 *   node scripts/realbank/loss_ledger.mjs --type ap,ctw    # 只看这些题型
 *   node scripts/realbank/loss_ledger.mjs --freeze         # 顺手把当前各题型入库量冻成基线
 *
 * 防退化：`data/realBank/loss-baseline.json` 是冻结基线，
 * `__tests__/realbank-loss-guard.test.js` 拿它卡住「重建一次库，某题型悄悄变少」——
 * 这正是过去几轮补题反复踩的坑（补回更靠前的题让 id 改名、下架静默失效、合并把副本的题一起扔了）。
 * 数字**涨了**要重新 --freeze；**跌了**测试会红，必须先解释清楚为什么跌。
 *
 * 退出码：0 正常；2 缺输入文件。
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { buildLedger, actionableTasks, CAUSES, CAUSE_LABEL } = require("./loss_attribution.js");
const { EXAM_2026, SECTIONS } = await import("../../lib/realExam/blueprint.mjs");

/**
 * 蓝图默认版式（A 型）的槽位清单，按科目摊平。
 * 用来给 sets.json 里**整科缺席**的科目补出应有槽位 —— 那些科目在 sets.json 里连键都没有，
 * 不补的话「一科都没跑过」的 47 套听力会显示成「没缺题」，账本反而把丢题藏起来。
 * A 型是本库观察到的主流版式（阅读 M1 A 型 47 套 / B 型 16 套），当下限用：
 * B 型只会让某些科目的应有题数更多，不会更少。
 */
function defaultSlotsBySection() {
  const out = {};
  for (const section of SECTIONS) {
    const spec = EXAM_2026[section];
    const slots = [];
    for (const [moduleKey, mod] of Object.entries(spec?.modules || {})) {
      for (const slot of mod?.forms?.A || []) {
        slots.push({ key: slot.key, type: slot.type, q: slot.q, band: slot.band, module: moduleKey, form: "A" });
      }
    }
    out[section] = slots;
  }
  return out;
}

const BANK = path.join(process.cwd(), "data", "realBank");
const OUT = path.join(BANK, "loss-ledger.json");
const BASELINE = path.join(BANK, "loss-baseline.json");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function pct(x) { return `${(x * 100).toFixed(1)}%`; }

function pad(s, n, right = false) {
  const str = String(s);
  // 中文按两格宽算，否则表格会散
  const width = [...str].reduce((a, ch) => a + (/[⺀-鿿＀-￯]/.test(ch) ? 2 : 1), 0);
  const fill = " ".repeat(Math.max(0, n - width));
  return right ? fill + str : str + fill;
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const freeze = args.includes("--freeze");
  const topIdx = args.indexOf("--top");
  const top = topIdx >= 0 ? Number(args[topIdx + 1]) || 15 : 15;
  const typeIdx = args.indexOf("--type");
  const typeFilter = typeIdx >= 0
    ? new Set(String(args[typeIdx + 1] || "").split(",").map((s) => s.trim()).filter(Boolean))
    : null;

  const setsPath = path.join(BANK, "sets.json");
  const sets = readJson(setsPath, null);
  if (!sets) {
    console.error(`[缺输入] 读不到 ${setsPath} —— 先跑 node scripts/realbank/assemble_sets.mjs`);
    process.exit(2);
  }
  const holds = readJson(path.join(BANK, "review-holds.json"), {}).holds || [];
  const sourceFlags = readJson(path.join(BANK, "source-flags.json"), {}).sets || {};
  const clusters = readJson(path.join(BANK, "reading", "consolidation.json"), {}).clusters || [];

  const ledger = buildLedger({ sets, holds, clusters, sourceFlags, defaultSlots: defaultSlotsBySection() });
  const rows = typeFilter ? ledger.rows.filter((r) => typeFilter.has(r.type)) : ledger.rows;
  const tasks = actionableTasks(rows);

  const s = ledger.summary;
  console.log(`真题丢题账本（蓝图 ${sets.blueprint_version} · 装卷产出 ${sets.generated}）`);
  console.log(`全库槽位 ${s.got}/${s.need} = ${pct(s.completeness)}，缺 ${s.missing} 题`
    + `（分母 = ${sets.sets.length} 套源卷 × 2026 蓝图，含 sets.json 里整科缺席的科目）`);
  // 两种缺口的处置完全不同，别加总成一个数字催人：
  //   管线丢题 = 源里有、这一科也跑过，重扫 flagged 块就能回收；
  //   整科缺席 = 这一科一道题都没进过库，先查源料在不在（无音频的卷是源缺，补不了）。
  console.log(`  管线丢题 ${s.causes.pipeline_loss} 题（重扫 flagged 块可回收）`);
  console.log(`  整科缺席 ${s.causes.section_absent} 题（先查源料在不在：有源就整科重跑，无源要找商家补料）\n`);

  console.log("按题型：");
  console.log(`  ${pad("题型", 12)}${pad("got/need", 12, true)}${pad("完整度", 9, true)}${pad("缺", 6, true)}   `
    + CAUSES.map((c) => pad(CAUSE_LABEL[c], 14, true)).join(""));
  const typeRows = Object.values(ledger.byType)
    .filter((b) => !typeFilter || typeFilter.has(b.type))
    .sort((a, b) => b.missing - a.missing);
  for (const b of typeRows) {
    console.log(`  ${pad(b.type, 12)}${pad(`${b.got}/${b.need}`, 12, true)}${pad(pct(b.completeness), 9, true)}`
      + `${pad(b.missing, 6, true)}   ` + CAUSES.map((c) => pad(b.causes[c] || 0, 14, true)).join(""));
  }

  console.log("\n按科目：");
  for (const b of Object.values(ledger.bySection).sort((a, b) => b.missing - a.missing)) {
    console.log(`  ${pad(b.section, 12)}${pad(`${b.got}/${b.need}`, 12, true)}${pad(pct(b.completeness), 9, true)}`
      + `${pad(b.missing, 6, true)}   ` + CAUSES.map((c) => pad(b.causes[c] || 0, 14, true)).join(""));
  }

  // 两张表分开：整科缺席的卷长得一模一样（每套听力都缺 47），混在一起会把
  // 「立刻重跑就能回收」的那些刷下去。
  const lossTasks = tasks.filter((t) => t.cause === "pipeline_loss");
  const absentTasks = tasks.filter((t) => t.cause === "section_absent");

  console.log(`\n① 立刻能回收的（${CAUSE_LABEL.pipeline_loss}，共 ${lossTasks.length} 套·科；`
    + "跑 structure_set --only-failed 扫这一科的 flagged 块)：");
  for (const t of lossTasks.slice(0, top)) {
    const types = Object.entries(t.types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}-${v}`).join(" ");
    console.log(`  ${pad(t.set, 26)}${pad(t.section, 11)}${pad(`缺 ${t.missing}`, 8, true)}  ${types}`);
  }
  if (lossTasks.length > top) console.log(`  …另有 ${lossTasks.length - top} 套·科，见账本 tasks[]`);

  console.log(`\n② ${CAUSE_LABEL.section_absent}（一道题都没进过库；先查源料在不在，有源才谈重跑）：`);
  const absentBySection = {};
  for (const t of absentTasks) {
    absentBySection[t.section] ||= { sets: 0, missing: 0 };
    absentBySection[t.section].sets += 1;
    absentBySection[t.section].missing += t.missing;
  }
  for (const [section, v] of Object.entries(absentBySection).sort((a, b) => b[1].missing - a[1].missing)) {
    console.log(`  ${pad(section, 12)}${pad(`${v.sets} 套`, 8, true)}${pad(`缺 ${v.missing} 题`, 12, true)}`);
  }

  if (dry) { console.log("\n--dry-run：未写文件"); return; }

  const payload = {
    _generated: new Date().toISOString().slice(0, 10),
    _generated_by: "scripts/realbank/loss_ledger.mjs",
    _purpose: "全科真题缺口账本：每个没填满的槽位 + 归因。口径见 scripts/realbank/loss_attribution.js",
    _source: {
      sets: `data/realBank/sets.json（${sets.generated}，蓝图 ${sets.blueprint_version}）`,
      holds: "data/realBank/review-holds.json",
      source_flags: "data/realBank/source-flags.json",
      consolidation: "data/realBank/reading/consolidation.json",
    },
    _causes: CAUSE_LABEL,
    summary: ledger.summary,
    byType: ledger.byType,
    bySection: ledger.bySection,
    tasks: actionableTasks(ledger.rows),
    rows: ledger.rows,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`\n账本 → ${path.relative(process.cwd(), OUT)}（${ledger.rows.length} 行缺口，${payload.tasks.length} 项补题任务）`);

  if (freeze) {
    const prev = readJson(BASELINE, null);
    const baseline = {
      _generated: new Date().toISOString().slice(0, 10),
      _generated_by: "scripts/realbank/loss_ledger.mjs --freeze",
      _purpose: "各题型入库量的冻结基线。重建后只许涨不许跌；跌了 __tests__/realbank-loss-guard.test.js 会红。",
      _how_to_bump: "确认数字是真涨了（不是把别的题挤掉换来的），重跑 node scripts/realbank/loss_ledger.mjs --freeze",
      blueprint_version: sets.blueprint_version,
      total_got: ledger.summary.got,
      byType: Object.fromEntries(Object.values(ledger.byType).map((b) => [b.type, b.got])),
    };
    fs.writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    const drops = prev
      ? Object.entries(baseline.byType).filter(([t, got]) => got < (prev.byType?.[t] ?? 0))
      : [];
    console.log(`基线 → ${path.relative(process.cwd(), BASELINE)}（总入库 ${baseline.total_got}）`);
    if (drops.length) {
      console.log(`  [注意] 这次冻结把下列题型的基线**调低**了：${drops.map(([t, g]) => `${t} ${prev.byType[t]}→${g}`).join("、")}`);
      console.log("  调低基线 = 承认丢了题。确认是有意为之再提交。");
    }
  }
}

main();
