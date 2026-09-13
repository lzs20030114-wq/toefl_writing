/**
 * 真题阅读「跨卷同篇合并」的锁（scripts/realbank/consolidate_reading.js）。
 *
 * 这一步是**往库里加题**：同一篇文章被两套卷各抽到一部分题时，以前留一份扔一份、
 * 扔掉那份多出来的题也一起没了；现在把副本的题并进保留的那条。加题这件事一旦判错，
 * 用户看到的就是「正文里根本没有的题」—— 所以每道守卫都得逐条钉死。
 *
 * 不碰真实题库（数字天天变），用手写的迷你条目跑纯函数。阈值用导出的 jaccard/tokens
 * 当场量一遍再断言，免得哪天我把 fixture 改得越过了阈值却自己不知道。
 */
const C = require("../scripts/realbank/consolidate_reading.js");

/* ── fixture 素材 ──────────────────────────────────────────────────────── */

// 20 个长度 > 3 的词（短词不进词集，见 consolidate_reading.tokens）
const SHARED = "urban noise pollution affects millions residents across modern metropolitan regions researchers measured decibel levels highways during morning commuting hours barriers";
const TITLE = "Noise Control in Urban Areas";

/** 造一段正文：共同 20 词 + 各自 extra 词；两份的 Jaccard = 20 / (20 + a + b)。 */
const body = (extra) => `${SHARED}. ${extra}.`;
const EXTRA_A = "acoustic panels reduce reflected energy";          // 5 词 → 与 B 的 Jaccard = 20/30 ≈ 0.67
const EXTRA_B = "vegetation screens absorb ambient frequencies";     // 5 词
const EXTRA_C = "concrete slabs";                                    // 2 词 ┐ 与 D 的 Jaccard = 20/24 ≈ 0.83
const EXTRA_D = "steel girders";                                     // 2 词 ┘

// 选项按 (题号, 题干) 取种子：默认每道题的四个选项互不相同 —— 选项重合本身就是一条去重判据
// （OPTION_OVERLAP_DUP），fixture 里图省事让所有题共用 {a,b,c,d} 会把每一对都判成同一题。
// 要测「选项撞了」的场景就显式传同一套选项进来。
const opts = (seed) => ({ A: `alpha ${seed}`, B: `bravo ${seed}`, C: `charlie ${seed}`, D: `delta ${seed}` });
const q = (q_number, stem, extra = {}) => ({
  question_type: "detail", stem, options: opts(`${q_number}|${stem}`), correct_answer: "A", q_number, ...extra,
});

/**
 * 造一条 AP 条目。paragraphs[0] 是标题，其余是正文段。
 * `truncated: true` 让末段不以句号收尾（模拟 OCR 把后半截吃了）。
 */
function ap(id, { title = TITLE, paras, date = "2026-03-10", source = "set", questions = [], truncated = false } = {}) {
  const bodyParas = (paras || [body(EXTRA_A)]).slice();
  if (truncated) bodyParas[bodyParas.length - 1] = bodyParas[bodyParas.length - 1].replace(/[.!?]\s*$/, "");
  const all = [title, ...bodyParas];
  return { id, source, date, questions, paragraphs: all, passage: all.join("\n\n"), difficulty: "medium", real: true };
}
function rdl(id, { text, date = "2026-03-10", source = "set", questions = [] } = {}) {
  return { id, source, date, questions, text, genre: "notice", real: true };
}

const run = (banks, review) => C.consolidateReading({ ap: [], rdl: [], ...banks }, review || { holds: [] });
const ids = (list) => list.map((x) => x.id);
const stems = (item) => item.questions.map((x) => x.stem);

/* ── fixture 自检：阈值必须落在我以为的那一档 ─────────────────────────── */

describe("fixture 自检：Jaccard 落在预期区间", () => {
  const j = (a, b) => C.jaccard(C.tokens(a), C.tokens(b));
  test("EXTRA_A / EXTRA_B 两份正文在 0.5~0.8 之间（只有靠标题相同才该被认作同篇）", () => {
    const v = j(body(EXTRA_A), body(EXTRA_B));
    expect(v).toBeGreaterThanOrEqual(C.AP_TITLE_BODY_JACCARD_MIN);
    expect(v).toBeLessThan(C.AP_BODY_JACCARD_MIN);
  });
  test("EXTRA_C / EXTRA_D 两份正文 ≥ 0.8（标题不同也该被认作同篇）", () => {
    expect(j(body(EXTRA_C), body(EXTRA_D))).toBeGreaterThanOrEqual(C.AP_BODY_JACCARD_MIN);
  });
});

/* ── 聚簇判据 ─────────────────────────────────────────────────────────── */

describe("聚簇：什么算同一篇", () => {
  test("标题相同 + 正文过半重合 → 同一篇（这正是 1.28A / 5.3 的 Noise Control）", () => {
    const r = run({ ap: [
      ap("real_ap_128a_1_27", { date: "2026-01-28", paras: [body(EXTRA_A)], questions: [q(27, "How do green walls help control noise pollution?")] }),
      // 5.3 那份的末段被 OCR 砍了（真实情况就是这样），所以代表取 1.28A
      ap("real_ap_53_1_32", { date: "2026-05-03", paras: [body(EXTRA_B)], truncated: true, questions: [
        q(32, "How do green walls help control noise pollution?"),
        q(33, "What can be inferred about noise pollution in the European cities mentioned in the passage?"),
      ] }),
    ] });
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0].kept).toBe("real_ap_128a_1_27");
    expect(r.clusters[0].dropped).toEqual(["real_ap_53_1_32"]);
    expect(ids(r.ap)).toEqual(["real_ap_128a_1_27"]);
    // 重复题干被跳过，多出来的那道并进来了
    expect(stems(r.ap[0])).toEqual([
      "How do green walls help control noise pollution?",
      "What can be inferred about noise pollution in the European cities mentioned in the passage?",
    ]);
    expect(r.clusters[0].merged.map((m) => m.q_number)).toEqual([33]);
    expect(r.clusters[0].skipped.map((s) => s.reason)).toEqual(["duplicate_stem"]);
  });

  test("标题不同但正文 ≥0.8 → 同一篇（OCR 把标题吃了的那份也认得出来）", () => {
    const r = run({ ap: [
      ap("real_ap_a_1_31", { title: "Concrete Acoustics", paras: [body(EXTRA_C)], questions: [q(31, "What is Health Geek?")] }),
      ap("real_ap_b_1_31", { title: "Slab Acoustics", paras: [body(EXTRA_D)], questions: [q(31, "Why does the author mention public speaking?")] }),
    ] });
    expect(r.clusters).toHaveLength(1);
    expect(r.ap).toHaveLength(1);
  });

  test("标题相同但正文各说各话 → 不是同一篇，一条都不动", () => {
    const other = "deep ocean hydrothermal vents support chemosynthetic communities living beside superheated mineral plumes far beneath sunlight";
    const r = run({ ap: [
      ap("real_ap_a_1_31", { paras: [body(EXTRA_A)], questions: [q(31, "Q one?")] }),
      ap("real_ap_b_1_31", { paras: [`${other}.`], questions: [q(31, "Q two?")] }),
    ] });
    expect(r.clusters).toEqual([]);
    expect(ids(r.ap)).toEqual(["real_ap_a_1_31", "real_ap_b_1_31"]);
  });

  test("RDL 用 0.8：0.83 合、0.67 不合（通知/广告篇幅短，不放宽）", () => {
    const merge = run({ rdl: [
      rdl("real_rdl_a_1_21", { text: body(EXTRA_C), questions: [q(21, "Q one?")] }),
      rdl("real_rdl_b_1_21", { text: body(EXTRA_D), questions: [q(21, "Q two?")] }),
    ] });
    expect(merge.rdl).toHaveLength(1);
    const keep = run({ rdl: [
      rdl("real_rdl_a_1_21", { text: body(EXTRA_A), questions: [q(21, "Q one?")] }),
      rdl("real_rdl_b_1_21", { text: body(EXTRA_B), questions: [q(21, "Q two?")] }),
    ] });
    expect(keep.rdl).toHaveLength(2);
    expect(keep.clusters).toEqual([]);
  });
});

/* ── 代表（保留方）选择 ───────────────────────────────────────────────── */

describe("选代表", () => {
  const pair = (extraA = {}, extraB = {}) => [
    ap("real_ap_a_1_31", { date: "2026-03-01", paras: [body(EXTRA_A)], questions: [q(31, "Q alpha?")], ...extraA }),
    ap("real_ap_b_1_31", { date: "2026-04-01", paras: [body(EXTRA_B)], questions: [q(31, "Q bravo?")], ...extraB }),
  ];

  test("正文被截断的那份不当代表（末段不以句号收尾）", () => {
    const r = run({ ap: pair({ truncated: true }) });
    expect(r.clusters[0].kept).toBe("real_ap_b_1_31");
  });

  test("段落多的优先（两边都完整时）", () => {
    const r = run({ ap: pair({ paras: [body(EXTRA_A), "Second paragraph adds context."] }) });
    expect(r.clusters[0].kept).toBe("real_ap_a_1_31");
  });

  test("复核清单 dup_of 指着的那条一定当代表（哪怕它正文被截断、题还少）", () => {
    const review = { holds: [{ file: "reading/ap", id: "real_ap_x_1_31", scope: "unit", dup_of: "real_ap_a_1_31", reason: "跨套重复，保留 real_ap_a_1_31" }] };
    const r = run({ ap: pair({ truncated: true }) }, review);
    expect(r.clusters[0].kept).toBe("real_ap_a_1_31");
    expect(r.clusters[0].dropped).toEqual(["real_ap_b_1_31"]);
  });

  test("被整条下架的条目不当代表（它马上要被 applyReview 删掉，当代表 = 并进去的题一起消失）", () => {
    const review = { holds: [{ file: "reading/ap", id: "real_ap_b_1_31", scope: "unit", reason: "材料串了无关内容" }] };
    const r = run({ ap: pair({ truncated: true }) }, review);
    expect(r.clusters[0].kept).toBe("real_ap_a_1_31");     // b 完整但待下架 → 仍不选它
  });

  test("整簇都待下架 → 整簇不动", () => {
    const review = { holds: [
      { file: "reading/ap", id: "real_ap_a_1_31", scope: "unit", reason: "x" },
      { file: "reading/ap", id: "real_ap_b_1_31", scope: "unit", reason: "y" },
    ] };
    const r = run({ ap: pair() }, review);
    expect(r.clusters).toEqual([]);
    expect(r.ap).toHaveLength(2);
  });

  test("簇里有插入句题时，优先选正文带 [A]~[D] 的那份", () => {
    const marked = `${SHARED} [A] one [B] two [C] three [D] four. ${EXTRA_B}.`;
    const r = run({ ap: [
      ap("real_ap_a_1_31", { paras: [body(EXTRA_A)], questions: [q(31, "Q alpha?")] }),
      ap("real_ap_b_1_31", { paras: [marked], questions: [q(31, "Where would the sentence best fit?")] }),
    ] });
    expect(r.clusters[0].kept).toBe("real_ap_b_1_31");
  });
});

/* ── 逐题守卫 ─────────────────────────────────────────────────────────── */

describe("逐题守卫：并进来的每道题都得在代表正文上答得了", () => {
  // 代表固定是 a（正文完整、日期早），要并的题挂在 b 上
  const withB = (bq, opts = {}) => run({ ap: [
    ap("real_ap_a_1_31", { date: "2026-03-01", paras: opts.repParas || [body(EXTRA_A)], questions: [q(31, "Q alpha?")] }),
    ap("real_ap_b_1_31", { date: "2026-04-01", paras: [body(EXTRA_B)], truncated: true, questions: bq }),
  ] }, opts.review);
  const reasons = (r) => r.clusters[0].skipped.map((s) => s.reason);

  test("词汇题：问的词不在代表正文里 → 不收", () => {
    const r = withB([q(32, 'The word "chemosynthetic" in the passage is closest in meaning to')]);
    expect(reasons(r)).toEqual(["vocab_word_absent"]);
    expect(r.clusters[0].merged).toEqual([]);
  });

  test("词汇题：问的词在代表正文里 → 收（比对去空格去标点的字母序列）", () => {
    const r = withB([q(32, 'The word "metropolitan" in the passage is closest in meaning to')]);
    expect(reasons(r)).toEqual([]);
    expect(r.clusters[0].merged).toHaveLength(1);
    expect(r.ap[0].questions[1].question_type).toBe("vocabulary_in_context");
    expect(r.ap[0].questions[1].merged_from).toBe("real_ap_b_1_31");
  });

  test("段落守卫：代表只有 1 段正文，题干却引 paragraph 3 → 不收", () => {
    const r = withB([q(32, "According to paragraph 3, what did researchers measure?")]);
    expect(reasons(r)).toEqual(["paragraph_out_of_range"]);
  });

  test("段落守卫：代表段落够 → 收", () => {
    const r = withB([q(32, "According to paragraph 3, what did researchers measure?")],
      { repParas: [body(EXTRA_A), "Second paragraph.", "Third paragraph."] });
    expect(reasons(r)).toEqual([]);
  });

  test("段落守卫：整篇不分段时 the last paragraph 无从定位 → 不收", () => {
    const r = withB([q(32, "What does the author suggest about biofeedback in the last paragraph?")]);
    expect(reasons(r)).toEqual(["paragraph_out_of_range"]);
  });

  test("插入句题：代表正文没有 [A]~[D]/■ → 不收（死题）", () => {
    const r = withB([q(32, "There are four locations in the passage that indicate where the following sentence could be added")]);
    expect(reasons(r)).toEqual(["insert_no_markers"]);
  });

  test("插入句题：代表正文带标记 → 收，题型落 insert_text", () => {
    const marked = `${SHARED} [A] one [B] two [C] three [D] four. ${EXTRA_A}.`;
    const r = withB([q(32, "There are four locations in the passage that indicate where the following sentence could be added")],
      { repParas: [marked] });
    expect(reasons(r)).toEqual([]);
    expect(r.ap[0].questions[1].question_type).toBe("insert_text");
  });

  test("选句题一律不并（答案是原文里的某一句，换份副本就对不上）", () => {
    const r = withB([q(32, "Identify the sentence that best summarizes the author's argument.")]);
    expect(reasons(r)).toEqual(["sentence_selection"]);
  });

  test("复核清单判过歧义的题干（scope=question 的 stem 前缀）→ 全局拒收", () => {
    const stem = "Who is most likely to obtain a locker?";
    const review = { holds: [{ file: "reading/ap", id: "real_ap_other_1_28", scope: "question", q: 2, stem: "Who is most likely to obtain a locker", reason: "A 与 D 两个选项都成立" }] };
    const r = withB([q(32, stem)], { review });
    expect(reasons(r)).toEqual(["review_held_stem"]);
  });

  test("题干被 OCR 砍了前半截（小写开头）→ 不收", () => {
    const r = withB([q(32, "all of the following EXCEPT")]);
    expect(reasons(r)).toEqual(["truncated_stem"]);
  });

  test("去重：题干归一化相同 / 题干极像 都算已有", () => {
    // 刻意给每道题一套互不相同的选项：这条测的是**题干**判据，选项撞了会先被
    // duplicate_options 截走（那条另有专门的一组测试）。
    const r = run({ ap: [
      ap("real_ap_a_1_31", { date: "2026-03-01", paras: [body(EXTRA_A)], questions: [
        q(31, "According to the passage, what did researchers measure near highways?", { options: opts("own") }),
      ] }),
      ap("real_ap_b_1_31", { date: "2026-04-01", paras: [body(EXTRA_B)], truncated: true, questions: [
        q(31, "  According to the passage, what did researchers measure near highways?  ", { options: opts("v1") }),   // 只差空白
        q(32, "According to the passage, what did researchers measure near the highways?", { options: opts("v2") }),   // 只差一个虚词
        q(33, "Why does the author mention public speaking?", { options: opts("v3") }),                                 // 真的是新题
      ] }),
    ] });
    expect(r.clusters[0].skipped.map((s) => s.reason)).toEqual(["duplicate_stem", "duplicate_stem"]);
    expect(r.clusters[0].merged.map((m) => m.q_number)).toEqual([33]);
  });
});

/* ── 去重的三段判据（题干像不够，还得看选项）────────────────────────── */

describe("去重：题干相似时用选项当第二把尺", () => {
  // 实测反例：同一篇里问法相近的两道**不同**的题（real_ap_rf0808_1_131 q132 vs 代表那道），
  // 题干 Jaccard 0.63 但四个选项零重合。按 0.6 一刀切会把新题当重复扔掉。
  const STEM_APP = "All of the following are mentioned as applications of polarized light EXCEPT:";
  const STEM_USES = "All of the following are mentioned as uses of polarized light in biology EXCEPT";
  const OPT = (a, b, c, d) => ({ A: a, B: b, C: c, D: d });
  const qo = (n, stem, options) => ({ question_type: "detail", stem, options, correct_answer: "A", q_number: n });
  const runPair = (repQ, candQ) => run({ ap: [
    ap("real_ap_a_1_31", { date: "2026-03-01", paras: [body(EXTRA_A)], questions: [repQ] }),
    ap("real_ap_b_1_31", { date: "2026-04-01", paras: [body(EXTRA_B)], truncated: true, questions: [candQ] }),
  ] });

  test("fixture 自检：两条题干的 Jaccard 落在 0.6~0.85 之间", () => {
    const v = C.jaccard(C.tokens(STEM_APP), C.tokens(STEM_USES));
    expect(v).toBeGreaterThanOrEqual(C.STEM_JACCARD_MIN);
    expect(v).toBeLessThan(C.STEM_JACCARD_STRICT);
  });

  test("题干像但选项零重合 → 不是同一道，照并", () => {
    const r = runPair(
      qo(31, STEM_APP, OPT("mineral identification", "glare reduction", "stress analysis", "screen displays")),
      qo(32, STEM_USES, OPT("bee navigation", "crystal microscopy", "squid signalling", "beetle shells")),
    );
    expect(r.clusters[0].skipped).toEqual([]);
    expect(r.clusters[0].merged.map((m) => m.q_number)).toEqual([32]);
    expect(r.ap[0].questions).toHaveLength(2);
  });

  test("题干像且至少一个选项相同 → 同一道，跳过", () => {
    const r = runPair(
      qo(31, STEM_APP, OPT("mineral identification", "bee navigation", "stress analysis", "screen displays")),
      qo(32, STEM_USES, OPT("bee  navigation.", "crystal microscopy", "squid signalling", "beetle shells")),
    );
    expect(r.clusters[0].skipped.map((s) => s.reason)).toEqual(["duplicate_stem"]);
    expect(r.clusters[0].merged).toEqual([]);
  });

  test("题干 Jaccard ≥0.85 → 不看选项也算同一道", () => {
    const r = runPair(
      qo(31, "According to the passage, what did researchers measure near the busy highways?", OPT("a1", "a2", "a3", "a4")),
      qo(32, "According to the passage, what did researchers measure near busy highways?", OPT("b1", "b2", "b3", "b4")),
    );
    expect(r.clusters[0].skipped.map((s) => s.reason)).toEqual(["duplicate_stem"]);
  });
});

/* ── 选项重合：措辞被改写的重复题 / 源料串栏 ───────────────────────────── */

describe("去重：选项撞 3 个以上直接判同一题（不看题干）", () => {
  const qo = (n, stem, options) => ({ question_type: "detail", stem, options, correct_answer: "A", q_number: n });
  const FOUR = { A: "in a lab", B: "on a reef", C: "under ice", D: "in a cave" };
  const runPair = (repQ, candQ) => run({ ap: [
    ap("real_ap_a_1_31", { date: "2026-03-01", paras: [body(EXTRA_A)], questions: [repQ] }),
    ap("real_ap_b_1_31", { date: "2026-04-01", paras: [body(EXTRA_B)], truncated: true, questions: [candQ] }),
  ] });

  test("改写措辞的同一题：题干 Jaccard 够不着 0.6，靠 4/4 选项相同认出来", () => {
    // 实测 real_ap_310_1_25「What is HealthGeek?」vs 并入的「What is Health Geek?」
    const r = runPair(qo(31, "What is HealthGeek?", FOUR), qo(32, "Which of the following best describes the service?", { ...FOUR }));
    expect(r.clusters[0].skipped.map((s) => s.reason)).toEqual(["duplicate_options"]);
    expect(r.clusters[0].merged).toEqual([]);
  });

  test("源料串栏：题干配错了选项（四个选项与自有题完全相同）必须拒收", () => {
    // 实测 real_ap_411_1_31 自有「Why does the author mention Biorock technology…」
    // 与并入的「What is the main purpose of the passage?」四个选项逐字相同
    const r = runPair(
      qo(31, "Why does the author mention Biorock technology in the passage?", FOUR),
      qo(13, "What is the main purpose of the passage?", { ...FOUR }),
    );
    expect(r.clusters[0].skipped.map((s) => s.reason)).toEqual(["duplicate_options"]);
  });

  test("撞 3 个也算（第四个被改写）", () => {
    const r = runPair(
      qo(31, "Where do the organisms live?", FOUR),
      qo(32, "According to the passage, what habitat is described?", { ...FOUR, D: "in an estuary" }),
    );
    expect(r.clusters[0].skipped.map((s) => s.reason)).toEqual(["duplicate_options"]);
  });

  test("只撞 2 个不算：题干也对不上就是两道不同的题，照并", () => {
    const r = runPair(
      qo(31, "Where do the organisms live?", FOUR),
      qo(32, "According to the passage, what habitat is described?", { ...FOUR, C: "in a delta", D: "in an estuary" }),
    );
    expect(r.clusters[0].skipped).toEqual([]);
    expect(r.clusters[0].merged.map((m) => m.q_number)).toEqual([32]);
  });

  test("选项判据优先级最高：同时满足题干判据时记 duplicate_options", () => {
    const r = runPair(qo(31, "Where do the organisms live?", FOUR), qo(32, "Where do the organisms live?", { ...FOUR }));
    expect(r.clusters[0].skipped.map((s) => s.reason)).toEqual(["duplicate_options"]);
  });
});

/* ── 每篇题量上限 ─────────────────────────────────────────────────────── */

describe("每篇题量上限（真考一篇 5 题）", () => {
  // 代表自有 3 题（全是细节题），副本有 4 道可并的新题
  const build = () => ({ ap: [
    ap("real_ap_a_1_31", { date: "2026-03-01", paras: [body(EXTRA_A)], questions: [
      q(31, "What did researchers measure first?"),
      q(32, "Where were the barriers installed?"),
      q(33, "Who commissioned the survey?"),
    ] }),
    ap("real_ap_b_1_31", { date: "2026-04-01", paras: [body(EXTRA_B)], truncated: true, questions: [
      q(11, "Which building material was chosen?"),                                    // factual_detail
      q(12, "What can be inferred about the residents of these regions?"),              // inference
      q(13, "Why does the author mention commuting hours?"),                            // rhetorical_purpose
      q(14, "What is the main purpose of the passage?"),                                // main_idea
    ] }),
  ] });

  test("补到 5 题为止，多出来的记 over_cap", () => {
    const r = run(build());
    expect(r.ap[0].questions).toHaveLength(5);
    expect(r.clusters[0].merged).toHaveLength(2);
    expect(r.clusters[0].skipped.map((s) => s.reason)).toEqual(["over_cap", "over_cap"]);
    expect(r.summary.skipped.over_cap).toBe(2);
  });

  test("名额先给代表里没有的题型（细节题排最后）", () => {
    const r = run(build());
    const merged = r.ap[0].questions.filter((x) => x.merged_from).map((x) => x.question_type);
    expect(merged).toEqual(["inference", "rhetorical_purpose"]);   // 同为缺失题型时按来源日期 / 题号
    expect(r.clusters[0].skipped.map((s) => s.q_number)).toEqual([14, 11]);  // main_idea 排第三、细节题垫底
  });

  test("代表自己就超了 5 题：一道都不补，全记 over_cap（自有题不动）", () => {
    const banks = build();
    banks.ap[0].questions = Array.from({ length: 6 }, (_, i) => q(31 + i, `Own question number ${i} here?`));
    const r = run(banks);
    expect(r.ap[0].questions).toHaveLength(6);
    expect(r.clusters[0].merged).toEqual([]);
    expect(r.summary.skipped.over_cap).toBe(4);
  });

  test("上限显式传 null 就不限", () => {
    const r = C.consolidateReading(build(), { holds: [] }, { maxQuestions: { ap: null, rdl: null } });
    expect(r.ap[0].questions).toHaveLength(7);
    expect(r.summary.skipped.over_cap).toBeUndefined();
  });

  test("默认上限：ap 5 / rdl 3（蓝图里日常阅读一篇 2~3 题）", () => {
    expect(C.MAX_QUESTIONS).toEqual({ ap: 5, rdl: 3 });
  });
});

describe("日常阅读（RDL）每篇最多 3 题", () => {
  const qa = (n, stem, options, correct_answer = "A") => ({ stem, options, correct_answer, q_number: n });

  test("代表自有 3 题：第二来源改写过的同三道题一道不并（实测 real_rdl_rf0713_1_123 被并成 6 题）", () => {
    const r = run({ rdl: [
      rdl("real_rdl_rf0713_1_123", { date: "2026-07-13", text: body(EXTRA_C), questions: [
        qa(123, "What is the main problem that Colin expresses about the assignment?", { A: "He believes the topic is unimportant.", B: "He finds the topic too general to approach easily.", C: "He does not understand the assignment.", D: "He believes that the prompt makes false assumptions." }, "B"),
        qa(124, "What does Priya suggest is the purpose of the assignment?", { A: "To summarize existing research on remote learning", B: "To criticize existing research on remote learning", C: "To choose a viewpoint and support it with arguments", D: "To analyze one's personal experience with online courses" }, "C"),
        qa(125, "What does Colin struggle with when reviewing the research?", { A: "It discusses too many topics.", B: "It contradicts his own experience.", C: "It relies too heavily on theory.", D: "It is intended for experts only." }),
      ] }),
      rdl("real_rdl_rf0808_1_125", { date: "2026-08-08", text: body(EXTRA_D), questions: [
        qa(125, "What problem does Colin have with the assignment?", { A: "He cannot find research about remote learning.", B: "He thinks the topic is too general.", C: "He disagrees with the professor's position.", D: "He does not understand the deadline." }, "B"),
        qa(126, "What does Priya say is the main purpose of the assignment?", { A: "To summarize every possible issue", B: "To compare all published research", C: "To choose a viewpoint and support it with evidence", D: "To design a new online course" }, "C"),
        qa(127, "What is Colin struggling to decide?", { A: "Which topic to prioritize", B: "Which professor to interview", C: "Whether to change courses", D: "How to collect student data" }),
      ] }),
    ] });
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0].kept).toBe("real_rdl_rf0713_1_123");
    expect(r.rdl).toHaveLength(1);
    expect(r.rdl[0].questions.map((x) => x.q_number)).toEqual([123, 124, 125]);
    expect(r.clusters[0].skipped.map((s) => s.reason)).toEqual(["over_cap", "over_cap", "over_cap"]);
  });

  test("代表 2 题只补 1 道；RDL 没有题型优先，按来源日期先到先得", () => {
    const r = run({ rdl: [
      rdl("real_rdl_a_1_21", { date: "2026-03-01", text: body(EXTRA_C), questions: [
        q(21, "What time does the workshop begin?"),
        q(22, "Where should participants register?"),
      ] }),
      // 按 AP 题型口径这道是主旨题（代表里没有），若走 AP 的「缺失题型优先」会抢到名额
      rdl("real_rdl_b_1_21", { date: "2026-04-01", text: body(EXTRA_D), questions: [q(23, "What is the main purpose of the notice?")] }),
      rdl("real_rdl_c_1_21", { date: "2026-02-01", text: body(EXTRA_C), questions: [q(24, "How much does the parking permit cost?")] }),
    ] });
    expect(r.clusters[0].kept).toBe("real_rdl_a_1_21");
    expect(r.rdl[0].questions.map((x) => x.q_number)).toEqual([21, 22, 24]);
    expect(r.clusters[0].skipped).toEqual([expect.objectContaining({ from: "real_rdl_b_1_21", reason: "over_cap" })]);
    expect(r.rdl[0].questions.every((x) => !("question_type" in x) || x.question_type === "detail")).toBe(true);
  });
});

describe("去重：正确答案原文相同（题干和干扰项都被改写）", () => {
  const qa = (n, stem, options, correct_answer = "A") => ({ stem, options, correct_answer, q_number: n });
  // 代表自有 2 题（比副本多 → 当代表），第二道是要比对的那道
  const Q121 = qa(121, "Which light shows that the router is ready?", { A: "The steady green light", B: "The blinking red light", C: "The orange power light", D: "The blue signal light" });
  const pair = (repQ, candQ) => run({ rdl: [
    rdl("real_rdl_rf0902_1_121", { date: "2026-09-02", text: body(EXTRA_C), questions: [Q121, repQ] }),
    rdl("real_rdl_318_1_22", { date: "2026-03-18", text: body(EXTRA_D), questions: [candQ] }),
  ] });
  const REP = qa(122, "What should a resident do last?", {
    A: "Unplug the router from the wall.", B: "Wait until the router has completely started again", C: "Record the error code.", D: "Contact the building manager.",
  }, "B");

  test("实测 real_rdl_rf0902_1_121 vs real_rdl_318_1_22：题干 J 0.13、选项只撞 2 个，答案逐字相同 → duplicate_answer", () => {
    const cand = qa(22, "What is the final step to resetting the router?", {
      A: "Wait until the router has completely started again.", B: "Press the reset button twice.", C: "Unplug the router from the wall.", D: "Change the network password.",
    });
    expect(C.jaccard(C.tokens(REP.stem), C.tokens(cand.stem))).toBeLessThan(C.STEM_JACCARD_MIN);
    expect(C.sharedOptionCount(C.questionKey(REP).options, C.questionKey(cand).options)).toBeLessThan(C.OPTION_OVERLAP_DUP);
    const r = pair(REP, cand);
    expect(r.clusters[0].kept).toBe("real_rdl_rf0902_1_121");
    expect(r.clusters[0].skipped.map((s) => s.reason)).toEqual(["duplicate_answer"]);
    expect(r.rdl[0].questions.map((x) => x.q_number)).toEqual([121, 122]);
    expect(r.summary.skipped.duplicate_answer).toBe(1);
  });

  test("答案太短不算（词汇题 / 插入题的答案天然短，撞了未必是同一题）", () => {
    const short = (n, stem) => qa(n, stem, { A: "strong", B: `bravo ${n}`, C: `charlie ${n}`, D: `delta ${n}` });
    const r = pair(short(122, "The word \"robust\" in the notice is closest in meaning to"), short(22, "How are the new benches described?"));
    expect(r.clusters[0].skipped).toEqual([]);
    expect(r.rdl[0].questions.map((x) => x.q_number)).toEqual([121, 122, 22]);
  });

  test("答案不同就照并（同篇两道不同的题）", () => {
    const cand = qa(22, "Why might a resident need to reset the router?", {
      A: "The connection keeps dropping.", B: "Wait until the router has completely started again", C: "The bill is overdue.", D: "The cable is missing.",
    });
    const r = pair(REP, cand);
    expect(r.clusters[0].skipped).toEqual([]);
    expect(r.rdl[0].questions.map((x) => x.q_number)).toEqual([121, 122, 22]);
  });

  test("优先级：题干判据先于答案判据（两条都满足时记 duplicate_stem）", () => {
    const cand = { ...REP, q_number: 22, options: { A: "Wait until the router has completely started again", B: "x1", C: "x2", D: "x3" }, correct_answer: "A" };
    expect(pair(REP, cand).clusters[0].skipped.map((s) => s.reason)).toEqual(["duplicate_stem"]);
  });

  test("correct_answer 不是选项键时不参与答案判据", () => {
    expect(C.questionKey({ stem: "S?", options: { A: "Wait until the router has completely started again" }, correct_answer: "E" }).answer).toBe("");
    expect(C.questionKey(REP).answer).toBe("waituntiltherouterhascompletelystartedagain");
  });
});

/* ── 点选句子题跨卷换宿主 ─────────────────────────────────────────────── */

describe("点选句子题（S1… 选项）跨卷合并", () => {
  const SS = require("../scripts/realbank/sentence_select.js");
  const P_REP = "Noise-canceling materials emerged. Such materials are used on roads. Urban planners can use these materials to design acoustic panels and noise barriers.";
  const P_COPY = "Advancements led to noise-canceling materials. Urban planners can use these materials to design acoustic panels and noise barriers.";
  const P_OTHER = "Noise-canceling materials emerged. Such materials are used on roads. Urban planners design whole cities more effectively with them.";
  const STEM = "Identify the sentence in paragraph 1 that names specific architectural elements.";
  const SENTENCE = "Urban planners can use these materials to design acoustic panels and noise barriers.";
  const ssQ = (paraText, n = 34) => SS.buildSentenceQuestion(
    { stem: STEM, paragraph: 1, answer_prefix: "urban planners", q_number: n }, { paragraphs: ["T", paraText] },
  ).question;
  const mk = (id, date, paras, questions, truncated = false) => {
    const ps = [TITLE, ...paras];
    if (truncated) ps[ps.length - 1] = ps[ps.length - 1].replace(/\.$/, "");
    return { id, date, source: id, paragraphs: ps, passage: ps.join("\n\n"), questions };
  };
  // 代表 a（完整、日期早）；副本 b 带一道选句题。第 2 段是共同正文，保证两份聚成一簇。
  const banks = (repP1, copyQs, repQs = [q(31, "How do green walls help control noise pollution?")]) => ({ ap: [
    mk("real_ap_a_1_31", "2026-01-28", [repP1, body(EXTRA_A)], repQs),
    mk("real_ap_b_1_31", "2026-05-03", [P_COPY, body(EXTRA_B)], copyQs, true),
  ] });
  const passes = (paraText, sentence = SENTENCE) => new Map([[SS.auditHash(STEM, paraText), new Set([sentence])]]);

  test("fixture 自检：两份聚成一簇，代表是 a", () => {
    const r = C.consolidateReading(banks(P_REP, [ssQ(P_COPY)]), { holds: [] });
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0].kept).toBe("real_ap_a_1_31");
  });

  test("代表第 N 段里有同一句 + 那段审过 → 搬过来，选项与答案按代表重算", () => {
    const r = C.consolidateReading(banks(P_REP, [ssQ(P_COPY)]), { holds: [] }, { sentencePasses: passes(P_REP) });
    expect(r.clusters[0].skipped).toEqual([]);
    const moved = r.ap[0].questions.find((x) => x.question_type === "sentence_selection");
    expect(moved).toMatchObject({ merged_from: "real_ap_b_1_31", paragraph: 1, correct_answer: "S3" });
    expect(moved.options).toEqual({ S1: "Noise-canceling materials emerged.", S2: "Such materials are used on roads.", S3: SENTENCE });
  });

  test("代表那段没审过 → sentence_select_unaudited，不搬；按代表那段重算好的题进待审清单", () => {
    const r = C.consolidateReading(banks(P_REP, [ssQ(P_COPY)]), { holds: [] }, { sentencePasses: new Map() });
    expect(r.clusters[0].skipped.map((s) => s.reason)).toEqual(["sentence_select_unaudited"]);
    expect(r.sentencePending).toHaveLength(1);
    expect(r.sentencePending[0]).toMatchObject({
      host: "real_ap_a_1_31", from: "real_ap_b_1_31", hash: SS.auditHash(STEM, P_REP),
      question: { merged_from: "real_ap_b_1_31", correct_answer: "S3", paragraph: 1 },
    });
  });

  test("名额已满时没审过的选句题不进待审清单（审过了也会被 over_cap 挡住，白审）", () => {
    const own = [31, 32, 33, 35, 36].map((n) => q(n, `Own question number ${n} here?`));
    const r = C.consolidateReading(banks(P_REP, [ssQ(P_COPY)], own), { holds: [] }, { sentencePasses: new Map() });
    expect(r.clusters[0].skipped.map((s) => s.reason)).toEqual(["sentence_select_unaudited"]);
    expect(r.sentencePending).toEqual([]);
    // 审过之后确实是被名额挡住
    const r2 = C.consolidateReading(banks(P_REP, [ssQ(P_COPY)], own), { holds: [] }, { sentencePasses: passes(P_REP) });
    expect(r2.clusters[0].skipped.map((s) => s.reason)).toEqual(["over_cap"]);
  });

  test("代表第 N 段里没有这一句（另一版文章换了措辞）→ sentence_select_sentence_not_in_rep", () => {
    const r = C.consolidateReading(banks(P_OTHER, [ssQ(P_COPY)]), { holds: [] }, { sentencePasses: passes(P_OTHER) });
    expect(r.clusters[0].skipped.map((s) => s.reason)).toEqual(["sentence_select_sentence_not_in_rep"]);
  });

  test("代表自己已有同题干的选句题 → duplicate_stem", () => {
    const r = C.consolidateReading(banks(P_REP, [ssQ(P_COPY)], [ssQ(P_REP, 29)]), { holds: [] }, { sentencePasses: passes(P_REP) });
    expect(r.clusters[0].skipped.map((s) => s.reason)).toEqual(["duplicate_stem"]);
  });

  test("代表自己没审过的选句题不占 5 题名额（落盘时会被上线闸摘掉）", () => {
    const own = [...[31, 32, 33, 35].map((n) => q(n, `Own question number ${n} here?`)), ssQ(P_REP, 29)];
    const r = C.consolidateReading(banks(P_REP, [q(11, "Why does the author mention commuting hours?")], own), { holds: [] }, { sentencePasses: new Map() });
    expect(r.clusters[0].merged.map((m) => m.q_number)).toEqual([11]);
    // 同一道选句题审过了就占名额 → 满 5，挡住
    const r2 = C.consolidateReading(banks(P_REP, [q(11, "Why does the author mention commuting hours?")], own), { holds: [] }, { sentencePasses: passes(P_REP) });
    expect(r2.clusters[0].skipped.map((s) => s.reason)).toEqual(["over_cap"]);
  });
});

/* ── 产物形状 / 幂等 ──────────────────────────────────────────────────── */

describe("产物：题序、记账、幂等", () => {
  const build = () => ({ ap: [
    ap("real_ap_a_1_31", { date: "2026-03-01", paras: [body(EXTRA_A)], questions: [q(33, "Q gamma?"), q(31, "Q alpha?")] }),
    ap("real_ap_b_1_31", { date: "2026-04-01", paras: [body(EXTRA_B)], truncated: true, questions: [q(35, "Q epsilon?")] }),
    ap("real_ap_c_1_31", { date: "2026-02-01", paras: [body(EXTRA_B)], truncated: true, questions: [q(34, "Q delta?")] }),
  ] });

  test("代表自有题按 q_number 升序在前，并入题按（来源日期, q_number）在后，带 merged_from", () => {
    const r = run(build());
    expect(stems(r.ap[0])).toEqual(["Q alpha?", "Q gamma?", "Q delta?", "Q epsilon?"]);
    expect(r.ap[0].questions.map((x) => x.merged_from || null)).toEqual([null, null, "real_ap_c_1_31", "real_ap_b_1_31"]);
    expect(r.ap[0].questions.map((x) => x.q_number)).toEqual([31, 33, 34, 35]);   // 原题号保留
  });

  test("summary 记账对得上", () => {
    const r = run(build());
    expect(r.summary).toMatchObject({ clusters: 1, dropped: 2, merged: 2, conflicts: 0 });
  });

  test("clusters 按 kept id 升序（重建 diff 才稳定）", () => {
    const other = "deep ocean hydrothermal vents support chemosynthetic communities living beside superheated mineral plumes far beneath sunlight";
    const r = run({ ap: [
      ap("real_ap_z_1_31", { title: "Vents", paras: [`${other} alpha.`], questions: [q(31, "Q one?")] }),
      ap("real_ap_z2_1_31", { title: "Vents", paras: [`${other} alpha beta.`], questions: [q(32, "Q two?")] }),
      ...build().ap,
    ] });
    expect(r.clusters.map((c) => c.kept)).toEqual([...r.clusters.map((c) => c.kept)].sort());
    expect(r.clusters).toHaveLength(2);
  });

  test("幂等：对合并过的产物再跑一遍是 no-op", () => {
    const first = run(build());
    const snapshot = JSON.stringify(first.ap);
    const second = C.consolidateReading({ ap: first.ap, rdl: first.rdl }, { holds: [] });
    expect(second.clusters).toEqual([]);
    expect(second.summary).toMatchObject({ clusters: 0, dropped: 0, merged: 0 });
    expect(JSON.stringify(second.ap)).toBe(snapshot);
    expect(ids(second.ap)).toEqual(ids(first.ap));
  });

  test("单条簇什么都不做（没有同篇副本时不该产生记录）", () => {
    const r = run({ ap: [ap("real_ap_a_1_31", { questions: [q(31, "Q alpha?")] })] });
    expect(r.clusters).toEqual([]);
    expect(r.summary).toMatchObject({ clusters: 0, dropped: 0, merged: 0 });
  });

  test("空库 / 缺字段不抛", () => {
    expect(() => C.consolidateReading({}, undefined)).not.toThrow();
    const r = C.consolidateReading({ ap: [], rdl: [] }, { holds: [] });
    expect(r).toMatchObject({ ap: [], rdl: [], clusters: [] });
  });
});
