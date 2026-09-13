/**
 * lib/realBank.js 的选择题 mapper × 选句题（sentence_selection）放行 / 拒收契约。
 *
 * 契约（lib/reading/sentenceSelection.js）：
 *   paragraph 为 ≥1 整数（题干段号，只管展示）；paragraph_index 为 ≥0 整数且 < paragraphs.length（缺失即拒收，
 *   定位一律按它）；options 键恰为 S1..Sn 连续且 n≥2、值非空；correct_answer 在键里；
 *   每句能在 paragraphs[paragraph_index] 里按序找到，且该段在正文里定位得到。
 * 不合格只丢这一道选句题；四选一题的老规矩（任一题坏 = 整条作废）不变。
 *
 * 题库 JSON 换成 fixture（真题 real_ap_128a_1_27 的真实段落 + 手造第 4 段选句题），
 * 与真数据脱钩 —— 真库形状由 __tests__/real-bank-reading-data.test.js 把关。
 */

jest.mock("../data/realBank/reading/ap.json", () => {
  const fx = require("./fixtures/real-ap-sentence-selection.json");
  const base = fx.items[0];
  const [mcq, vocab, ss] = base.questions;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const { paragraph_index: _dropped, ...ssWithoutIndex } = clone(ss);
  // 「第 0 段不是标题」的篇目：同一篇去掉标题段 —— 题干第 4 段 = paragraphs[3]
  const body = base.paragraphs.slice(1);
  const noTitle = { ...clone(base), passage: body.join("\n\n"), paragraphs: body };
  return {
    tier: "recalled",
    items: [
      // 1) 合规：四选一 + 词汇 + 选句全收
      { ...clone(base), id: "real_ap_mapper_ok_1_27" },
      // 2) 选句题有一句不在该段里 → 只丢选句题，条目与另外两题保留
      {
        ...clone(base),
        id: "real_ap_mapper_badss_1_27",
        questions: [clone(mcq), clone(vocab), { ...clone(ss), options: { ...ss.options, S3: "They work by passively reducing sound vibrations." } }],
      },
      // 3) 唯一一道题是缺 paragraph_index 的选句题 → 拒收该题，丢完一题不剩，整条作废
      { ...clone(base), id: "real_ap_mapper_onlybad_1_29", questions: [ssWithoutIndex] },
      // 4) 四选一题少一个选项（老规矩）→ 整条作废，好的选句题也救不回来
      {
        ...clone(base),
        id: "real_ap_mapper_badmcq_1_27",
        questions: [{ ...clone(mcq), options: { A: "x", B: "y", C: "z" } }, clone(ss)],
      },
      // 5) 第 0 段不是标题：paragraph=4 ↔ paragraph_index=3 → 收
      {
        ...clone(noTitle),
        id: "real_ap_mapper_notitle_2_11",
        questions: [clone(mcq), { ...clone(ss), paragraph: 4, paragraph_index: 3 }],
      },
      // 6) 同一篇按「题干段号当下标」写成 paragraph_index=4（= paragraphs.length，越界）→ 只丢选句题
      {
        ...clone(noTitle),
        id: "real_ap_mapper_notitle_oldindex_2_12",
        questions: [clone(mcq), { ...clone(ss), paragraph: 4, paragraph_index: 4 }],
      },
      // 7) 源 paragraphs 里有个空段：映射不滤空，paragraph_index 仍按源数组下标（5）对齐
      {
        ...clone(base),
        id: "real_ap_mapper_emptyslot_1_27",
        paragraphs: [base.paragraphs[0], "", ...body],
        questions: [{ ...clone(ss), paragraph: 4, paragraph_index: 5 }],
      },
      // 8) 第二来源拍成 A–D 的选句题：题型按题干推断也是 sentence_selection，但选项是 A–D、没有 paragraph_index
      //    → 按普通四选一收下（不是点选句子），条目与另一题都保留
      {
        ...clone(base),
        id: "real_ap_mapper_abcd_sentence_2_31",
        questions: [
          clone(mcq),
          {
            question_type: "sentence_selection",
            stem: "Which sentence in paragraph 4 names a place where noise-canceling materials are used?",
            options: {
              A: "Advancements in technology have also led to the creation of noise cancelling materials.",
              B: "Such materials are often used on buildings or road surfaces.",
              C: "They work by actively reducing sound vibrations.",
              D: "Urban planners can use these materials to design cities more effectively.",
            },
            correct_answer: "B",
          },
        ],
      },
    ],
  };
});

jest.mock("../data/realBank/reading/rdl.json", () => ({
  tier: "recalled",
  items: [
    {
      // RDL 不带 paragraphs：按空行切 text（标题行也算一段）—— paragraph_index 1 是 "Please note…" 那段
      id: "real_rdl_mapper_ss_1_21",
      genre: "notice",
      text: "Library Notice\n\nPlease note the new hours. The library opens at nine. It closes at six.\n\nQuestions? Ask at the desk.",
      questions: [
        {
          question_type: "sentence_selection",
          stem: "Identify the sentence in paragraph 1 that states the closing time.",
          paragraph: 1,
          paragraph_index: 1,
          options: { S1: "Please note the new hours.", S2: "The library opens at nine.", S3: "It closes at six." },
          correct_answer: "S3",
        },
      ],
      format_metadata: {},
    },
    {
      // 带 paragraphs 的 RDL（例如从学术阅读归位过来）：下标按它的数组算，不按空行切 text
      // （这里数组不含标题行，按空行切的话 0 号段是 "Library Notice"，那样定位不到）。
      id: "real_rdl_mapper_ss_paras_1_22",
      genre: "notice",
      text: "Library Notice\n\nPlease note the new hours. The library opens at nine. It closes at six.\n\nQuestions? Ask at the desk.",
      paragraphs: ["Please note the new hours. The library opens at nine. It closes at six.", "Questions? Ask at the desk."],
      questions: [
        {
          question_type: "sentence_selection",
          stem: "Identify the sentence in paragraph 1 that states the closing time.",
          paragraph: 1,
          paragraph_index: 0,
          options: { S1: "Please note the new hours.", S2: "The library opens at nine.", S3: "It closes at six." },
          correct_answer: "S3",
        },
      ],
      format_metadata: {},
    },
  ],
}));

import FIXTURE from "./fixtures/real-ap-sentence-selection.json";
import { getRealAPItems, getRealRDLItems } from "../lib/realBank";
import {
  isSentenceSelection,
  locateParagraph,
  normalizeSentenceSelection,
  readingParagraphs,
  selectionParagraphIndex,
  sentenceOptionKeys,
  sentenceSelectionLayout,
  sentenceSelectionSegments,
} from "../lib/reading/sentenceSelection";

const RAW = FIXTURE.items[0];
const SS = RAW.questions[2];
const MATERIAL = { passage: RAW.passage, paragraphs: RAW.paragraphs };
const BODY = RAW.paragraphs.slice(1);
const NO_TITLE = { passage: BODY.join("\n\n"), paragraphs: BODY };
const withSS = (patch) => ({ ...JSON.parse(JSON.stringify(SS)), ...patch });

describe("normalizeSentenceSelection：放行", () => {
  test("合规题原样放行（只留契约字段，paragraph / paragraph_index 保持整数）", () => {
    expect(SS.paragraph_index).toBe(4);
    expect(normalizeSentenceSelection(SS, MATERIAL)).toEqual({
      question_type: "sentence_selection",
      stem: SS.stem,
      paragraph: 4,
      paragraph_index: 4,
      options: SS.options,
      correct_answer: "S2",
    });
  });

  test("paragraphs[0] 不是标题：题干第 4 段 = paragraph_index 3 → 放行，定位到的就是第 4 段正文", () => {
    const q = withSS({ paragraph: 4, paragraph_index: 3 });
    expect(normalizeSentenceSelection(q, NO_TITLE)).toMatchObject({ paragraph: 4, paragraph_index: 3 });
    const layout = sentenceSelectionLayout(NO_TITLE, q);
    expect(layout).toMatchObject({ paragraph: 4, paragraphIndex: 3 });
    expect(NO_TITLE.passage.slice(layout.start, layout.end)).toBe(BODY[3]);
  });

  test("定位只看 paragraph_index：题干段号写几都只影响展示", () => {
    const out = normalizeSentenceSelection(withSS({ paragraph: 2 }), MATERIAL);
    expect(out).toMatchObject({ paragraph: 2, paragraph_index: 4 });
    expect(sentenceSelectionLayout(MATERIAL, out)).toMatchObject({ paragraph: 2, paragraphIndex: 4 });
  });

  test("correct_answer 小写 s2 归一成 S2；explanation 透传", () => {
    const out = normalizeSentenceSelection(withSS({ correct_answer: "s2", explanation: " why " }), MATERIAL);
    expect(out.correct_answer).toBe("S2");
    expect(out.explanation).toBe("why");
  });

  test("2 句也算（句数不定，不是固定四项）", () => {
    const q = withSS({ paragraph: 1, paragraph_index: 1, options: {
      S1: "Urban areas across the globe are grappling with the challenge of noise pollution.",
      S2: "This type of pollution can severely impact health, leading to sleep disturbances and cardiovascular problems.",
    }, correct_answer: "S1" });
    expect(normalizeSentenceSelection(q, MATERIAL)).not.toBeNull();
  });

  test("S10 排在 S9 后面（按序号而不是字典序定位）", () => {
    const words = Array.from({ length: 10 }, (_, i) => `Sentence number ${i + 1} is here.`);
    const text = `Title\n\n${words.join(" ")}`;
    const options = Object.fromEntries(words.map((w, i) => [`S${i + 1}`, w]));
    // 故意打乱对象键顺序
    const shuffled = Object.fromEntries(Object.entries(options).reverse());
    const q = { question_type: "sentence_selection", stem: "Identify…", paragraph: 1, paragraph_index: 1, options: shuffled, correct_answer: "S10" };
    expect(sentenceOptionKeys(shuffled)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10"]);
    expect(normalizeSentenceSelection(q, { text })).not.toBeNull();
  });

  test("没有 paragraphs 时按空行切正文（下标从 0 起，开头的标题行也算一段）", () => {
    expect(readingParagraphs({ text: RAW.passage })).toEqual(RAW.paragraphs);
    expect(normalizeSentenceSelection(SS, { text: RAW.passage })).not.toBeNull();
  });
});

describe("normalizeSentenceSelection：拒收", () => {
  test.each([
    ["paragraph = 0", { paragraph: 0 }],
    ["paragraph 为负", { paragraph: -1 }],
    ["paragraph 非整数", { paragraph: 4.5 }],
    ["paragraph 是字符串", { paragraph: "4" }],
    ["paragraph 缺失", { paragraph: undefined }],
    ["paragraph_index 缺失", { paragraph_index: undefined }],
    ["paragraph_index 为 null", { paragraph_index: null }],
    ["paragraph_index 为负", { paragraph_index: -1 }],
    ["paragraph_index 非整数", { paragraph_index: 3.5 }],
    ["paragraph_index 是字符串", { paragraph_index: "4" }],
    ["paragraph_index = paragraphs.length", { paragraph_index: 5 }],
    ["paragraph_index 越界", { paragraph_index: 9 }],
    ["paragraph_index 指到别的段（句子不在该段）", { paragraph_index: 3 }],
    ["键不连续（缺 S3）", { options: { S1: SS.options.S1, S2: SS.options.S2, S4: SS.options.S4 } }],
    ["不从 S1 起", { options: { S2: SS.options.S1, S3: SS.options.S2 }, correct_answer: "S2" }],
    ["只有 1 句", { options: { S1: SS.options.S1 }, correct_answer: "S1" }],
    ["混进非 S 键", { options: { ...SS.options, A: "extra" } }],
    ["小写 s 键", { options: { s1: SS.options.S1, s2: SS.options.S2 }, correct_answer: "S1" }],
    ["某句为空", { options: { ...SS.options, S3: "   " } }],
    ["答案不在键里", { correct_answer: "S5" }],
    ["答案是字母", { correct_answer: "A" }],
    ["某句改了一个词（不是精确子串）", { options: { ...SS.options, S3: "They work by passively reducing sound vibrations." } }],
    ["句内空白被改（精确子串，空白原样）", { options: { ...SS.options, S3: "They work by  actively reducing sound vibrations." } }],
    ["句子顺序颠倒", { options: { S1: SS.options.S2, S2: SS.options.S1, S3: SS.options.S3, S4: SS.options.S4 } }],
    ["题干为空", { stem: "  " }],
  ])("%s", (_name, patch) => {
    expect(normalizeSentenceSelection(withSS(patch), MATERIAL)).toBeNull();
  });

  test("字段整个没写（JSON 里无 paragraph_index）→ 拒收，不拿 paragraph 去猜", () => {
    const { paragraph_index: _drop, ...noIndex } = withSS({});
    expect("paragraph_index" in noIndex).toBe(false);
    expect(normalizeSentenceSelection(noIndex, MATERIAL)).toBeNull();
  });

  test("第 0 段不是标题的篇目，按「题干段号当下标」写成 4 → 越界拒收", () => {
    expect(normalizeSentenceSelection(withSS({ paragraph: 4, paragraph_index: 4 }), NO_TITLE)).toBeNull();
  });

  test("不是 sentence_selection 题型直接不认", () => {
    expect(normalizeSentenceSelection(withSS({ question_type: "detail" }), MATERIAL)).toBeNull();
  });

  test("段落数组里有这一段、但 passage 里找不到（组件圈不出来）→ 拒收", () => {
    const drifted = { passage: RAW.passage.replace("noise cancelling materials", "noise-canceling materials"), paragraphs: RAW.paragraphs };
    expect(normalizeSentenceSelection(SS, drifted)).toBeNull();
  });
});

describe("版面定位（mapper 与 RDLTask 共用）", () => {
  test("selectionParagraphIndex：有 paragraph_index 一律按它；非法 → -1 不猜；没写才按旧口径 paragraph", () => {
    const paras = RAW.paragraphs;
    expect(selectionParagraphIndex({ paragraph: 4, paragraph_index: 3 }, paras)).toBe(3);
    expect(selectionParagraphIndex({ paragraph: 4, paragraph_index: 9 }, paras)).toBe(-1);
    expect(selectionParagraphIndex({ paragraph: 4, paragraph_index: -1 }, paras)).toBe(-1);
    expect(selectionParagraphIndex({ paragraph: 4, paragraph_index: "3" }, paras)).toBe(-1);
    // 兼容：没经过 mapper 的调用方不带 paragraph_index
    expect(selectionParagraphIndex({ paragraph: 4 }, paras)).toBe(4);
    expect(selectionParagraphIndex({ paragraph: 4, paragraph_index: null }, paras)).toBe(4);
  });

  test("readingParagraphs 不滤空：下标与源数组对齐；全是空串才按空行切正文", () => {
    expect(readingParagraphs({ paragraphs: ["T", " ", "B"], passage: "x" })).toEqual(["T", "", "B"]);
    expect(readingParagraphs({ paragraphs: ["", " "], passage: "A\n\nB" })).toEqual(["A", "B"]);
  });

  test("locateParagraph 按顺序找段：定位到的就是 paragraphs[4] 在 passage 里的位置", () => {
    const span = locateParagraph(RAW.passage, RAW.paragraphs, 4);
    expect(RAW.passage.slice(span.start, span.end)).toBe(RAW.paragraphs[4]);
  });

  test("前面某段在 passage 里找不到（没带标题 / 复核只改了 passage）→ 退回直接找目标段", () => {
    const noTitlePassage = BODY.join("\n\n");
    const span = locateParagraph(noTitlePassage, RAW.paragraphs, 4);
    expect(noTitlePassage.slice(span.start, span.end)).toBe(RAW.paragraphs[4]);
  });

  test("空段不占位置；目标段本身是空串 → null", () => {
    const withGap = [RAW.paragraphs[0], "", ...BODY];
    const span = locateParagraph(RAW.passage, withGap, 5);
    expect(RAW.passage.slice(span.start, span.end)).toBe(BODY[3]);
    expect(locateParagraph(RAW.passage, withGap, 1)).toBeNull();
  });

  test("segments 拼回去 = 原文，句子与句间空白交替", () => {
    const layout = sentenceSelectionLayout({ text: RAW.passage, paragraphs: RAW.paragraphs }, SS);
    const { before, paragraph, after } = sentenceSelectionSegments(RAW.passage, layout);
    expect(before + paragraph.map((p) => p.text).join("") + after).toBe(RAW.passage);
    expect(paragraph.filter((p) => p.type === "sentence").map((p) => p.key)).toEqual(["S1", "S2", "S3", "S4"]);
    expect(paragraph.filter((p) => p.type === "text").every((p) => /^\s+$/.test(p.text))).toBe(true);
  });
});

describe("getRealAPItems / getRealRDLItems：选句题接线", () => {
  const ap = getRealAPItems();
  const byId = Object.fromEntries(ap.map((it) => [it.id, it]));

  test("合规条目：三题全收，选句题带 paragraph / paragraph_index 与 S1..S4", () => {
    const it = byId.real_ap_mapper_ok_1_27;
    expect(it).toBeTruthy();
    expect(it.questions.map((q) => q.question_type)).toEqual(["detail", "vocabulary_in_context", "sentence_selection"]);
    const ss = it.questions[2];
    expect(ss).toMatchObject({ paragraph: 4, paragraph_index: 4, correct_answer: "S2" });
    expect(Object.keys(ss.options)).toEqual(["S1", "S2", "S3", "S4"]);
    // paragraphs 透传（RDLTask 定位用），与体检用的是同一份
    expect(it.paragraphs).toEqual(RAW.paragraphs);
  });

  test("坏选句题只丢它自己：条目保留、四选一与词汇题都在", () => {
    const it = byId.real_ap_mapper_badss_1_27;
    expect(it).toBeTruthy();
    expect(it.questions.map((q) => q.question_type)).toEqual(["detail", "vocabulary_in_context"]);
  });

  test("缺 paragraph_index 拒收该题；丢完一题都不剩 → 整条作废", () => {
    expect(byId.real_ap_mapper_onlybad_1_29).toBeUndefined();
  });

  test("四选一题的老规矩不变：少一个选项 → 整条作废（好的选句题也不留）", () => {
    expect(byId.real_ap_mapper_badmcq_1_27).toBeUndefined();
  });

  test("第 0 段不是标题的篇目：paragraph=4 / paragraph_index=3 收；按段号写成 4 的只丢选句题", () => {
    const ok = byId.real_ap_mapper_notitle_2_11;
    expect(ok.questions.map((q) => q.question_type)).toEqual(["detail", "sentence_selection"]);
    expect(ok.questions[1]).toMatchObject({ paragraph: 4, paragraph_index: 3 });
    expect(ok.paragraphs[0]).toBe(BODY[0]);

    const old = byId.real_ap_mapper_notitle_oldindex_2_12;
    expect(old).toBeTruthy();
    expect(old.questions.map((q) => q.question_type)).toEqual(["detail"]);
  });

  test("源 paragraphs 有空段：映射不滤空（下标对齐），选句题按源下标 5 收下", () => {
    const it = byId.real_ap_mapper_emptyslot_1_27;
    expect(it).toBeTruthy();
    expect(it.paragraphs).toEqual([RAW.paragraphs[0], "", ...BODY]);
    expect(it.questions[0]).toMatchObject({ paragraph: 4, paragraph_index: 5 });
    expect(sentenceSelectionLayout({ ...it, text: it.passage }, it.questions[0])).toMatchObject({ paragraphIndex: 5 });
  });

  test("A–D 形式的选句题（题型 sentence_selection、选项 A–D）按普通四选一收下，不当点选句子", () => {
    const it = byId.real_ap_mapper_abcd_sentence_2_31;
    expect(it).toBeTruthy();
    expect(it.questions).toHaveLength(2);
    const q = it.questions[1];
    expect(q).toMatchObject({ question_type: "sentence_selection", correct_answer: "B" });
    expect(Object.keys(q.options)).toEqual(["A", "B", "C", "D"]);
    expect(isSentenceSelection(q)).toBe(false);
    expect(isSentenceSelection(it.questions[0])).toBe(false);
    // 真点选题照旧认得出来
    expect(isSentenceSelection(byId.real_ap_mapper_ok_1_27.questions[2])).toBe(true);
  });

  test("收下的条目总数（1、2、5、6、7、8；3 与 4 作废）", () => {
    expect(ap.map((it) => it.id).sort()).toEqual([
      "real_ap_mapper_abcd_sentence_2_31",
      "real_ap_mapper_badss_1_27",
      "real_ap_mapper_emptyslot_1_27",
      "real_ap_mapper_notitle_2_11",
      "real_ap_mapper_notitle_oldindex_2_12",
      "real_ap_mapper_ok_1_27",
    ]);
  });

  test("RDL：不带 paragraphs 按空行切 text 定位；带 paragraphs 按它的下标定位并透传", () => {
    const rdl = getRealRDLItems();
    const plain = rdl.find((it) => it.id === "real_rdl_mapper_ss_1_21");
    expect(plain.questions[0]).toMatchObject({ question_type: "sentence_selection", paragraph: 1, paragraph_index: 1, correct_answer: "S3" });
    expect("paragraphs" in plain).toBe(false);

    const withParas = rdl.find((it) => it.id === "real_rdl_mapper_ss_paras_1_22");
    expect(withParas.questions[0]).toMatchObject({ paragraph: 1, paragraph_index: 0 });
    expect(withParas.paragraphs).toHaveLength(2);
    expect(sentenceSelectionLayout(withParas, withParas.questions[0])).toMatchObject({ paragraphIndex: 0 });
  });
});
