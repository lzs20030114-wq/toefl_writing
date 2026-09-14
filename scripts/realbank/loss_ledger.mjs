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
 *   node scripts/realbank/loss_ledger.mjs --plan          # 出「回收作业单」：按阶段排好的可粘贴命令
 *   node scripts/realbank/loss_ledger.mjs --plan --limit 8  # 每阶段只出前 8 套
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


/**
 * 回收作业单：把账本里「重扫就能捡」的任务排成可粘贴的命令。
 *
 * 只剩阅读一个阶段能靠重扫：不碰音频、量最大（填词为主）。
 * 听力/口语必须接着重跑合流，否则救回的块进不了库（见 structured_io 头注）。
 *
 * 同一套卷的多个科目合成一条命令（--sections a,b），少跑一次扫描。
 */
function printPlan(tasks, limit) {
  // 只有阅读能靠重扫 structure_set 回收。听力/口语**不在作业单里**：
  // 合流跑过之后这两科归合流所有（key 格式都换了），重扫既查不到失败块、会变成整科
  // 全量付费重跑，也换不来题 —— 正文来自商家逐字稿 + ASR 对齐，扣题原因全判在合流层。
  // 详见 scripts/realbank/failure_policy.js 的 isMergeOwned。
  // 写作三题型都**不靠重扫**（下面各自单列一段）：
  //   · 造句(bs)：题面来自 extract_bs_pages.py 看图产出的 `<卷>.bs.json`（写作 PDF 没有文字层）；
  //     structured 的 build 段只有 {n, sentence} 答案句，build_bank 按 thin 丢弃。
  //   · 邮件 / 学术讨论：structure_set 根本没有这两种题的路由（2026-09-14 实测 54 套 --dry 全是
  //     「没有需要处理的块」）—— 它靠答案页题号对题，这两题没有标准答案，对齐层不生成题块。
  //     第一来源的这两题走 writing-recall 补录账本（scripts/realbank/writing_recall.js 头注）。
  const STAGES = [
    { name: "阶段 1 · 阅读（量最大，填词为主）",
      sections: ["reading"], types: ["ctw", "rdl", "ap"] },
  ];
  console.log("\n" + "=".repeat(72));
  console.log("回收作业单（在本机 .codex-tmp 所在的仓库根目录跑）");
  console.log("=".repeat(72));
  console.log("下面每条都带 --dry：**不调模型、零成本、秒回**，只报这卷这科还有几个失败块可重扫。");
  console.log("所以第 0 步是把整个阶段的 --dry 全跑一遍（不花钱），拿到真实可回收量，再决定花钱跑哪些。");
  console.log("");
  console.log("怎么读 --dry 的结果：");
  console.log("  · 报出「待处理题块 N」→ 有 N 个失败块可重扫，去掉 --dry 就真跑；");
  console.log("  · 报「没有需要处理的块」→ 这卷这科在中间产物里根本没有题块。那是 ingest/对齐层的空缺");
  console.log("    （源里没有这几页，或对齐没认出来），重扫解决不了 —— **但这本身就是有用的诊断**，");
  console.log("    说明这批缺口要去 ingest 那一层找，请记下来。");
  console.log("  · 报「需要既有产物」→ 这卷的中间产物不在 .codex-tmp，跳过即可。");
  console.log("");
  console.log("每条命令只重扫**已经失败**的块；合流层扣下的听力段会自动跳过");
  console.log("（它们的病在对齐/性别/音频，重跑结构化治不了）。");

  for (const stage of STAGES) {
    const mine = tasks.filter((t) => stage.sections.includes(t.section));
    if (!mine.length) continue;
    // 同一套卷的多科合成一条命令
    const bySet = new Map();
    for (const t of mine) {
      // 只计这一阶段能靠重扫回收的题型，免得把「重扫治不了的」也算进预期收益
      const types = Object.entries(t.types).filter(([k]) => stage.types.includes(k));
      const missing = types.reduce((a, [, v]) => a + v, 0);
      if (!missing) continue;
      const cur = bySet.get(t.set) || { set: t.set, missing: 0, sections: new Set(), types: {} };
      cur.missing += missing;
      cur.sections.add(t.section);
      for (const [k, v] of types) cur.types[k] = (cur.types[k] || 0) + v;
      bySet.set(t.set, cur);
    }
    if (!bySet.size) continue;
    let list = [...bySet.values()].sort((a, b) => b.missing - a.missing);
    const total = list.reduce((a, b) => a + b.missing, 0);
    if (limit > 0) list = list.slice(0, limit);

    console.log(`\n── ${stage.name} —— ${bySet.size} 套，合计缺 ${total} 题 ──`);
    for (const x of list) {
      const types = Object.entries(x.types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}-${v}`).join(" ");
      console.log(`# 缺 ${x.missing}：${types}`);
      console.log(`node scripts/realbank/structure_set.mjs "${x.set}" --only-failed --sections ${[...x.sections].join(",")} --dry`);
    }
    if (limit > 0 && bySet.size > limit) console.log(`# …另有 ${bySet.size - limit} 套，去掉 --limit 看全部`);
  }

  // 邮件 / 学术讨论单独一段：不是重扫，是补录账本
  const wGap = tasks.reduce((a, t) => a + (t.types.email || 0) + (t.types.disc || 0), 0);
  if (wGap) {
    console.log(`\n── 真题邮件 / 学术讨论的 ${wGap} 题：走补录账本，不是重扫 ──`);
    console.log("structure_set 靠答案页题号对题，这两题没有标准答案 → 对齐层根本不给它们生成题块，重扫全是空转。");
    console.log("第一来源卷的这两题早在校准时抽过（data/realExam2026/writing/），核过原卷后记进 data/realBank/writing-recall.json：");
    console.log("  node scripts/realbank/recall_writing.mjs --dry          # 账本里每卷 ok / review / reject 与原因");
    console.log("  node scripts/realbank/build_bank.mjs --only-writing-recall");
    console.log("  node scripts/realbank/assemble_sets.mjs");
    console.log("剩下的缺口多半是：同一道题在别的卷已入库（记成别名，assemble 后自动补回槽位）、");
    console.log("教授原话 / 学生帖只抽到一半（要对着原卷截图补进账本）、或写作整科被源料体检扣下。");
  }

  // 造句单独一段：工具链完全不同
  const bsGap = tasks.reduce((a, t) => a + (t.types.bs || 0), 0);
  if (bsGap) {
    console.log(`\n── 真题造句（bs）的 ${bsGap} 题：走看图，不是重扫 ──`);
    console.log("写作 PDF 没有文字层，造句题的模板 + 乱序词块只存在于考试界面截图里。");
    console.log("structured.json 的 build 段只有 {n, sentence} 答案句，build_bank 按 thin 丢弃；");
    console.log("题面来自 extract_bs_pages.py 看图产出的 `<卷>.bs.json`。");
    console.log("  D:/python/python scripts/realbank/extract_bs_pages.py --dry-run   # 先报「几张图 / 预计 ¥」(¥0.01/张)");
    console.log("  D:/python/python scripts/realbank/extract_bs_pages.py --only <卷名>");
    console.log("⚠ 先看 docs/BACKLOG.md 里那条未决项：写作 PDF 上的词块边界已被 OCR 糊掉");
    console.log("  （363 条 scrambled_ocr），只能做成「真题句子 + 本站切块」——");
    console.log("  这种来源分档接不接受，是要你先拍板的，别先烧看图的钱。");
  }

  // 听力/口语单独说清楚：它们的缺口在作业单里是**故意不出现**的
  const lsn = tasks.filter((t) => t.section === "listening" || t.section === "speaking");
  if (lsn.length) {
    const q = lsn.reduce((a, b) => a + b.missing, 0);
    console.log(`\n── 听力/口语的 ${q} 题：不要重扫 ──`);
    console.log("这两科合流跑过之后就归合流所有（structure_set 的 key 格式与合流写回的不同），");
    console.log("重扫既查不到失败块（会变成整科全量重跑、全额付费），也换不来题：");
    console.log("听力题的正文/轮次/说话人来自商家逐字稿 PDF + ASR 词级对齐，音频是商家原声，");
    console.log("structure_set 只负责转写答题屏上的题干选项；扣题原因（对齐不符 / 性别判不出 /");
    console.log("段数不符 / 逐字稿被截 / 屏幕侧缺题）全部判在合流层。要补得回合流那一层：");
    console.log("  python scripts/realbank/lc_gender_worksheet.py --list --csv lc-gender.csv   # 听音标性别");
    console.log("  python scripts/realbank/merge_first_source_asr.py --all                     # 标完重跑合流");
    console.log("源料本身缺的（音频缺失/无说话人标签）要找商家补料，见 data/realBank/listening/original-audio.json 的 skipped。");
  }

  console.log("\n── 跑完扫描后（顺序不能换）──");
  console.log("# 阅读救回的题必须补盲审：build_bank 的阅读闸按 <卷>.audit.json 放行，");
  console.log("# 没审过的题会被当场丢掉（stats.droppedNoAudit）。写作不走这道闸，跳过即可。");
  console.log("node scripts/realbank/audit_answers.mjs \"<卷名>\" --section=reading --only-missing");
  console.log("#  ⚠ --only-q 不带 --only-missing 会清空该卷全部阅读盲审条目（已知工具坑，别单独用）");
  console.log("node scripts/realbank/build_bank.mjs");
  console.log("node scripts/realbank/assemble_sets.mjs");
  console.log("node scripts/realbank/loss_ledger.mjs --freeze     # 数字涨了就重冻基线");
  console.log("npx jest __tests__/realbank-loss-guard.test.js     # 确认没有哪个题型反而变少");
  console.log("node scripts/ops/deepseek-usage-report.mjs         # 对账这轮花了多少");
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const freeze = args.includes("--freeze");
  const plan = args.includes("--plan");
  const limIdx = args.indexOf("--limit");
  const planLimit = limIdx >= 0 ? Number(args[limIdx + 1]) || 0 : 0;
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
  console.log(`  管线丢题   ${s.causes.pipeline_loss} 题（重扫 flagged 块可回收）`);
  console.log(`  整科跑了归零 ${s.causes.section_lost} 题（管线覆盖这科、这卷也跑过，却颗粒无收 —— 同上，重扫）`);
  console.log(`  整科没跑过 ${s.causes.section_never_run} 题（管线本来就没跑它；补不补是铺量决策，听力还要掏 TTS 的钱）\n`);

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
  const absentTasks = tasks.filter((t) => t.cause === "section_lost");

  console.log(`\n① 立刻能回收的（${CAUSE_LABEL.pipeline_loss}，共 ${lossTasks.length} 套·科；`
    + "跑 structure_set --only-failed 扫这一科的 flagged 块)：");
  for (const t of lossTasks.slice(0, top)) {
    const types = Object.entries(t.types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}-${v}`).join(" ");
    console.log(`  ${pad(t.set, 26)}${pad(t.section, 11)}${pad(`缺 ${t.missing}`, 8, true)}  ${types}`);
  }
  if (lossTasks.length > top) console.log(`  …另有 ${lossTasks.length - top} 套·科，见账本 tasks[]`);

  console.log(`\n② ${CAUSE_LABEL.section_lost}（跑过却颗粒无收 —— 整科重扫，不是补料问题）：`);
  const absentBySection = {};
  for (const t of absentTasks) {
    absentBySection[t.section] ||= { sets: 0, missing: 0 };
    absentBySection[t.section].sets += 1;
    absentBySection[t.section].missing += t.missing;
  }
  for (const [section, v] of Object.entries(absentBySection).sort((a, b) => b[1].missing - a[1].missing)) {
    console.log(`  ${pad(section, 12)}${pad(`${v.sets} 套`, 8, true)}${pad(`缺 ${v.missing} 题`, 12, true)}`);
  }

  // ③ 铺量决策那一桶：不进 tasks，单独报规模
  const neverRun = {};
  for (const r of rows) {
    if (!r.charged.section_never_run) continue;
    neverRun[r.section] ||= { sets: new Set(), missing: 0 };
    neverRun[r.section].sets.add(r.set);
    neverRun[r.section].missing += r.charged.section_never_run;
  }
  if (Object.keys(neverRun).length) {
    console.log(`\n③ ${CAUSE_LABEL.section_never_run}（管线没跑过；补不补要先拍板，听力/口语还要掏配音的钱）：`);
    for (const [section, v] of Object.entries(neverRun).sort((a, b) => b[1].missing - a[1].missing)) {
      console.log(`  ${pad(section, 12)}${pad(`${v.sets.size} 套`, 8, true)}${pad(`缺 ${v.missing} 题`, 12, true)}`);
    }
  }

  if (plan) printPlan(tasks, planLimit);

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
