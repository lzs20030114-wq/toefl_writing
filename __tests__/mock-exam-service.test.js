import { buildPersistPayload, finalizeDeferredScoringSession, retryTimeoutScoringSession, rescoreMockHistorySession, recomputeMockHistoryAggregate, isFailedMockTask } from "../lib/mockExam/service";
import { updateTaskScore, recomputeAggregate } from "../lib/mockExam/stateMachine";

describe("mock exam service", () => {
  test("keeps an unresolved task as null (not 0) and excludes it from percent", () => {
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
    // Failed email excluded — percent reflects only the scored build-sentence (8/10).
    expect(sessionSnapshot.aggregate.percent).toBe(80);
    expect(historyPayload.type).toBe("mock");
    expect(historyPayload.details.scoringPhase).toBe("error");
    // Unscored task is null (distinguishable from a real 0) and flagged failed.
    expect(historyPayload.details.tasks[1].score).toBeNull();
    expect(historyPayload.details.tasks[1].scoringFailed).toBe(true);
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

  test("finalize deferred scoring keeps score null (not 0) when payload missing", async () => {
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
    // Not 0 — an unscoreable task stays null and flagged, never a phantom 0.
    expect(result.session.attempts["email-writing"].score).toBeNull();
    expect(result.session.attempts["email-writing"].meta.error).toBeTruthy();
    expect(result.session.attempts["email-writing"].meta.scoringFailed).toBe(true);
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

  describe("rescoreMockHistorySession (re-score a persisted history mock)", () => {
    const historySession = () => ({
      id: 42,
      type: "mock",
      band: 4.0,
      details: {
        mockSessionId: "mock-hist-1",
        aggregate: { band: 4.0, percent: 80 },
        tasks: [
          { taskId: "build-sentence", score: 8, maxScore: 10, meta: { details: [] } },
          {
            taskId: "email-writing",
            score: null,
            maxScore: 5,
            scoringFailed: true,
            meta: {
              error: "API timeout",
              retryPayload: { promptData: { id: "e1" }, promptSummary: "s", userText: "hello", reportLanguage: "zh" },
            },
          },
          { taskId: "academic-writing", score: 4, maxScore: 5, meta: { feedback: { score: 4 } } },
        ],
      },
    });

    test("isFailedMockTask detects flagged and legacy (error+no feedback) failures", () => {
      expect(isFailedMockTask({ scoringFailed: true })).toBe(true);
      expect(isFailedMockTask({ score: 0, meta: { error: "boom" } })).toBe(true); // legacy phantom 0
      expect(isFailedMockTask({ score: 4, meta: { feedback: { score: 4 } } })).toBe(false);
      expect(isFailedMockTask(null)).toBe(false);
    });

    test("re-scores the failed task, clears the flag, and recomputes band in place", async () => {
      const { session, changed, error } = await rescoreMockHistorySession(historySession(), {
        evaluateResponse: async () => ({ score: 5, band: 5.5, reportLanguage: "zh" }),
      });
      expect(changed).toBe(true);
      expect(error).toBe("");
      const email = session.details.tasks.find((t) => t.taskId === "email-writing");
      expect(email.score).toBe(5);
      expect(email.scoringFailed).toBe(false);
      expect(email.meta.retryPayload).toBeNull();
      expect(email.meta.feedback).toBeTruthy();
      // Band recomputed over all three now-scored tasks; top-level + details agree.
      expect(session.band).toBe(session.details.aggregate.band);
      expect(session.details.scoringPhase).toBe("done");
      expect(Number.isFinite(session.band)).toBe(true);
    });

    test("keeps the failure (retry payload intact) when re-scoring fails again", async () => {
      const { session, changed, error } = await rescoreMockHistorySession(historySession(), {
        evaluateResponse: async () => {
          throw new Error("still down");
        },
      });
      expect(changed).toBe(false);
      expect(error).toContain("still down");
      const email = session.details.tasks.find((t) => t.taskId === "email-writing");
      expect(email.score).toBeNull();
      expect(email.meta.retryPayload).toBeTruthy(); // preserved for a later retry
    });

    test("recomputeMockHistoryAggregate excludes failed tasks from percent/band", () => {
      const { bandResult, percent } = recomputeMockHistoryAggregate([
        { taskId: "build-sentence", score: 8, maxScore: 10 },
        { taskId: "email-writing", score: null, maxScore: 5, scoringFailed: true },
        { taskId: "academic-writing", score: 4, maxScore: 5 },
      ]);
      // Only build-sentence (80%) + academic (80%) count → 80%, and email excluded from band.
      expect(percent).toBe(80);
      expect(bandResult.scoredCount).toBe(2);
    });
  });
});
