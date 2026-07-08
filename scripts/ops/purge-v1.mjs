/**
 * purge-v1.mjs — v1（校准前老题）整段删除：阅读 + 听力 8 库
 *
 * 背景（已获用户拍板，见 QUESTION-PIPELINE-REVIEW-2026-07-07.md）：
 * 2026-05-31 晚 18:41 校准后 routine 上线之前生成的「v1 老题」（老编号方案 +
 * 5 月及更早时间戳批次，含 5/31 上午的 *_v2_1780213… 批）质量口径不可考，
 * 整段删除；删后剩余题走盲审质检（scripts/ops/review/）。
 *
 * v1 判定规则（精确执行）——对 item.id：
 *   1. 匹配 /_r1_|_gen_|WAVE|wave/ → v1（老编号方案）。
 *      注：_r1_ 两侧带下划线，不会误伤 *_r2_routine-*。
 *   2. 否则解码 epoch 时间戳，任一命中且 < 2026-06-01（UTC）→ v1：
 *      a. 13 位十进制 epoch-ms：/_(17[78]\d{10})/
 *      b. 10 位十进制 epoch-s：/_(17[78]\d{7})(_|$)/ ×1000
 *      c. base36 段：id 按 "_" 分段，形如 /^m[a-z0-9]{7}$/ 的段 parseInt(p,36)，
 *         落在 (1.75e12, 1.85e12) 内视为 epoch-ms
 *   3. id 内嵌 routine-YYYYMMDD / rt_YYYYMMDD 日期串的一律保留
 *      （5/31 晚 18:41 起校准后 routine 的产物，日期串不做删除依据）。
 *   4. 其余解不出时间的（lat_rt_001、rpt_ 占位等）→ 保留（保守，留给盲审兜底）。
 *
 * 用法：
 *   node scripts/ops/purge-v1.mjs            # 默认 dry-run（只打印，不写盘）
 *   node scripts/ops/purge-v1.mjs --apply    # 逐库预期全中才落盘 + 写 purged-ids 报告
 *
 * 安全阀：任何一库删除数 ≠ 预期 → 拒绝落盘（即使传了 --apply），停下汇报。
 * 不做 git commit（主线程统一提交）。
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { repoRoot } from "./_shared.mjs";

// ── 配置 ─────────────────────────────────────────────────────────────────────
const BANKS = [
  { name: "ap", file: "data/reading/bank/ap.json" },
  { name: "ctw", file: "data/reading/bank/ctw.json" },
  { name: "rdl-short", file: "data/reading/bank/rdl-short.json" },
  { name: "rdl-long", file: "data/reading/bank/rdl-long.json" },
  { name: "lcr", file: "data/listening/bank/lcr.json" },
  { name: "lc", file: "data/listening/bank/lc.json" },
  { name: "la", file: "data/listening/bank/la.json" },
  { name: "lat", file: "data/listening/bank/lat.json" },
];

// 预期删除数（逐库精确核对，任何偏差都拒绝 --apply）。
const EXPECTED_REMOVE = {
  ap: 61, ctw: 166, "rdl-short": 88, "rdl-long": 65,
  lcr: 38, lc: 19, la: 19, lat: 17,
};
// 删后预期条数（--apply 后复核）。
const EXPECTED_AFTER = {
  ap: 111, ctw: 183, "rdl-short": 133, "rdl-long": 69,
  lcr: 264, lc: 161, la: 140, lat: 116,
};

const PURGED_IDS_REPORT = "data/claudeGen/reports/v1-purged-ids-2026-07-08.json";

// v1/v2 分界：2026-06-01T00:00:00Z（< 该时刻 = 5 月及更早 = v1）。
const CUTOFF_MS = Date.parse("2026-06-01T00:00:00Z");
// base36 段合理 epoch-ms 区间（开区间）。
const B36_MIN = 1.75e12;
const B36_MAX = 1.85e12;

// ── v1 判定 ──────────────────────────────────────────────────────────────────
/**
 * decodeEpoch(id) → { ts: epoch-ms, src: "ms13"|"s10"|"b36" } | null
 * 按规则 2 的 a→b→c 顺序取第一个命中。
 */
function decodeEpoch(id) {
  let m = id.match(/_(17[78]\d{10})/);
  if (m) return { ts: parseInt(m[1], 10), src: "ms13" };
  m = id.match(/_(17[78]\d{7})(_|$)/);
  if (m) return { ts: parseInt(m[1], 10) * 1000, src: "s10" };
  for (const p of id.split("_")) {
    if (/^m[a-z0-9]{7}$/.test(p)) {
      const v = parseInt(p, 36);
      if (v > B36_MIN && v < B36_MAX) return { ts: v, src: "b36" };
    }
  }
  return null;
}

/**
 * classify(id) → { v1: boolean, rule: string, ts?: number }
 * rule ∈ del_oldscheme | del_ts_ms13 | del_ts_s10 | del_ts_b36
 *      | keep_ts_* | keep_routine_date | keep_undecodable | keep_noid
 */
function classify(id) {
  if (typeof id !== "string" || id === "") return { v1: false, rule: "keep_noid" };
  if (/_r1_|_gen_|WAVE|wave/.test(id)) return { v1: true, rule: "del_oldscheme" };
  const e = decodeEpoch(id);
  if (e) {
    if (e.ts < CUTOFF_MS) return { v1: true, rule: `del_ts_${e.src}`, ts: e.ts };
    return { v1: false, rule: `keep_ts_${e.src}`, ts: e.ts };
  }
  if (/routine-\d{8}|rt_\d{8}/.test(id)) return { v1: false, rule: "keep_routine_date" };
  return { v1: false, rule: "keep_undecodable" };
}

// ── I/O（保持顶层字段原样、2 空格缩进、末尾单换行，与现有库一致） ─────────────
function readBank(file) {
  const full = resolve(repoRoot, file);
  const data = JSON.parse(readFileSync(full, "utf8"));
  return { full, data };
}

function writeBank(full, data) {
  writeFileSync(full, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
function main() {
  const apply = process.argv.slice(2).includes("--apply");
  console.log(`\n=== v1 老题删除（${apply ? "APPLY 落盘" : "DRY-RUN 预览"}）===`);
  console.log(`分界: 时间戳 < ${new Date(CUTOFF_MS).toISOString()} 视为 v1\n`);

  const plans = []; // { bank, full, data, kept, removed, ruleCounts, orphanAudio }
  const purgedIdsReport = {};
  let grandBefore = 0;
  let grandRemove = 0;
  let grandOrphan = 0;
  let mismatch = false;

  for (const bank of BANKS) {
    const { full, data } = readBank(bank.file);
    const items = Array.isArray(data.items) ? data.items : [];
    const kept = [];
    const removed = [];
    const ruleCounts = {};
    for (const item of items) {
      const r = classify(item && item.id);
      ruleCounts[r.rule] = (ruleCounts[r.rule] || 0) + 1;
      if (r.v1) removed.push(item);
      else kept.push(item);
    }
    const orphanAudio = removed.filter((it) => it && it.audio_url).length;
    const exp = EXPECTED_REMOVE[bank.name];
    const ok = removed.length === exp;
    if (!ok) mismatch = true;

    grandBefore += items.length;
    grandRemove += removed.length;
    grandOrphan += orphanAudio;
    purgedIdsReport[bank.name] = removed.map((it) => (it && it.id != null ? it.id : null));
    plans.push({ bank, full, data, kept, removed, ruleCounts, orphanAudio });

    // 规则细分：老编号 vs 5月前时间戳。
    const delOld = ruleCounts.del_oldscheme || 0;
    const delTs = (ruleCounts.del_ts_ms13 || 0) + (ruleCounts.del_ts_s10 || 0) + (ruleCounts.del_ts_b36 || 0);
    console.log(
      `[${bank.name}] before=${items.length} 删=${removed.length} after=${kept.length}` +
      ` | 预期删=${exp} ${ok ? "✓" : "✗ 不一致!"}` +
      ` | 细分: 老编号=${delOld} 5月前时间戳=${delTs}` +
      (orphanAudio ? ` | 被删条目含音频(孤儿)=${orphanAudio}` : "")
    );
    const keeps = Object.entries(ruleCounts)
      .filter(([k]) => k.startsWith("keep_"))
      .map(([k, v]) => `${k.slice(5)}=${v}`)
      .join(" ");
    console.log(`    保留侧: ${keeps}`);
  }

  // 汇总表
  console.log("\n── 汇总 ──────────────────────────────────────────────");
  console.log("库          before    删   after  预期删  核对");
  for (const p of plans) {
    const exp = EXPECTED_REMOVE[p.bank.name];
    console.log(
      `${p.bank.name.padEnd(10)} ${String(p.kept.length + p.removed.length).padStart(6)}` +
      ` ${String(p.removed.length).padStart(5)} ${String(p.kept.length).padStart(6)}` +
      ` ${String(exp).padStart(6)}  ${p.removed.length === exp ? "✓" : "✗"}`
    );
  }
  console.log("──────────────────────────────────────────────────────");
  const expTotal = Object.values(EXPECTED_REMOVE).reduce((a, b) => a + b, 0);
  console.log(`合计 before=${grandBefore} 删=${grandRemove} after=${grandBefore - grandRemove}（预期删合计=${expTotal}）`);
  console.log(`孤儿音频合计=${grandOrphan}（被删听力条目的 audio_url 数，Supabase 存储可后续清理）`);

  if (mismatch) {
    console.error(`\n[停止] 至少一库删除数与预期不一致，${apply ? "拒绝落盘" : "请勿 --apply"}，先人工核对规则/数据。`);
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log("\n(dry-run：未写任何文件。逐库全中，可加 --apply 落盘。)");
    return;
  }

  // ── 落盘 ──
  for (const p of plans) {
    p.data.items = p.kept; // 复用原对象 → 顶层字段与顺序完全保持
    writeBank(p.full, p.data);
  }
  const rep = resolve(repoRoot, PURGED_IDS_REPORT);
  mkdirSync(dirname(rep), { recursive: true });
  writeFileSync(rep, JSON.stringify(purgedIdsReport, null, 2) + "\n", "utf8");
  console.log(`\npurged-ids 清单已写入: ${rep}`);

  // ── 复核：重读文件核对删后条数 + 库内不应再有 v1 ──
  let recheckFailed = false;
  console.log("\n── 复核（重读落盘文件）──");
  for (const bank of BANKS) {
    const { data } = readBank(bank.file);
    const items = Array.isArray(data.items) ? data.items : [];
    const expAfter = EXPECTED_AFTER[bank.name];
    const residual = items.filter((it) => classify(it && it.id).v1).length;
    const ok = items.length === expAfter && residual === 0;
    if (!ok) recheckFailed = true;
    console.log(`[${bank.name}] after=${items.length} 预期=${expAfter} 残留v1=${residual} ${ok ? "✓" : "✗"}`);
  }
  if (recheckFailed) {
    console.error("\n[错误] 复核未通过，请人工检查。");
    process.exitCode = 1;
  } else {
    console.log("\n复核通过：8 库删后条数全部符合预期，0 残留 v1。");
  }
}

main();
