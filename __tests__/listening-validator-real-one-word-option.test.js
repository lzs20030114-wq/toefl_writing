/**
 * 「真题的单词选项」放行闸 —— lc / la / lat validator。
 *
 * 真题里 "Yes." / "No." 这种一个词的选项是**真实存在**的（第二来源 8 套里出现在 10 组题上），
 * 而三个 validator 的选项下限写死 2 词，把这 10 组真题整组拒了。
 *
 * 放宽的口径只对 `item.real === true` 生效：真题按真题收，
 * **生成库仍然是 2 词下限** —— 那条规则同时是防退化质量闸，
 * 一旦对生成内容松口，AI 出的题就会开始塞单词选项。
 *
 * 所以这里两边都要测：real 放行、非 real 仍拒。少测哪一边，闸都可能被悄悄拆掉。
 */
import { validateLC } from "../lib/listeningGen/lcValidator";
import { validateLA } from "../lib/listeningGen/laValidator";
import { validateLAT } from "../lib/listeningGen/latValidator";

const sentences = (n) =>
  Array.from({ length: n }, (_, i) => `This is filler sentence number ${i + 1} about the topic.`).join(" ");

// 一词选项在 A 位；其余三个选项都合规，保证只有「选项过短」这一条会触发。
const oneWordOptions = { A: "Yes.", B: "Not this week", C: "Only on weekends", D: "After the exam" };
const normalOptions = { A: "Yes it is", B: "Not this week", C: "Only on weekends", D: "After the exam" };

function lcItem(options) {
  const speakers = [
    { name: "Man", role: "student", gender: "male" },
    { name: "Woman", role: "advisor", gender: "female" },
  ];
  const conversation = Array.from({ length: 8 }, (_, i) => ({
    speaker: i % 2 ? "Woman" : "Man",
    text: `Turn ${i + 1}: we should talk about the schedule for the seminar next week in detail.`,
  }));
  return {
    id: "t_lc_1", difficulty: "medium", context: "campus_daily", speakers, conversation,
    questions: [
      { type: "detail", stem: "What will the man do next?", options, answer: "A" },
      { type: "gist", stem: "What are the speakers mainly discussing?", options: normalOptions, answer: "B" },
    ],
  };
}

function laItem(options) {
  return {
    id: "t_la_1", difficulty: "medium", context: "campus_daily",
    speaker: { name: "Staff", role: "librarian", gender: "female" },
    announcement: sentences(12),
    questions: [
      { type: "detail", stem: "What must students do first?", options, answer: "A" },
      { type: "gist", stem: "What is the announcement mainly about?", options: normalOptions, answer: "C" },
    ],
  };
}

function latItem(options) {
  return {
    id: "t_lat_1", difficulty: "medium", topic: "biology",
    speaker: { name: "Professor", role: "professor", gender: "male" },
    transcript: sentences(24),
    questions: [
      { type: "detail", stem: "What does the professor emphasize?", options, answer: "A" },
      { type: "gist", stem: "What is the lecture mainly about?", options: normalOptions, answer: "B" },
      { type: "inference", stem: "What can be inferred about the study?", options: normalOptions, answer: "C" },
    ],
  };
}

const CASES = [
  ["lc", validateLC, lcItem],
  ["la", validateLA, laItem],
  ["lat", validateLAT, latItem],
];

const shortErrors = (res) => (res.errors || []).filter((e) => /option_A_too_short/.test(e));

describe("听力 validator：单词选项只对真题放行", () => {
  for (const [name, validate, make] of CASES) {
    test(`${name}：real=true 的题，"Yes." 这种一词选项要收下`, () => {
      const res = validate({ ...make(oneWordOptions), real: true });
      expect(shortErrors(res)).toEqual([]);
    });

    test(`${name}：没有 real 标记（=生成库）的题，一词选项仍然拒`, () => {
      const res = validate(make(oneWordOptions));
      expect(shortErrors(res).length).toBeGreaterThan(0);
      expect(res.valid).toBe(false);
    });

    test(`${name}：real=true 也不是免检 —— 空选项照样拒`, () => {
      const res = validate({ ...make({ ...oneWordOptions, A: "" }), real: true });
      expect(res.valid).toBe(false);
    });

    test(`${name}：正常选项在两种模式下都通过 schema 校验`, () => {
      expect(shortErrors(validate(make(normalOptions)))).toEqual([]);
      expect(shortErrors(validate({ ...make(normalOptions), real: true }))).toEqual([]);
    });
  }
});
