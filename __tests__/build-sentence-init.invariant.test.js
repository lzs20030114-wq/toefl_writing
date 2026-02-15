import { __internal } from "../components/buildSentence/useBuildSentenceSession";

describe("build sentence init invariants", () => {
  test("normalized runtime question keeps bank/answerOrder length aligned", () => {
    const raw = {
      id: "ets_inv_001",
      prompt: "Your presentation yesterday was impressive.",
      answer: "Would you like me to send you a copy of it?",
      chunks: ["you like", "of it", "me", "you", "to send", "would", "a copy"],
      prefilled: [],
      prefilled_positions: {},
      distractor: null,
      has_question_mark: true,
      grammar_points: ["embedded question (if)"],
    };

    const prepared = __internal.prepareQuestions([raw]);
    expect(prepared.errors).toHaveLength(0);
    expect(prepared.questions).toHaveLength(1);

    const q = prepared.questions[0];
    const slotCount = q.answerOrder.length;
    const slots = Array(slotCount).fill(null);

    expect(q.bank.length).toBe(q.answerOrder.length);
    expect(slots.length).toBe(q.answerOrder.length);
  });
});
