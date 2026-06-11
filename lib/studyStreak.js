/**
 * 打卡 / 倒计时纯函数：从练习历史（sessions）派生连续打卡、当月日历网格，
 * 以及距考试天数。全部用本地时区计算，避免 UTC 跨日错位。无副作用，便于测试。
 */

/** Date | ISO string → "YYYY-MM-DD"（本地时区），无效输入返回 null */
export function toLocalDateKey(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 取某天 00:00 的本地 Date（去掉时分秒） */
export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date, n) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** sessions → Map<dateKey, 当日练习次数> */
export function buildPracticeMap(sessions) {
  const map = new Map();
  for (const s of sessions || []) {
    const key = toLocalDateKey(s?.date);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

/**
 * 连续打卡：从今天往回数连续有练习的天数。
 * 今天还没练 → 从昨天起算（连胜不算断，今日待打卡）；今昨都没练 → 0。
 */
export function computeStreak(practiceMap, today = new Date()) {
  const has = (d) => practiceMap.has(toLocalDateKey(d));
  const start = startOfDay(today);
  const practicedToday = has(start);
  let cursor = practicedToday ? start : addDays(start, -1);
  let streak = 0;
  while (has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return { streak, practicedToday };
}

/** 距考试天数：>0 未到，0 当天，<0 已过。examDateStr 为 "YYYY-MM-DD"（本地意图） */
export function daysUntil(examDateStr, today = new Date()) {
  if (!examDateStr || typeof examDateStr !== "string") return null;
  const [y, m, d] = examDateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  const exam = new Date(y, m - 1, d);
  if (Number.isNaN(exam.getTime())) return null;
  const t0 = startOfDay(today);
  return Math.round((exam.getTime() - t0.getTime()) / 86400000);
}

/**
 * 当月日历网格。返回若干周，每周 7 个 cell：{ date, inMonth }。
 * weekStartsOn=1 → 周一为每周第一天（中文习惯）。自动裁掉整周不属于本月的尾行。
 */
export function buildMonthGrid(year, month, { weekStartsOn = 1 } = {}) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  let cursor = addDays(first, -offset);
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const week = [];
    for (let i = 0; i < 7; i += 1) {
      week.push({ date: cursor, inMonth: cursor.getMonth() === month });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks.filter((week) => week.some((cell) => cell.inMonth));
}

/**
 * 贡献热力图列（GitHub 风格）。返回 numWeeks 列，每列 7 天（周一→周日），
 * 含 { date, key, count, isFuture, isToday }。最后一列为本周（含未来天）。
 */
export function buildHeatmapColumns(practiceMap, today = new Date(), numWeeks = 12) {
  const t0 = startOfDay(today);
  const todayKey = toLocalDateKey(t0);
  const dow = (t0.getDay() + 6) % 7; // 周一=0
  const thisMonday = addDays(t0, -dow);
  let cursor = addDays(thisMonday, -(numWeeks - 1) * 7);
  const columns = [];
  for (let w = 0; w < numWeeks; w += 1) {
    const col = [];
    for (let d = 0; d < 7; d += 1) {
      const key = toLocalDateKey(cursor);
      col.push({
        date: new Date(cursor),
        key,
        count: practiceMap.get(key) || 0,
        isFuture: cursor.getTime() > t0.getTime(),
        isToday: key === todayKey,
      });
      cursor = addDays(cursor, 1);
    }
    columns.push(col);
  }
  return columns;
}
