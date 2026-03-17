const {
  detectAdvancedGrammarSignals,
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
      "I do not go to the gym on weekends.",
      ["I", "do", "not", "go", "to", "the gym", "on weekends"],
      { grammar_points: ["negation"] },
    );
    const medium = makeQuestion(
      "q_medium",
      "Do you know if the lab is open tonight?",
      ["do", "you know", "if", "the lab", "is open", "tonight", "already"],
      { distractor: "already", grammar_points: ["embedded question (if)"] },
    );
    const hard = makeQuestion(
      "q_hard",
      "The desk you ordered is scheduled to arrive on Friday.",
      ["the desk", "you ordered", "is scheduled", "to arrive", "on Friday", "today"],
      { distractor: "today", grammar_points: ["relative clause", "passive voice"] },
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

  test("hard requires advanced grammar signals instead of just a longer answer", () => {
    const longButPlain = makeQuestion(
      "q_long_plain",
      "Do you know whether the community center is open for visitors tomorrow morning?",
      ["do", "you know", "whether", "the community center", "is open", "for visitors", "tomorrow morning"],
      { grammar_points: ["embedded question (whether)"] },
    );
    const structuralHard = makeQuestion(
      "q_structural_hard",
      "He wanted to know where all the accountants had gone.",
      ["he", "wanted to know", "where", "all the accountants", "had gone", "go"],
      { distractor: "go", grammar_points: ["embedded question (where)", "past perfect"] },
    );

    expect(estimateQuestionDifficulty(longButPlain).bucket).not.toBe("hard");
    expect(estimateQuestionDifficulty(structuralHard).bucket).toBe("hard");
  });

  test("detects advanced grammar signals used by TPO hard items", () => {
    const out = detectAdvancedGrammarSignals(
      makeQuestion(
        "q_signal",
        "She wanted to know whom I would ask about what happened.",
        ["she", "wanted to know", "whom", "I", "would ask", "about what happened", "who"],
        { distractor: "who", grammar_points: ["embedded question (whom)", "whom"] },
      ),
    );

    expect(out.hasWhom).toBe(true);
    expect(out.hasLayeredEmbedding).toBe(true);
    expect(out.advancedCount).toBeGreaterThan(0);
  });

  test("accepts a 10-question set close to target ratio", () => {
    const easyQs = Array.from({ length: 1 }, (_, i) =>
      makeQuestion(
        `e${i}`,
        "I do not go to the gym on weekends.",
        ["I", "do", "not", "go", "to", "the gym", "on weekends"],
        { grammar_points: ["negation"] },
      ));
    const mediumQs = Array.from({ length: 7 }, (_, i) =>
      makeQuestion(
        `m${i}`,
        "Do you know if the lab is open tonight?",
        ["do", "you know", "if", "the lab", "is open", "tonight", "already"],
        { distractor: "already", grammar_points: ["embedded question (if)"] },
      ));
    const hardQs = Array.from({ length: 2 }, (_, i) =>
      makeQuestion(
        `h${i}`,
        i === 0
          ? "The desk you ordered is scheduled to arrive on Friday."
          : "He wanted to know where all the accountants had gone.",
        i === 0
          ? ["the desk", "you ordered", "is scheduled", "to arrive", "on Friday", "today"]
          : ["he", "wanted to know", "where", "all the accountants", "had gone", "go"],
        i === 0
          ? { distractor: "today", grammar_points: ["relative clause", "passive voice"] }
          : { distractor: "go", grammar_points: ["embedded question (where)", "past perfect"] },
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
