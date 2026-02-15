const {
  estimateQuestionDifficulty,
  profileQuestionSetDifficulty,
  evaluateSetDifficultyAgainstTarget,
  ETS_2026_TARGET_COUNTS_10,
} = require("../lib/questionBank/difficultyControl");

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

describe("difficulty control", () => {
  test("estimates easy/medium/hard in expected order", () => {
    const easy = makeQuestion(
      "q_easy",
      "Can you tell me where it is?",
      ["can", "tell me", "where", "it", "is"],
      { prefilled: ["you"], prefilled_positions: { you: 1 }, grammar_points: ["embedded question (where)"] },
    );
    const medium = makeQuestion(
      "q_medium",
      "Do you know if the lab is open tonight?",
      ["do", "you know", "if", "the lab", "is open", "tonight"],
      { grammar_points: ["embedded question (if)"] },
    );
    const hard = makeQuestion(
      "q_hard",
      "Would you happen to know where the exhibit information center is?",
      ["would", "you happen", "to know", "where", "the exhibit", "information center", "is", "daily"],
      { distractor: "daily", grammar_points: ["embedded question (where)", "polite question frame"] },
    );

    const easyEst = estimateQuestionDifficulty(easy);
    const mediumEst = estimateQuestionDifficulty(medium);
    const hardEst = estimateQuestionDifficulty(hard);

    expect(easyEst.bucket).toBe("easy");
    expect(mediumEst.bucket).toBe("medium");
    expect(hardEst.bucket).toBe("hard");
    expect(easyEst.score).toBeLessThan(mediumEst.score);
    expect(mediumEst.score).toBeLessThan(hardEst.score);
  });

  test("accepts a 10-question set close to target ratio", () => {
    const easyQs = Array.from({ length: 2 }, (_, i) =>
      makeQuestion(
        `e${i}`,
        "Can you tell me where it is?",
        ["can", "tell me", "where", "it", "is"],
        { prefilled: ["you"], prefilled_positions: { you: 1 }, grammar_points: ["embedded question (where)"] },
      ));
    const mediumQs = Array.from({ length: 5 }, (_, i) =>
      makeQuestion(
        `m${i}`,
        "Do you know if the lab is open tonight?",
        ["do", "you know", "if", "the lab", "is open", "tonight"],
        { grammar_points: ["embedded question (if)"] },
      ));
    const hardQs = Array.from({ length: 3 }, (_, i) =>
      makeQuestion(
        `h${i}`,
        "Would you happen to know where the exhibit information center is?",
        ["would", "you happen", "to know", "where", "the exhibit", "information center", "is", "daily"],
        { distractor: "daily", grammar_points: ["embedded question (where)", "polite question frame"] },
      ));

    const questions = [...easyQs, ...mediumQs, ...hardQs];
    const profile = profileQuestionSetDifficulty(questions);
    const result = evaluateSetDifficultyAgainstTarget(questions);

    expect(profile.total).toBe(10);
    expect(result.ok).toBe(true);
    expect(result.meetsTargetCount10).toBe(true);
    expect(profile.counts).toEqual(ETS_2026_TARGET_COUNTS_10);
  });
});
