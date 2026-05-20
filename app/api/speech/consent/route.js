/**
 * POST /api/speech/consent
 *
 * Records the user's grant or revocation of consent to upload their voice
 * recordings to OpenAI Whisper. Required for PIPL compliance — Chinese law
 * treats voice as personal information and demands explicit, revocable
 * consent before transmitting it to a third party.
 *
 * Body (JSON):
 *   { user_code: string, action: "grant" | "revoke" }
 *
 * Response:
 *   { ok: true, consented: boolean }
 *   { ok: false, code, error }
 */

import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";

const limiter = createRateLimiter("speech-consent", { window: 60_000, max: 10 });

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
    const update = action === "grant"
      ? { speech_consent_at: now, speech_consent_revoked_at: null }
      : { speech_consent_revoked_at: now };

    const { error } = await supabaseAdmin
      .from("users")
      .update(update)
      .eq("code", userCode);

    if (error) {
      return Response.json({ ok: false, code: "DB_ERROR", error: "数据写入失败。" }, { status: 500 });
    }

    return Response.json({ ok: true, consented: action === "grant" });
  } catch (e) {
    return Response.json({ ok: false, code: "INTERNAL", error: e?.message || "未知错误" }, { status: 500 });
  }
}
