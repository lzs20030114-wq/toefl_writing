#!/usr/bin/env node
/**
 * 真题源料体检 —— 陈旧 flag 重算（`refresh_section_gap.mjs` 的超集）。
 *
 * 为什么需要：`data/realBank/source-flags.json` 是 2026-09-06 的一次性体检快照
 * （`.codex-tmp/realbank/_source_audit.json`）。此后解析器修过两处：
 *   · `ingest_common._headers`：`EXTRA_MODULE` 认得「第二部份 / 另一套加试」这类表头；
 *   · `ingest_common.resolve_orphan_chains`：没写科目头的整块答案按**题号形状**定科（唯一命中才采用）。
 * 卷也全部重扫过，但 flag 没人重算 —— 而 severity=blocking 的后果是**整科不入库**，
 * 陈旧的 flag 就等于凭 11 天前的解析器把今天认得出来的答案扣着。实测 2026-09-17：
 *   · 2.8 / 3.24 的 `ingest_blocker`（「当前科目 reading」的题号重启块）—— 现在那一行被认成阅读 M2 表头，
 *     重扫产物 `blockers` 为空、听力 47/47 对齐；旧 flag 的 sections 是 `["*"]`，四科一起连坐。
 *   · 3.29 的 `section_no_answers`（listening「答案 PDF 里没有该科答案」）—— 商家漏打「听力」表头，
 *     `resolve_orphan_chains` 已按题号形状（of-32 / of-15）唯一推断回 listening，现在配对 47/47。
 *   · 4.18 的 `section_blocked`（speaking「配对 0 题」）—— 现在 partial 6/11。
 *
 * 判据不新定，全部是「拿**当前**扫描产物把体检当初那条判据重跑一遍」：
 *   | code | 体检当初记的是什么 | 现在怎么重判 |
 *   |---|---|---|
 *   | `section_gap` | 配对题数距**蓝图满分**的缺口（≤2 不记 / 3–9 warn / ≥10 blocking） | 交给 `refresh_section_gap.refreshSet` |
 *   | `section_no_answers` / `section_no_stems` / `section_blocked` | `alignment[科].status` 的那个坏状态 | 现在 status 是 ok/partial 且配对 >0 → 这条不成立 |
 *   | `ingest_blocker`（只限「题号重启块」形态） | 解析器在答案页第 N 行 fail-closed 扔掉一块答案 | 现在第 N 行不再触发 / 孤儿块已「已采用」定科 → 这条不成立 |
 *
 * 边界（守得很紧，避免变成「自动放行」）：
 *   · 只**移除**已不成立的 flag；**从不新增**，也从不把一个坏 code 改写成另一个坏 code；
 *   · 扫描产物缺失 / 读不出 / 认不出形态 → 该条**原样保留**（fail-closed 到「照旧扣着」）；
 *   · `ingest_blocker` 的其它形态（真读不出源、答案页整段缺失…）一个字不动；
 *   · `section_gap` 真成立时不移除，只在「缺口恰好等于某几个**整个缺席**的 module」时给它加
 *     `modules: [...]`，把扣留范围收窄到那几个 module（3.8：听力 M2 在答案源里真没有，M1 的 32 题齐全）。
 *     收窄同样是可证伪的算术，不是放宽判据：其余 module 的题一道没少配上。
 *
 * 用法：
 *   node scripts/realbank/refresh_source_flags.mjs --dry   # 只打印会怎么改
 *   node scripts/realbank/refresh_source_flags.mjs         # 写回 source-flags.json
 */
import fs from "fs";
import path from "path";
import { EXAM_2026 } from "../../lib/realExam/blueprint.mjs";
import { refreshSet as refreshGapSet } from "./refresh_section_gap.mjs";

const ROOT = process.cwd();
const FLAGS = path.join(ROOT, "data", "realBank", "source-flags.json");
const OUT_DIR = path.join(ROOT, ".codex-tmp", "realbank");

/** 由 `alignment[科].status` 的坏状态直接翻译过来的三条 code。 */
export const STATUS_CODES = Object.freeze({
  section_no_stems: "no_stems",
  section_no_answers: "no_answers",
  section_blocked: "blocked",
});

/** 扫描产物里这一科现在是什么状态；读不出返回 null（调用方据此保留原状）。 */
export function scanStatus(scan, section) {
  const a = ((scan || {}).alignment || {})[section];
  if (!a || typeof a.status !== "string") return null;
  const matched = Number.isFinite(a.matched_count)
    ? a.matched_count
    : (a.modules || []).reduce((n, m) => n + ((m.matched || []).length), 0);
  return { status: a.status, matched };
}

/**
 * 状态类 flag 现在还成不成立。
 * 只有「现在是 ok/partial 且配对 >0」才判为不成立；其余一律保留
 * （包括「从 no_stems 变成 blocked」这种——换了个坏法还是坏，不该在这里改写成另一条 code）。
 */
export function statusFlagStale(scan, section, code) {
  const cur = scanStatus(scan, section);
  if (!cur) return null;                                   // 读不出 → 保留
  if (!STATUS_CODES[code]) return null;
  const good = (cur.status === "ok" || cur.status === "partial") && cur.matched > 0;
  return good ? { stale: true, cur } : { stale: false, cur };
}

/** flag.detail 里「[某某.pdf] 答案页第 N 行…题号重启块…」的行号（1 起）。认不出返回 null。 */
export function restartBlockLine(detail) {
  const s = String(detail || "");
  if (!/题号重启块/.test(s)) return null;                   // 只认这一种形态
  const m = /答案页第\s*(\d+)\s*行/.exec(s);
  return m ? Number(m[1]) : null;
}

/** flag.detail 开头的 `[xxx.pdf]` 文件名；没有返回 null。 */
export function detailFile(detail) {
  const m = /^\s*\[([^\]]+)\]/.exec(String(detail || ""));
  return m ? m[1] : null;
}

/**
 * 「题号重启块」形态的 ingest_blocker 现在还成不成立。
 *
 * 当前扫描产物的 `blockers` 是解析器这一轮真实留下的痕迹：
 *   · 同一行**一条都没有** → 解析器已经认得那个表头，压根没扔东西 → 不成立（2.8 / 3.24）；
 *   · 同一行有「…已采用——请人工确认」的定科结论 → 孤儿块已被认回某一科 → 不成立（3.29 / 4.18）；
 *   · 同一行只有「已扣下…待题号形状推断」而没有定科结论 → 东西还扔着 → **保留**。
 * 拿不到 blockers 数组、认不出形态、文件名对不上 → 一律保留。
 */
export function ingestBlockerStale(scan, flag) {
  if (!scan || !Array.isArray(scan.blockers)) return null;
  const line = restartBlockLine(flag && flag.detail);
  if (line == null) return null;
  const file = detailFile(flag && flag.detail);
  const atLine = scan.blockers.map(String).filter((b) => {
    const m = /答案页第\s*(\d+)\s*行/.exec(b);
    if (!m || Number(m[1]) !== line) return false;
    return !file || b.includes(file);
  });
  if (!atLine.length) return { stale: true, why: `当前扫描里答案页第 ${line} 行不再出现题号重启块` };
  const adopted = atLine.find((b) => /已采用/.test(b));
  if (adopted) return { stale: true, why: `当前扫描里那一块已按题号形状定科并采用（第 ${line} 行）` };
  return { stale: false, why: `当前扫描里第 ${line} 行的孤儿块仍未定科` };
}

/**
 * section_gap 的「整个 module 缺席」收窄：某几个蓝图 module 在**答案源里连一块答案都没有**
 * （扫描的 alignment 里压根没有这个 module 号），而其余 module 逐题配满 → 返回缺席的 module 号数组。
 * 这时缺口必然恰好等于缺席 module 的满分之和（蓝图满分 = 各 module 满分之和），是算术不是判断。
 *
 * 「有答案块但路由不上题面」（3.24 阅读 M2/M3：answer module 在、matched 0、status=blocked）**不算缺席** ——
 * 那是对不齐，不是没有，收窄它等于把「可能错位」的一科放出去。任何一条对不上返回 null（照旧整科扣着）。
 */
export function absentModules(scan, section) {
  const a = ((scan || {}).alignment || {})[section];
  const bp = (EXAM_2026[section] || {}).modules;
  if (!a || !Array.isArray(a.modules) || !bp) return null;
  const byNo = new Map();
  for (const m of a.modules) byNo.set(Number(m.module), m);
  const absent = [];
  for (const [no, spec] of Object.entries(bp)) {
    const m = byNo.get(Number(no));
    if (!m) { absent.push(Number(no)); continue; }          // 答案源里连这个 module 都没有 = 缺席
    // 在场的 module 必须与蓝图同号同满分、且逐题配满 —— 否则缺口不止「整个 module 缺席」这一种成因
    if (Number(m.total) !== Number(spec.total) || (m.matched || []).length !== Number(spec.total)) return null;
  }
  // 扫描里多出蓝图没有的 module 号（答案页被题号重启块撑出第 3 块）→ 情况不干净，不收窄
  for (const no of byNo.keys()) if (!bp[String(no)]) return null;
  const totalOk = Object.values(bp).reduce((n, s) => n + Number(s.total), 0) === Number((EXAM_2026[section] || {}).total);
  if (!totalOk) return null;
  return absent.length && absent.length < Object.keys(bp).length ? absent.sort((x, y) => x - y) : null;
}

/**
 * 重算一卷的 flag 列表（section_gap 先交给 refresh_section_gap，再叠加本文件这几条）。
 * 纯函数：扫描产物由调用方读进来，方便单测。
 * → { flags, changes[] }
 */
export function refreshSetAll(setname, flags, scan) {
  const { flags: afterGap, changes } = refreshGapSet(setname, flags, scan);
  const out = [];
  for (const f of afterGap) {
    const section = ((f && f.sections) || []).find((s) => s !== "*") || null;

    if (f && STATUS_CODES[f.code] && section) {
      const r = statusFlagStale(scan, section, f.code);
      if (!r) { out.push(f); changes.push({ set: setname, code: f.code, section, action: "保留", why: "扫描产物里读不出这一科的状态" }); continue; }
      if (r.stale) {
        changes.push({ set: setname, code: f.code, section, action: "删除", from: f.severity,
          why: `现在 status=${r.cur.status}、配对 ${r.cur.matched} 题` });
        continue;
      }
      out.push(f);
      continue;
    }

    if (f && f.code === "ingest_blocker") {
      const r = ingestBlockerStale(scan, f);
      if (!r) { out.push(f); continue; }                   // 其它形态 / 读不出：一个字不动
      if (r.stale) {
        changes.push({ set: setname, code: f.code, section: section || "*", action: "删除", from: f.severity, why: r.why });
        continue;
      }
      out.push(f);
      changes.push({ set: setname, code: f.code, section: section || "*", action: "保留", why: r.why });
      continue;
    }

    if (f && f.code === "section_gap" && f.severity === "blocking" && section && !Array.isArray(f.modules)) {
      const absent = absentModules(scan, section);
      if (absent) {
        changes.push({ set: setname, code: f.code, section, action: "收窄", from: f.severity,
          why: `缺口全在 module ${absent.join("/")}（整个 module 在源料里没有），其余 module 逐题配满 → 只扣这几个 module` });
        // 说明写进自己的字段，**不动 detail** —— detail 归 refresh_section_gap 重写，
        // 往里面追加会让两个脚本来回改同一行（实测 --dry 不幂等）。
        out.push({ ...f, modules: absent,
          modules_why: `该 module 在源料里整个缺席（答案源连这个 module 都没有），其余 module 已逐题配满 —— 扣留范围收窄到 module ${absent.join("/")}。` });
        continue;
      }
    }

    out.push(f);
  }
  return { flags: out, changes };
}

function main() {
  const dry = process.argv.includes("--dry");
  const doc = JSON.parse(fs.readFileSync(FLAGS, "utf8"));
  const sets = doc.sets || {};
  const allChanges = [];
  for (const [setname, flags] of Object.entries(sets)) {
    let scan = null;
    try { scan = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `${setname}.json`), "utf8")); } catch { /* 没扫描就保留原状 */ }
    const { flags: next, changes } = refreshSetAll(setname, flags, scan);
    if (changes.length) allChanges.push(...changes);
    if (next.length) sets[setname] = next; else delete sets[setname];
  }
  console.log("■ 重算陈旧 flag（section_gap / section_no_* / section_blocked / ingest_blocker(题号重启块)）");
  const shown = allChanges.filter((c) => c.action !== "保留");
  for (const c of allChanges) {
    console.log(`  ${c.action.padEnd(4)} ${c.set} · ${c.code || "section_gap"} · ${c.section}`
      + `${c.from ? ` · ${c.from}` : ""} —— ${c.why}`);
  }
  console.log(`  合计：改动 ${shown.length} 条、保留 ${allChanges.length - shown.length} 条有记录的`);
  if (!shown.length) { console.log("  没有需要改的。"); return 0; }
  if (dry) { console.log("（--dry：未写盘）"); return 0; }
  doc._source_flags_refreshed = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(FLAGS, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(`→ ${path.relative(ROOT, FLAGS)}`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("refresh_source_flags.mjs")) process.exit(main());
