const { validateAllSets } = require("../scripts/validate-bank");

function makeQuestion(id, answer, chunks, opts = {}) {
  return {
    id,
    prompt: "Prompt",
    answer,
    chunks,
    prefilled: opts.prefilled || [],
    prefilled_positions: opts.prefilled_positions || {},
    distractor: opts.distractor ?? null,
    has_question_mark: opts.has_question_mark ?? answer.trim().endsWith("?"),
    grammar_points: opts.grammar_points || ["embedded question (if)"],
  };
}

function makeValidSet() {
  return {
    set_id: 1,
    questions: [
      makeQuestion("q1", "Do you know if the lab is open tonight?", ["do", "you know", "if", "the lab", "is open", "tonight"], { grammar_points: ["embedded question (if)"] }),
      makeQuestion("q2", "Could you tell me where the notes are posted?", ["could", "tell me", "where", "the notes", "are posted"], { prefilled: ["you"], prefilled_positions: { you: 1 }, grammar_points: ["embedded question (where)"] }),
      makeQuestion("q3", "Have you heard how they solved the problem?", ["have you heard", "how", "they", "solved", "the problem"], { grammar_points: ["embedded question (how)"] }),
      makeQuestion("q4", "Can we find out whether the room is available?", ["can", "we", "find out", "whether", "the room", "is available"], { grammar_points: ["embedded question (whether)"] }),
      makeQuestion("q5", "I wonder how many seats they have.", ["i wonder", "how many", "seats", "they", "have"], { has_question_mark: false, grammar_points: ["embedded question (how many)"] }),
      makeQuestion("q6", "Does anybody know whether it is open all year long?", ["does", "anybody know", "whether", "it is open", "all year", "long", "they"], { distractor: "they", grammar_points: ["embedded question (whether)"] }),
      makeQuestion("q7", "Do you know if it is usually crowded at this time?", ["do", "you know", "if", "it is", "usually crowded", "at this time", "daily"], { distractor: "daily", grammar_points: ["embedded question (if)"] }),
      makeQuestion("q8", "Could you tell me how long each session was?", ["could", "tell me", "how long", "each", "session", "was", "why"], { prefilled: ["you"], prefilled_positions: { you: 1 }, distractor: "why", grammar_points: ["embedded question (how long)"] }),
      makeQuestion("q9", "I wonder if a few classes can be held on Saturdays.", ["i wonder", "if", "a few", "classes", "can be held", "on saturdays"], { has_question_mark: false, grammar_points: ["embedded question (if)", "passive voice"] }),
      makeQuestion("q10", "Have you heard any details about how they filmed it?", ["have you heard", "any details", "about", "how", "they filmed", "it"], { grammar_points: ["embedded question (how)"] }),
    ],
  };
}

describe("validate-bank strict mode", () => {
  test("fails on schema errors in a set", () => {
    const data = { question_sets: [makeValidSet()] };
    data.question_sets[0].questions[0].chunks = ["do", "you know"]; // invalid: answer/chunks mismatch

    const out = validateAllSets(data, { strict: true });

    expect(out.ok).toBe(false);
    expect(out.failures.join("\n")).toContain("FATAL: chunks (minus distractor) + prefilled words must equal answer words");
  });

  test("strict mode fails when runtime slot model cannot normalize fixed chunks", () => {
    const data = { question_sets: [makeValidSet()] };
    data.question_sets[0].questions[0] = {
      id: "q_multi_prefilled",
      prompt: "Prompt",
      answer: "Do you know if the lab is open tonight now?",
      chunks: ["do", "know", "if", "the lab", "is open", "tonight"],
      prefilled: ["you", "now"],
      prefilled_positions: { you: 1, now: 8 },
      distractor: null,
      has_question_mark: true,
      grammar_points: ["embedded question (if)"],
    };

    const out = validateAllSets(data, { strict: true });
    expect(out.ok).toBe(false);
    expect(out.strictHardFails.some((x) => x.reasons.join(" ").includes("multiple prefilled chunks"))).toBe(true);
  });
});
