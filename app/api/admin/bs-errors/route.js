import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../lib/apiResponse";

/**
 * GET /api/admin/bs-errors
 *
 * Aggregates Build Sentence error data across all users.
 * Returns per-question error rates and grammar-point weakness summary.
 */
export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const url = new URL(request.url);
    const sessionLimit = Math.min(5000, Math.max(100, Number(url.searchParams.get("limit") || 2000)));

    // Fetch BS sessions
    const { data: bsRows, error: bsErr } = await supabaseAdmin
      .from("sessions")
      .select("id,user_code,date,score,details")
      .eq("type", "bs")
      .order("date", { ascending: false })
      .limit(sessionLimit);
    if (bsErr) return jsonError(400, bsErr.message || "Load BS sessions failed");

    // Also fetch mock sessions that may contain BS tasks
    const { data: mockRows, error: mockErr } = await supabaseAdmin
      .from("sessions")
      .select("id,user_code,date,score,details")
      .eq("type", "mock")
      .order("date", { ascending: false })
      .limit(Math.floor(sessionLimit / 2));
    if (mockErr) return jsonError(400, mockErr.message || "Load mock sessions failed");

    // Aggregate: question answer → { total, wrong, grammar_points, prompt }
    const questionMap = new Map();
    // Aggregate: grammar point → { total, wrong }
    const grammarMap = new Map();
    // Per-user stats
    const userMap = new Map();

    let totalAttempts = 0;
    let totalWrong = 0;
    let uniqueUsers = new Set();

    function processDetail(d, userCode) {
      if (!d || typeof d !== "object") return;
      const correctAnswer = String(d.correctAnswer || "").trim();
      if (!correctAnswer) return;

      // Skip unanswered questions — they are stored as "(no answer)" when
      // the user didn't complete the full set or ran out of time.
      const userAnswer = String(d.userAnswer || "").trim();
      if (!userAnswer || userAnswer === "(no answer)") return;

      const isCorrect = d.isCorrect === true;
      totalAttempts += 1;
      if (!isCorrect) totalWrong += 1;
      uniqueUsers.add(userCode);

      // Per-question aggregation (keyed by correctAnswer)
      const key = correctAnswer.toLowerCase();
      if (!questionMap.has(key)) {
        questionMap.set(key, {
          correctAnswer,
          prompt: String(d.prompt || ""),
          grammar_points: d.grammar_points || [],
          total: 0,
          wrong: 0,
          users: new Set(),
          wrongUsers: new Set(),
          attempts: [],
        });
      }
      const q = questionMap.get(key);
      q.total += 1;
      q.users.add(userCode);
      // Keep up to 20 wrong attempts for inspection
      if (!isCorrect) {
        q.wrong += 1;
        q.wrongUsers.add(userCode);
        if (q.attempts.length < 20) {
          q.attempts.push({ userCode, userAnswer });
        }
      }

      // Per-grammar-point aggregation
      const gps = Array.isArray(d.grammar_points) ? d.grammar_points : [];
      for (const gp of gps) {
        const gpKey = String(gp).trim().toLowerCase();
        if (!gpKey) continue;
        if (!grammarMap.has(gpKey)) {
          grammarMap.set(gpKey, { name: String(gp).trim(), total: 0, wrong: 0 });
        }
        const g = grammarMap.get(gpKey);
        g.total += 1;
        if (!isCorrect) g.wrong += 1;
      }

      // Per-user aggregation
      if (!userMap.has(userCode)) {
        userMap.set(userCode, { total: 0, wrong: 0 });
      }
      const u = userMap.get(userCode);
      u.total += 1;
      if (!isCorrect) u.wrong += 1;
    }

    // Process BS sessions
    for (const row of bsRows || []) {
      const details = Array.isArray(row?.details) ? row.details : [];
      for (const d of details) {
        processDetail(d, row.user_code);
      }
    }

    // Process mock sessions (extract BS task details)
    for (const row of mockRows || []) {
      const tasks = Array.isArray(row?.score?.tasks)
        ? row.score.tasks
        : Array.isArray(row?.details?.tasks)
          ? row.details.tasks
          : [];
      for (const t of tasks) {
        if (String(t?.taskId || "") !== "build-sentence") continue;
        const details = Array.isArray(t?.meta?.details) ? t.meta.details : [];
        for (const d of details) {
          processDetail(d, row.user_code);
        }
      }
    }

    // Build sorted question error list (highest error rate first)
    const questions = [...questionMap.values()]
      .map((q) => ({
        correctAnswer: q.correctAnswer,
        prompt: q.prompt,
        grammar_points: q.grammar_points,
        total: q.total,
        wrong: q.wrong,
        errorRate: q.total > 0 ? Math.round((q.wrong / q.total) * 1000) / 10 : 0,
        uniqueUsers: q.users.size,
        uniqueWrongUsers: q.wrongUsers.size,
        wrongAttempts: q.attempts,
      }))
      .filter((q) => q.total >= 2) // Only show questions attempted at least twice
      .sort((a, b) => b.errorRate - a.errorRate || b.wrong - a.wrong);

    // Build sorted grammar weakness list
    const grammarPoints = [...grammarMap.values()]
      .map((g) => ({
        name: g.name,
        total: g.total,
        wrong: g.wrong,
        errorRate: g.total > 0 ? Math.round((g.wrong / g.total) * 1000) / 10 : 0,
      }))
      .filter((g) => g.total >= 3)
      .sort((a, b) => b.errorRate - a.errorRate || b.wrong - a.wrong);

    // Per-user error rates (sorted by error rate desc)
    const users = [...userMap.entries()]
      .map(([code, u]) => ({
        code,
        total: u.total,
        wrong: u.wrong,
        errorRate: u.total > 0 ? Math.round((u.wrong / u.total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.errorRate - a.errorRate);

    return Response.json({
      summary: {
        totalAttempts,
        totalWrong,
        overallErrorRate: totalAttempts > 0 ? Math.round((totalWrong / totalAttempts) * 1000) / 10 : 0,
        uniqueUsers: uniqueUsers.size,
        bsSessions: (bsRows || []).length,
        mockSessions: (mockRows || []).length,
      },
      questions,
      grammarPoints,
      users,
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
