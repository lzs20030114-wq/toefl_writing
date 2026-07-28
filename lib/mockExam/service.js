import { TASK_IDS } from "./contracts";
import { calculateWritingBand } from "./bandScore";

const EVAL_TYPE_BY_TASK = {
  [TASK_IDS.EMAIL_WRITING]: "email",
  [TASK_IDS.ACADEMIC_WRITING]: "discussion",
};

// A persisted mock writing task counts as "failed" (re-scoreable) when it was
// explicitly flagged, or — for legacy rows written before the flag existed — it
// carries an error and produced no feedback. A genuine score always has feedback
// and no error, so this never misfires on a real low score.
export function isFailedMockTask(task) {
  if (!task) return false;
  if (task.scoringFailed === true) return true;
  return Boolean(task?.meta?.error) && !task?.meta?.feedback;
}

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
    const scoringFailed = !hasFinalScore || attempt?.meta?.scoringFailed === true;
    const fallbackError = !hasFinalScore ? (attempt?.meta?.error || "AI 评分未完成") : "";

    return {
      taskId: task.taskId,
      title: task.title,
      // null (not 0) when unscored: a failed AI scoring must stay distinguishable
      // from a genuine 0 so the UI/admin can render "评分失败" and offer a re-score.
      score: hasFinalScore ? attempt.score : null,
      maxScore,
      scoringFailed,
      meta: {
        ...(attempt?.meta || {}),
        ...(hasFinalScore ? {} : { error: fallbackError, scoringFailed: true }),
      },
    };
  });
}

export function computeOverallPercent(finalSession, normalizedTasks) {
  if (Number.isFinite(finalSession?.aggregate?.percent)) {
    return finalSession.aggregate.percent;
  }
  const list = Array.isArray(normalizedTasks) ? normalizedTasks : [];
  // Only tasks that were actually scored count toward the percent — an unscored
  // (failed) task is excluded, not treated as a 0.
  const scored = list.filter((t) => Number.isFinite(t?.score) && t?.maxScore > 0);
  if (scored.length === 0) return 0;
  const sum = scored.reduce((acc, t) => acc + t.score / t.maxScore, 0);
  return Math.round((sum / scored.length) * 100);
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
        // null (not 0): unscored, excluded from band. No payload survived so this
        // one can't be retried, but it must not masquerade as a real 0.
        score: null,
        maxScore: cfg.maxScore,
        meta: { ...(nextSession.attempts?.[cfg.taskId]?.meta || {}), error: "作答数据缺失，无法评分", scoringFailed: true },
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
      const r = await evaluateResponse(cfg.evalType, payload.promptData, payload.userText, payload.reportLanguage || "zh");
      nextSession = updateTaskScore(nextSession, cfg.taskId, {
        score: r.score,
        maxScore: cfg.maxScore,
        meta: {
          ...attempt.meta,
          deferredPayload: null,
          scoringFailed: false,
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
      const msg = e?.message || `${cfg.label} scoring failed`;
      taskErrors.push(msg);
      // score: null (not 0) — unscored, excluded from band. Always keep
      // retryPayload so the user can re-score ANY failed task, not just timeouts.
      nextSession = updateTaskScore(nextSession, cfg.taskId, {
        score: null,
        maxScore: cfg.maxScore,
        meta: {
          ...attempt.meta,
          deferredPayload: null,
          retryPayload: payload,
          error: msg,
          scoringFailed: true,
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
    if (!errMsg) continue; // no error = already scored successfully
    const payload = attempt?.meta?.retryPayload || attempt?.meta?.deferredPayload;
    if (!payload?.promptData || !payload?.userText) continue;

    try {
      const r = await evaluateResponse(cfg.evalType, payload.promptData, payload.userText, payload.reportLanguage || "zh");
      nextSession = updateTaskScore(nextSession, cfg.taskId, {
        score: r.score,
        maxScore: cfg.maxScore,
        meta: {
          ...attempt.meta,
          deferredPayload: null,
          retryPayload: null,
          error: "",
          scoringFailed: false,
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
        score: null,
        maxScore: cfg.maxScore,
        meta: {
          ...attempt.meta,
          deferredPayload: null,
          retryPayload: payload,
          error: msg,
          scoringFailed: true,
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

// Recompute band + percent from a persisted (flattened) mock task list — the
// details.tasks[] shape stored in history, not the live attempts{} shape.
export function recomputeMockHistoryAggregate(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const scoreOf = (taskId) => {
    const t = list.find((x) => x?.taskId === taskId);
    return t && Number.isFinite(t.score) && !isFailedMockTask(t) ? t.score : null;
  };
  const bandResult = calculateWritingBand(
    scoreOf(TASK_IDS.BUILD_SENTENCE),
    scoreOf(TASK_IDS.EMAIL_WRITING),
    scoreOf(TASK_IDS.ACADEMIC_WRITING),
  );
  const scored = list.filter((t) => Number.isFinite(t?.score) && t?.maxScore > 0 && !isFailedMockTask(t));
  const percent = scored.length > 0
    ? Math.round((scored.reduce((acc, t) => acc + t.score / t.maxScore, 0) / scored.length) * 100)
    : 0;
  return { bandResult, percent };
}

// Re-score the failed writing tasks of a PERSISTED history mock session (the
// flattened details.tasks[] shape). Re-evaluates each failed task from its
// retryPayload, recomputes band/percent, and returns an updated history session
// ready to hand to updateSess(). Pure w.r.t. storage — the caller persists.
export async function rescoreMockHistorySession(session, { evaluateResponse }) {
  const details = session?.details || {};
  const tasks = Array.isArray(details.tasks)
    ? details.tasks.map((t) => ({ ...t, meta: { ...(t?.meta || {}) } }))
    : [];
  if (tasks.length === 0) return { session, changed: false, error: "no tasks" };

  const errors = [];
  let changed = false;

  for (const task of tasks) {
    const evalType = EVAL_TYPE_BY_TASK[task.taskId];
    if (!evalType || !isFailedMockTask(task)) continue;
    const payload = task.meta?.retryPayload || task.meta?.deferredPayload;
    if (!payload?.promptData || !payload?.userText) continue;
    try {
      const r = await evaluateResponse(evalType, payload.promptData, payload.userText, payload.reportLanguage || "zh");
      task.score = r.score;
      task.scoringFailed = false;
      task.meta = {
        ...task.meta,
        retryPayload: null,
        deferredPayload: null,
        error: "",
        scoringFailed: false,
        band: r.band,
        feedback: r,
        response: {
          userText: payload.userText,
          promptSummary: payload.promptSummary || task.meta?.response?.promptSummary || "",
        },
      };
      changed = true;
    } catch (e) {
      errors.push(e?.message || `${evalType} 重新评分失败`);
    }
  }

  if (!changed) return { session, changed: false, error: errors.join(" | ") };

  const { bandResult, percent } = recomputeMockHistoryAggregate(tasks);
  const stillFailed = tasks.some((t) => EVAL_TYPE_BY_TASK[t.taskId] && isFailedMockTask(t));
  const nextAggregate = {
    ...(details.aggregate || {}),
    band: bandResult.band,
    scaledScore: bandResult.scaledScore,
    combinedMean: bandResult.combinedMean,
    cefr: bandResult.cefr,
    color: bandResult.color,
    percent,
  };

  const nextSession = {
    ...session,
    // Top-level fields mirror buildScoreObj's mock output that history flattens in.
    band: bandResult.band,
    scaledScore: bandResult.scaledScore,
    combinedMean: bandResult.combinedMean,
    cefr: bandResult.cefr,
    score: percent,
    tasks,
    details: {
      ...details,
      tasks,
      aggregate: nextAggregate,
      scoringPhase: stillFailed ? "error" : "done",
      scoringError: errors.join(" | "),
    },
  };
  return { session: nextSession, changed: true, error: errors.join(" | ") };
}
