import { buildPersistPayload, finalizeDeferredScoringSession } from "../lib/mockExam/service";
import { updateTaskScore } from "../lib/mockExam/stateMachine";

describe("mock exam service", () => {
  test("normalizes unresolved task score to 0 and keeps aggregate payload shape", () => {
    const session = {
      id: "mock-1",
      status: "completed",
      aggregate: null,
      blueprint: [
        { taskId: "build-sentence", title: "Task 1" },
        { taskId: "email-writing", title: "Task 2" },
      ],
      attempts: {
        "build-sentence": { score: 8, maxScore: 10, meta: { foo: 1 } },
        "email-writing": { score: null, maxScore: 5, meta: {} },
      },
    };

    const { sessionSnapshot, historyPayload, mockSessionId } = buildPersistPayload(session, { phase: "error", error: "x" });

    expect(mockSessionId).toBe("mock-1");
    expect(sessionSnapshot.aggregate.percent).toBe(40);
    expect(historyPayload.type).toBe("mock");
    expect(historyPayload.details.scoringPhase).toBe("error");
    expect(historyPayload.details.tasks[1].score).toBe(0);
    expect(historyPayload.details.tasks[1].meta.error).toBeTruthy();
  });

  test("finalize deferred scoring writes score and feedback when evaluator succeeds", async () => {
    const session = {
      id: "mock-2",
      status: "completed",
      aggregate: { percent: 0 },
      blueprint: [
        { taskId: "email-writing", title: "Task 2" },
        { taskId: "academic-writing", title: "Task 3" },
      ],
      attempts: {
        "email-writing": {
          score: null,
          maxScore: 5,
          meta: {
            deferredPayload: {
              promptData: { foo: 1 },
              promptSummary: "abc",
              userText: "hello",
            },
          },
        },
        "academic-writing": {
          score: null,
          maxScore: 5,
          meta: {
            deferredPayload: {
              promptData: { bar: 2 },
              promptSummary: "def",
              userText: "world",
            },
          },
        },
      },
    };

    const result = await finalizeDeferredScoringSession(session, {
      evaluateResponse: async (type) => ({ score: type === "email" ? 4 : 3, band: "B" }),
      updateTaskScore,
    });

    expect(result.phase).toBe("done");
    expect(result.error).toBe("");
    expect(result.session.attempts["email-writing"].score).toBe(4);
    expect(result.session.attempts["academic-writing"].score).toBe(3);
    expect(result.session.attempts["email-writing"].meta.feedback).toBeTruthy();
    expect(result.session.attempts["academic-writing"].meta.feedback).toBeTruthy();
  });

  test("finalize deferred scoring falls back to zero when payload missing", async () => {
    const session = {
      id: "mock-3",
      status: "completed",
      aggregate: { percent: 0 },
      blueprint: [{ taskId: "email-writing", title: "Task 2" }],
      attempts: {
        "email-writing": {
          score: null,
          maxScore: 5,
          meta: {},
        },
      },
    };

    const result = await finalizeDeferredScoringSession(session, {
      evaluateResponse: async () => ({ score: 5, band: "A" }),
      updateTaskScore,
    });

    expect(result.phase).toBe("error");
    expect(result.session.attempts["email-writing"].score).toBe(0);
    expect(result.session.attempts["email-writing"].meta.error).toBeTruthy();
  });
});
