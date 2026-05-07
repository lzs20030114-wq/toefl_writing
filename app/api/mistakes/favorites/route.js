import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { jsonError } from "../../../../lib/apiResponse";

const VALID_SUBJECTS = new Set(["bs", "reading", "listening"]);
const SNAPSHOT_MAX_BYTES = 5 * 1024;

const limiter = createRateLimiter("mistake-fav", { window: 60_000, max: 30 });

function normalizeCode(raw) {
  return String(raw || "").toUpperCase().trim();
}

function validateSnapshot(s) {
  if (!s || typeof s !== "object") return "snapshot must be an object";
  if (!s.prompt && !s.correctAnswer) return "snapshot needs at least prompt or correctAnswer";
  let bytes;
  try { bytes = JSON.stringify(s).length; } catch { return "snapshot is not JSON-serializable"; }
  if (bytes > SNAPSHOT_MAX_BYTES) return `snapshot too large (${bytes} > ${SNAPSHOT_MAX_BYTES} bytes)`;
  return null;
}

export async function GET(request) {
  try {
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const url = new URL(request.url);
    const code = normalizeCode(url.searchParams.get("code"));
    if (!code) return jsonError(400, "code is required");

    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)));

    const { data, error } = await supabaseAdmin
      .from("mistake_favorites")
      .select("id,subject,session_id,detail_index,snapshot,note,created_at")
      .eq("user_code", code)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return jsonError(400, error.message || "Load favorites failed");

    return Response.json({ ok: true, favorites: data || [] });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}

export async function POST(request) {
  try {
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const body = await request.json().catch(() => ({}));
    const code = normalizeCode(body?.code);
    if (!code) return jsonError(400, "code is required");

    const subject = String(body?.subject || "bs").toLowerCase();
    if (!VALID_SUBJECTS.has(subject)) return jsonError(400, `Invalid subject "${subject}"`);

    const sessionIdRaw = body?.sessionId;
    const sessionId = sessionIdRaw == null ? null : Number(sessionIdRaw);
    if (sessionId != null && !Number.isInteger(sessionId)) return jsonError(400, "sessionId must be an integer or null");

    const detailIndexRaw = body?.detailIndex;
    const detailIndex = detailIndexRaw == null ? null : Number(detailIndexRaw);
    if (detailIndex != null && (!Number.isInteger(detailIndex) || detailIndex < 0)) {
      return jsonError(400, "detailIndex must be a non-negative integer or null");
    }

    const snapshot = body?.snapshot;
    const snapErr = validateSnapshot(snapshot);
    if (snapErr) return jsonError(400, snapErr);

    // Idempotent: if a favorite with the same (user, session, index) already exists, return it.
    if (sessionId != null && detailIndex != null) {
      const { data: existing } = await supabaseAdmin
        .from("mistake_favorites")
        .select("id,subject,session_id,detail_index,snapshot,note,created_at")
        .eq("user_code", code)
        .eq("session_id", sessionId)
        .eq("detail_index", detailIndex)
        .maybeSingle();
      if (existing) return Response.json({ ok: true, favorite: existing, deduped: true });
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("mistake_favorites")
      .insert({
        user_code: code,
        subject,
        session_id: sessionId,
        detail_index: detailIndex,
        snapshot,
      })
      .select("id,subject,session_id,detail_index,snapshot,note,created_at")
      .single();
    if (error) {
      // 23505 = unique_violation — treat as success (race condition, refetch existing).
      if (error.code === "23505" && sessionId != null && detailIndex != null) {
        const { data: existing } = await supabaseAdmin
          .from("mistake_favorites")
          .select("id,subject,session_id,detail_index,snapshot,note,created_at")
          .eq("user_code", code)
          .eq("session_id", sessionId)
          .eq("detail_index", detailIndex)
          .maybeSingle();
        if (existing) return Response.json({ ok: true, favorite: existing, deduped: true });
      }
      return jsonError(400, error.message || "Insert favorite failed");
    }

    return Response.json({ ok: true, favorite: inserted });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}

export async function DELETE(request) {
  try {
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const url = new URL(request.url);
    const code = normalizeCode(url.searchParams.get("code"));
    if (!code) return jsonError(400, "code is required");

    const idRaw = url.searchParams.get("id");
    const sessionRaw = url.searchParams.get("session");
    const indexRaw = url.searchParams.get("index");

    let query = supabaseAdmin
      .from("mistake_favorites")
      .delete()
      .eq("user_code", code);

    if (idRaw) {
      const id = Number(idRaw);
      if (!Number.isInteger(id) || id <= 0) return jsonError(400, "id must be a positive integer");
      query = query.eq("id", id);
    } else if (sessionRaw && indexRaw != null) {
      const sessionId = Number(sessionRaw);
      const detailIndex = Number(indexRaw);
      if (!Number.isInteger(sessionId)) return jsonError(400, "session must be an integer");
      if (!Number.isInteger(detailIndex) || detailIndex < 0) return jsonError(400, "index must be a non-negative integer");
      query = query.eq("session_id", sessionId).eq("detail_index", detailIndex);
    } else {
      return jsonError(400, "Provide either ?id= or ?session=&index=");
    }

    const { data, error } = await query.select("id");
    if (error) return jsonError(400, error.message || "Delete favorite failed");

    return Response.json({ ok: true, removed: (data || []).length });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
