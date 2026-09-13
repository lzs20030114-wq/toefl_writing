/**
 * 真题 AP 题型推断（scripts/realbank/question_type.js）+ 前端中文标签
 * （lib/reading/questionTypeLabels.js）的锁。
 *
 * 为什么要锁：结构化产物从不带 question_type，build_bank 以前一律落成 "detail"，
 * 前端把它原样印在题号行上 —— 385 道 AP 题全是 "(detail)"，等于没有标签。
 * 现在按题干句式推回题型，推错了用户就会看到错的题型名（比没标签更糟），
 * 所以规则的**优先级**必须逐条钉死：调换任意两条规则的顺序，下面就有用例报红。
 */
const { AP_QUESTION_TYPES, inferApQuestionType, apQuestionType } = require("../scripts/realbank/question_type.js");
const { questionTypeLabel, QUESTION_TYPE_LABELS } = require("../lib/reading/questionTypeLabels");

describe("inferApQuestionType：按题干句式推题型", () => {
  const CASES = [
    // ── 句式唯一、不会被别的规则误吃的三条 ──
    ['The word "grappling" in the passage is closest in meaning to', "vocabulary_in_context"],
    ['The phrase "in the long run" in paragraph 2 is closest in meaning to', "vocabulary_in_context"],
    ['The word "it" in paragraph 3 refers to', "reference"],
    ["There are four locations in the passage that indicate where the following sentence could be added", "insert_text"],
    ["Look at the four squares [A]-[D]. Where would the sentence best fit?", "insert_text"],
    // ── 否定细节：EXCEPT / NOT xxx ──
    ["All of the following can be done at the front desk EXCEPT", "negative_factual"],
    ["Which of the following is NOT mentioned as a strategy for addressing AMR?", "negative_factual"],
    // 「EXCEPT 必须排在 infer/suggest 前面」的证据：这句两边都沾，正确答案是否定细节
    ["Advanced computer models suggest all of the following about Earth's core EXCEPT:", "negative_factual"],
    // ── 推断：注意这句里的 "mentioned" 前面没有 NOT，不许落否定细节 ──
    ["What can be inferred about noise pollution in the European cities mentioned in the passage?", "inference"],
    ["The passage implies that competitive athletes may most benefit from static stretching when they", "inference"],
    // ── 修辞目的：「in order to」必须带作者/修辞语境词才算 ──
    ["Why does the author mention public speaking?", "rhetorical_purpose"],
    ["The author discusses the 1918 flu in order to illustrate which point?", "rhetorical_purpose"],
    ["The example of the beaver dam is included in order to show what?", "rhetorical_purpose"],
    // 反例：同样带 in order to，问的却是事实（轮作是为了什么），不是「作者为什么这么写」
    ["According to the passage, farmers rotate crops in order to", "factual_detail"],
    // ── 主旨 ──
    ["What is the main purpose of the passage?", "main_idea"],
    ["Which of the following would be the best title for the passage?", "main_idea"],
    // ── 段落关系 ──
    ["What is the relationship between paragraph 2 and 1?", "paragraph_relationship"],
    ["How does paragraph 3 relate to paragraph 2?", "paragraph_relationship"],
    ["What is the relationship between paragraphs 2 and 3?", "paragraph_relationship"],
    // ── 选句（真题特有）：题干里带 "paragraph N"，但不该被段落关系题挑走 ──
    ["Identify the sentence in paragraph 4 that best summarizes the author's argument.", "sentence_selection"],
    // 「Which sentence in paragraph N …」同属选句（第二来源拍成 A–D 的那种），以前误落细节题
    ["Which sentence in paragraph 3 describes a specific criticism of computer models of the inner core?", "sentence_selection"],
    // 选句是作答形式：题干后半截带 suggests / NOT 也不许被推断题、否定细节题吃掉
    ["Identify the sentence in paragraph 2 that suggests the author doubts the claim.", "sentence_selection"],
    // ── 问「某一段的作用」是修辞目的题（以前落细节题 / 主旨题）──
    ["What is the purpose of the first paragraph?", "rhetorical_purpose"],
    ["What is the main purpose of paragraph 3?", "rhetorical_purpose"],
    ["Which of the following best describes the main purpose of paragraph 1?", "rhetorical_purpose"],
    // 反例：问整篇 / 整份材料的 main purpose 仍是主旨题
    ["What is the main purpose of the email?", "main_idea"],
    // ── 整篇的目的 → 主旨题（passage 级），别和上面的段落目的（paragraph 级 → 修辞目的）弄混 ──
    ["What is the purpose of the passage?", "main_idea"],
    ["The primary purpose of the passage is to", "main_idea"],
    ["What is the main purpose of the passage", "main_idea"],
    ["What is the primary purpose of paragraph 2?", "rhetorical_purpose"],       // 段落级：不被 primary purpose 吃走
    // 反例：「purpose of + 具体事物」是细节题，不是主旨题
    ["According to the passage, what is the purpose of repeatedly simulating various modifications?", "factual_detail"],
    ["What is the purpose of green infrastructure like parks and green roofs?", "factual_detail"],
    // ── 回落细节 ──
    ["How do green walls help control noise pollution?", "factual_detail"],
    ["According to the passage, what is ITER's primary objective?", "factual_detail"],  // primary ≠ primarily
    ["What is Health Geek?", "factual_detail"],
    ["", "factual_detail"],
  ];

  test.each(CASES)("%s → %s", (stem, want) => {
    expect(inferApQuestionType(stem)).toBe(want);
  });

  test("输出一定落在 AP 题型全集里", () => {
    for (const [stem] of CASES) expect(AP_QUESTION_TYPES).toContain(inferApQuestionType(stem));
  });

  test("题型全集 = apValidator 的 9 种 + 真题特有的选句题", () => {
    // lib/readingGen/apValidator.js 的 VALID_QUESTION_TYPES（AI 生成题用的那套）没有导出，
    // 这里按值对齐；那边加题型时这条会提醒同步。
    expect([...AP_QUESTION_TYPES].sort()).toEqual([
      "factual_detail", "inference", "insert_text", "main_idea", "negative_factual",
      "paragraph_relationship", "reference", "rhetorical_purpose", "sentence_selection", "vocabulary_in_context",
    ]);
  });

  test("认不出来也不抛：null / 数字 / 纯符号一律回落细节题", () => {
    expect(inferApQuestionType(null)).toBe("factual_detail");
    expect(inferApQuestionType(undefined)).toBe("factual_detail");
    expect(inferApQuestionType(123)).toBe("factual_detail");
    expect(inferApQuestionType("   ")).toBe("factual_detail");
  });
});

describe("apQuestionType：落库口径（人写的优先于我们猜的）", () => {
  test("缺失 / 占位值 detail → 推断", () => {
    expect(apQuestionType(undefined, "Why does the author mention public speaking?")).toBe("rhetorical_purpose");
    expect(apQuestionType("", "Why does the author mention public speaking?")).toBe("rhetorical_purpose");
    expect(apQuestionType("detail", 'The word "grappling" in the passage is closest in meaning to')).toBe("vocabulary_in_context");
  });

  test("源料已经给了题型就原样沿用，不覆盖", () => {
    expect(apQuestionType("insert_text", "How do green walls help control noise pollution?")).toBe("insert_text");
    expect(apQuestionType("main_idea", "anything")).toBe("main_idea");
  });
});

describe("questionTypeLabel：题型的中文标签", () => {
  test("每个 AP 题型都有中文名", () => {
    for (const t of AP_QUESTION_TYPES) {
      const label = questionTypeLabel(t);
      expect(label).not.toBe(t);                  // 没漏配（漏了会原样回落成英文枚举）
      expect(/[一-龥]/.test(label)).toBe(true);
    }
  });

  test("占位值 detail 也认（旧库里还有）", () => {
    expect(questionTypeLabel("detail")).toBe("细节");
    expect(questionTypeLabel("factual_detail")).toBe("细节");
    expect(questionTypeLabel("sentence_selection")).toBe("选句");
  });

  test("认不出的类型原样返回（不吞掉，屏幕上能直接看见新枚举）", () => {
    expect(questionTypeLabel("brand_new_type")).toBe("brand_new_type");
  });

  test("空值回落空串 —— 调用方据此决定要不要渲染括号", () => {
    expect(questionTypeLabel("")).toBe("");
    expect(questionTypeLabel(null)).toBe("");
    expect(questionTypeLabel(undefined)).toBe("");
  });

  test("映射表是只读约定：键全是小写下划线枚举", () => {
    for (const k of Object.keys(QUESTION_TYPE_LABELS)) expect(k).toMatch(/^[a-z_]+$/);
  });
});
