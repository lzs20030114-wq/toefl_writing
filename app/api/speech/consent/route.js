/**
 * POST /api/speech/consent
 *
 * Records the user's grant or revocation of consent to upload their voice
 * recordings for AI scoring. Required for PIPL compliance — Chinese law treats
 * voice as personal information and demands explicit, revocable consent before
 * transmitting it to a third party (OpenAI Whisper / Microsoft Azure), all of
 * which run outside mainland China.
 *
 * Consent v2 (2026-07) additionally discloses that, during the test window, some
 * recordings are RETAINED (≤ 90 days) for scoring-quality experiments. Retention
 * is unlocked only by v2 consent; legacy v1 consent still permits transcription
 * but never retention.
 *
 * grant  → speech_consent_at = now, revoked = null, speech_consent_version = 2
 * revoke → speech_consent_revoked_at = now AND cascade-delete this user's
 *          retained recordings (storage objects + speech_recordings rows).
 *
 * Body (JSON): { user_code: string, action: "grant" | "revoke" }
 * Response:    { ok: true, consented: boolean } | { ok: false, code, error }
 */

import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { SPEECH_BUCKET, SPEECH_CONSENT_VERSION } from "../../../../lib/speech/retentionPolicy";

const limiter = createRateLimiter("speech-consent", { window: 60_000, max: 10 });

/**
 * Cascade-delete every retained recording for a user on consent revocation.
 * Batched + awaited; a failure returns an explicit error (never silent) so the
 * caller can surface "撤回未完成" rather than falsely claiming deletion.
 *
 * Degrades cleanly if the retention table/bucket don't exist yet (pre-migration):
 * a missing table means nothing was ever retained, so revoke still succeeds.
 *
 * @returns {{ ok: true, deleted: number } | { ok: false, message: string }}
 */
async function deleteRetainedRecordings(userCode) {
  // 1. Read all storage paths for this user.
  const { data: rows, error: selErr } = await supabaseAdmin
    .from("speech_recordings")
    .select("id, storage_path")
    .eq("user_code", userCode);

  if (selErr) {
    // Undefined table (42P01) = retention never provisioned → nothing to delete.
    if (/speech_recordings/.test(selErr.message || "") || selErr.code === "42P01") {
      console.warn("[/api/speech/consent] retention table absent, revoke has nothing to purge:", selErr.message);
      return { ok: true, deleted: 0 };
    }
    return { ok: false, message: `读取留存记录失败: ${selErr.message}` };
  }

  const paths = (rows || []).map((r) => r.storage_path).filter(Boolean);
  if (paths.length === 0) return { ok: true, deleted: 0 };

  // 2. Remove the objects from the private bucket (whitelisted bucket only).
  const { error: rmErr } = await supabaseAdmin.storage.from(SPEECH_BUCKET).remove(paths);
  if (rmErr) {
    return { ok: false, message: `删除录音文件失败: ${rmErr.message}` };
  }

  // 3. Delete the metadata rows.
  const { error: delErr } = await supabaseAdmin
    .from("speech_recordings")
    .delete()
    .eq("user_code", userCode);
  if (delErr) {
    return { ok: false, message: `删除留存记录失败: ${delErr.message}` };
  }

  return { ok: true, deleted: paths.length };
}

export async function POST(request) {
  try {
    const ip = getIp(request);
    if (ip && ip !== "unknown" && limiter.isLimited(`ip:${ip}`)) {
      return Response.json({ ok: false, code: "RATE_LIMITED", error: "请求过于频繁。" }, { status: 429 });
    }

    if (!isSupabaseAdminConfigured) {
      // No backing store — treat as success so dev environments can still
      // exercise the rest of the consent flow without Supabase configured.
      return Response.json({ ok: true, consented: true, dev_no_persist: true });
    }

    const body = await request.json().catch(() => ({}));
    const userCode = String(body?.user_code || "").toUpperCase().trim();
    const action = String(body?.action || "").toLowerCase().trim();

    if (!userCode || userCode.length !== 6) {
      return Response.json({ ok: false, code: "INVALID_USER", error: "请先登录。" }, { status: 403 });
    }
    if (action !== "grant" && action !== "revoke") {
      return Response.json({ ok: false, code: "INVALID_ACTION", error: "未知操作。" }, { status: 400 });
    }

    const now = new Date().toISOString();

    if (action === "grant") {
      // Record consent v2. The speech_consent_version column may not exist yet
      // (pre-migration) — tolerate that by degrading to a version-less write so
      // the legacy consent flow never breaks. Retention simply stays off until
      // the migration runs.
      let error;
      ({ error } = await supabaseAdmin
        .from("users")
        .update({
          speech_consent_at: now,
          speech_consent_revoked_at: null,
          speech_consent_version: SPEECH_CONSENT_VERSION,
        })
        .eq("code", userCode));

      if (error && (/speech_consent_version/.test(error.message || "") || error.code === "42703")) {
        console.warn("[/api/speech/consent] speech_consent_version column absent; writing consent without version:", error.message);
        ({ error } = await supabaseAdmin
          .from("users")
          .update({ speech_consent_at: now, speech_consent_revoked_at: null })
          .eq("code", userCode));
      }

      if (error) {
        return Response.json({ ok: false, code: "DB_ERROR", error: "数据写入失败。" }, { status: 500 });
      }
      return Response.json({ ok: true, consented: true, consent_version: SPEECH_CONSENT_VERSION });
    }

    // action === "revoke": stamp the revoke time, then cascade-delete retained audio.
    const { error: revokeErr } = await supabaseAdmin
      .from("users")
      .update({ speech_consent_revoked_at: now })
      .eq("code", userCode);
    if (revokeErr) {
      return Response.json({ ok: false, code: "DB_ERROR", error: "数据写入失败。" }, { status: 500 });
    }

    const purge = await deleteRetainedRecordings(userCode);
    if (!purge.ok) {
      // Consent is revoked (writes gated on version), but we could not fully
      // purge — surface it loudly so the user isn't told deletion is complete.
      return Response.json(
        { ok: false, code: "PURGE_FAILED", error: `已撤回同意，但删除已留存录音时出错：${purge.message}` },
        { status: 500 },
      );
    }

    return Response.json({ ok: true, consented: false, deleted: purge.deleted });
  } catch (e) {
    return Response.json({ ok: false, code: "INTERNAL", error: e?.message || "未知错误" }, { status: 500 });
  }
}
