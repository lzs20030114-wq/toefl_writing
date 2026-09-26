import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { jsonError } from "../../../../lib/apiResponse";

/**
 * 复习日志归档。只写不读（读走后台统计/离线脚本）。
 *
 * 这张表的价值全在「以后」：等日志够多，用 fsrs-optimizer 在我们自己的数据上
 * 重新拟合一套 FSRS 权重当全局默认值，并做留存率校准监控（实际留存率 vs
 * 目标 0.90 的偏差）。事后补不回来，所以从第一天就收。
 */

const TABLE = "vocab_review_logs";
const MAX_LOGS_PER_REQUEST = 200;

const limiter = createRateLimiter("vocab-logs", { window: 60_000, max: 30 });

function normalizeCode(raw) {
  return String(raw || "").toUpperCase().trim();
}

const VALID_STATES = new Set(["new", "learning", "review", "relearning"]);

function toRow(code, raw) {
  if (!raw || typeof raw !== "object") return null;
  const word = String(raw.w || "").trim().toLowerCase().slice(0, 60);
  const rating = Number(raw.r);
  if (!word || !Number.isInteger(rating) || rating < 1 || rating > 4) return null;
  const at = raw.at && !Number.isNaN(new Date(raw.at).getTime()) ? new Date(raw.at) : new Date();
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    user_code: code,
    word,
    mode: raw.mode === "listening" ? "listening" : "reading",
    rating,
    state: VALID_STATES.has(raw.st) ? raw.st : "new",
    elapsed_days: num(raw.el) ?? 0,
    scheduled_days: Math.round(num(raw.sd) ?? 0),
    stability: num(raw.s),
    difficulty: num(raw.d),
    duration_ms: raw.ms == null ? null : Math.round(num(raw.ms) ?? 0),
    reviewed_at: at.toISOString(),
  };
}

export async function POST(request) {
  try {
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const body = await request.json().catch(() => ({}));
    const code = normalizeCode(body?.code);
    if (!code) return jsonError(400, "code is required");

    const logs = Array.isArray(body?.logs) ? body.logs : null;
    if (!logs || logs.length === 0) return jsonError(400, "logs must be a non-empty array");
    if (logs.length > MAX_LOGS_PER_REQUEST) {
      return jsonError(400, `too many logs (${logs.length} > ${MAX_LOGS_PER_REQUEST})`);
    }

    const rows = logs.map((l) => toRow(code, l)).filter(Boolean);
    if (rows.length === 0) return jsonError(400, "no valid log entries");

    // 同一条日志重复推送（网络重试）靠 (user_code, word, reviewed_at) 唯一键去重，
    // 而不是让它插两遍——重复的复习记录会把后续的参数拟合带偏。
    const { error } = await supabaseAdmin
      .from(TABLE)
      .upsert(rows, { onConflict: "user_code,word,reviewed_at", ignoreDuplicates: true });
    if (error) return jsonError(400, error.message || "Save review logs failed");

    return Response.json({ ok: true, saved: rows.length });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
