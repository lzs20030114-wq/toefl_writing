/**
 * 落库丢弃账本（纯函数，无 IO —— build_bank.mjs 记账、loss_ledger.mjs 归因、jest 直接测）。
 *
 * ── 为什么要有这本账 ──
 * build_bank 在落库这一步会按十几道闸扔题（选项残缺、盲审不一致、没被盲审覆盖、插入题无标记、
 * 组内题干重复、整科被扣、整卷源文件重复……），以前每道闸只有一个计数器，`console.log` 到终端就散了；
 * counts.json 只记最终条数。于是「这一轮丢了多少题、丢在哪一关、丢的是哪一套卷的第几题」事后无从查证 ——
 * 2026-09-14 追「AP 86 篇里 32 篇不足 5 题、共缺 36 题」时，谁都说不清这 36 题分别死在哪一关。
 * 丢题账本（loss_attribution.js）也因此只能把这些缺口笼统算成「管线丢题」，
 * 把「源里有、结构化也抽出来了、却在落库时被闸扔掉」和「压根没抽出来」混成一桶。
 *
 * 这里把每一次丢弃记成一行：(卷, 科, 题型, module, 题号, 题数, 原因码, 一句话详情)。
 * **原因码就用 build_bank 现有 stats 的键名**，不另发明一套 —— 终端日志里的数字和账本逐项对得上。
 *
 * ── 口径 ──
 *   n     这一行代表几道题（按槽位口径算：填词一段 10 空、选择题一题一道、听力一组按题数），
 *         丢题账本按它扣「落库丢弃」的额度。
 *   scope question  逐题丢（有题号）；
 *         unit      整组 / 整段丢（一篇材料、一段听力、一段填词）；
 *         section   整科丢（整科被扣、整份源文件与更早一套相同）—— 题数不可知，n 记 null，
 *                   归因时对这卷这科**不设上限**（整科缺口都算它的）。
 */

/** 原因码 → 中文说明 + 默认 scope。键名 = build_bank 的 stats 键名。 */
const DROP_CODES = Object.freeze({
  // 阅读
  droppedDupSet: { label: "阅读题目文件与更早一套卷相同，整科跳过", scope: "section", section: "reading" },
  droppedHeld: { label: "源料体检 blocking，阅读整科扣下", scope: "section", section: "reading" },
  droppedCtwTruncated: { label: "答案页砍掉词首，填词 fail-closed 拒收", scope: "unit", section: "reading" },
  buildFailed: { label: "构建失败（材料太短 / 一组题全丢 / 填词结构不合法）", scope: "unit", section: "reading" },
  droppedNoAudit: { label: "没被盲审覆盖（没审过 = 不收）", scope: "question", section: "reading" },
  droppedDisagree: { label: "盲审不一致", scope: "question", section: "reading" },
  droppedBadOptions: { label: "选项残缺（不是恰好 4 个 / 答案下标非法）", scope: "question", section: "reading" },
  droppedInsert: { label: "插入句题：正文里没有 ■ 标记，答不了", scope: "question", section: "reading" },
  droppedDupStem: { label: "同组题干重复（相邻两屏抽到同一题），留题号小的", scope: "question", section: "reading" },
  // 写作
  wDroppedDupSet: { label: "写作题目文件与更早一套卷相同，整科跳过", scope: "section", section: "writing" },
  wDroppedHeld: { label: "源料体检 blocking，写作整科扣下", scope: "section", section: "writing" },
  wSkippedThin: { label: "字段不全（造句缺模板 / 词块，邮件缺情境 / 要求，讨论缺教授 / 学生帖）", scope: "question", section: "writing" },
  wDroppedDupBs: { label: "造句答案句跨卷重复", scope: "question", section: "writing" },
  wDroppedBsRuntime: { label: "造句过不了前端 runtime 校验", scope: "question", section: "writing" },
  wRecallDropped: { label: "第一来源邮件 / 讨论补录没收（过不了闸 / 账本未核过）", scope: "question", section: "writing" },
  // 听力
  lDroppedHeld: { label: "源料体检 blocking，听力整科扣下", scope: "section", section: "listening" },
  lDroppedNoAudit: { label: "这卷没有盲审结果，听力整科跳过", scope: "section", section: "listening" },
  lDroppedNoAuditQ: { label: "没被盲审覆盖", scope: "question", section: "listening" },
  lDroppedDisagree: { label: "盲审不一致", scope: "question", section: "listening" },
  lDroppedBadOptions: { label: "选项残缺", scope: "question", section: "listening" },
  lDroppedDupItem: { label: "跨卷逐条内容重复", scope: "unit", section: "listening" },
  lDroppedInvalid: { label: "validator 不收（段数 / 轮次 / 时长不达标）", scope: "unit", section: "listening" },
  lDroppedNoOriginalAudio: { label: "整块录音来源没切出真人原声（不许退回 TTS 上线）", scope: "unit", section: "listening" },
  // 口语
  sDroppedDupSet: { label: "口语内容与更早一套卷重复", scope: "unit", section: "speaking" },
  sDroppedInvalid: { label: "validator 不收", scope: "unit", section: "speaking" },
});

/**
 * 记账器。build_bank 的每道闸在 `stats.xxx += 1` 旁边调一次 drop()。
 * 构建里有「重出一遍」的地方（阅读 AP/RDL 归位后按新题型再出一次）用的是一份丢弃的计数器 ——
 * 那一遍要配一个丢弃的记账器，不许记进正式账本（同一道题会被记两次）。
 */
function makeDropRecorder() {
  const rows = [];
  return {
    rows,
    drop({ set, slug = null, section = null, type = null, module = null, q = null, n, id = null, code, detail = "" }) {
      const spec = DROP_CODES[code];
      if (!spec) throw new Error(`drop_ledger: 未登记的原因码 ${code}（键名必须是 build_bank 的 stats 键）`);
      const scope = spec.scope;
      rows.push({
        set: String(set || ""),
        slug: slug == null ? null : String(slug),
        section: section || spec.section,
        type: type || null,
        module: module == null ? null : Number(module),
        q: q == null ? null : q,
        n: scope === "section" ? null : Number.isFinite(Number(n)) ? Number(n) : 1,
        scope,
        id: id || null,
        code,
        detail: String(detail || "").slice(0, 300),
      });
    },
  };
}

/** 汇总：按原因码 / 科目 / 题型 / 卷·科。题数只加 n 不为 null 的行；整科丢弃另计「套·科」数。 */
function summarizeDrops(rows) {
  const byCode = {};
  const bySection = {};
  const byType = {};
  let questions = 0;
  let sections = 0;
  for (const r of rows || []) {
    const c = (byCode[r.code] ||= { code: r.code, label: DROP_CODES[r.code]?.label || r.code, rows: 0, questions: 0, sections: 0 });
    c.rows += 1;
    const s = (bySection[r.section] ||= { section: r.section, questions: 0, sections: 0 });
    if (r.n == null) { c.sections += 1; s.sections += 1; sections += 1; continue; }
    c.questions += r.n; s.questions += r.n; questions += r.n;
    if (r.type) {
      const t = (byType[r.type] ||= { type: r.type, questions: 0, byCode: {} });
      t.questions += r.n;
      t.byCode[r.code] = (t.byCode[r.code] || 0) + r.n;
    }
  }
  return { rows: (rows || []).length, questions, sections, byCode, bySection, byType };
}

/** 落盘形状（与 loss-ledger.json 同风格）。 */
function dropLedgerPayload(rows, { generated, generatedBy = "scripts/realbank/build_bank.mjs", dry = false } = {}) {
  return {
    _generated: generated || new Date().toISOString().slice(0, 10),
    _generated_by: generatedBy,
    _purpose: "落库这一步被闸扔掉的每一题：(卷, 科, 题型, module, 题号, 题数, 原因码, 详情)。"
      + "原因码 = build_bank 的 stats 键名。丢题账本（loss_ledger.mjs）据此把缺口里的「落库丢弃」和「管线丢题」分开。",
    _scope: "question = 逐题；unit = 整组 / 整段；section = 整科（题数不可知，n=null）",
    _dry_run: Boolean(dry),
    _codes: Object.fromEntries(Object.entries(DROP_CODES).map(([k, v]) => [k, v.label])),
    summary: summarizeDrops(rows),
    rows,
  };
}

/**
 * 给丢题账本用的额度索引。
 *   byTypeSlug     Map<`${type}|${slug}`, 题数>      逐题 / 整组丢弃，按题型扣
 *   sectionSlug    Map<`${section}|${slug}`, codes[]> 整科丢弃：这卷这科的缺口不设上限
 * 阅读的 ap / rdl 在落库时还没按考卷位置归位（reading_position.mjs 在后面），丢弃行上的题型是结构化阶段的判断，
 * 与 sets.json 槽位的题型可能对调 —— 归因时同一卷里 ap / rdl 的额度互通（见 loss_attribution）。
 */
function indexDropsForAttribution(rows) {
  const byTypeSlug = new Map();
  const sectionSlug = new Map();
  const codesByTypeSlug = new Map();
  for (const r of rows || []) {
    if (!r.slug) continue;
    if (r.n == null) {
      const k = `${r.section}|${r.slug}`;
      sectionSlug.set(k, [...new Set([...(sectionSlug.get(k) || []), r.code])]);
      continue;
    }
    if (!r.type) continue;
    const k = `${r.type}|${r.slug}`;
    byTypeSlug.set(k, (byTypeSlug.get(k) || 0) + r.n);
    const codes = codesByTypeSlug.get(k) || {};
    codes[r.code] = (codes[r.code] || 0) + r.n;
    codesByTypeSlug.set(k, codes);
  }
  return { byTypeSlug, sectionSlug, codesByTypeSlug };
}

module.exports = { DROP_CODES, makeDropRecorder, summarizeDrops, dropLedgerPayload, indexDropsForAttribution };
