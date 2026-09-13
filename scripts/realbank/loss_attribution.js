/**
 * 真题「丢题」归因（纯函数，无 IO —— 供 loss_ledger.mjs 与单测共用）。
 *
 * ── 为什么要有这个文件 ──
 * 2026-09 连着修了好几轮丢题，每一轮都是同一个流程：用户偶然点开一篇，发现「这篇怎么只有 1 道题」，
 * 然后针对那一个题型抢救一轮。修完阅读 AP，填词还在丢；修完填词，听力对话还在丢。
 * 根子不在某个题型的实现，而在于**丢题从来没有被度量过**：
 *   · `sets.json` 里躺着全部证据（每套卷每个槽位 need/got），但没有任何工具把它变成一张缺口清单；
 *   · 「还缺多少题」「缺的是源里就没有、还是管线丢的」没人答得上来；
 *   · 没有数字，就只能等下一次用户撞见。
 *
 * 这里把每个没填满的槽位摊成一行并给出归因，让缺口能按「能不能补、怎么补」排队。
 *
 * ── 归因口径（按优先级从上往下**扣额度**，不是「沾边就整锅算它头上」）──
 *   source_defect      源料体检认领的缺口（source-flags.json）。补不了，除非找商家重出。
 *   held               复核清单主动扣下的（review-holds.json，非 dup_of）。设计行为，不是丢题。
 *   deduped            跨卷同篇合并时被丢掉的题（consolidation.json 的 skipped）。放宽判据可回收。
 *   section_lost       这一科**在管线覆盖范围内、这套卷也确实跑过**（同卷别的科有题），库里却一道都没有。
 *                      与 pipeline_loss 同性质、同处置，只是丢得更彻底（整科归零）。
 *   section_never_run  这一科压根没被跑过（不在管线覆盖范围，或这套卷没进过管线）。
 *                      要不要补是**铺量决策**，不是修 bug。
 *   pipeline_loss      以上都不是：源里有、管线也跑过这一科，题却没进库。**这才是要修的丢题。**
 *
 * 为什么按额度扣而不是按标签判：早期写法是「这卷这科只要挂过任何 source flag，缺的全算源料缺陷」，
 * 于是 `duplicate_cluster`（只是说这篇材料别的场次也考过）这种纯溯源标记，
 * 会把整卷的管线丢题一口吞掉 —— 正好掩盖我们要找的东西。现在改成：
 *   · 只有**能解释缺题**的 code 才有额度（见 SOURCE_DEFECT_CODES）；
 *   · detail 里写了「缺 N 题」的，额度就是 N，多出来的缺口不许再赖给它；
 *   · code 只影响某个题型的（ctw_answer_truncated 只砍填词），只能扣那个题型。
 *
 * 为什么 dup_of 的扣留不算缺口：那是「同一篇材料在两场考试都考过，库里只留一份」，
 * assemble_sets 会按 dup_of 把 id 原位还回该场次（items[].alias_of），槽位并不空。
 */

/** 归因桶。顺序即扣额度的优先级。 */
const CAUSES = Object.freeze([
  "source_defect",
  "held",
  "deduped",
  "section_never_run",
  "section_lost",
  "pipeline_loss",
]);

const CAUSE_LABEL = Object.freeze({
  source_defect: "源料缺陷",
  held: "复核扣下",
  deduped: "跨卷合并丢弃",
  section_never_run: "整科没跑过",
  section_lost: "整科跑了归零",
  pipeline_loss: "管线丢题",
});

/**
 * 结构化管线常规覆盖的科目 —— `run_pipeline.mjs` 的 `SECTIONS` 锁死在这两科
 * （一期定的「听力/口语题面依赖音频、盲审不达标」，听力/口语靠单独脚本合流）。
 *
 * 为什么这条要写进归因：整科缺席有两种完全不同的病，处置也完全不同。
 *   · 听力/口语整科没题 = 管线本来就没跑它 → 要不要补是铺量决策（还要掏 TTS 的钱）；
 *   · 阅读/写作整科没题，而同卷别的科**有**题 = 这套卷确实进过管线、这一科被跑过，却颗粒无收
 *     → 和管线丢题同一种病，重扫就能捡。
 * 实测（2026-09-14）：24 套写作整科缺席的卷，阅读全都有题 —— 全是后一种。
 * 若将来放开 SECTIONS，改这里即可，账本会自动跟着重新归类。
 */
const PIPELINE_SECTIONS = Object.freeze(["reading", "writing"]);

/**
 * 能解释「这一科少了题」的源料体检 code。
 *   types  限定只砍哪些题型（不写 = 该科全部题型）
 *   cap    "detail" = 从 detail 里读「缺 N 题」当额度；不写 = 无上限（整科都算它的）
 *
 * 不在这张表里的 code 一律**不解释任何缺题**，只作为溯源提示记在行上：
 *   duplicate_cluster   这篇材料别的场次也考过
 *   vendor_pool         第二来源拼盘，本来就不是完整一卷
 *   vendor_reformatted  第二来源重排版 docx
 *   identical_file      两套卷的源文件哈希相同
 * 它们说的都是「这份源是什么」，不是「这份源少了什么」。
 */
const SOURCE_DEFECT_CODES = Object.freeze({
  section_no_stems: {},          // 该科 OCR 里根本没有题块
  section_no_answers: {},        // 答案 PDF 里没有该科答案
  section_blocked: {},           // 该科配对 0 题
  answer_key_misaligned: {},     // 答案页与题面题号对不上，整科不敢收
  audit_low_agreement: {},       // 盲审一致率塌了，整科扣下
  ingest_blocker: {},            // 解析器 fail-closed
  section_gap: { cap: "detail" },        // detail 写明「缺 N 题」
  ctw_answer_truncated: { types: ["ctw"] },   // 只砍填词：AP/RDL 的答案来自选择题答案键
  audio_partial: {},             // 音频残缺（听力/口语）
});

/** 纯溯源类 code：记在行上供人判断，但不认领任何缺题。 */
const PROVENANCE_CODES = Object.freeze(["duplicate_cluster", "vendor_pool", "vendor_reformatted", "identical_file"]);

/**
 * 一个「单元」值几道题 —— 复核清单按单元扣（scope=unit），但缺口按题算。
 * 数字出自 docs/realbank-set-blueprint.md §一 的每套卷结构表：
 * 填词每篇恒 10 空、学术段落每篇恒 5 题、对话/通知每段 2 题、讲座每段 4 题、
 * 短应答一题一条、复述 7 句、面试 4 问、日常阅读每篇 1~3 题（取 2）。
 */
const QUESTIONS_PER_UNIT = Object.freeze({
  ctw: 10, ap: 5, rdl: 2, lcr: 1, lc: 2, la: 2, lat: 4, repeat: 7, interview: 4, bs: 1, email: 1, disc: 1,
});

/**
 * 从 item id 解析出 { type, slug }。
 * 阅读/听力/口语：`real_<type>_<slug>_<module>_<q>`；写作：`bs_<slug>_<n>` / `email_<slug>` / `disc_<slug>`。
 * slug 本身不含下划线（121a / rf0610 / 56v2 / rp0830），所以按下划线切就够。
 */
function parseItemId(id) {
  const parts = String(id || "").split("_").filter(Boolean);
  if (parts[0] === "real") parts.shift();
  const type = parts.shift();
  const slug = parts.shift();
  if (!type || !slug) return null;
  return { type, slug };
}

const key = (type, slug) => `${type}|${slug}`;

/**
 * 复核清单 → Map<type|slug, 被扣掉的**题**数>。
 * 只数真扣下的：带 dup_of 的是跨卷重复，装卷时按别名原位还回，槽位不空。
 * scope=unit 按 QUESTIONS_PER_UNIT 折成题数，其余 scope（question/sentence/iq）一条算一题。
 */
function indexHolds(holds = []) {
  const m = new Map();
  for (const h of holds) {
    if (!h || h.dup_of) continue;
    const parsed = parseItemId(h.id);
    if (!parsed) continue;
    const weight = h.scope === "unit" ? (QUESTIONS_PER_UNIT[parsed.type] || 1) : 1;
    const k = key(parsed.type, parsed.slug);
    m.set(k, (m.get(k) || 0) + weight);
  }
  return m;
}

/**
 * 跨卷合并账本 → Map<type|slug, 被丢弃的题数>。
 * 只数 skipped（并入时被规则挡下的题）；merged 是并进代表了的，没丢。
 * 归到**被丢那一方的卷**（skipped[].from 的 slug），缺的正是那场考试的槽位。
 */
function indexDeduped(clusters = []) {
  const m = new Map();
  for (const c of clusters) {
    for (const s of c?.skipped || []) {
      const parsed = parseItemId(s?.from);
      if (!parsed) continue;
      const k = key(parsed.type, parsed.slug);
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  return m;
}

/** detail 里的「缺 N 题」。读不出返回 null。 */
function capFromDetail(detail) {
  const m = String(detail || "").match(/缺\s*(\d+)\s*题/);
  return m ? Number(m[1]) : null;
}

/**
 * 源料体检 → Map<卷名, { explainers: [{code, section, types:Set|null, remaining}], notes: [{code, section}] }>。
 * explainers 带额度，会被逐行扣减；notes 只是溯源提示。
 */
function indexSourceFlags(flagSets = {}) {
  const m = new Map();
  for (const [setName, flags] of Object.entries(flagSets)) {
    const explainers = [];
    const notes = [];
    for (const f of flags || []) {
      const code = f?.code;
      const sections = f?.sections || [];
      if (PROVENANCE_CODES.includes(code)) {
        for (const section of sections) notes.push({ code, section });
        continue;
      }
      const spec = SOURCE_DEFECT_CODES[code];
      if (!spec) { for (const section of sections) notes.push({ code, section }); continue; }
      const cap = spec.cap === "detail" ? capFromDetail(f.detail) : null;
      for (const section of sections) {
        explainers.push({
          code,
          section,
          types: spec.types ? new Set(spec.types) : null,
          remaining: cap === null ? Infinity : cap,
        });
      }
    }
    if (explainers.length || notes.length) m.set(setName, { explainers, notes });
  }
  return m;
}

/** 该行能从哪个 explainer 扣额度（section 与 type 都要对得上）。 */
function findExplainer(entry, section, type) {
  if (!entry) return null;
  return entry.explainers.find((e) => (e.section === section || e.section === "*")
    && (!e.types || e.types.has(type))
    && e.remaining > 0) || null;
}

/** 把缺口按优先级摊到各归因桶，返回 { charged, cause }。cause = 占比最大的那个桶。 */
function chargeMissing(missing, budgets) {
  const charged = {};
  let left = missing;
  for (const [cause, take] of budgets) {
    if (left <= 0) break;
    const amount = Math.min(left, take());
    if (amount > 0) { charged[cause] = (charged[cause] || 0) + amount; left -= amount; }
  }
  if (left > 0) charged.pipeline_loss = (charged.pipeline_loss || 0) + left;
  const cause = Object.entries(charged).sort((a, b) => b[1] - a[1]
    || CAUSES.indexOf(a[0]) - CAUSES.indexOf(b[0]))[0][0];
  return { charged, cause };
}

/**
 * 把一套卷摊成缺口行（含整科缺席的科目）。
 *
 * @param {object} set        sets.json 的一条
 * @param {object} ctx        { holdIndex, dedupIndex, flagIndex, defaultSlots }
 *   defaultSlots: { <section>: [{ key, type, q, module, form }] } —— 蓝图默认版式，
 *   用来给 sets.json 里**整科缺席**的科目补出应有槽位（缺席的科目在 sets.json 里连键都没有，
 *   不补的话这些卷压根不进分母，账本会把「一科都没跑」显示成「没缺题」）。
 */
function rowsForSet(set, ctx) {
  const { holdIndex, dedupIndex, flagIndex, defaultSlots = {} } = ctx;
  const rows = [];
  const sections = set?.sections || {};
  const flagEntry = flagIndex.get(set?.set) || null;
  // 这套卷进过管线吗 —— 任一科有题即是。用来把「跑了归零」和「压根没跑」分开。
  const anySectionHasItems = Object.values(sections).some((x) => (x?.got || 0) > 0);
  // 额度是「按卷按科」的，逐行扣：Map<type|slug, 剩余>
  const holdLeft = new Map();
  const dedupLeft = new Map();
  const takeFrom = (map, index, k) => {
    if (!map.has(k)) map.set(k, index.get(k) || 0);
    return map.get(k);
  };
  const spend = (map, k, n) => map.set(k, (map.get(k) || 0) - n);

  const emit = (section, moduleKey, form, slot, got, absent) => {
    const need = Number(slot?.need ?? slot?.q ?? 0);
    const missing = need - got;
    if (missing <= 0) return;
    const type = slot.type;
    const k = key(type, set.slug);
    const explainer = findExplainer(flagEntry, section, type);
    // 整科缺席分两种：管线覆盖且这卷跑过 → 跑了归零（可扫）；否则 → 压根没跑（铺量决策）
    const absentCause = PIPELINE_SECTIONS.includes(section) && anySectionHasItems
      ? "section_lost" : "section_never_run";
    const { charged, cause } = chargeMissing(missing, [
      ["source_defect", () => (explainer ? explainer.remaining : 0)],
      ["held", () => takeFrom(holdLeft, holdIndex, k)],
      ["deduped", () => takeFrom(dedupLeft, dedupIndex, k)],
      [absentCause, () => (absent ? missing : 0)],
    ]);
    if (charged.source_defect && explainer) explainer.remaining -= charged.source_defect;
    if (charged.held) spend(holdLeft, k, charged.held);
    if (charged.deduped) spend(dedupLeft, k, charged.deduped);
    rows.push({
      set: set.set,
      slug: set.slug,
      date: set.date,
      section,
      module: String(moduleKey),
      form: form || null,
      slotKey: slot.key,
      type,
      band: slot.band || null,
      need,
      got,
      missing,
      status: absent ? "absent" : slot.status,
      cause,
      charged,
      notes: (flagEntry?.notes || []).filter((n) => n.section === section || n.section === "*").map((n) => n.code),
    });
  };

  for (const [section, secData] of Object.entries(sections)) {
    for (const [moduleKey, mod] of Object.entries(secData?.modules || {})) {
      for (const slot of mod?.slots || []) emit(section, moduleKey, mod?.form, slot, Number(slot?.got || 0), false);
    }
  }
  // 整科缺席：sets.json 里连这个键都没有 —— 这一科一道题都没进过库。
  for (const [section, slots] of Object.entries(defaultSlots)) {
    if (sections[section]) continue;
    for (const slot of slots) emit(section, slot.module, slot.form, { ...slot, need: slot.q }, 0, true);
  }
  return rows;
}

/** 空的分桶计数器（保证每个桶都存在，报表列宽稳定）。 */
function emptyCauseTally() {
  return Object.fromEntries(CAUSES.map((c) => [c, 0]));
}

function addCharged(tally, charged) {
  for (const [c, n] of Object.entries(charged)) tally[c] = (tally[c] || 0) + n;
}

/**
 * 主入口：全科丢题账本。
 *
 * @param {object} input
 * @param {object} input.sets            data/realBank/sets.json
 * @param {Array}  [input.holds]         review-holds.json 的 holds
 * @param {Array}  [input.clusters]      reading/consolidation.json 的 clusters
 * @param {object} [input.sourceFlags]   source-flags.json 的 sets
 * @param {object} [input.defaultSlots]  蓝图默认版式槽位（见 rowsForSet）
 */
function buildLedger({ sets, holds = [], clusters = [], sourceFlags = {}, defaultSlots = {} } = {}) {
  const ctx = {
    holdIndex: indexHolds(holds),
    dedupIndex: indexDeduped(clusters),
    flagIndex: indexSourceFlags(sourceFlags),
    defaultSlots,
  };

  const rows = [];
  for (const set of sets?.sets || []) rows.push(...rowsForSet(set, ctx));

  const byType = {};
  const bySection = {};
  const bump = (bucket, keyName, keyVal, need, got) => {
    bucket[keyVal] ||= { [keyName]: keyVal, need: 0, got: 0, missing: 0, causes: emptyCauseTally() };
    bucket[keyVal].need += need;
    bucket[keyVal].got += got;
  };

  // 分母 = sets.json 里已有的槽位 + 整科缺席补出来的槽位（后者 got 恒 0）
  for (const set of sets?.sets || []) {
    const sections = set?.sections || {};
    for (const [section, secData] of Object.entries(sections)) {
      for (const mod of Object.values(secData?.modules || {})) {
        for (const slot of mod?.slots || []) {
          bump(byType, "type", slot.type, Number(slot.need || 0), Number(slot.got || 0));
          bump(bySection, "section", section, Number(slot.need || 0), Number(slot.got || 0));
        }
      }
    }
    for (const [section, slots] of Object.entries(defaultSlots)) {
      if (sections[section]) continue;
      for (const slot of slots) {
        bump(byType, "type", slot.type, Number(slot.q || 0), 0);
        bump(bySection, "section", section, Number(slot.q || 0), 0);
      }
    }
  }

  for (const r of rows) {
    if (byType[r.type]) { byType[r.type].missing += r.missing; addCharged(byType[r.type].causes, r.charged); }
    if (bySection[r.section]) { bySection[r.section].missing += r.missing; addCharged(bySection[r.section].causes, r.charged); }
  }
  for (const b of [...Object.values(byType), ...Object.values(bySection)]) {
    b.completeness = b.need ? Number((b.got / b.need).toFixed(4)) : 1;
  }

  const causes = emptyCauseTally();
  for (const r of rows) addCharged(causes, r.charged);
  const need = Object.values(bySection).reduce((a, b) => a + b.need, 0);
  const got = Object.values(bySection).reduce((a, b) => a + b.got, 0);
  // 缺口按**槽位**数，不是 need - got：装多了的槽（口语复述拼盘切出来的份数超过卷面 7 句，
  // sets.json 里 repeat 就有 130%）填不了别的槽的空。用 need - got 会把缺口冲掉、报少。
  // 恒等式：need = got + missing - overfilled。
  const missing = rows.reduce((a, r) => a + r.missing, 0);
  const overfilled = missing - (need - got);

  return {
    summary: {
      need,
      got,
      missing,
      overfilled,
      completeness: need ? Number((got / need).toFixed(4)) : 1,
      causes,
      // 「值得修的缺口」= 重扫管线就能捡回来的那些。源缺/扣下/合并各有各的处置；
      // 「整科没跑过」是铺量决策（还要掏钱），也不混进来催人。
      actionable: (causes.pipeline_loss || 0) + (causes.section_lost || 0),
    },
    byType,
    bySection,
    rows,
  };
}

/**
 * 把行按「同一套卷同一科」聚成可执行的补题任务，按缺口从大到小排。
 * 只聚重扫管线就能捡的（pipeline_loss / section_lost）——
 * 「整科没跑过」要先拍板铺不铺，不算可执行任务。
 */
function actionableTasks(rows, { limit = 0 } = {}) {
  const m = new Map();
  for (const r of rows) {
    const actionable = (r.charged.pipeline_loss || 0) + (r.charged.section_lost || 0);
    if (actionable <= 0) continue;
    const k = `${r.set}|${r.section}`;
    const t = m.get(k) || {
      set: r.set, slug: r.slug, date: r.date, section: r.section,
      missing: 0, cause: "pipeline_loss", types: {}, slots: [],
    };
    t.missing += actionable;
    t.types[r.type] = (t.types[r.type] || 0) + actionable;
    t.slots.push(`M${r.module}/${r.slotKey}(-${actionable})`);
    // 同一科混着两种成因时，整科归零优先（处置不同：一个是整科重跑，一个是扫 flagged 块）
    if (r.charged.section_lost) t.cause = "section_lost";
    m.set(k, t);
  }
  const list = [...m.values()].sort((a, b) => b.missing - a.missing || a.set.localeCompare(b.set));
  return limit > 0 ? list.slice(0, limit) : list;
}

module.exports = {
  CAUSES,
  CAUSE_LABEL,
  PIPELINE_SECTIONS,
  SOURCE_DEFECT_CODES,
  PROVENANCE_CODES,
  QUESTIONS_PER_UNIT,
  parseItemId,
  capFromDetail,
  indexHolds,
  indexDeduped,
  indexSourceFlags,
  findExplainer,
  rowsForSet,
  buildLedger,
  actionableTasks,
};
