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

// 模考记录按 details.mockSessionId 落在「同一行」：写作模考评分失败后「重试 AI 评分」会把整条记录再存一次，
// 以前每次都 insert，云端就多出一行同一场模考。找到同 key 的行就原地更新 score + details（date 保留首存时间）；
// 没 key / 没找到 / 查询出错才 insert —— 最坏情况与从前一样多一行，绝不丢记录。
export async function upsertMockSessionCloud(userCode, session, mockSessionId) {
  if (!supabase) return { error: "Supabase not configured" };
  const key = typeof mockSessionId === "string" ? mockSessionId.trim() : "";
  if (key) {
    let id = null;
    try {
      const { data, error } = await supabase
        .from("sessions")
        .select("id")
        .eq("user_code", userCode)
        .eq("type", session.type)
        .eq("details->>mockSessionId", key)
        .order("date", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);
      if (!error && Array.isArray(data)) id = data[0]?.id ?? null;
    } catch {
      id = null;
    }
    if (id != null) {
      const { error: updateError } = await supabase
        .from("sessions")
        .update({ score: buildScoreObj(session), details: session.details || null })
        .eq("id", id)
        .eq("user_code", userCode);
      return { error: updateError?.message || null };
    }
  }
  return saveSessionCloud(userCode, session);
}

// 只更新一行的 details（讲评 lesson 在评分之后才到，必须回写到已经插好的那条记录）。
// 带上 user_code 条件是防越权：id 是自增整数，光靠它谁都能改别人的记录。
export async function updateSessionDetailsCloud(userCode, sessionId, details) {
  if (!supabase) return { error: "Supabase not configured" };
  const { error } = await supabase
    .from("sessions")
    .update({ details })
    .eq("id", sessionId)
    .eq("user_code", userCode);
  return { error: error?.message || null };
}

// 整条记录补丁：分数在 score 列、题目与反馈在 details 列，两列一起写。
// 目前唯一用途：真题记录「重试评分」——评分失败时 score 为空、details.feedback 为 null，
// 重试成功后要把新分数与完整反馈一并补回同一行（updateSessionDetailsCloud 只写 details，不够用）。
// 带 user_code 条件防越权，理由同上。
export async function updateSessionCloud(userCode, sessionId, session) {
  if (!supabase) return { error: "Supabase not configured" };
  const { error } = await supabase
    .from("sessions")
    .update({ score: buildScoreObj(session), details: session.details || null })
    .eq("id", sessionId)
    .eq("user_code", userCode);
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
