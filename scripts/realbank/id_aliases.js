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
    aliases.push({ from, to, from_type: typeOfId(from), to_type: to ? typeOfId(to) : null, reason });
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

module.exports = { typeOfId, buildIdAliases, reclassifiedRedirects };
