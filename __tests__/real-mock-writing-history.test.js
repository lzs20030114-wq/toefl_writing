import { MOCK_EXAM_STATUS, TASK_IDS } from "../lib/mockExam/contracts";
import { buildRealWritingHistory, shouldKeepRealWritingCheckpoint } from "../lib/realMockExam/linearWritingService";

const bsQuestions = [1, 2, 3].map((n) => ({
  id: `real_bs_${n}`, taskType: "bs", prompt: `Prompt ${n}`, answer: `Answer ${n}.`, chunks: ["a", "b"],
}));
const emailPrompt = { id: "real_email_1", taskType: "email", direction: "Write an email to Jessica.", goals: ["g1"] };
const discussionPrompt = { id: "real_discussion_1", taskType: "discussion", professor: { name: "Dr. Gupta", text: "Should students work together?" } };
const paper = {
  attemptId: "11111111-1111-4111-8111-111111111111", userCode: "ABC123", section: "writing", templateVersion: "2026-full-v1",
  bsQuestions, emailPrompt, discussionPrompt, items: [...bsQuestions, emailPrompt, discussionPrompt],
};
const blueprint = [
  { taskId: TASK_IDS.BUILD_SENTENCE, title: "Task 1 - Build a Sentence" },
  { taskId: TASK_IDS.EMAIL_WRITING, title: "Task 2 - Write an Email" },
  { taskId: TASK_IDS.ACADEMIC_WRITING, title: "Task 3 - Academic Discussion" },
];
const bsDetail = (n, isCorrect) => ({
  qid: `real_bs_${n}`, prompt: `Prompt ${n}`, userAnswer: isCorrect ? `Answer ${n}.` : "(no answer)", correctAnswer: `Answer ${n}.`, isCorrect, grammar_points: [],
});

function completedSession(overrides = {}) {
  return {
    id: "mock-1", status: MOCK_EXAM_STATUS.COMPLETED, completedAt: "2026-10-04T08:00:00.000Z",
    blueprint, realMockPaper: paper,
    // BS ran out of time on question 3: it was never shown, but the BS payload still lists it.
    realMockSeenItemIds: ["real_bs_1", "real_bs_2", "real_email_1", "real_discussion_1"],
    attempts: {
      [TASK_IDS.BUILD_SENTENCE]: { status: "submitted", score: 1, maxScore: 10, meta: { type: "bs", detailCount: 3, details: [bsDetail(1, true), bsDetail(2, false), bsDetail(3, false)] } },
      [TASK_IDS.EMAIL_WRITING]: { status: "submitted", score: 4, maxScore: 5, meta: { type: "email", response: { userText: "Dear Jessica" } } },
      [TASK_IDS.ACADEMIC_WRITING]: { status: "submitted", score: 3, maxScore: 5, meta: { type: "discussion", response: { userText: "I agree." } } },
    },
    aggregate: { raw: 8, maxRaw: 20, percent: 40, band: 3 },
    ...overrides,
  };
}

describe("buildRealWritingHistory", () => {
  test("dates the record by completedAt, so re-persisting the same exam keeps its date", () => {
    const first = buildRealWritingHistory(completedSession(), "error", "discussion: timeout");
    const again = buildRealWritingHistory(completedSession(), "done", "");
    expect(first.date).toBe("2026-10-04T08:00:00.000Z");
    expect(again.date).toBe(first.date);
    expect(again.details.mockSessionId).toBe("mock-1");
  });

  test("falls back to now only when the exam has no completedAt", () => {
    const record = buildRealWritingHistory(completedSession({ completedAt: null }));
    expect(Number.isFinite(Date.parse(record.date))).toBe(true);
  });

  test("keeps full content only for items that were shown", () => {
    const record = buildRealWritingHistory(completedSession());
    expect(record.details.items).toEqual([
      bsQuestions[0], bsQuestions[1],
      { id: "real_bs_3", taskType: "bs", unreached: true },
      emailPrompt, discussionPrompt,
    ]);
    const bs = record.details.tasks[0];
    expect(bs.items[2]).toEqual({ id: "real_bs_3", taskType: "bs", unreached: true });
    expect(bs.itemIds).toEqual(["real_bs_1", "real_bs_2", "real_bs_3"]);
    // The never-shown BS question goes back to the pool: no prompt, no correct answer in the record.
    expect(bs.meta.details).toEqual([bsDetail(1, true), bsDetail(2, false), { qid: "real_bs_3", unreached: true, isCorrect: false }]);
    expect(JSON.stringify(record)).not.toContain("Answer 3.");
    expect(bs.meta.detailCount).toBe(3);
    // Ids are kept for both the paper and what was seen.
    expect(record.details.itemIds).toEqual(paper.items.map((item) => item.id));
    expect(record.details.seenItemIds).toEqual(completedSession().realMockSeenItemIds);
  });

  test("does not write a paperSnapshot (the server keeps the attempt snapshot)", () => {
    const record = buildRealWritingHistory(completedSession());
    expect(record.details).not.toHaveProperty("paperSnapshot");
  });

  test("an aborted paper is flagged and carries no score", () => {
    const session = completedSession({
      status: MOCK_EXAM_STATUS.ABORTED,
      realMockSeenItemIds: ["real_bs_1"],
      attempts: {
        [TASK_IDS.BUILD_SENTENCE]: { status: "started", score: null, maxScore: 10, meta: null },
        [TASK_IDS.EMAIL_WRITING]: { status: "pending", score: null, maxScore: 5, meta: null },
        [TASK_IDS.ACADEMIC_WRITING]: { status: "pending", score: null, maxScore: 5, meta: null },
      },
      // The state machine's abort computes an ordinary-mock (ETS conversion) aggregate.
      aggregate: { band: 2.5, scaledScore: 9, cefr: "A2", percent: 0 },
    });
    const record = buildRealWritingHistory(session, "aborted");
    expect(record.details.aborted).toBe(true);
    expect(record.details.scoringPhase).toBe("aborted");
    expect(record.status).toBe(MOCK_EXAM_STATUS.ABORTED);
    expect(record.score).toBeNull();
    expect(record.band).toBeNull();
    expect(record.details.aggregate).toEqual({ raw: null, maxRaw: 20, percent: null, band: null });
    expect(record.details.items.filter((item) => !item.unreached).map((item) => item.id)).toEqual(["real_bs_1"]);
    expect(record.details.tasks[1].items).toEqual([{ id: "real_email_1", taskType: "email", unreached: true }]);
  });

  test("a finished paper is not flagged as aborted", () => {
    expect(buildRealWritingHistory(completedSession()).details).not.toHaveProperty("aborted");
  });
});

describe("shouldKeepRealWritingCheckpoint", () => {
  const running = { status: MOCK_EXAM_STATUS.RUNNING };
  const completed = { status: MOCK_EXAM_STATUS.COMPLETED };

  test("keeps a running paper and a completed one whose scoring is unfinished or failed", () => {
    expect(shouldKeepRealWritingCheckpoint(running, "idle")).toBe(true);
    expect(shouldKeepRealWritingCheckpoint(completed, "idle")).toBe(true);
    expect(shouldKeepRealWritingCheckpoint(completed, "pending")).toBe(true);
    expect(shouldKeepRealWritingCheckpoint(completed, "error")).toBe(true);
  });

  test("drops a scored paper, an aborted one and nothing at all", () => {
    expect(shouldKeepRealWritingCheckpoint(completed, "done")).toBe(false);
    expect(shouldKeepRealWritingCheckpoint({ status: MOCK_EXAM_STATUS.ABORTED }, "idle")).toBe(false);
    expect(shouldKeepRealWritingCheckpoint(null, "idle")).toBe(false);
  });
});
