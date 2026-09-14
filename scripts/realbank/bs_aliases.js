/**
 * 造句「跨卷重复 → 别名」账本（纯函数，无 IO —— 供 build_bank.mjs、一次性回填 CLI 与单测共用）。
 * 产物：写进 data/realBank/writing/id-aliases.json，与邮件 / 讨论的别名同一份文件。
 *
 * ── 为什么要有 ──────────────────────────────────────────────────────────
 * ETS 真实地循环出题：实测 132 道造句是「后面某一场又考了前面考过的那一道」（4.1 有 9 道
 * 与 3.21 重复、5.6 有 7 道与 4.15 重复），全部是跨卷重复、没有一条是同卷内重复。
 * build_bank 按答案句归一化去重，库里只留先入库的那一条 —— 这一步没错（同一道题不该收两份），
 * 错的是丢掉之后**什么都不记**：
 *   · assemble_sets 装卷时那一槽永远空着 → sets.json 说 4.1 的造句 0/10；
 *   · loss_ledger 把它算成「落库丢弃」→ 账本报 196 题缺口，其中 132 题其实躺在库里；
 *   · 前端真题专区那一卷少几道题，不足 REAL_BS_MIN_BATCH 的整卷都不露面。
 * 邮件 / 讨论早就有这套别名（writing_recall.js），造句这条路一直没接上 —— 本模块补上。
 *
 * ── 契约（比邮件 / 讨论多两个字段，读的人有两处）────────────────────────
 *   { from, to, from_type: "bs", to_type: "bs", reason, from_source, from_date }
 *   · from = 这一卷本该有的 id（bs_<slug>_<题号>），to = 库里留下的那一条。
 *   · from_source / from_date 必须带：整卷都是重复题的卷（4.1 / 5.6 / rf0902）库里一条自己的题
 *     都没有，assemble_sets.indexItems 的「slug → 卷名」表是从库里的题反推的，查不到这个 slug，
 *     没有这两个字段别名会被整条丢掉（`if (!set) continue`），槽位照样空着。
 *   · lib/realBank.js 用同两个字段在真题专区把那一卷的批次补齐，题上打 recycled_of 标记。
 *   · 按 from 升序，重建 diff 稳定。
 */

/** writing/id-aliases.json 的 _purpose —— build_bank.mjs 与回填脚本共用，两边文案不能各写各的。 */
const WRITING_ALIAS_PURPOSE = "写作侧 id 别名：同一道题在别的卷里的那份（from）→ 库里留下的那条（to）。"
  + "assemble_sets.mjs 用它把槽位还回原卷、lib/realBank.js 用它把真题专区那一卷的批次补齐；"
  + "邮件 / 讨论见 scripts/realbank/writing_recall.js，造句（带 from_source / from_date）见 scripts/realbank/bs_aliases.js。";

const BS_ALIAS_REASON = Object.freeze({
  /** 答案句与更早入库的某一道逐字相同（同一道题在两场考试里都考了） */
  DUP_ANSWER: "duplicate_bs",
  /** 整份写作源文件与更早一套相同（3.20 ↔ 3.15），造句按题号逐题对应 */
  DUP_SET: "duplicate_set",
});

/** 造句 id 的题号后缀（bs_225_03 → "03"，bs_rf0610_1 → "1"）—— 补位宽度按源卷原样保留。 */
function bsIdSuffix(id) {
  const m = /_(\d+)$/.exec(String(id || ""));
  return m ? m[1] : null;
}

/** 把同一套卷的造句 id 换个 slug（bs_315_03 + "320" → bs_320_03）。 */
function bsIdForSlug(keptId, slug) {
  const suffix = bsIdSuffix(keptId);
  return suffix ? `bs_${slug}_${suffix}` : null;
}

/**
 * 边 → 账本条目。
 * @param {Array<{from, to, reason, fromSource, fromDate}>} edges
 * @returns {Array<{from, to, from_type, to_type, reason, from_source, from_date}>}
 *   同一个 from 只留第一条（先记的赢，与 build_bank 的「先入库者留下」同向）；自指边丢掉。
 */
function bsAliasEntries(edges = []) {
  const byFrom = new Map();
  for (const e of edges) {
    if (!e || !e.from || !e.to) continue;
    const from = String(e.from);
    const to = String(e.to);
    if (from === to || byFrom.has(from)) continue;
    byFrom.set(from, {
      from,
      to,
      from_type: "bs",
      to_type: "bs",
      reason: e.reason || BS_ALIAS_REASON.DUP_ANSWER,
      from_source: e.fromSource ? String(e.fromSource) : null,
      from_date: e.fromDate ? String(e.fromDate) : null,
    });
  }
  return [...byFrom.values()].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/**
 * 整份写作源文件与更早一套相同的卷（dupSets）：它的造句就是那一套的那十道，按题号逐题记别名。
 * @param {{dupSets: Array<{setname, kept}>, items: Array<{id, source}>, slugOf, dateOf}} args
 */
function bsDupSetEdges({ dupSets = [], items = [], slugOf, dateOf }) {
  const bySource = new Map();
  for (const it of items) {
    const src = String(it?.source || "").trim();
    if (!src) continue;
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(it);
  }
  const edges = [];
  for (const { setname, kept } of dupSets) {
    const slug = slugOf(setname);
    for (const it of bySource.get(String(kept).trim()) || []) {
      const from = bsIdForSlug(it.id, slug);
      if (!from) continue;
      edges.push({
        from, to: it.id, reason: BS_ALIAS_REASON.DUP_SET,
        fromSource: setname, fromDate: dateOf(setname),
      });
    }
  }
  return edges;
}

module.exports = { WRITING_ALIAS_PURPOSE, BS_ALIAS_REASON, bsAliasEntries, bsDupSetEdges, bsIdSuffix, bsIdForSlug };
