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
  /** 真题 ground truth（data/realExam2026）记了这一卷考过这道题，题面取库里那条 */
  GT_SAME_ITEM: "same_item_ground_truth",
});

/**
 * 造句去重判据：答案句归一化（只剥 .,!?;: ，大小写与多余空白不算差别）。
 * build_bank 的跨卷去重、别名回填、GT 对照都必须用同一把尺 —— 各写各的尺，
 * 去重丢掉的那条和别名认回来的那条就会对不上，槽位白空着。
 */
function bsAnswerKey(answer) {
  return String(answer || "")
    .toLowerCase()
    .replace(/[.,!?;:]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

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
      // 边用驼峰（fromSource），落库的条目用下划线（from_source）—— 两种都认：
      // 把条目再喂回来是很容易犯的错，认错一次就是整批别名 from_source 变 null、前端全丢。
      from_source: e.fromSource || e.from_source ? String(e.fromSource || e.from_source) : null,
      from_date: e.fromDate || e.from_date ? String(e.fromDate || e.from_date) : null,
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

/**
 * 真题 ground truth（data/realExam2026/writing/buildSentence.json）对照出来的别名。
 *
 * 为什么这条路值得走：GT 是按卷逐题转写的**校准锚**（CLAUDE.md：唯一标准锚点），它记了
 * 「哪一场考了哪道句子」。而管线那一侧因为源料体检 blocking 整科扣下（2.8 / 2.23 / 3.24 /
 * 3.29 / 4.18）或题面识图没覆盖，这些卷在库里一条题都没有 —— 可那些句子多数早就从**别的卷**
 * 收进库了。把它们按别名还回去，等于零成本复原这几卷，而且用户做到的题面全部来自干净卷。
 *
 * 实测两个来源的卷归属对得上 196/212 = 92.5%，对不上的 16 条集中在源料本来就有问题的那几卷。
 * 所以这里按**不冲突才落**：
 *   · 这一卷已经有同一道题（原生或别名）→ 跳过；
 *   · 库里根本没有这个答案句 → 跳过（那是真缺题，要靠识图/重扫抽题面，不是别名能补的）；
 *   · GT 的题号已经被这一卷的现有 id 占了 → 跳过，不抢号也不另编号
 *     （号被占 = 两个来源对这一卷的第 n 题说法不一致，该人工对原卷，不该在这里替它拍板）。
 *
 * @param {{gtItems, items, aliases, slugOf, dateOf}} args
 *   gtItems  GT 的 buildSentence items（{source, date, n, target}）
 *   items    落库后的造句（别名的保留方只能从这里挑）
 *   aliases  已经记下的别名（去重 / 整卷同源那两批），用来判「这一卷已经有了」与「题号被占」
 */
function bsGroundTruthEdges({ gtItems = [], items = [], aliases = [], slugOf, dateOf } = {}) {
  const byAnswer = new Map();
  const byId = new Map();
  for (const it of items) {
    byId.set(String(it.id), it);
    const k = bsAnswerKey(it.answer);
    if (k && !byAnswer.has(k)) byAnswer.set(k, it);
  }
  // 这一卷已经有的答案句（原生 + 别名）
  const owned = new Map();
  const own = (set, k) => {
    const s = String(set || "").trim();
    if (!s || !k) return;
    if (!owned.has(s)) owned.set(s, new Set());
    owned.get(s).add(k);
  };
  for (const it of items) own(it.source, bsAnswerKey(it.answer));
  const taken = new Set(byId.keys());
  for (const a of aliases) {
    taken.add(String(a.from));
    const kept = byId.get(String(a.to));
    if (kept) own(a.from_source, bsAnswerKey(kept.answer));
  }

  const edges = [];
  for (const g of gtItems) {
    const set = String(g?.source || "").trim();
    const k = bsAnswerKey(g?.target);
    if (!set || !k || g?.n == null) continue;
    if ((owned.get(set) || new Set()).has(k)) continue;
    const kept = byAnswer.get(k);
    if (!kept || String(kept.source || "").trim() === set) continue;
    const slug = slugOf(set);
    if (!slug) continue;                                  // 不是 69 套源卷之一，不给它造槽位
    const from = `bs_${slug}_${String(g.n).padStart(2, "0")}`;
    if (taken.has(from)) continue;                        // 题号被占：两个来源说法不一，留给人工对原卷
    taken.add(from);
    own(set, k);
    edges.push({ from, to: kept.id, reason: BS_ALIAS_REASON.GT_SAME_ITEM, fromSource: set, fromDate: g.date || dateOf(set) });
  }
  return edges;
}

module.exports = {
  WRITING_ALIAS_PURPOSE, BS_ALIAS_REASON, bsAnswerKey,
  bsAliasEntries, bsDupSetEdges, bsGroundTruthEdges, bsIdSuffix, bsIdForSlug,
};
