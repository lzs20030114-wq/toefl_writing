// 真题阅读「旧 id 别名」：题库重建会给条目改名 / 归位，用户手里按旧 id 记的东西不能因此失效。
//
// 为什么会有旧 id：
//   · reclassified —— 放错进学术阅读（AP）列表的日常阅读材料挪回 RDL，id 从 real_ap_… 变成 real_rdl_…；
//   · consolidated —— 跨卷同一篇文章合并成一条（scripts/realbank/consolidate_reading.js），副本的 id 下线。
// 用户侧按 id 记的东西有三样：已练标记（localStorage 按题型分的 done key）、练习记录里的
// details.itemId（记录页的题库覆盖 / 最新一次按它归类）、以及按 id 找题。练习记录本身存的是
// 整篇与题目快照，回看不依赖题库；受影响的只有「按 id 对账」的这几处，本模块把它们接回新 id。
//
// 账本 data/realBank/reading/id-aliases.json 由流水线建库时生成（前端只读）：
//   { generated_by, generated, aliases: [ { from, to, from_type, to_type, reason } ] }
//   to 已收敛到库里活着的 id；to 为 null = 该题已下线。
//
// 账本还没生成时（例如流水线尚未跑过这一版）按空账本处理 —— 所以用 try/require 而不是静态 import：
// 静态 import 一个不存在的文件会直接编译失败；webpack 对 try 块里的 require 找不到文件只报警告、
// 运行时抛错被这里接住。文件一旦出现就是普通的打包依赖。
//
// 体积：账本只有几十条别名，不拖任何题库 JSON。本模块**不许** import lib/realBank ——
// lib/realBankHistory.js 的首页 bundle 回归门同样适用于它的调用方。
// 它也不 import lib/realBankHistory：记录页把 resolveRealReadingRef 当参数注入进去，
// 首页只用 realBankHistory 数条数，连这份账本都不必打进首页包。

let RAW_LEDGER = null;
try {
  // eslint-disable-next-line global-require
  RAW_LEDGER = require("../data/realBank/reading/id-aliases.json");
} catch {
  RAW_LEDGER = null;
}

const READING_TYPES = ["ctw", "rdl", "ap"];
const READING_ID_RE = /^real_(ctw|rdl|ap)_/;

/** 从 real_{ctw|rdl|ap}_… 前缀认题型；认不出返回 ""。 */
export function realReadingTypeOfId(id) {
  const m = READING_ID_RE.exec(String(id || ""));
  return m ? m[1] : "";
}

function normalizeType(rawType, id) {
  const t = String(rawType || "").trim().toLowerCase();
  return READING_TYPES.includes(t) ? t : realReadingTypeOfId(id);
}

/**
 * 账本 → 索引 { byFrom: Map<from, alias> }。
 * 逐条防御：from 必须是 real_ 开头的非空串；to 只能是非空串或 null；自指（from === to）丢掉；
 * 同一个 from 出现多次以第一条为准（账本是构建产物，形状坏了不该顺着流进 UI）。
 */
export function buildAliasIndex(ledger) {
  const list = Array.isArray(ledger?.aliases) ? ledger.aliases : Array.isArray(ledger) ? ledger : [];
  const byFrom = new Map();
  for (const raw of list) {
    const from = String(raw?.from || "").trim();
    if (!from.startsWith("real_") || byFrom.has(from)) continue;
    const toRaw = raw?.to;
    let to = null;
    if (toRaw != null) {
      to = String(toRaw).trim();
      if (!to.startsWith("real_")) continue;
    }
    if (to === from) continue;
    byFrom.set(from, {
      from,
      to,
      fromType: normalizeType(raw?.from_type, from),
      toType: to ? normalizeType(raw?.to_type, to) : normalizeType(raw?.to_type, from),
      reason: String(raw?.reason || "").trim(),
    });
  }
  return { byFrom };
}

/** 默认索引：读仓库里的账本（缺文件 = 空索引）。 */
export const REAL_READING_ALIAS_INDEX = buildAliasIndex(RAW_LEDGER);

/**
 * 一个（可能是旧的）真题阅读 id → 当前 id 与题型。
 *   { id, type, aliased, retired, reason }
 *   · 不在账本里：原样返回（type 取 fallbackType，缺省按 id 前缀认）；
 *   · 顺着别名链走到底（账本本该已收敛，链只是防御）；遇到环视为账本坏了，按没有别名处理；
 *   · 走到 to=null：retired=true、id=null（题已下线）。
 */
export function resolveRealReadingId(id, fallbackType = "", index = REAL_READING_ALIAS_INDEX) {
  const start = String(id || "").trim();
  const startType = normalizeType(fallbackType, start) || realReadingTypeOfId(start);
  const plain = { id: start, type: startType, aliased: false, retired: false, reason: "" };
  if (!start || !index?.byFrom?.has(start)) return plain;

  const seen = new Set();
  let cur = start;
  let type = startType;
  let reason = "";
  while (index.byFrom.has(cur)) {
    if (seen.has(cur)) return plain;
    seen.add(cur);
    const alias = index.byFrom.get(cur);
    reason = alias.reason;
    if (alias.to == null) {
      return { id: null, type: alias.toType || type, aliased: true, retired: true, reason };
    }
    cur = alias.to;
    type = alias.toType || realReadingTypeOfId(cur) || type;
  }
  return { id: cur, type, aliased: true, retired: false, reason };
}

/**
 * 给 lib/realBankHistory 的 resolveItemRef 用的适配器（记录里的 itemId + 记录的题型 → 当前 id / 题型）。
 * 只改阅读；别的科目 / 认不出的题型原样返回，保证不会把一条听力记录「归位」到阅读去。
 */
export function resolveRealReadingRef(id, recordedSubtype = "", index = REAL_READING_ALIAS_INDEX) {
  const sub = String(recordedSubtype || "");
  if (sub && !READING_TYPES.includes(sub)) {
    return { id: String(id || ""), type: sub, aliased: false, retired: false, reason: "" };
  }
  // resolveRealReadingId 给出的题型只可能是 ctw / rdl / ap（normalizeType 已收口），不会跨科。
  return resolveRealReadingId(id, sub, index);
}

/**
 * 真题阅读选题页的「已练」集合（TopicPicker 的 doneIds）。
 *
 * 条目 X（题型 T）算已练，当且仅当：
 *   X 本身在 T 的已练 key 里；或
 *   有一条别名 from 解析到 X（同题型或跨题型），且 from 出现在「T」或「from_type」的已练 key 里。
 * 例：real_ap_310_1_25 归位成 real_rdl_310_1_25 —— 用户当年在学术阅读列表里做过，
 * 旧 id 记在 AP 的 key 里；现在日常阅读列表里的新条目要亮「已练」。
 *
 * @param type 当前列表的题型（ctw / rdl / ap）
 * @param loadDoneFor (题型) => Set|string[]，读该题型的已练 key（页面传 loadDoneIds 的包装）
 */
export function collectRealReadingDoneIds(type, loadDoneFor, index = REAL_READING_ALIAS_INDEX) {
  const cache = new Map();
  const doneIn = (t) => {
    if (!READING_TYPES.includes(t)) return new Set();
    if (!cache.has(t)) {
      let v;
      try { v = loadDoneFor(t); } catch { v = null; }
      cache.set(t, v instanceof Set ? v : new Set(Array.isArray(v) ? v : []));
    }
    return cache.get(t);
  };

  const out = new Set(doneIn(type));
  for (const alias of index?.byFrom?.values?.() || []) {
    const target = resolveRealReadingId(alias.from, alias.fromType, index);
    if (!target.id || target.type !== type) continue;
    if (doneIn(type).has(alias.from) || doneIn(alias.fromType).has(alias.from)) out.add(target.id);
  }
  return out;
}

/**
 * 按（可能是旧的）id 找真题阅读条目。先在当前题型里精确找；找不到再走别名：
 * 解析到同题型 → 在当前列表里找新 id；解析到别的题型 → 交给 itemsForType(新题型) 找。
 * 返回 { item, type, aliased } 或 null（真找不到 / 已下线）。
 *
 * @param itemsForType (题型) => 该题型的条目数组
 */
export function findRealReadingItem(id, type, itemsForType, index = REAL_READING_ALIAS_INDEX) {
  const want = String(id || "");
  if (!want) return null;
  const list = (t) => {
    try {
      const v = itemsForType(t);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const exact = list(type).find((it) => String(it?.id) === want);
  if (exact) return { item: exact, type, aliased: false };

  const r = resolveRealReadingId(want, type, index);
  if (!r.aliased || !r.id || !READING_TYPES.includes(r.type)) return null;
  const hit = list(r.type).find((it) => String(it?.id) === r.id);
  return hit ? { item: hit, type: r.type, aliased: true } : null;
}
