import { supabase } from "./supabase";

function buildScoreObj(session) {
  if (session.type === "bs") {
    return { correct: session.correct, total: session.total };
  }
  if (session.type === "mock") {
    return {
      band: session.band,
      scaledScore: session.scaledScore ?? session.scaled,
      combinedMean: session.combinedMean,
      tasks: session.tasks || session?.details?.tasks || [],
      cefr: session.cefr,
    };
  }
  return { score: session.score };
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

