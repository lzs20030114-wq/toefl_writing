const { postProcessLa, postProcessLat } = require("../lib/ai/prompts/questionExtraction");

// postProcessLa / postProcessLat: schema分档 for personal-bank LA (听公告) / LAT (学术讲座) import.
// announcement/transcript + questions[] (multi-question, unlike single-question LCR). 口径 (2026-07-04
// 研究 附录 C): body 空/过短 → invalid (LA<40 词 / LAT<80 词); 词数上限只警告; 题数区间外只警告
// (LA 1-3 / LAT 2-6); 每题 stem/选项缺 → 剔除+警示; answer 非 A-D → 归 null (verify 代解), 不废整条.
// 音频 never produced here.

// A valid-length (>=40 word) announcement.
const ANNO =
  "Attention all students. Please be aware that the main library will be closed this coming " +
  "Friday, March third, for scheduled maintenance work in Smith Hall. During this time, all " +
  "study rooms and computer labs on the second and third floors will also be unavailable. We " +
  "kindly ask that you plan to return any borrowed books by Thursday afternoon at the desk.";

function laQ(over = {}) {
  return {
    type: "main_idea",
    stem: "What is the announcement mainly about?",
    options: { A: "A library closure", B: "A new building", C: "A book sale", D: "A staff meeting" },
    answer: "A",
    ...over,
  };
}

function laBase(over = {}) {
  return { announcement: ANNO, questions: [laQ(), laQ({ type: "detail", answer: "B" })], ...over };
}

// A valid-length (>=80 word) transcript.
const TRANSCRIPT = Array.from(
  { length: 16 },
  (_, i) => `This is a meaningful lecture sentence number ${i} about the geology of ancient rocks.`
).join(" ");

function latQ(over = {}) {
  return {
    type: "main_idea",
    stem: "What is the lecture mainly about?",
    options: { A: "Rock geology", B: "Ocean tides", C: "Star maps", D: "Plant cells" },
    answer: "A",
    ...over,
  };
}

function latBase(over = {}) {
  return { transcript: TRANSCRIPT, questions: [latQ(), latQ({ answer: "B" }), latQ({ answer: "C" }), latQ({ answer: "D" })], ...over };
}

describe("postProcessLa", () => {
  test("valid item → not invalid, defaults filled, answers preserved (null allowed)", () => {
    const out = postProcessLa(laBase({ questions: [laQ({ answer: null }), laQ({ type: "detail", answer: "B" })] }));
    expect(out.invalid).toBeUndefined();
    expect(out.questions).toHaveLength(2);
    expect(out.questions[0].answer).toBeNull(); // null answer allowed (verify 代解)
    expect(out.questions[1].answer).toBe("B");
    expect(out.context).toBeTruthy();
    expect(out.speaker_role).toBeTruthy();
    expect(out.difficulty).toBe("medium");
    expect(out.audio_url).toBeUndefined();
  });

  test("announcement too short → invalid (下限 40 词)", () => {
    const out = postProcessLa(laBase({ announcement: "The library is closed today." }));
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/公告|词/);
  });

  test("no questions at all → invalid (need at least 1 answerable question)", () => {
    const out = postProcessLa(laBase({ questions: [] }));
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/题目/);
  });

  test("bad answer letter → that question's answer null, item still valid", () => {
    const out = postProcessLa(laBase({ questions: [laQ({ answer: "Z" })] }));
    expect(out.invalid).toBeUndefined();
    expect(out.questions[0].answer).toBeNull();
  });

  test("question with incomplete options → dropped + warning (not the whole item)", () => {
    const out = postProcessLa(
      laBase({ questions: [laQ({ answer: "A" }), { stem: "Bad one?", options: { A: "a", B: "b" }, answer: "B" }] })
    );
    expect(out.invalid).toBeUndefined();
    expect(out.questions).toHaveLength(1);
    expect(Array.isArray(out.warnings)).toBe(true);
  });

  test("question count outside range (>3) → warning only, still valid", () => {
    const out = postProcessLa(laBase({ questions: [laQ(), laQ(), laQ(), laQ()] }));
    expect(out.invalid).toBeUndefined();
    expect(out.questions).toHaveLength(4);
    expect(out.warnings.some((w) => /题/.test(w))).toBe(true);
  });

  test("word count over upper bound → warning only (真题长稿放宽)", () => {
    const longAnno = ANNO + " " + Array.from({ length: 120 }, () => "extra padding words here today").join(" ");
    const out = postProcessLa(laBase({ announcement: longAnno }));
    expect(out.invalid).toBeUndefined();
    expect(out.warnings.some((w) => /偏长|词数/.test(w))).toBe(true);
  });

  test("garbage input → invalid, never throws", () => {
    expect(() => postProcessLa(null)).not.toThrow();
    expect(postProcessLa(null).invalid).toBe(true);
    expect(postProcessLa("not an object").invalid).toBe(true);
    expect(postProcessLa([]).invalid).toBe(true);
  });
});

describe("postProcessLat", () => {
  test("valid 4-question item → not invalid, defaults filled", () => {
    const out = postProcessLat(latBase());
    expect(out.invalid).toBeUndefined();
    expect(out.questions).toHaveLength(4);
    expect(out.subject).toBeTruthy();
    expect(out.difficulty).toBe("medium");
    expect(out.audio_url).toBeUndefined();
  });

  test("real-exam length 6-question lecture is accepted (区间 2-6)", () => {
    const out = postProcessLat(latBase({ questions: Array.from({ length: 6 }, (_, i) => latQ({ answer: "ABCD"[i % 4] })) }));
    expect(out.invalid).toBeUndefined();
    expect(out.questions).toHaveLength(6);
  });

  test("transcript too short → invalid (下限 80 词)", () => {
    const out = postProcessLat(latBase({ transcript: "A short lecture about rocks and their history." }));
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/讲座|词/);
  });

  test("null answer allowed (verify 代解); bad answer → null", () => {
    const out = postProcessLat(latBase({ questions: [latQ({ answer: null }), latQ({ answer: "Q" }), latQ({ answer: "C" }), latQ({ answer: "D" })] }));
    expect(out.invalid).toBeUndefined();
    expect(out.questions[0].answer).toBeNull();
    expect(out.questions[1].answer).toBeNull();
    expect(out.questions[2].answer).toBe("C");
  });

  test("question count 1 (< range min 2) → warning only, still valid", () => {
    const out = postProcessLat(latBase({ questions: [latQ()] }));
    expect(out.invalid).toBeUndefined();
    expect(out.questions).toHaveLength(1);
    expect(out.warnings.some((w) => /题/.test(w))).toBe(true);
  });

  test("garbage input → invalid, never throws", () => {
    expect(() => postProcessLat(undefined)).not.toThrow();
    expect(postProcessLat(undefined).invalid).toBe(true);
  });
});
