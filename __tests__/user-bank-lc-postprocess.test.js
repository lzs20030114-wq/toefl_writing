const { postProcessLc } = require("../lib/ai/prompts/questionExtraction");

// postProcessLc: schema分档 for personal-bank LC (听对话) import. TWO-speaker, multi-turn
// conversation + questions[] (same MCQ shape as LA/LAT). 口径 (2026-07-04 研究 附录 C, LC §3-5):
//   * speakers 恒 2 且各带 gender（缺则按 name 推断 Woman/Man，推不出 → invalid 引导标注）;
//   * conversation <4 轮 或 <40 词 → invalid; 上限（>15 轮 / >280 词）只警告 (真题长对话放宽);
//   * 出现名单外说话人（切分错位）→ invalid; 每题 stem/选项缺 → 剔除+警示; answer 非 A-D → 归 null.
//   * 音频 never produced here.

function turn(speaker, i) {
  return { speaker, text: `This is conversation turn number ${i} with several meaningful words in it here.` };
}
function makeConversation(n = 6) {
  return Array.from({ length: n }, (_, i) => turn(i % 2 === 0 ? "Woman" : "Man", i));
}
function lcQ(over = {}) {
  return {
    type: "main_idea",
    stem: "What are the speakers mainly discussing?",
    options: { A: "An elective choice", B: "A missed exam", C: "A dorm move", D: "A lost book" },
    answer: "A",
    ...over,
  };
}
function lcBase(over = {}) {
  return {
    situation: "a student asks a staff member which elective to take",
    speakers: [
      { name: "Woman", role: "student", gender: "female" },
      { name: "Man", role: "advising_staff", gender: "male" },
    ],
    conversation: makeConversation(6),
    questions: [lcQ(), lcQ({ type: "detail", answer: "B" })],
    ...over,
  };
}

describe("postProcessLc", () => {
  test("valid item → not invalid, defaults filled, answers preserved (null allowed)", () => {
    const out = postProcessLc(lcBase({ questions: [lcQ({ answer: null }), lcQ({ type: "detail", answer: "B" })] }));
    expect(out.invalid).toBeUndefined();
    expect(out.questions).toHaveLength(2);
    expect(out.questions[0].answer).toBeNull(); // null answer allowed (verify 代解)
    expect(out.questions[1].answer).toBe("B");
    expect(out.speakers).toHaveLength(2);
    expect(out.conversation).toHaveLength(6);
    expect(out.context).toBeTruthy();
    expect(out.difficulty).toBe("medium");
    expect(out.audio_url).toBeUndefined();
  });

  test("gender inferred from name when omitted (Woman→female, Man→male)", () => {
    const out = postProcessLc(lcBase({ speakers: [{ name: "Woman" }, { name: "Man" }] }));
    expect(out.invalid).toBeUndefined();
    expect(out.speakers[0].gender).toBe("female");
    expect(out.speakers[1].gender).toBe("male");
  });

  test("gender unresolvable → invalid, guides annotation", () => {
    const out = postProcessLc(lcBase({ speakers: [{ name: "Alex" }, { name: "Sam" }] }));
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/性别|Woman|Man/);
  });

  test("not exactly 2 speakers → invalid", () => {
    expect(postProcessLc(lcBase({ speakers: [{ name: "Woman", gender: "female" }] })).invalid).toBe(true);
    expect(postProcessLc(lcBase({
      speakers: [
        { name: "Woman", gender: "female" },
        { name: "Man", gender: "male" },
        { name: "Kid", gender: "male" },
      ],
    })).invalid).toBe(true);
  });

  test("conversation too short (<4 turns) → invalid", () => {
    const out = postProcessLc(lcBase({ conversation: makeConversation(3) }));
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/对话过短|轮/);
  });

  test("conversation too few words (<40) → invalid even with 4 turns", () => {
    const out = postProcessLc(lcBase({
      conversation: [
        { speaker: "Woman", text: "Hi there." },
        { speaker: "Man", text: "Hello." },
        { speaker: "Woman", text: "Okay." },
        { speaker: "Man", text: "Sure." },
      ],
    }));
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/词|对话过短/);
  });

  test("stray speaker outside the two-name roster → invalid (切分错位 guard)", () => {
    const conv = makeConversation(6);
    conv[5] = { speaker: "Bob", text: "This stray turn belongs to an unlisted speaker with extra words." };
    const out = postProcessLc(lcBase({ conversation: conv }));
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/名单之外|切分|Bob/);
  });

  test("bad answer letter → that question's answer null, item still valid", () => {
    const out = postProcessLc(lcBase({ questions: [lcQ({ answer: "Z" }), lcQ({ answer: "B" })] }));
    expect(out.invalid).toBeUndefined();
    expect(out.questions[0].answer).toBeNull();
    expect(out.questions[1].answer).toBe("B");
  });

  test("question with incomplete options → dropped + warning (not the whole item)", () => {
    const out = postProcessLc(lcBase({
      questions: [lcQ({ answer: "A" }), { stem: "Bad one?", options: { A: "a", B: "b" }, answer: "B" }],
    }));
    expect(out.invalid).toBeUndefined();
    expect(out.questions).toHaveLength(1);
    expect(Array.isArray(out.warnings)).toBe(true);
  });

  test("no answerable questions at all → invalid", () => {
    const out = postProcessLc(lcBase({ questions: [] }));
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/题目/);
  });

  test("turn count over upper bound (>15) → warning only, still valid", () => {
    const out = postProcessLc(lcBase({ conversation: makeConversation(18) }));
    expect(out.invalid).toBeUndefined();
    expect(out.warnings.some((w) => /轮/.test(w))).toBe(true);
  });

  test("word count over upper bound (>280) → warning only (真题长对话放宽)", () => {
    const long = Array.from({ length: 20 }, (_, i) =>
      turn(i % 2 === 0 ? "Woman" : "Man", i)
    ).map((t) => ({ ...t, text: t.text + " " + Array.from({ length: 12 }, () => "extra padding words here").join(" ") }));
    const out = postProcessLc(lcBase({ conversation: long }));
    expect(out.invalid).toBeUndefined();
    expect(out.warnings.some((w) => /偏长|词数/.test(w))).toBe(true);
  });

  test("unlabeled alternating turns still validate once speakers are named", () => {
    // Simulates the AI having split an unlabeled dialogue into alternating Woman/Man turns.
    const out = postProcessLc(lcBase({ conversation: makeConversation(8) }));
    expect(out.invalid).toBeUndefined();
    expect(out.conversation).toHaveLength(8);
  });

  test("garbage input → invalid, never throws", () => {
    expect(() => postProcessLc(null)).not.toThrow();
    expect(postProcessLc(null).invalid).toBe(true);
    expect(postProcessLc("not an object").invalid).toBe(true);
    expect(postProcessLc([]).invalid).toBe(true);
  });
});
