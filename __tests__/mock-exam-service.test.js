import { buildPersistPayload, finalizeDeferredScoringSession, retryTimeoutScoringSession } from "../lib/mockExam/service";
import { updateTaskScore, recomputeAggregate } from "../lib/mockExam/stateMachine";

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

  test("finalize with recomputeAggregate produces band in final session", async () => {
    const session = {
      id: "mock-4",
      status: "completed",
      aggregate: { percent: 0 },
      blueprint: [
        { taskId: "build-sentence", title: "Task 1", weight: 0.34 },
        { taskId: "email-writing", title: "Task 2", weight: 0.33 },
        { taskId: "academic-writing", title: "Task 3", weight: 0.33 },
      ],
      attempts: {
        "build-sentence": { taskId: "build-sentence", status: "submitted", score: 8, maxScore: 10, meta: {} },
        "email-writing": {
          taskId: "email-writing", status: "submitted", score: null, maxScore: 5,
          meta: { deferredPayload: { promptData: { x: 1 }, promptSummary: "p", userText: "text" } },
        },
        "academic-writing": {
          taskId: "academic-writing", status: "submitted", score: null, maxScore: 5,
          meta: { deferredPayload: { promptData: { y: 2 }, promptSummary: "q", userText: "text2" } },
        },
      },
    };

    const result = await finalizeDeferredScoringSession(session, {
      evaluateResponse: async (type) => ({ score: type === "email" ? 4 : 4, band: "B" }),
      updateTaskScore,
      recomputeAggregate,
    });

    expect(result.phase).toBe("done");
    expect(result.session.aggregate).toBeTruthy();
    expect(result.session.aggregate.band).toBe(5.0);
    expect(result.session.aggregate.scaledScore).toBe(25);
    expect(result.session.aggregate.cefr).toBe("B2-C1");
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

  test("timeout failure keeps retry payload and retry API rescoring recalculates aggregate", async () => {
    const session = {
      id: "mock-5",
      status: "completed",
      aggregate: { percent: 0 },
      blueprint: [
        { taskId: "build-sentence", title: "Task 1", weight: 0.34 },
        { taskId: "email-writing", title: "Task 2", weight: 0.33 },
        { taskId: "academic-writing", title: "Task 3", weight: 0.33 },
      ],
      attempts: {
        "build-sentence": { taskId: "build-sentence", status: "submitted", score: 8, maxScore: 10, meta: {} },
        "email-writing": {
          taskId: "email-writing",
          status: "submitted",
          score: null,
          maxScore: 5,
          meta: { deferredPayload: { promptData: { x: 1 }, promptSummary: "p", userText: "text" } },
        },
        "academic-writing": {
          taskId: "academic-writing",
          status: "submitted",
          score: 4,
          maxScore: 5,
          meta: { feedback: { score: 4 } },
        },
      },
    };

    const firstPass = await finalizeDeferredScoringSession(session, {
      evaluateResponse: async () => {
        throw new Error("API timeout");
      },
      updateTaskScore,
      recomputeAggregate,
    });
    expect(firstPass.phase).toBe("error");
    expect(firstPass.session.attempts["email-writing"].meta.retryPayload).toBeTruthy();
    expect(firstPass.session.attempts["email-writing"].meta.error).toContain("timeout");

    const retried = await retryTimeoutScoringSession(firstPass.session, {
      evaluateResponse: async () => ({ score: 4, band: 4.5, summary: "ok" }),
      updateTaskScore,
      recomputeAggregate,
    });
    expect(retried.phase).toBe("done");
    expect(retried.session.attempts["email-writing"].score).toBe(4);
    expect(retried.session.attempts["email-writing"].meta.retryPayload).toBeFalsy();
    expect(retried.session.aggregate.band).toBeTruthy();
  });
});
