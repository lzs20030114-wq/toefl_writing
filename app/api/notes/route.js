import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../lib/rateLimit";
import { jsonError } from "../../../lib/apiResponse";
import { NOTES_MAX_PER_ACCOUNT } from "../../../lib/notes/passageNotes";
import { toNoteRow, noteTime as time } from "../../../lib/notes/noteRow";

/**
 * 原文批注笔记的云端副本（lib/notes/noteStore.js 是真源，这里只是跨设备镜像）。
 * 整条笔记存 JSONB；note_id、passage_key、updated_at 提成列，供去重和「谁新谁赢」合并。
 * 删除是软删除（note.deletedAt），行不删。
 */

const TABLE = "passage_notes";
const MAX_PER_REQUEST = 100;

const limiter = createRateLimiter("notes", { window: 60_000, max: 60 });

function normalizeCode(raw) {
  return String(raw || "").toUpperCase().trim();
}

export async function GET(request) {
  try {
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");
    const code = normalizeCode(new URL(request.url).searchParams.get("code"));
    if (!code) return jsonError(400, "code is required");
    const { data, error } = await supabaseAdmin.from(TABLE).select("note_id,note,updated_at")
      .eq("user_code", code).order("updated_at", { ascending: false }).limit(NOTES_MAX_PER_ACCOUNT * 2);
    if (error) return jsonError(503, error.message || "Load notes failed");
    const notes = (data || []).map((r) => ({ ...(r.note || {}), id: r.note_id, updatedAt: r.updated_at }));
    return Response.json({ ok: true, notes });
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
    const notes = Array.isArray(body?.notes) ? body.notes : null;
    if (!notes || notes.length === 0) return jsonError(400, "notes must be a non-empty array");
    if (notes.length > MAX_PER_REQUEST) return jsonError(400, `too many notes (${notes.length} > ${MAX_PER_REQUEST})`);

    const byId = new Map();
    for (const raw of notes) {
      const { row, error } = toNoteRow(code, raw);
      if (error) return jsonError(400, error);
      const cur = byId.get(row.note_id);
      if (!cur || time(row.updated_at) > time(cur.updated_at)) byId.set(row.note_id, row);
    }
    const rows = [...byId.values()];

    // 云端已有更新的版本就不覆盖（另一台设备后改的）。
    const { data: existing, error: readError } = await supabaseAdmin.from(TABLE)
      .select("note_id,updated_at").eq("user_code", code).in("note_id", rows.map((r) => r.note_id));
    if (readError) return jsonError(503, readError.message || "Load notes failed");
    const remoteAt = new Map((existing || []).map((r) => [r.note_id, time(r.updated_at)]));
    const writes = rows.filter((r) => !remoteAt.has(r.note_id) || time(r.updated_at) > remoteAt.get(r.note_id));
    if (writes.length) {
      const { error } = await supabaseAdmin.from(TABLE).upsert(writes, { onConflict: "user_code,note_id" });
      if (error) return jsonError(503, error.message || "Save notes failed");
    }
    return Response.json({ ok: true, saved: writes.length });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
