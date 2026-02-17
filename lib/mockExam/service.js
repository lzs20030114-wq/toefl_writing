import { TASK_IDS } from "./contracts";

export function isTimeoutError(message) {
  const m = String(message || "").toLowerCase();
  return m.includes("timeout") || m.includes("timed out");
}

export function normalizeMockTasks(finalSession) {
  return (finalSession?.blueprint || []).map((task) => {
    const attempt = finalSession?.attempts?.[task.taskId] || {};
    const fallbackMax = task.taskId === TASK_IDS.BUILD_SENTENCE ? 10 : 5;
    const maxScore = Number.isFinite(attempt?.maxScore) ? attempt.maxScore : fallbackMax;
    const hasFinalScore = Number.isFinite(attempt?.score);
    const fallbackError = !hasFinalScore ? (attempt?.meta?.error || "score unresolved, fallback to 0") : "";

    return {
      taskId: task.taskId,
      title: task.title,
      score: hasFinalScore ? attempt.score : 0,
      maxScore,
      meta: {
        ...(attempt?.meta || {}),
        ...(hasFinalScore ? {} : { error: fallbackError }),
      },
    };
  });
}

export function computeOverallPercent(finalSession, normalizedTasks) {
  if (Number.isFinite(finalSession?.aggregate?.percent)) {
    return finalSession.aggregate.percent;
  }
  const list = Array.isArray(normalizedTasks) ? normalizedTasks : [];
  if (list.length === 0) return 0;
  const sum = list.reduce((acc, t) => acc + (t.maxScore > 0 ? t.score / t.maxScore : 0), 0);
  return Math.round((sum / list.length) * 100);
}

export function buildPersistPayload(finalSession, { phase = "done", error = "" } = {}) {
  const normalizedTasks = normalizeMockTasks(finalSession);
  const overallPercent = computeOverallPercent(finalSession, normalizedTasks);

  const agg = finalSession?.aggregate || {};

  return {
    sessionSnapshot: {
      ...finalSession,
      aggregate: {
        ...agg,
        percent: overallPercent,
      },
    },
    historyPayload: {
      type: "mock",
      mode: finalSession?.mode || "standard",
      score: overallPercent,
      scale: 100,
      band: agg.band ?? null,
      scaledScore: agg.scaledScore ?? null,
      cefr: agg.cefr ?? null,
      status: finalSession?.status || "unknown",
      details: {
        mockSessionId: finalSession?.id || "",
        scoringPhase: phase,
        scoringError: error || "",
        mode: finalSession?.mode || "standard",
        aggregate: { ...agg, percent: overallPercent },
        tasks: normalizedTasks,
      },
    },
    mockSessionId: finalSession?.id || "",
  };
}

export async function finalizeDeferredScoringSession(
  session,
  { evaluateResponse, updateTaskScore, recomputeAggregate },
) {
  if (!session) {
    return { session, phase: "error", error: "missing session" };
  }

  let nextSession = session;
  const taskErrors = [];

  const writingConfigs = [
    { taskId: TASK_IDS.EMAIL_WRITING, evalType: "email", maxScore: 5, label: "Email" },
    { taskId: TASK_IDS.ACADEMIC_WRITING, evalType: "discussion", maxScore: 5, label: "Discussion" },
  ];

  const missingPayloadTasks = writingConfigs.filter((cfg) => {
    const a = nextSession.attempts?.[cfg.taskId];
    return a && a.score == null && !a.meta?.deferredPayload;
  });

  const skip = { skipAggregate: true };

  if (missingPayloadTasks.length > 0) {
    for (const cfg of missingPayloadTasks) {
      nextSession = updateTaskScore(nextSession, cfg.taskId, {
        score: 0,
        maxScore: cfg.maxScore,
        meta: { ...(nextSession.attempts?.[cfg.taskId]?.meta || {}), error: "missing deferred payload" },
      }, skip);
    }
    taskErrors.push("missing deferred payload for writing task");
  }

  for (const cfg of writingConfigs) {
    const attempt = nextSession.attempts?.[cfg.taskId];
    const payload = attempt?.meta?.deferredPayload;
    if (!attempt || attempt.score != null) continue;
    if (!payload?.promptData || !payload?.userText) continue;

    try {
      const r = await evaluateResponse(cfg.evalType, payload.promptData, payload.userText);
      nextSession = updateTaskScore(nextSession, cfg.taskId, {
        score: r.score,
        maxScore: cfg.maxScore,
        meta: {
          ...attempt.meta,
          deferredPayload: null,
          band: r.band,
          feedback: r,
          response: {
            userText: payload.userText,
            promptSummary: payload.promptSummary || "",
          },
        },
      }, skip);
    } catch (e) {
      const msg = e?.message || `${cfg.label} scoring failed`;
      taskErrors.push(msg);
      const shouldKeepRetryPayload = isTimeoutError(msg);
      nextSession = updateTaskScore(nextSession, cfg.taskId, {
        score: 0,
        maxScore: cfg.maxScore,
        meta: {
          ...attempt.meta,
          deferredPayload: shouldKeepRetryPayload ? payload : null,
          retryPayload: shouldKeepRetryPayload ? payload : null,
          error: msg,
          response: {
            userText: payload.userText,
            promptSummary: payload.promptSummary || "",
          },
        },
      }, skip);
    }
  }

  // Single aggregate recomputation after all scores are settled
  if (recomputeAggregate) {
    nextSession = recomputeAggregate(nextSession);
  }

  if (taskErrors.length > 0) {
    return { session: nextSession, phase: "error", error: taskErrors.join(" | ") };
  }

  return { session: nextSession, phase: "done", error: "" };
}

export async function retryTimeoutScoringSession(
  session,
  { evaluateResponse, updateTaskScore, recomputeAggregate },
) {
  if (!session) return { session, phase: "error", error: "missing session" };

  let nextSession = session;
  const taskErrors = [];
  const writingConfigs = [
    { taskId: TASK_IDS.EMAIL_WRITING, evalType: "email", maxScore: 5, label: "Email" },
    { taskId: TASK_IDS.ACADEMIC_WRITING, evalType: "discussion", maxScore: 5, label: "Discussion" },
  ];
  const skip = { skipAggregate: true };

  for (const cfg of writingConfigs) {
    const attempt = nextSession.attempts?.[cfg.taskId];
    if (!attempt) continue;
    const errMsg = attempt?.meta?.error || "";
    if (!isTimeoutError(errMsg)) continue;
    const payload = attempt?.meta?.retryPayload || attempt?.meta?.deferredPayload;
    if (!payload?.promptData || !payload?.userText) continue;

    try {
      const r = await evaluateResponse(cfg.evalType, payload.promptData, payload.userText);
      nextSession = updateTaskScore(nextSession, cfg.taskId, {
        score: r.score,
        maxScore: cfg.maxScore,
        meta: {
          ...attempt.meta,
          deferredPayload: null,
          retryPayload: null,
          error: "",
          band: r.band,
          feedback: r,
          response: {
            userText: payload.userText,
            promptSummary: payload.promptSummary || "",
          },
        },
      }, skip);
    } catch (e) {
      const msg = e?.message || `${cfg.label} retry scoring failed`;
      taskErrors.push(msg);
      nextSession = updateTaskScore(nextSession, cfg.taskId, {
        score: 0,
        maxScore: cfg.maxScore,
        meta: {
          ...attempt.meta,
          deferredPayload: isTimeoutError(msg) ? payload : null,
          retryPayload: isTimeoutError(msg) ? payload : null,
          error: msg,
          response: {
            userText: payload.userText,
            promptSummary: payload.promptSummary || "",
          },
        },
      }, skip);
    }
  }

  if (recomputeAggregate) nextSession = recomputeAggregate(nextSession);
  if (taskErrors.length > 0) return { session: nextSession, phase: "error", error: taskErrors.join(" | ") };
  return { session: nextSession, phase: "done", error: "" };
}
