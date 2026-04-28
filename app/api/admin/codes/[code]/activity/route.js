import { isAdminAuthorized } from "../../../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../../../lib/apiResponse";

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCode(code) {
  return String(code || "").toUpperCase().trim();
}

// Mock task-id → subject/subtype routing. Mirrors codes/route.js — extend both
// when reading/listening tasks land in mock-exam.
const TASKID_TO_SUBJECT_SUBTYPE = {
  "build-sentence": { subject: "writing", subtype: "build" },
  "email-writing": { subject: "writing", subtype: "email" },
  "academic-writing": { subject: "writing", subtype: "discussion" },
};

function emptyAnswered() {
  return {
    writing: { build: 0, email: 0, discussion: 0, total: 0 },
    reading: { ctw: 0, rdl: 0, ap: 0, total: 0 },
    listening: { lcr: 0, la: 0, lc: 0, lat: 0, total: 0 },
    speaking: { interview: 0, repeat: 0, total: 0 },
    // Legacy flat aliases (mirror writing.*)
    build: 0,
    email: 0,
    discussion: 0,
    total: 0,
  };
}

function applyDelta(target, subject, subtype, n = 1) {
  if (!target[subject]) return;
  if (subtype && target[subject][subtype] !== undefined) {
    target[subject][subtype] += n;
  }
  target[subject].total += n;
  if (subject === "writing") {
    if (subtype && target[subtype] !== undefined) target[subtype] += n;
    target.total += n;
  }
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
  applyDelta(summary.answered, "writing", "build");

  details.forEach((d, i) => {
    if (acc.length >= attemptLimit) return;
    acc.push({
      ...buildAttemptBase(row, "build-sentence", i),
      subject: "writing",
      subtype: "build",
      prompt: String(d?.prompt || ""),
      answer: String(d?.userAnswer || ""),
      scoreText: d?.isCorrect ? "Correct" : "Incorrect",
      isCorrect: d?.isCorrect === true,
      correctAnswer: String(d?.correctAnswer || ""),
    });
  });
}

function collectFromWriting(row, acc, summary, attemptLimit, subtype) {
  applyDelta(summary.answered, "writing", subtype);
  if (acc.length >= attemptLimit) return;
  const score = safeNum(row?.score?.score, NaN);
  acc.push({
    ...buildAttemptBase(row, subtype, 0),
    subject: "writing",
    subtype,
    prompt: String(row?.details?.promptSummary || ""),
    answer: String(row?.details?.userText || ""),
    scoreText: Number.isFinite(score) ? `${score}/5` : "-",
    band: row?.details?.feedback?.band ?? null,
  });
}

function collectFromReadingOrListening(row, acc, summary, attemptLimit, subject) {
  const details = row?.details || {};
  const subtype = String(details?.subtype || "").toLowerCase();
  if (!subtype) return;
  applyDelta(summary.answered, subject, subtype);
  if (acc.length >= attemptLimit) return;
  const results = Array.isArray(details?.results) ? details.results : [];
  const total = results.length;
  const correct = results.filter((r) => r?.correct === true || r?.isCorrect === true).length;
  const pct = total > 0 ? Math.round((correct / total) * 100) : null;
  acc.push({
    ...buildAttemptBase(row, `${subject}-${subtype}`, 0),
    subject,
    subtype,
    topic: String(details?.topic || details?.genre || ""),
    correct,
    total,
    pct,
    scoreText: total > 0 ? `${correct}/${total}` : "-",
  });
}

function collectFromSpeaking(row, acc, summary, attemptLimit) {
  const details = row?.details || {};
  const subtype = String(details?.subtype || "").toLowerCase();
  if (!subtype) return;
  applyDelta(summary.answered, "speaking", subtype);
  if (acc.length >= attemptLimit) return;
  acc.push({
    ...buildAttemptBase(row, `speaking-${subtype}`, 0),
    subject: "speaking",
    subtype,
    topic: String(details?.topic || ""),
    scoreText: "-",
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
    const map = TASKID_TO_SUBJECT_SUBTYPE[taskId];
    if (!map) continue;

    if (map.subject === "writing" && map.subtype === "build") {
      const tDetails = Array.isArray(t?.meta?.details) ? t.meta.details : [];
      applyDelta(summary.answered, "writing", "build");
      tDetails.forEach((d, j) => {
        if (acc.length >= attemptLimit) return;
        acc.push({
          ...buildAttemptBase(row, "build-sentence", `${i}-${j}`),
          subject: "writing",
          subtype: "build",
          fromMock: true,
          prompt: String(d?.prompt || ""),
          answer: String(d?.userAnswer || ""),
          scoreText: d?.isCorrect ? "Correct" : "Incorrect",
          isCorrect: d?.isCorrect === true,
          correctAnswer: String(d?.correctAnswer || ""),
        });
      });
      continue;
    }

    if (map.subject === "writing") {
      applyDelta(summary.answered, "writing", map.subtype);
      if (acc.length >= attemptLimit) continue;
      const response = t?.meta?.response || t?.meta?.deferredPayload || {};
      const score = safeNum(t?.score, NaN);
      const maxScore = safeNum(t?.maxScore, 5);
      acc.push({
        ...buildAttemptBase(row, map.subtype, i),
        subject: "writing",
        subtype: map.subtype,
        fromMock: true,
        prompt: String(response?.promptSummary || ""),
        answer: String(response?.userText || ""),
        scoreText: Number.isFinite(score) ? `${score}/${maxScore}` : "pending",
      });
    }
    // Future: reading/listening tasks in mock would be handled here via map.subject.
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
      answered: emptyAnswered(),
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
      if (type === "reading") {
        collectFromReadingOrListening(row, attempts, summary, attemptLimit, "reading");
        continue;
      }
      if (type === "listening") {
        collectFromReadingOrListening(row, attempts, summary, attemptLimit, "listening");
        continue;
      }
      if (type === "speaking") {
        collectFromSpeaking(row, attempts, summary, attemptLimit);
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
