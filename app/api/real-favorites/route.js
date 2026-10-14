import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../lib/rateLimit";
import { jsonError } from "../../../lib/apiResponse";
import { REAL_FAVORITES_MAX } from "../../../lib/realBankFavorites";
import { toFavRow, favTime as time } from "../../../lib/realBankFavoriteRow";

/**
 * 真题收藏夹的云端副本（lib/realBankFavorites.js 是真源，这里只是跨设备镜像）。
 * 整条收藏存 JSONB；fav_key、updated_at 提成列，供去重和「谁新谁赢」合并。
 * 取消收藏是软删除（fav.deletedAt），行不删。表见 scripts/sql/real-bank-favorites.sql。
 */

const TABLE = "real_bank_favorites";
const MAX_PER_REQUEST = 100;
const CAS_ATTEMPTS = 5;

const limiter = createRateLimiter("real-favorites", { window: 60_000, max: 60 });

function normalizeCode(raw) {
  return String(raw || "").toUpperCase().trim();
}

async function saveFavorite(code, row, initial) {
  let current = initial;
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    if (current && time(row.updated_at) <= time(current.updated_at)) return { saved: false };
    if (current) {
      // Only replace the version actually observed. A newer cancellation must
      // survive an older favorite request that read before that cancellation.
      const { data, error } = await supabaseAdmin.from(TABLE)
        .update({ fav: row.fav, updated_at: row.updated_at })
        .eq("user_code", code).eq("fav_key", row.fav_key).eq("updated_at", current.updated_at)
        .select("fav_key");
      if (error) return { error: error.message || "Save favorites failed" };
      if (data?.length) return { saved: true };
    } else {
      const { error } = await supabaseAdmin.from(TABLE).insert(row);
      if (!error) return { saved: true };
      if (error.code !== "23505") return { error: error.message || "Save favorites failed" };
    }
    const { data, error } = await supabaseAdmin.from(TABLE).select("fav_key,updated_at")
      .eq("user_code", code).eq("fav_key", row.fav_key).maybeSingle();
    if (error) return { error: error.message || "Reload favorites failed" };
    current = data;
  }
  return { error: "Favorite changed concurrently; retry sync" };
}

export async function GET(request) {
  try {
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");
    const code = normalizeCode(new URL(request.url).searchParams.get("code"));
    if (!code) return jsonError(400, "code is required");
    const { data, error } = await supabaseAdmin.from(TABLE).select("fav_key,fav,updated_at")
      .eq("user_code", code).order("updated_at", { ascending: false }).limit(REAL_FAVORITES_MAX * 2);
    if (error) return jsonError(503, error.message || "Load favorites failed");
    const favorites = (data || []).map((r) => ({ ...(r.fav || {}), key: r.fav_key, updatedAt: r.updated_at }));
    return Response.json({ ok: true, favorites });
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
    const favorites = Array.isArray(body?.favorites) ? body.favorites : null;
    if (!favorites || favorites.length === 0) return jsonError(400, "favorites must be a non-empty array");
    if (favorites.length > MAX_PER_REQUEST) return jsonError(400, `too many favorites (${favorites.length} > ${MAX_PER_REQUEST})`);

    const byKey = new Map();
    for (const raw of favorites) {
      const { row, error } = toFavRow(code, raw);
      if (error) return jsonError(400, error);
      const cur = byKey.get(row.fav_key);
      if (!cur || time(row.updated_at) > time(cur.updated_at)) byKey.set(row.fav_key, row);
    }
    const rows = [...byKey.values()];

    // 云端已有更新的版本就不覆盖（另一台设备后改的）。
    const { data: existing, error: readError } = await supabaseAdmin.from(TABLE)
      .select("fav_key,updated_at").eq("user_code", code).in("fav_key", rows.map((r) => r.fav_key));
    if (readError) return jsonError(503, readError.message || "Load favorites failed");
    const known = new Map((existing || []).map((r) => [r.fav_key, r]));
    let saved = 0;
    for (const row of rows) {
      const result = await saveFavorite(code, row, known.get(row.fav_key));
      if (result.error) return jsonError(503, result.error);
      if (result.saved) saved += 1;
    }
    return Response.json({ ok: true, saved });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
