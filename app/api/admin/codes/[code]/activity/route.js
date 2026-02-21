import { isAdminAuthorized } from "../../../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../../../lib/supabaseAdmin";

function jsonError(status, error) {
  return Response.json({ error }, { status });
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCode(code) {
  return String(code || "").toUpperCase().trim();
}

function buildAttemptBase(row, taskType, idx) {
  return {
    id: `${row.id || "session"}-${taskType}-${idx}`,
    sessionId: row.id || null,
    date: row.date || null,
    sourceType: row.type || "",
    taskType,
  };
}

function collectFromBs(row, acc, summary, attemptLimit) {
  const details = Array.isArray(row?.details) ? row.details : [];
  const questionCount = details.length > 0 ? details.length : safeNum(row?.score?.total, 0);
  summary.answered.build += questionCount;
  summary.answered.total += questionCount;

  details.forEach((d, i) => {
    if (acc.length >= attemptLimit) return;
    acc.push({
      ...buildAttemptBase(row, "build-sentence", i),
      prompt: String(d?.prompt || ""),
      answer: String(d?.userAnswer || ""),
      scoreText: d?.isCorrect ? "Correct" : "Incorrect",
      isCorrect: d?.isCorrect === true,
      correctAnswer: String(d?.correctAnswer || ""),
    });
  });
}

function collectFromWriting(row, acc, summary, attemptLimit, taskType) {
  summary.answered[taskType] += 1;
  summary.answered.total += 1;
  if (acc.length >= attemptLimit) return;
  const score = safeNum(row?.score?.score, NaN);
  acc.push({
    ...buildAttemptBase(row, taskType, 0),
    prompt: String(row?.details?.promptSummary || ""),
    answer: String(row?.details?.userText || ""),
    scoreText: Number.isFinite(score) ? `${score}/5` : "-",
    band: row?.details?.feedback?.band ?? null,
  });
}

function collectFromMock(row, acc, summary, attemptLimit) {
  const tasks = Array.isArray(row?.score?.tasks)
    ? row.score.tasks
    : Array.isArray(row?.details?.tasks)
      ? row.details.tasks
      : [];
  for (let i = 0; i < tasks.length; i += 1) {
    const t = tasks[i] || {};
    const taskId = String(t?.taskId || "");
    if (taskId === "build-sentence") {
      const details = Array.isArray(t?.meta?.details) ? t.meta.details : [];
      const detailCount = details.length > 0 ? details.length : safeNum(t?.meta?.detailCount, 10);
      summary.answered.build += detailCount;
      summary.answered.total += detailCount;
      details.forEach((d, j) => {
        if (acc.length >= attemptLimit) return;
        acc.push({
          ...buildAttemptBase(row, "build-sentence", `${i}-${j}`),
          prompt: String(d?.prompt || ""),
          answer: String(d?.userAnswer || ""),
          scoreText: d?.isCorrect ? "Correct" : "Incorrect",
          isCorrect: d?.isCorrect === true,
          correctAnswer: String(d?.correctAnswer || ""),
        });
      });
      continue;
    }

    if (taskId === "email-writing" || taskId === "academic-writing") {
      const mappedType = taskId === "email-writing" ? "email" : "discussion";
      summary.answered[mappedType] += 1;
      summary.answered.total += 1;
      if (acc.length >= attemptLimit) continue;
      const response = t?.meta?.response || t?.meta?.deferredPayload || {};
      const score = safeNum(t?.score, NaN);
      const maxScore = safeNum(t?.maxScore, 5);
      acc.push({
        ...buildAttemptBase(row, mappedType, i),
        prompt: String(response?.promptSummary || ""),
        answer: String(response?.userText || ""),
        scoreText: Number.isFinite(score) ? `${score}/${maxScore}` : "pending",
      });
    }
  }
}

export async function GET(request, { params }) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const code = normalizeCode(params?.code);
    if (!code || code.length !== 6) return jsonError(400, "Invalid code");

    const url = new URL(request.url);
    const sessionLimit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 120)));
    const attemptLimit = Math.min(2000, Math.max(50, Number(url.searchParams.get("attemptLimit") || 400)));

    const { data: rows, error } = await supabaseAdmin
      .from("sessions")
      .select("id,user_code,type,date,score,details")
      .eq("user_code", code)
      .order("date", { ascending: false })
      .limit(sessionLimit);
    if (error) return jsonError(400, error.message || "Load activity failed");

    const attempts = [];
    const summary = {
      sessions: Array.isArray(rows) ? rows.length : 0,
      answered: { build: 0, email: 0, discussion: 0, total: 0 },
      lastActiveAt: rows?.[0]?.date || null,
    };

    for (const row of rows || []) {
      const type = String(row?.type || "");
      if (type === "bs") {
        collectFromBs(row, attempts, summary, attemptLimit);
        continue;
      }
      if (type === "email") {
        collectFromWriting(row, attempts, summary, attemptLimit, "email");
        continue;
      }
      if (type === "discussion") {
        collectFromWriting(row, attempts, summary, attemptLimit, "discussion");
        continue;
      }
      if (type === "mock") {
        collectFromMock(row, attempts, summary, attemptLimit);
      }
    }

    return Response.json({ code, summary, attempts });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
