import { supabase } from "./supabase";

function compactScoreObj(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  );
}

export function buildScoreObj(session) {
  if (session.type === "bs") {
    return compactScoreObj({ correct: session.correct, total: session.total, mode: session.mode });
  }
  if (session.type === "mock") {
    return compactScoreObj({
      band: session.band,
      scaledScore: session.scaledScore ?? session.scaled,
      combinedMean: session.combinedMean,
      tasks: session.tasks || session?.details?.tasks || [],
      cefr: session.cefr,
      mode: session.mode,
    });
  }
  if (session.type === "reading" || session.type === "listening") {
    return compactScoreObj({
      correct: session.correct,
      total: session.total,
      band: session.band ?? session?.details?.band,
      score: session.score,
      mode: session.mode,
    });
  }
  if (session.type === "speaking") {
    return compactScoreObj({
      score: session.score ?? session?.details?.averageScore,
      band: session.band ?? session?.details?.band,
      mode: session.mode,
    });
  }
  return compactScoreObj({ score: session.score, mode: session.mode });
}

export async function saveSessionCloud(userCode, session) {
  if (!supabase) return { error: "Supabase not configured" };

  const record = {
    user_code: userCode,
    type: session.type,
    date: session.date || new Date().toISOString(),
    score: buildScoreObj(session),
    details: session.details || null,
  };

  const { error } = await supabase.from("sessions").insert(record);
  return { error: error?.message || null };
}

export async function loadSessionsCloud(userCode) {
  if (!supabase) return { sessions: [], error: "Supabase not configured" };

  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_code", userCode)
    .order("date", { ascending: false })
    .limit(200);

  if (error) return { sessions: [], error: error.message };

  const sessions = (data || []).map((row) => ({
    id: row.id,
    type: row.type,
    date: row.date,
    ...row.score,
    details: row.details,
  }));

  return { sessions, error: null };
}

// Update an existing session row in place (by id), rather than inserting a new
// one. Used when a stored session is re-scored from history — we must not create
// a duplicate row. Rebuilds the flattened `score` column from the updated session.
export async function updateSessionCloud(sessionId, session) {
  if (!supabase) return { error: "Supabase not configured" };
  const id = Number(sessionId);
  if (!Number.isInteger(id)) return { error: "invalid session id" };
  const { error } = await supabase
    .from("sessions")
    .update({ score: buildScoreObj(session), details: session.details || null })
    .eq("id", id);
  return { error: error?.message || null };
}

export async function deleteSessionCloud(sessionId) {
  if (!supabase) return { error: "Supabase not configured" };
  const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
  return { error: error?.message || null };
}

export async function clearAllSessionsCloud(userCode) {
  if (!supabase) return { error: "Supabase not configured" };
  const { error } = await supabase.from("sessions").delete().eq("user_code", userCode);
  return { error: error?.message || null };
}
