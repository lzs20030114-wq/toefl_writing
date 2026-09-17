/**
 * 盲审明细的**题目标识**（纯函数，无 IO，可单测）。
 *
 * 为什么单独抽一份：`.audit.json` 的 `audited[]` 原来按 `section#q` 认题，**不带 module**。
 * 数字卷 / 第一来源卷的听力 M1、M2 题号都从 1 起编（M1 1~32、M2 1~15），于是：
 *
 *   1. `build_bank` 的 `passedKeys` 变成两个 module 的**并集** —— M2 的 Q1~15 只要 M1 同号题
 *      盲审一致就被当成过审放行。2026-09-17 实测能唯一配对的误放行 20 题（lat 15 / lcr 4 / lc 1），
 *      例：`real_lat_316_2_08` 的 Q10/Q11 两票模型都不认答案页却在线。
 *   2. `audit_answers --second-vote` 的 `recByKey` 同款撞号 —— 送去补票的可能是**另一个 module**
 *      的那道题，记回来的 `second_vote.agree` 描述的根本不是这条明细说的题。
 *
 * 所以键一律带 module：`section#module#q`。旧明细没有 module 字段，**fail-closed**
 * （`entryKey` 返回 null → 既不算过审也不算审过 → 那题按「没审过」不收），不许退回旧键兜底：
 * 退回去就等于把上面两个 bug 原样留着。旧明细走一次性回填（`audit_backfill_module.mjs`）补上 module。
 */

const SEP = "#";

/** 题目标识：`section#module#q`。module 用 String 归一（JSON 里可能是数字或字符串）。 */
function auditKey(section, module, q) {
  return `${section}${SEP}${module}${SEP}${q}`;
}

/**
 * 一条盲审明细的键。**没有 module 的旧条目返回 null**（fail-closed，调用方须当成「没审过」）。
 */
function entryKey(entry) {
  if (!entry || entry.section == null || entry.q == null) return null;
  if (entry.module == null || entry.module === "") return null;
  return auditKey(entry.section, entry.module, entry.q);
}

/**
 * 从 `audited[]` 建落库要用的三个集合 + 明细索引。
 *
 * @param {Array} audited      `.audit.json` 的 audited 数组
 * @param {Function} passed    判「这条算不算过」的谓词（= hold_policy.auditPassed）
 * @returns {{passedKeys:Set, auditedKeys:Set, secondVoteKeys:Set, byKey:Map, legacy:number}}
 *   legacy = 因为没有 module 而被忽略的旧条目数（调用方可以打日志）
 */
function buildAuditIndex(audited, passed) {
  const passedKeys = new Set();
  const auditedKeys = new Set();
  const secondVoteKeys = new Set();
  const byKey = new Map();
  let legacy = 0;
  for (const a of Array.isArray(audited) ? audited : []) {
    const k = entryKey(a);
    if (!k) { legacy += 1; continue; }
    auditedKeys.add(k);
    if (!byKey.has(k)) byKey.set(k, a);
    if (passed(a)) {
      passedKeys.add(k);
      if (a.agree !== true) secondVoteKeys.add(k);
    }
  }
  return { passedKeys, auditedKeys, secondVoteKeys, byKey, legacy };
}

/**
 * 本卷里**跨 module 撞号**的 (section, q)：老键 `section#q` 分不开的就是这些。
 *
 * @param {Array} items [{section, module, q}]
 * @returns {Set<string>} `section#q`
 */
function crossModuleDupKeys(items) {
  const mods = new Map();
  for (const it of items || []) {
    const k = `${it.section}${SEP}${it.q}`;
    if (!mods.has(k)) mods.set(k, new Set());
    mods.get(k).add(String(it.module));
  }
  const out = new Set();
  for (const [k, s] of mods) if (s.size > 1) out.add(k);
  return out;
}

/**
 * 旧明细回填 module（幂等）。
 *
 * 判据：在**当前** structured 产物里按 (section, type, q, 答案页字母) 找。字母也要相等 ——
 * 重结构化换了题 / 答案页改了字母的，宁可判成孤儿重审，也不许把一条旧票安到别的题上。
 *
 *   唯一命中一个 module → 填上；
 *   一个都没命中        → 孤儿（题已不在产物里，多半是 --only-missing 一路沿用下来的），删掉；
 *   命中多个 module     → 歧义（就是老键治不了的那批），删掉并报出候选，交给调用方重审。
 *
 * @param {Array} audited 旧 audited 数组
 * @param {Array} items   当前可审题目 [{section, type, module, q, stamped}]
 * @returns {{audited:Array, stats:object, orphans:Array, ambiguous:Array}}
 *   ambiguous[i] = { entry, candidates:[{section,type,module,q,stamped}] }
 */
function backfillModules(audited, items) {
  const rows = Array.isArray(audited) ? audited : [];
  const kept = [];
  const orphans = [];
  const ambiguous = [];
  const stats = { total: rows.length, kept: 0, filled: 0, alreadyHad: 0, orphan: 0, ambiguous: 0 };
  for (const a of rows) {
    if (a && a.module != null && a.module !== "") {
      stats.alreadyHad += 1; stats.kept += 1; kept.push(a); continue;
    }
    const cand = (items || []).filter((it) => it
      && it.section === a.section
      && it.type === a.type
      && String(it.q) === String(a.q)
      && it.stamped === a.stamped);
    const mods = new Set(cand.map((c) => String(c.module)));
    if (!cand.length) { stats.orphan += 1; orphans.push(a); continue; }
    if (mods.size > 1) { stats.ambiguous += 1; ambiguous.push({ entry: a, candidates: cand }); continue; }
    stats.filled += 1; stats.kept += 1;
    kept.push({ ...a, module: cand[0].module });
  }
  return { audited: kept, stats, orphans, ambiguous };
}

/**
 * 作废撞号条目上的第二票：那一票很可能解的是另一个 module 的题（见文件头 §2）。
 * 只删 `second_vote`，第一票留着 —— 第一票是照着它自己那道题算的，没被污染。
 *
 * @returns {{audited:Array, stripped:Array}} stripped = 被删掉第二票的条目（含原 second_vote，供重跑清单用）
 */
function stripCollidedSecondVotes(audited, collided) {
  const stripped = [];
  const out = (Array.isArray(audited) ? audited : []).map((a) => {
    if (!a || !a.second_vote) return a;
    if (!collided.has(`${a.section}${SEP}${a.q}`)) return a;
    const { second_vote: sv, ...rest } = a;
    stripped.push({ ...a, _dropped_second_vote: sv });
    return rest;
  });
  return { audited: out, stripped };
}

module.exports = {
  auditKey, entryKey, buildAuditIndex, crossModuleDupKeys, backfillModules, stripCollidedSecondVotes,
};
