export const PRACTICE_MODE = {
  STANDARD: "standard",
  CHALLENGE: "challenge",
};

export const STANDARD_TIME_SECONDS = {
  build: 410,
  email: 420,
  discussion: 600,
};

export const CHALLENGE_TIME_SECONDS = {
  // Challenge mode keeps writing quality feasible while increasing pace pressure.
  // Build: -19.5%, Email: -14.3%, Discussion: -15.0%.
  build: 330,
  email: 360,
  discussion: 510,
};

export function normalizePracticeMode(mode) {
  return mode === PRACTICE_MODE.CHALLENGE ? PRACTICE_MODE.CHALLENGE : PRACTICE_MODE.STANDARD;
}

export function getTaskTimeSeconds(taskKey, mode = PRACTICE_MODE.STANDARD) {
  const safeMode = normalizePracticeMode(mode);
  const table = safeMode === PRACTICE_MODE.CHALLENGE ? CHALLENGE_TIME_SECONDS : STANDARD_TIME_SECONDS;
  return table[taskKey] || STANDARD_TIME_SECONDS[taskKey] || 0;
}

export function formatMinutesLabel(seconds) {
  const s = Number(seconds) || 0;
  const min = Math.floor(s / 60);
  const sec = s % 60;
  if (sec === 0) return `${min} min`;
  return `${min}m ${String(sec).padStart(2, "0")}s`;
}

export function formatLongDuration(seconds) {
  const s = Number(seconds) || 0;
  const min = Math.floor(s / 60);
  const sec = s % 60;
  if (sec === 0) return `${min} minutes`;
  return `${min} minutes ${sec} seconds`;
}
