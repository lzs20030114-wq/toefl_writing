import {
  numberSentences,
  buildEvidence,
  buildQaMessage,
  parseAnswer,
  citationStats,
  pickRelatedMistakes,
  locateSentence,
  askedEnglishTerm,
  conversationKey,
  QA_MAX_MESSAGE_CHARS,
} from "../lib/qa/questionQa";

const PASSAGE = "Farmers use cover crops. These plants anchor the soil at 7 a.m. daily.\n\nDr. Lee disagrees. She says yields fall.";

const DETAIL = {
  qid: "ap_1-q0",
  stem: "The word \"anchor\" is closest in meaning to",
  options: { A: "fertilize", B: "stabilize" },
  selected: "A",
  correct: "B",
  passage: PASSAGE,
  question: { question_type: "vocabulary_in_context" },
};

describe("numberSentences", () => {
  test("按段按句连续编号，缩写不切断", () => {
    const s = numberSentences(PASSAGE);
    expect(s.map((x) => x.id)).toEqual(["S1", "S2", "S3", "S4"]);
    expect(s[1].text).toBe("These plants anchor the soil at 7 a.m. daily.");
    expect(s[2]).toMatchObject({ para: 2, text: "Dr. Lee disagrees." });
  });
  test("空原文返回空数组", () => {
    expect(numberSentences("")).toEqual([]);
  });
});

describe("buildEvidence", () => {
  test("原文带句号、题型中文名、作答与标准答案写全", () => {
    const { text, sentences, materials } = buildEvidence(DETAIL);
    expect(sentences).toHaveLength(4);
    expect(text).toContain("[S2] These plants anchor the soil");
    expect(text).toContain("（第 2 段）");
    expect(text).toContain("题型：词汇（vocabulary_in_context）");
    expect(text).toContain("学生作答：A. fertilize");
    expect(text).toContain("标准答案：B. stabilize");
    expect(text).not.toContain("参考解析");
    expect(materials).toEqual([DETAIL.stem, "fertilize", "stabilize"]);
  });

  test("未作答写明；同类错题列编号；本题错过多次单独写", () => {
    const related = {
      total: 5,
      sameQuestionWrongCount: 2,
      items: [{ stem: "x", userAnswer: "C. y", correctAnswer: "D. z", wrongCount: 2, date: "2026-10-01" }],
    };
    const { text } = buildEvidence({ ...DETAIL, selected: null }, related);
    expect(text).toContain("学生作答：未作答");
    expect(text).toContain("同题型共 5 道");
    expect(text).toContain("[错题1] 2026-10-01");
    expect(text).toContain("这道题学生累计错过 2 次");
  });

  test("老记录正文糊成一坨时，按 paragraphs 补回段落", () => {
    const flat = PASSAGE.replace(/\n\n/, " ");
    const paragraphs = PASSAGE.split("\n\n");
    expect(buildEvidence({ ...DETAIL, passage: flat }).sentences.every((s) => s.para === 1)).toBe(true);
    const { sentences } = buildEvidence({ ...DETAIL, passage: flat, paragraphs });
    expect(sentences.map((s) => s.para)).toEqual([1, 1, 2, 2]);
  });

  test("选句题：选项键 S1..Sn 不原样出现，换成句子原文并对回原文句号", () => {
    const detail = {
      stem: "Which sentence in paragraph 2 shows the critic's view?",
      question: { question_type: "sentence_selection", options: { S1: "Dr. Lee disagrees.", S2: "She says yields fall." } },
      selected: "S2",
      correct: "S1",
      passage: PASSAGE,
    };
    const { text } = buildEvidence(detail);
    expect(text).toContain("学生选的句子：[S4] She says yields fall.");
    expect(text).toContain("正确句子：[S3] Dr. Lee disagrees.");
    expect(text).not.toMatch(/学生作答|标准答案/);
  });
});

describe("pickRelatedMistakes", () => {
  const card = (stem, type, at, extra = {}) => ({
    subject: "reading", subtype: "ap", brief: { stem, type, userAnswer: "A", correctAnswer: "B" }, lastWrongAt: at, wrongCount: 1, ...extra,
  });
  test("同题型、同小类、排除本题、最近优先、最多 3 道", () => {
    const cards = [
      card("q1", "detail", "2026-10-01"),
      card("q2", "detail", "2026-10-05"),
      card("q3", "inference", "2026-10-06"),
      card("current", "detail", "2026-10-07", { wrongCount: 3 }),
      card("q4", "detail", "2026-09-01"),
      card("q5", "detail", "2026-09-02"),
      card("q6", "detail", "2026-10-09", { subject: "listening" }),
      card("q7", "detail", "2026-10-10", { subtype: "rdl" }),
    ];
    const r = pickRelatedMistakes(cards, { questionType: "detail", subtype: "ap", stem: "current" });
    expect(r.total).toBe(4);
    expect(r.sameQuestionWrongCount).toBe(3);
    expect(r.items.map((x) => x.stem)).toEqual(["q2", "q1", "q5"]);
  });
  test("没有题型时不取同类题，但仍报本题错次", () => {
    const r = pickRelatedMistakes([card("a", "detail", "x", { wrongCount: 2 }), card("b", "detail", "y")], { stem: "a" });
    expect(r).toEqual({ total: 0, sameQuestionWrongCount: 2, items: [] });
  });
});

describe("buildQaMessage", () => {
  test("带选区、词典、历史；超长时从最早的问答开始丢，证据包不丢", () => {
    const history = Array.from({ length: 6 }, (_, i) => ({ q: `问${i}`, a: "答".repeat(6000) }));
    const msg = buildQaMessage({
      evidence: "EVIDENCE",
      firstExplain: "FIRST",
      history,
      question: "这个词什么意思？",
      selection: { kind: "word", text: "anchor", sentenceId: "S2" },
      dict: { word: "anchor", p: "ˈæŋkə", t: "n. 锚\nv. 使稳固" },
    });
    expect(msg.length).toBeLessThanOrEqual(QA_MAX_MESSAGE_CHARS);
    expect(msg).toContain("EVIDENCE");
    expect(msg).toContain("FIRST");
    expect(msg).toContain("【词典】（ECDICT）anchor /ˈæŋkə/：n. 锚；v. 使稳固");
    expect(msg).toContain("学生选中的词（原文 S2）：\"anchor\"");
    expect(msg).not.toContain("问0");
    expect(msg).toContain("问5");
  });
});

describe("parseAnswer", () => {
  const sentences = numberSentences(PASSAGE);
  const cites = (segs) => segs.filter((s) => s.type === "cite").map((c) => [c.id, c.valid]);

  test("合法出处、越界出处、紧跟出处的引文对不上", () => {
    const segs = parseAnswer("原文说 \"anchor the soil\" [S2]，但 [S9] 不存在；\"yields rise\" [S4]。依据 [答案] 和 [词典]，你上次 [错题1] 也是。", sentences);
    expect(cites(segs)).toEqual([["S2", true], ["S9", false], ["S4", false], ["答案", true], ["词典", true], ["错题1", true]]);
    expect(segs.find((s) => s.id === "S2").sentence).toContain("anchor the soil");
    // 原文完整拼回（不丢字）
    expect(segs.map((s) => (s.type === "cite" ? `{${s.id}}` : s.text)).join("")).toBe(
      "原文说 \"anchor the soil\" {S2}，但 {S9} 不存在；\"yields rise\" {S4}。依据 {答案} 和 {词典}，你上次 {错题1} 也是。"
    );
  });

  test("引文只绑紧挨着的出处：出处在前、引文在后，不连累下一条出处", () => {
    const segs = parseAnswer("原文 [S2] 说 \"anchor the soil\"，而 [S4] 讲的是产量。", sentences);
    expect(cites(segs)).toEqual([["S2", true], ["S4", true]]);
  });

  test("引文在原文 / 选项里都找不到 → quote 段标为未核实", () => {
    const segs = parseAnswer("选项 \"fertilize\" 不对，原文没说 \"plants grow faster\"。", sentences, buildEvidence(DETAIL).materials);
    const quotes = segs.filter((s) => s.type === "quote").map((q) => [q.text, q.valid]);
    expect(quotes).toEqual([["\"fertilize\"", true], ["\"plants grow faster\"", false]]);
    expect(citationStats(segs)).toEqual({ cites: 0, badCites: 0, badQuotes: 1 });
  });

  test("区间、并列、全角括号都认", () => {
    const c = parseAnswer("见 [S1-S3] 与 [S2, S4]，还有【S1】", sentences).filter((s) => s.type === "cite");
    expect(c.map((x) => x.id)).toEqual(["S1", "S2", "S3", "S2", "S4", "S1"]);
    expect(c.every((x) => x.valid)).toBe(true);
  });

  test("引文忽略大小写与标点", () => {
    expect(cites(parseAnswer("“Dr Lee DISAGREES” [S3]", sentences))).toEqual([["S3", true]]);
  });
});

test("locateSentence 找到选中文字所在句", () => {
  const s = numberSentences(PASSAGE);
  expect(locateSentence(s, "yields fall")).toBe("S4");
  expect(locateSentence(s, "nothing here")).toBeNull();
});

test("askedEnglishTerm 只在问一个原文里出现过的英文词 / 短语时返回", () => {
  const s = numberSentences(PASSAGE);
  expect(askedEnglishTerm("anchor 在这里什么意思", s)).toBe("anchor");
  expect(askedEnglishTerm("cover crops 是什么", s)).toBe("cover crops");
  expect(askedEnglishTerm("banana 是什么", s)).toBeNull();
  expect(askedEnglishTerm("anchor 和 soil 有什么关系", s)).toBeNull();
  expect(askedEnglishTerm("这句话什么意思", s)).toBeNull();
});

test("conversationKey 与阅读讲解缓存同口径", () => {
  expect(conversationKey(DETAIL)).toBe(`ap_1-q0|${DETAIL.stem}|||A|||B`);
});
