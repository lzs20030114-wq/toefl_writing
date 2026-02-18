import { DEFAULT_TASK_MAX_SCORES, MOCK_EXAM_STATUS, TASK_IDS, TASK_STATUS } from "./contracts";
import { calculateWritingBand } from "./bandScore";

function extractSubmittedScore(attempts, taskId) {
  const a = attempts[taskId];
  return a?.status === TASK_STATUS.SUBMITTED && Number.isFinite(a?.score) ? a.score : 0;
}

function asISO(now) {
  return now instanceof Date ? now.toISOString() : new Date(now || Date.now()).toISOString();
}

function clampNumber(input, min, max) {
  const n = Number(input);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function computeAggregate(blueprint, attempts) {
  const byTask = {};
  let weighted = 0;
  let completed = 0;

  for (const item of blueprint) {
    const a = attempts[item.taskId];
    if (!a || a.status !== TASK_STATUS.SUBMITTED) continue;
    const safeMax = a.maxScore > 0 ? a.maxScore : 1;
    const ratio = clampNumber(a.score / safeMax, 0, 1);
    const weightedPart = ratio * item.weight;
    byTask[item.taskId] = {
      score: a.score,
      maxScore: a.maxScore,
      ratio,
      weightedPart,
    };
    weighted += weightedPart;
    completed += 1;
  }

  // Extract raw scores for band calculation — use helper to avoid hardcoding checks
  const basRaw = extractSubmittedScore(attempts, TASK_IDS.BUILD_SENTENCE);
  const emailScore = extractSubmittedScore(attempts, TASK_IDS.EMAIL_WRITING);
  const discScore = extractSubmittedScore(attempts, TASK_IDS.ACADEMIC_WRITING);
  const bandResult = calculateWritingBand(basRaw, emailScore, discScore);

  return {
    completedTasks: completed,
    totalTasks: blueprint.length,
    normalizedScore: Number(weighted.toFixed(4)),
    percent: Math.round(weighted * 100),
    byTask,
    band: bandResult.band,
    scaledScore: bandResult.scaledScore,
    combinedMean: bandResult.combinedMean,
    cefr: bandResult.cefr,
    color: bandResult.color,
    breakdown: bandResult.breakdown,
  };
}

export function createMockExamState(blueprint, now) {
  const attempts = {};
  for (const item of blueprint) {
    attempts[item.taskId] = {
      taskId: item.taskId,
      status: TASK_STATUS.PENDING,
      startedAt: null,
      submittedAt: null,
      score: null,
      maxScore: DEFAULT_TASK_MAX_SCORES[item.taskId] || 5,
      meta: null,
    };
  }

  return {
    id: "mock-" + Date.now(),
    status: MOCK_EXAM_STATUS.IDLE,
    createdAt: asISO(now),
    startedAt: null,
    completedAt: null,
    currentTaskIndex: -1,
    blueprint,
    attempts,
    aggregate: null,
  };
}

export function startMockExam(state, now) {
  if (!state || state.status !== MOCK_EXAM_STATUS.IDLE) return state;
  if (!Array.isArray(state.blueprint) || state.blueprint.length === 0) return state;
  const first = state.blueprint[0];

  return {
    ...state,
    status: MOCK_EXAM_STATUS.RUNNING,
    startedAt: asISO(now),
    currentTaskIndex: 0,
    attempts: {
      ...state.attempts,
      [first.taskId]: {
        ...state.attempts[first.taskId],
        status: TASK_STATUS.STARTED,
        startedAt: asISO(now),
      },
    },
  };
}

export function submitCurrentTask(state, payload, now) {
  if (!state || state.status !== MOCK_EXAM_STATUS.RUNNING) return state;
  const currentTask = state.blueprint[state.currentTaskIndex];
  if (!currentTask) return state;
  const currentAttempt = state.attempts[currentTask.taskId];
  if (!currentAttempt || currentAttempt.status !== TASK_STATUS.STARTED) return state;

  const maxScore = Number(payload?.maxScore ?? currentAttempt.maxScore);
  const safeMax = Number.isFinite(maxScore) && maxScore > 0 ? maxScore : currentAttempt.maxScore;
  const rawScore = payload?.score;
  const score = rawScore == null ? null : clampNumber(rawScore, 0, safeMax);

  return {
    ...state,
    attempts: {
      ...state.attempts,
      [currentTask.taskId]: {
        ...currentAttempt,
        status: TASK_STATUS.SUBMITTED,
        submittedAt: asISO(now),
        score,
        maxScore: safeMax,
        meta: payload?.meta || null,
      },
    },
  };
}

export function updateTaskScore(state, taskId, payload, { skipAggregate = false } = {}) {
  if (!state || !taskId || !state.attempts[taskId]) return state;
  const current = state.attempts[taskId];
  const maxScore = Number(payload?.maxScore ?? current.maxScore);
  const safeMax = Number.isFinite(maxScore) && maxScore > 0 ? maxScore : current.maxScore;
  const hasExplicitScore = Object.prototype.hasOwnProperty.call(payload || {}, "score");
  const incomingScore = hasExplicitScore ? payload?.score : current.score;
  const score = incomingScore == null ? null : clampNumber(incomingScore, 0, safeMax);
  const next = {
    ...state,
    attempts: {
      ...state.attempts,
      [taskId]: {
        ...current,
        score,
        maxScore: safeMax,
        meta: payload?.meta ? { ...(current.meta || {}), ...payload.meta } : current.meta,
      },
    },
  };
  if (!skipAggregate && (next.status === MOCK_EXAM_STATUS.COMPLETED || next.status === MOCK_EXAM_STATUS.ABORTED)) {
    return { ...next, aggregate: computeAggregate(next.blueprint, next.attempts) };
  }
  return next;
}

export function recomputeAggregate(state) {
  if (!state) return state;
  return { ...state, aggregate: computeAggregate(state.blueprint, state.attempts) };
}

export function moveToNextTask(state, now) {
  if (!state || state.status !== MOCK_EXAM_STATUS.RUNNING) return state;
  const currentTask = state.blueprint[state.currentTaskIndex];
  if (!currentTask) return state;
  const currentAttempt = state.attempts[currentTask.taskId];
  if (!currentAttempt || currentAttempt.status !== TASK_STATUS.SUBMITTED) return state;

  const nextIndex = state.currentTaskIndex + 1;
  if (nextIndex >= state.blueprint.length) {
    return {
      ...state,
      status: MOCK_EXAM_STATUS.COMPLETED,
      completedAt: asISO(now),
      aggregate: computeAggregate(state.blueprint, state.attempts),
    };
  }

  const nextTask = state.blueprint[nextIndex];
  return {
    ...state,
    currentTaskIndex: nextIndex,
    attempts: {
      ...state.attempts,
      [nextTask.taskId]: {
        ...state.attempts[nextTask.taskId],
        status: TASK_STATUS.STARTED,
        startedAt: state.attempts[nextTask.taskId].startedAt || asISO(now),
      },
    },
  };
}

export function abortMockExam(state, now) {
  if (!state || state.status !== MOCK_EXAM_STATUS.RUNNING) return state;
  return {
    ...state,
    status: MOCK_EXAM_STATUS.ABORTED,
    completedAt: asISO(now),
    aggregate: computeAggregate(state.blueprint, state.attempts),
  };
}

export function getCurrentTask(state) {
  if (!state || state.currentTaskIndex < 0) return null;
  return state.blueprint[state.currentTaskIndex] || null;
}
