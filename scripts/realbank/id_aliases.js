/**
 * 真题阅读「条目 id 别名账本」（纯函数，无 IO —— 供 build_bank.mjs、apply_review.mjs、
 * assemble_sets.mjs 与单测共用）。产物：data/realBank/reading/id-aliases.json。
 *
 * ── 为什么要有 ──────────────────────────────────────────────────────────
 * 阅读条目的 id 会在两种情况下「消失」：
 *   · consolidated：跨卷同篇合并，副本被合进保留的那条（real_ap_53_1_32 → real_ap_128a_1_27）；
 *   · reclassified：长篇日常阅读从 ap.json 归位到 rdl.json，前缀跟着换（real_ap_310_1_25 → real_rdl_310_1_25）。
 * 用户侧的练习记录 / 错题本、复核清单 review-holds.json、整卷装配 sets.json 都按 id 关联。
 * 没有账本，这些关联在 id 消失的那一刻就断了，而且是静默断。
 *
 * ── 契约（前端读，一字不差）──────────────────────────────────────────────
 *   { generated_by, generated: "YYYY-MM-DD",
 *     aliases: [ { from, to, from_type, to_type, reason: "reclassified" | "consolidated" } ] }
 *   · to 是**本次产物里活着的** id（顺着链收敛过）；收敛不到 → to: null、to_type: null。
 *     边有三类来源：本次重建的合并 / 归位边、复核清单里带 dup_of 的整条下架（跨套重复，内容在保留方上，
 *     记 consolidated）、上一版账本。所以 null 只剩「真正没有保留方的整条下架」（材料坏了下线）。
 *   · 跨重建累积：上一版账本的条目全部保留、重新收敛（上一版指向的 id 这一版又被合并/归位了，就接着往下找）。
 *   · 链上任何一跳是合并，整条就记 consolidated —— 「内容已经合进别的副本」这件事对下游是决定性的：
 *     apply_review 只沿 reclassified 链搬下架/patch（同一份材料换了个 id），绝不沿 consolidated 链搬
 *     （那会把保留方当成被下架的副本删掉）。
 *   · 按 from 升序，重建 diff 稳定。
 */

const typeOfId = (id) => {
  const m = /^real_(ap|rdl)_/.exec(String(id || ""));
  return m ? m[1] : null;
};

/**
 * 条目上的题型标签：填词也是阅读的一类（前端 lib/realBankAliases 按 ctw|rdl|ap 认 id 前缀）。
 * **只用来给条目打 from_type / to_type 标签**，holds 那条分支仍只认 ap|rdl ——
 * 填词的跨套重复早已由 assemble_sets 直接读 review-holds 的 dup_of 还槽位，
 * 在这里再记一遍只会给账本添 80 条无用条目，还会改掉前端对填词旧 id 的判定。
 */
const labelTypeOfId = (id) => {
  const m = /^real_(ap|rdl|ctw)_/.exec(String(id || ""));
  return m ? m[1] : null;
};

/** 真题阅读 id 换个卷 slug（real_ap_311_1_31 + "321" → real_ap_321_1_31）；形状认不出返回 null。 */
function readingIdForSlug(id, slug) {
  const m = /^(real_(?:ap|rdl|ctw)_)([^_]+)(_.+)$/.exec(String(id || ""));
  return m && slug ? `${m[1]}${slug}${m[3]}` : null;
}

/** 真题阅读 id 的卷 slug（real_ctw_311_2_1 → "311"）；形状认不出返回 null。 */
function readingSlugOfId(id) {
  const m = /^real_(?:ap|rdl|ctw)_([^_]+)_/.exec(String(id || ""));
  return m ? m[1] : null;
}

/**
 * 「整份阅读题目文件与更早一套相同」的卷（build_bank 的 droppedDupSet）：它的每个槽位就是
 * 保留方的那一条，按 id 逐条记别名 —— 与写作那路 `recallWriting` 的 dupSets 分支同一个道理。
 *
 * 不记别名的后果（2026-09-17 实测 3.21 阅读 0/50，内容全在 3.11 上）：assemble_sets 那一卷
 * 阅读整科空着、loss_ledger 把 49 道算成缺题、前端真题专区那一场根本不露面。
 *
 * 保留方自己的槽位有三种来源，三种都要跟着换 slug 才不漏：
 *   · 库里活着的条目（id 就是它自己）；
 *   · 账本里 from 是保留方那一卷的条目（它那一篇被跨卷合并到别的卷上了）；
 *   · 复核清单里 scope=unit 且带 dup_of 的下架条目（**填词的跨套重复只有这一条路** ——
 *     ctw 不进 buildIdAliases 的 holds 分支，3.11 的 M1 前十空就是这么指到 real_ctw_41_1_1 的）。
 * 三种来源合成一张 from → to 表，顺着链收敛到库里还活着的那条再换 slug。
 *
 * 两条守紧的：
 *   · **归位（ap↔rdl）那种边不跟着换** —— from 是已经作废的 id 形状，换出来的 real_ap_321_1_25
 *     在 assemble_sets.indexItems 会因题型对不上被丢掉，而同一个槽位早由 real_rdl_321_1_25 认领了；
 *     判据 = from 与收敛后的 to 题型一致才记。
 *   · 已经活着的 from、或账本 / 清单里已有的 from 一律跳过（不抢号、不覆盖）。
 *
 * @param {{dupSets: Array<{setname, kept}>, liveItems: Array<{id, source}>, ledger?: {aliases?: Array},
 *          holds?: object[], slugOf: (setname: string) => string}} args
 * @returns {Array<{from, to, reason: "consolidated"}>}
 */
function dupSetReadingEdges({ dupSets = [], liveItems = [], ledger = null, holds = [], slugOf } = {}) {
  const bySource = new Map();
  const liveIds = new Set();
  for (const it of liveItems || []) {
    const id = String(it?.id || "");
    if (!id) continue;
    liveIds.add(id);
    const src = String(it?.source || "").trim();
    if (!src) continue;
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(id);
  }
  // from → to 表：账本优先，复核清单的 dup_of 补缺
  const jump = new Map();
  for (const a of (ledger && ledger.aliases) || []) {
    if (!a || !a.from || !a.to || a.from === a.to || jump.has(String(a.from))) continue;
    jump.set(String(a.from), String(a.to));
  }
  for (const h of holds || []) {
    if (!h || h.scope !== "unit" || !h.id || !h.dup_of || String(h.id) === String(h.dup_of)) continue;
    if (!readingSlugOfId(h.id) || jump.has(String(h.id))) continue;
    jump.set(String(h.id), String(h.dup_of));
  }
  /** 顺着链走到库里活着的那条；走不到返回 null（那是真下线，不该给重复卷造一个指向空的槽位）。 */
  const resolve = (id) => {
    let cur = String(id);
    const seen = new Set([cur]);
    while (!liveIds.has(cur) && jump.has(cur)) {
      cur = jump.get(cur);
      if (seen.has(cur)) return null;
      seen.add(cur);
    }
    return liveIds.has(cur) ? cur : null;
  };
  const known = new Set(jump.keys());
  const edges = [];
  for (const { setname, kept } of dupSets || []) {
    const slug = slugOf ? slugOf(setname) : null;
    const keptSet = String(kept || "").trim();
    if (!slug || !keptSet) continue;
    const keptSlug = slugOf ? slugOf(keptSet) : null;
    const slotIds = [
      ...(bySource.get(keptSet) || []),
      ...[...jump.keys()].filter((id) => keptSlug && readingSlugOfId(id) === keptSlug),
    ];
    for (const slotId of slotIds) {
      const to = resolve(slotId);
      const from = readingIdForSlug(slotId, slug);
      if (!to || !from || from === to || liveIds.has(from) || known.has(from)) continue;
      // 归位边（ap→rdl）不跟着换：换出来的 id 题型对不上，assemble_sets 会整条丢掉
      if (labelTypeOfId(slotId) !== labelTypeOfId(to)) continue;
      known.add(from);
      edges.push({ from, to, reason: "consolidated" });
    }
  }
  return edges;
}

/**
 * @param {{prev?: object|null, edges?: Array<{from,to,reason}>, holds?: object[], liveIds: Iterable<string>, generated?: string}} args
 *   prev   上一版账本（缺省 = 空）
 *   edges  本次重建产生的直接边（合并 dropped→kept、归位 旧id→新id）
 *   holds  data/realBank/review-holds.json 的 holds（缺省 = 空）。其中阅读 ap/rdl 的 scope=unit 且带 dup_of 的
 *          下架条目也是直接边（held id → dup_of，记 consolidated）：「跨套重复、库里有保留方」不是题下线，
 *          内容就在保留方上。没有这条边，归位后被这类下架删掉的条目会收敛成 to: null，前端就把用户旧记录
 *          当成「题已下线」不计覆盖。只有**没有保留方**的整条下架（材料坏了）才该留 null。
 *   liveIds 本次最终产物（ap + rdl）里的全部 id
 * @returns {{generated_by, generated, aliases}}
 */
function buildIdAliases({ prev = null, edges = [], holds = [], liveIds, generated } = {}) {
  const live = liveIds instanceof Set ? liveIds : new Set(liveIds || []);
  // 直接边：本次优先，复核清单的跨套重复边其次，上一版补缺（上一版的 to 已经是当时活着的 id，正好当作一跳）
  const edge = new Map();
  const internal = new Set();          // 只用来走链、不单独出条目的派生边
  for (const e of edges || []) {
    if (!e || !e.from || !e.to || e.from === e.to || edge.has(String(e.from))) continue;
    edge.set(String(e.from), { to: String(e.to), reason: e.reason === "consolidated" ? "consolidated" : "reclassified" });
  }
  for (const h of holds || []) {
    if (!h || h.scope !== "unit" || !h.id || !h.dup_of || !typeOfId(h.id) || String(h.id) === String(h.dup_of)) continue;
    const from = String(h.id);
    const to = String(h.dup_of);
    // 清单记在归位**之前**的 id 上、被 applyReview 顺着归位链搬到新 id 删掉的：新 id 那一跳之后也要能接到保留方
    const moved = edge.get(from);
    if (moved && moved.reason === "reclassified" && !edge.has(moved.to) && moved.to !== to) {
      edge.set(moved.to, { to, reason: "consolidated" });
      internal.add(moved.to);
    }
    if (!edge.has(from)) edge.set(from, { to, reason: "consolidated" });
  }
  const prevReason = new Map();
  for (const a of (prev && prev.aliases) || []) {
    if (!a || !a.from) continue;
    const from = String(a.from);
    prevReason.set(from, a.reason === "consolidated" ? "consolidated" : "reclassified");
    internal.delete(from);             // 上一版出过的条目照常保留
    if (!edge.has(from) && a.to && a.to !== from) edge.set(from, { to: String(a.to), reason: prevReason.get(from) });
  }

  const froms = new Set([...[...edge.keys()].filter((k) => !internal.has(k)), ...prevReason.keys()]);
  const aliases = [];
  for (const from of froms) {
    let cur = from;
    const reasons = [];
    const seen = new Set([from]);
    if (!live.has(from)) {
      while (edge.has(cur)) {
        const e = edge.get(cur);
        reasons.push(e.reason);
        cur = e.to;
        if (live.has(cur) || seen.has(cur)) break;
        seen.add(cur);
      }
    }
    // from 本身又活过来了（上一版合并掉的副本这一版成了代表）：to 就是它自己，照样保留条目
    const to = live.has(cur) ? cur : null;
    const own = prevReason.get(from) || (edge.get(from) || {}).reason;
    const reason = reasons.includes("consolidated") || (!reasons.length && own === "consolidated")
      ? "consolidated"
      : (reasons[0] || own || "reclassified");
    aliases.push({ from, to, from_type: labelTypeOfId(from), to_type: to ? labelTypeOfId(to) : null, reason });
  }
  aliases.sort((a, b) => a.from.localeCompare(b.from));
  return {
    generated_by: "scripts/realbank/build_bank.mjs",
    generated: generated || new Date().toISOString().slice(0, 10),
    aliases,
  };
}

/** 账本 → 「同一份材料换了 id」的重定向表：from → {file, id}。只收 reclassified 且 to 活着的。 */
function reclassifiedRedirects(ledger) {
  const out = new Map();
  for (const a of (ledger && ledger.aliases) || []) {
    if (!a || a.reason !== "reclassified" || !a.to || !a.to_type) continue;
    out.set(String(a.from), { file: `reading/${a.to_type}`, id: String(a.to), fromType: a.from_type });
  }
  return out;
}

module.exports = {
  typeOfId, buildIdAliases, reclassifiedRedirects,
  readingIdForSlug, readingSlugOfId, dupSetReadingEdges,
};
