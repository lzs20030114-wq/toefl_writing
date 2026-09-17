/**
 * 落库前的只读校验：**还没重排的听力题号**。
 *
 * ── 病 ────────────────────────────────────────────────────────────────────
 * 听力题号重建（listening_renumber_run.mjs）就地改 `.codex-tmp/realbank/<卷>.structured.json`，
 * 而合流脚本（merge_recording_asr / merge_first_source_asr / merge_vendor_asr）会**整份重写**
 * 这个文件（从 `.structured.fs_parsed.json` / `.structured.parsed.json` 快照重放）。
 * 于是「重跑一次合流」就把重排静默冲掉了 —— 之前这件事只写在脚本头注里，没有任何机制拦。
 *
 * 冲掉之后不会出错题，只会**少题**：盲审明细是按重排后的新题号记的，打回旧号的题配不上明细，
 * build_bank 按「没审过」不收（fail-closed）。但账本上只看得到「这卷题变少了」，看不出为什么。
 *
 * ── 为什么闸放在 build_bank ───────────────────────────────────────────────
 * 重写 structured 的入口有四个（三个合流器 + structure_set），还都能手工单独跑；逐个接线会漏。
 * 落库只有 build_bank 一个口子，闸放这里**一处不漏**，而且是纯派生的只读计算：
 * 读现成的 `<卷>.json` + `<卷>.structured.json` 重算一遍计划，有待办就列出来。
 * 全库 75 套实测 < 1s、零 API，所以每次 build 都能白跑一遍。
 *
 * 只警告不拦：真正的 fail-closed 在盲审闸那一层（配不上明细 = 不收），这里的职责是把
 * 「为什么忽然少了」这件事说出来，而不是把一次正常的落库卡住。
 */
const fs = require("fs");
const path = require("path");

const R = require("./listening_renumber.js");

/**
 * 纯函数：`[{set, plan}]` → 待办清单（只留有动作的卷，按待重排题数倒序）。
 */
function pendingRows(plans) {
  return (plans || [])
    .map((p) => ({
      set: p.set,
      moves: ((p.plan && p.plan.moves) || []).length,
      removed: ((p.plan && p.plan.removed) || []).length,
    }))
    .filter((r) => r.moves || r.removed)
    .sort((a, b) => b.moves - a.moves || b.removed - a.removed || String(a.set).localeCompare(String(b.set)));
}

/**
 * 纯函数：待办清单 → 警告文本行数组（没有待办返回空数组）。
 */
function pendingLines(rows) {
  if (!rows || !rows.length) return [];
  const moves = rows.reduce((n, r) => n + r.moves, 0);
  const removed = rows.reduce((n, r) => n + r.removed, 0);
  const out = [
    `⚠ 听力题号重排有待办：${rows.length} 套卷共 ${moves} 题可重排、${removed} 条空题该清`
    + `（多半是重跑合流把上一次重排冲掉了 —— 这些题配不上盲审明细，本次落库不会收）`,
  ];
  for (const r of rows) {
    out.push(`   ${r.set}：重排 ${r.moves}、清空题 ${r.removed}`);
  }
  out.push('   修：node scripts/realbank/listening_renumber_run.mjs "<卷名>" --write'
    + ' → node scripts/realbank/audit_answers.mjs "<卷名>" --section=listening --only-missing');
  return out;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

/**
 * 扫一遍产物目录，重算每套卷的重排计划。
 * @param {string} outDir  `.codex-tmp/realbank`
 * @param {string[]} [files] `*.structured.json` 文件名（不给就自己列目录）
 */
function scanPending(outDir, files) {
  const list = (files && files.length ? files : fs.readdirSync(outDir).filter((f) => f.endsWith(".structured.json")));
  const plans = [];
  for (const f of list) {
    const set = String(f).replace(/\.structured\.json$/, "");
    const scan = readJson(path.join(outDir, `${set}.json`));
    const structured = readJson(path.join(outDir, `${set}.structured.json`));
    if (!scan || !structured) continue;
    if (!(structured.results || []).some((r) => r.section === "listening" && (r.items || []).length)) continue;
    let plan = null;
    try { plan = R.planSet({ scan, structured }); } catch { continue; }
    plans.push({ set, plan });
  }
  return pendingRows(plans);
}

/** 扫 + 打印。返回待办清单（调用方想入报告可以用）。 */
function warnPendingRenumber(outDir, files, log) {
  const say = log || console.warn;
  let rows = [];
  try { rows = scanPending(outDir, files); } catch (e) { say(`⚠ 听力重排校验没跑起来：${e && e.message}`); return []; }
  for (const line of pendingLines(rows)) say(line);
  return rows;
}

module.exports = { pendingRows, pendingLines, scanPending, warnPendingRenumber };
