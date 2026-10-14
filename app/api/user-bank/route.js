// 个人题库存量读取与自主删除；新增导入已下线（POST 返回 410）。
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../lib/rateLimit";
import { jsonError } from "../../../lib/apiResponse";
import { userBankRetiredResponse } from "../../../lib/userBank/retired";
import { userAudioStoragePath } from "../../../lib/userBank/listeningAudio";

// Storage whitelist follows shipped types. Widen alongside each launch (discussion+email
// P0; repeat+interview, then build, then rdl+ap, then ctw, then lcr, then la+lat, then lc).
// All 12 subtypes are now live; the DB CHECK constraint covers the same set.
const VALID_TYPES = new Set(["discussion", "email", "repeat", "interview", "build", "rdl", "ap", "ctw", "lcr", "la", "lat", "lc"]);
// Existing rendered audio is only reaped when its owner deletes that question.
const LIST_MAX = 500;
const SELECT_COLS = "id,item_id,type,data,status,source,created_at";

const limiter = createRateLimiter("user-bank", { window: 60_000, max: 60 });

function normalizeCode(raw) {
  return String(raw || "").toUpperCase().trim();
}
function isValidCode(code) {
  return code.length === 6;
}

// Best-effort delete of a user's own rendered audio object. Never throws. Path derivation +
// same-user whitelist lives in userAudioStoragePath (lib/userBank/listeningAudio, unit-tested).
async function reapUserAudio(code, audioUrl) {
  const path = userAudioStoragePath(code, audioUrl);
  if (!path) return;
  try {
    await supabaseAdmin.storage.from("listening_audio").remove([path]);
  } catch {
    /* ignore — nightly sweep is the backstop */
  }
}

export async function GET(request) {
  try {
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const url = new URL(request.url);
    const code = normalizeCode(url.searchParams.get("code"));
    if (!isValidCode(code)) return jsonError(400, "code is required");

    const typeFilter = url.searchParams.get("type");
    if (typeFilter && !VALID_TYPES.has(typeFilter)) return jsonError(400, `Invalid type "${typeFilter}"`);

    let query = supabaseAdmin.from("user_question_banks").select(SELECT_COLS).eq("user_code", code);
    if (typeFilter) query = query.eq("type", typeFilter);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(LIST_MAX);
    if (error) return jsonError(400, error.message || "Load failed");

    return Response.json({ ok: true, items: data || [] });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}

export async function POST() {
  return userBankRetiredResponse();
}

export async function DELETE(request) {
  try {
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const url = new URL(request.url);
    const code = normalizeCode(url.searchParams.get("code"));
    if (!isValidCode(code)) return jsonError(400, "code is required");

    const idRaw = url.searchParams.get("id");
    const itemId = url.searchParams.get("itemId");

    let query = supabaseAdmin.from("user_question_banks").delete().eq("user_code", code);
    if (idRaw) {
      const id = Number(idRaw);
      if (!Number.isInteger(id) || id <= 0) return jsonError(400, "id must be a positive integer");
      query = query.eq("id", id);
    } else if (itemId) {
      query = query.eq("item_id", String(itemId));
    } else {
      return jsonError(400, "Provide either ?id= or ?itemId=");
    }

    // Return data too so we can reap any server-rendered audio object (patch B). The delete
    // is scoped to .eq('user_code'), so returned rows are always this user's own.
    const { data, error } = await query.select("id,data");
    if (error) return jsonError(400, error.message || "Delete failed");

    // Security patch B: best-effort reap the storage object for a listening item whose
    // audio_url points at OUR bucket under this user's own prefix (listening_audio/user/{code}/…).
    // Failure is ignored — the nightly sweep is the backstop for orphans.
    // FUTURE: a scheduled routine should list `user/` and delete objects with no matching row.
    await Promise.all(
      (data || []).map((row) => reapUserAudio(code, row?.data?.audio_url))
    );

    return Response.json({ ok: true, removed: (data || []).length });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
