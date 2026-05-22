function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dayTimestamp(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  if (!year || !month || !day) return 0;
  return new Date(year, month - 1, day).getTime();
}

export function localDateKey(dateValue) {
  const d = new Date(dateValue);
  if (!Number.isFinite(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatMonthDayFromDateKey(dateKey) {
  const [, month, day] = String(dateKey || "").split("-");
  return month && day ? `${month}/${day}` : "";
}

export function getAccuracyPercent(session) {
  const s = session || {};
  const topTotal = toFiniteNumber(s.total);
  const topCorrect = toFiniteNumber(s.correct);
  if (topTotal != null && topTotal > 0 && topCorrect != null) {
    return clamp((topCorrect / topTotal) * 100, 0, 100);
  }

  const details = s.details || {};
  if (details.subtype === "mock") {
    const m1 = details.m1 || {};
    const m2 = details.m2 || {};
    const total = (toFiniteNumber(m1.total) || 0) + (toFiniteNumber(m2.total) || 0);
    const correct = (toFiniteNumber(m1.correct) || 0) + (toFiniteNumber(m2.correct) || 0);
    if (total > 0) return clamp((correct / total) * 100, 0, 100);
  }

  const results = Array.isArray(details.results) ? details.results : [];
  if (results.length > 0) {
    const correct = results.filter((r) => r?.isCorrect).length;
    return clamp((correct / results.length) * 100, 0, 100);
  }

  return null;
}

export function getSpeakingAverageScore(session) {
  const score = toFiniteNumber(session?.details?.averageScore ?? session?.score);
  return score != null && score > 0 ? clamp(score, 0, 5) : null;
}

export function getSpeakingBandScore(session) {
  const band = toFiniteNumber(session?.band ?? session?.details?.band);
  return band != null && band > 0 ? clamp(band, 0, 6) : null;
}

export function buildDailyAveragePoints(sessions, getScore) {
  const byDay = {};
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    const score = getScore(session);
    if (!Number.isFinite(score)) return;
    const date = localDateKey(session?.date);
    if (!date) return;
    if (!byDay[date]) byDay[date] = { scores: [], date };
    byDay[date].scores.push(score);
  });

  return Object.values(byDay)
    .filter((group) => group.scores.length > 0)
    .map((group) => ({
      date: group.date,
      ts: dayTimestamp(group.date),
      avg: group.scores.reduce((a, b) => a + b, 0) / group.scores.length,
    }))
    .sort((a, b) => a.ts - b.ts);
}
