#!/usr/bin/env node
/**
 * 真题源料体检 —— 只重算 `section_gap` 这一条 flag。
 *
 * 为什么需要：`data/realBank/source-flags.json` 是 2026-09-06 的一次性体检产物
 * （`.codex-tmp/realbank/_source_audit.json`），此后源料补齐过、解析器修过、卷重扫过，
 * 但 flag 没人重算。实测 2026-09-16：
 *   · 2.23 体检时听力音频还是 `.baiduyun.p.downloading` 半个包、OCR 只出 31 块 → 记 blocking；
 *     现在源料下全、重扫后配对 47/47，缺口 0。
 *   · 3.4 / 4.18 同理（体检 32/47 → 现在 47/47）。
 * 而 blocking 的后果是**整科不入库** —— 陈旧的 flag 就等于凭 9 天前的残缺源料把今天的好题扣着。
 *
 * 判据不是我新定的，就是 source-flags.json 自己 `_note` 里写的那条：
 *   「section_gap 的判据是配对题数距满分的缺口：≥3 记 warn、≥10 记 blocking；≤2 不记 flag。」
 * 这里只是拿**当前的扫描产物**（`.codex-tmp/realbank/<卷>.json` 的 alignment，也正是
 * structure_set / 合流器实际吃的那份）把同一条判据重跑一遍。
 *
 * 边界（守得很紧，避免变成「自动放行」）：
 *   · 只碰 code === "section_gap" 的条目；别的 code 一个字不动。
 *   · 只按缺口重算 severity 与 detail；**从不新增** flag（体检没记的卷不会因为这里多出 flag 来）。
 *   · 扫描产物缺失 / alignment 读不出 / 算不出总题数 → 该条**原样保留**（fail-closed 到「照旧扣着」）。
 *
 * 用法：
 *   node scripts/realbank/refresh_section_gap.mjs --dry   # 只打印会怎么改
 *   node scripts/realbank/refresh_section_gap.mjs         # 写回 source-flags.json
 */
import fs from "fs";
import path from "path";
import { EXAM_2026 } from "../../lib/realExam/blueprint.mjs";

const ROOT = process.cwd();
const FLAGS = path.join(ROOT, "data", "realBank", "source-flags.json");
const OUT_DIR = path.join(ROOT, ".codex-tmp", "realbank");

/** 缺口 → severity；null 表示这条 flag 不该存在。（判据出处见头注） */
export function gapSeverity(gap) {
  if (!Number.isFinite(gap) || gap <= 2) return null;
  return gap >= 10 ? "blocking" : "warn";
}

/**
 * 当前扫描里这一科配对上答案的题数与**蓝图满分**。算不出返回 null（调用方据此保留原状）。
 *
 * 满分一律取蓝图（2026：阅读 50 / 听力 47 / 口语 11 / 写作 12），不取「扫描里各 module 的 total 之和」——
 * 后者会把「整个 module 在源料里就没有」算成缺口 0（3.8 的听力只有 M1，模块和是 32/32），
 * 也会被答案页里多出来的题号重启块撑大（3.24 的阅读模块和是 65）。体检当初记的也是蓝图满分。
 */
export function scanPairing(scan, section) {
  const a = ((scan || {}).alignment || {})[section];
  if (!a || !Array.isArray(a.modules) || !a.modules.length) return null;
  const total = (EXAM_2026[section] || {}).total;
  if (!Number.isFinite(total)) return null;
  let matched = 0;
  for (const m of a.modules) matched += (m.matched || []).length;
  return { matched: Math.min(matched, total), total };
}

/**
 * 重算一卷的 flag 列表。→ { flags, changes[] }（flags 是新数组，changes 逐条说明改了什么）。
 * 纯函数：扫描产物由调用方读进来，方便单测。
 */
export function refreshSet(setname, flags, scan) {
  const out = [], changes = [];
  for (const f of flags || []) {
    if (!f || f.code !== "section_gap") { out.push(f); continue; }
    const section = (f.sections || []).find((s) => s !== "*");
    const pair = section ? scanPairing(scan, section) : null;
    if (!pair) {                       // 读不出就保留原状
      out.push(f);
      changes.push({ set: setname, section, action: "保留", why: "扫描产物里读不出这一科的配对" });
      continue;
    }
    const gap = pair.total - pair.matched;
    const next = gapSeverity(gap);
    if (next === null) {
      changes.push({ set: setname, section, action: "删除", from: f.severity,
        why: `现在配对 ${pair.matched}/${pair.total}，缺口 ${gap} ≤ 2` });
      continue;                        // 不再记这条 flag
    }
    const detail = `${section} 科缺 ${gap} 题（配对 ${pair.matched}／满分 ${pair.total}）。`;
    if (next === f.severity && detail === f.detail) { out.push(f); continue; }
    changes.push({ set: setname, section, action: next === f.severity ? "改写明细" : "改级别",
      from: f.severity, to: next, why: `现在配对 ${pair.matched}/${pair.total}，缺口 ${gap}` });
    out.push({ ...f, severity: next, detail });
  }
  return { flags: out, changes };
}

function main() {
  const dry = process.argv.includes("--dry");
  const doc = JSON.parse(fs.readFileSync(FLAGS, "utf8"));
  const sets = doc.sets || {};
  const allChanges = [];
  for (const [setname, flags] of Object.entries(sets)) {
    if (!(flags || []).some((f) => f && f.code === "section_gap")) continue;
    let scan = null;
    try { scan = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `${setname}.json`), "utf8")); } catch { /* 没扫描就保留原状 */ }
    const { flags: next, changes } = refreshSet(setname, flags, scan);
    if (changes.length) allChanges.push(...changes);
    if (next.length) sets[setname] = next; else delete sets[setname];
  }
  console.log(`■ 重算 section_gap（判据：缺口 ≤2 不记 / 3–9 warn / ≥10 blocking）`);
  if (!allChanges.length) { console.log("  没有需要改的。"); return 0; }
  for (const c of allChanges) {
    console.log(`  ${c.action.padEnd(4)} ${c.set} · ${c.section}${c.from ? ` · ${c.from}${c.to ? ` → ${c.to}` : ""}` : ""} —— ${c.why}`);
  }
  if (dry) { console.log("（--dry：未写盘）"); return 0; }
  doc._section_gap_refreshed = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(FLAGS, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(`→ ${path.relative(ROOT, FLAGS)}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1].split(path.sep).join("/")}`
    || process.argv[1].endsWith("refresh_section_gap.mjs")) process.exit(main());
