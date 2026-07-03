/**
 * 个人题库写入/抽取端点的共享门禁。
 *
 * 复刻 /api/ai 的服务端 Pro + 每日额度判定 (app/api/ai/route.js:201-236)，抽成一个
 * 可被 POST /api/user-bank 与 POST /api/user-bank/extract 复用的函数，保证两处门禁一致。
 *
 * 设计：个人题库是 **Pro 功能**。导入只在「门口」拦截，**不消耗**每日额度（不 increment）——
 * 它读的是和 /api/ai 同一张 daily_usage 表，但不写入；即只要求 Pro 且当日活动未超 100。
 * 永远服务端判定 tier（绝不信前端）。本地无 Supabase 时 fail-open，方便开发。
 */
import { isSupabaseAdminConfigured, supabaseAdmin } from "./supabaseAdmin";

export function computeIsPro(user) {
  if (!user) return false;
  if (user.tier === "legacy") return true;
  if (user.tier !== "pro") return false;
  const exp = user.tier_expires_at ? new Date(user.tier_expires_at).getTime() : 0;
  return !(exp && exp <= Date.now());
}

/**
 * @param {{ userCode: string }} args
 * @returns {Promise<{ ok: true, userCode: string, isPro?: boolean }
 *   | { ok: false, status: number, error: string, code: string }>}
 */
export async function gateUserBankRequest({ userCode }) {
  const code = String(userCode || "").toUpperCase().trim();
  if (code.length !== 6) {
    return { ok: false, status: 403, error: "Authentication required.", code: "AUTH_REQUIRED" };
  }

  // Local dev without Supabase: fail-open, no metering (mirrors /api/ai, which only
  // gates when isSupabaseAdminConfigured).
  if (!isSupabaseAdminConfigured) {
    return { ok: true, userCode: code };
  }

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("tier, tier_expires_at")
    .eq("code", code)
    .maybeSingle();
  if (!user) {
    return { ok: false, status: 403, error: "Invalid user.", code: "INVALID_USER" };
  }

  const isPro = computeIsPro(user);

  // Best-effort: downgrade an expired pro so tier state stays truthful (non-blocking).
  if (!isPro && user.tier === "pro" && user.tier_expires_at) {
    try {
      await supabaseAdmin.from("users").update({ tier: "free", tier_expires_at: null }).eq("code", code);
    } catch {
      /* never block on this */
    }
  }

  if (!isPro) {
    return { ok: false, status: 403, error: "个人题库为 Pro 功能，请升级后使用。", code: "PRO_REQUIRED" };
  }

  // Same daily meter as /api/ai (no separate credit consumed on import).
  const dailyLimit = isPro ? 100 : 3;
  const today = new Date().toISOString().split("T")[0];
  const { data: usage } = await supabaseAdmin
    .from("daily_usage")
    .select("usage_count")
    .eq("user_code", code)
    .eq("date", today)
    .maybeSingle();
  if ((usage?.usage_count || 0) >= dailyLimit) {
    return {
      ok: false,
      status: 429,
      error: isPro ? "服务繁忙，请稍后再试" : "Daily limit reached.",
      code: isPro ? "PRO_DAILY_CAP" : "DAILY_LIMIT",
    };
  }

  return { ok: true, userCode: code, isPro };
}
