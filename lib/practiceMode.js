export const PRACTICE_MODE = {
  STANDARD: "standard",
  CHALLENGE: "challenge",
  PRACTICE: "practice",
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

// 阅读三题型的限时表（秒）。原先内联在 app/reading/page.js，真题专区要复用同一口径 ——
// 「常规练习 5 分钟做完的题，真题专区也是 5 分钟」，两处不能各写一份。
// ctw 5/4 min、rdl 4/3 min、ap 8/6.5 min（challenge 一律更紧）。
export const READING_TIME_SECONDS = {
  ctw: { standard: 300, challenge: 240 },
  rdl: { standard: 240, challenge: 180 },
  ap: { standard: 480, challenge: 390 },
};

export function normalizePracticeMode(mode) {
  if (mode === PRACTICE_MODE.CHALLENGE) return PRACTICE_MODE.CHALLENGE;
  if (mode === PRACTICE_MODE.PRACTICE) return PRACTICE_MODE.PRACTICE;
  return PRACTICE_MODE.STANDARD;
}

export function getTaskTimeSeconds(taskKey, mode = PRACTICE_MODE.STANDARD) {
  const safeMode = normalizePracticeMode(mode);
  if (safeMode === PRACTICE_MODE.PRACTICE) return 0;
  const table = safeMode === PRACTICE_MODE.CHALLENGE ? CHALLENGE_TIME_SECONDS : STANDARD_TIME_SECONDS;
  return table[taskKey] || STANDARD_TIME_SECONDS[taskKey] || 0;
}

/**
 * 阅读题的限时（秒）。practice → 0（不限时）；未知 type 回退 300（与旧内联表的兜底同值）。
 */
export function getReadingTimeSeconds(type, mode = PRACTICE_MODE.STANDARD) {
  const safeMode = normalizePracticeMode(mode);
  if (safeMode === PRACTICE_MODE.PRACTICE) return 0;
  const row = READING_TIME_SECONDS[type];
  if (!row) return 300;
  return row[safeMode] || row.standard;
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
