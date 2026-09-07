// 后台「真题板块」聚合（纯函数，供 app/api/admin/real-bank/route.js 与单测复用）。
// 输入是 sessions 表按 REAL_SESSION_SELECT 投影后的行。
import { isRealSessionRow, realItemIdOf } from "./realSession";

const MS = 86400000;

const SUBTYPE_ORDER = [
  ["writing", "build"], ["writing", "email"], ["writing", "discussion"],
  ["reading", "ctw"], ["reading", "rdl"], ["reading", "ap"],
  ["listening", "lcr"], ["listening", "la"], ["listening", "lc"], ["listening", "lat"],
  ["speaking", "interview"], ["speaking", "repeat"],
];

// sessions.type → 科目 / 题型（writing 三种 type 本身就是题型；其余取 details.subtype）。
function subjectSubtypeOf(row) {
  const type = String(row?.type || "");
  if (type === "bs") return ["writing", "build"];
  if (type === "email") return ["writing", "email"];
  if (type === "discussion") return ["writing", "discussion"];
  if (type === "reading" || type === "listening" || type === "speaking") {
    return [type, String(row?.subtype || "").toLowerCase()];
  }
  return [null, null];
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(n, d) {
  return d > 0 ? Math.round((n / d) * 100) : null;
}

export function aggregateRealBank(rows, { days, now = new Date() } = {}) {
  const allSessions = rows.length;
  const allUsers = new Set();
  const realUsers = new Set();
  const bySubtype = new Map();
  const byItem = new Map();
  const dailyMap = {};
  let realSessions = 0;
  let correctSum = 0;
  let totalSum = 0;

  for (const row of rows) {
    if (row.user_code) allUsers.add(row.user_code);
    if (!isRealSessionRow(row)) continue;
    realSessions += 1;
    if (row.user_code) realUsers.add(row.user_code);

    const day = String(row.date || "").slice(0, 10);
    if (day) dailyMap[day] = (dailyMap[day] || 0) + 1;

    const [subject, subtype] = subjectSubtypeOf(row);
    const key = `${subject}.${subtype}`;
    let bucket = bySubtype.get(key);
    if (!bucket) {
      bucket = { subject, subtype, sessions: 0, users: new Set(), correct: 0, total: 0, scoreSum: 0, scoreN: 0 };
      bySubtype.set(key, bucket);
    }
    bucket.sessions += 1;
    if (row.user_code) bucket.users.add(row.user_code);

    // 客观题（bs / 阅读 / 听力）score 里有 correct/total；写作是 score.score(0–5)；口语是 score.score。
    const correct = safeNum(row?.score?.correct);
    const total = safeNum(row?.score?.total);
    if (correct != null && total != null && total > 0) {
      bucket.correct += correct;
      bucket.total += total;
      correctSum += correct;
      totalSum += total;
    } else {
      const score = safeNum(row?.score?.score);
      if (score != null) { bucket.scoreSum += score; bucket.scoreN += 1; }
    }

    const itemId = realItemIdOf(row);
    if (itemId) {
      let it = byItem.get(itemId);
      if (!it) { it = { id: itemId, subject, subtype, sessions: 0, users: new Set() }; byItem.set(itemId, it); }
      it.sessions += 1;
      if (row.user_code) it.users.add(row.user_code);
    }
  }

  const subtypes = SUBTYPE_ORDER.map(([subject, subtype]) => {
    const b = bySubtype.get(`${subject}.${subtype}`);
    if (!b) return { subject, subtype, sessions: 0, users: 0, correct: 0, total: 0, accuracyPct: null, avgScore: null };
    return {
      subject, subtype,
      sessions: b.sessions,
      users: b.users.size,
      correct: b.correct,
      total: b.total,
      accuracyPct: pct(b.correct, b.total),
      avgScore: b.scoreN > 0 ? Math.round((b.scoreSum / b.scoreN) * 10) / 10 : null,
    };
  });
  // 未知题型（subtype 缺失）也别静默丢掉，归到 other。
  for (const [key, b] of bySubtype) {
    if (subtypes.some((s) => `${s.subject}.${s.subtype}` === key)) continue;
    subtypes.push({
      subject: b.subject || "other", subtype: b.subtype || "other",
      sessions: b.sessions, users: b.users.size, correct: b.correct, total: b.total,
      accuracyPct: pct(b.correct, b.total),
      avgScore: b.scoreN > 0 ? Math.round((b.scoreSum / b.scoreN) * 10) / 10 : null,
    });
  }

  const topItems = [...byItem.values()]
    .sort((a, b) => b.sessions - a.sessions || b.users.size - a.users.size || a.id.localeCompare(b.id))
    .slice(0, 10)
    .map((it) => ({ id: it.id, subject: it.subject, subtype: it.subtype, sessions: it.sessions, users: it.users.size }));

  // 每日趋势：给定天数时补齐空日（图表连续）；全量时只列有数据的日子。
  let daily;
  if (days) {
    daily = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(now.getTime() - i * MS).toISOString().slice(0, 10);
      daily.push({ date: d, count: dailyMap[d] || 0 });
    }
  } else {
    daily = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
  }

  return {
    allSessions,
    allUsers: allUsers.size,
    realSessions,
    realUsers: realUsers.size,
    realSharePct: pct(realSessions, allSessions),
    userSharePct: pct(realUsers.size, allUsers.size),
    accuracyPct: pct(correctSum, totalSum),
    subtypes,
    topItems,
    daily,
  };
}

