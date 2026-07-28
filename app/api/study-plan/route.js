import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../lib/rateLimit";
import { jsonError } from "../../../lib/apiResponse";

/**
 * 备考计划落库(写库影子)。前端 lib/studyPlan.js 仍以 localStorage 为 UI 真源,
 * 保存时把 examDate/目标分/当前分 同步 upsert 到 users 表,供留存/流失 cohort
 * 分析读取(报告 #3 的考前/考后流失需要 users.exam_date)。
 *
 * ── fail-open ──────────────────────────────────────────────────────────────
 * study-plan-fields.sql 迁移可能尚未在生产执行。此时 update 会因列不存在报错;
 * 本端点把「列不存在」识别为软失败(200 + ok:false + pending:true),绝不返回
 * 4xx/5xx,前端 fire-and-forget 也吞掉——用户保存计划体验完全不受影响。迁移
 * 一旦跑完(带 NOTIFY 刷新 schema 缓存),同一份代码即自动开始成功写入,无需重部署。
 */

const limiter = createRateLimiter("study-plan", { window: 60_000, max: 60 });

function normalizeCode(raw) {
  return String(raw || "").toUpperCase().trim();
}

// null | 有效 YYYY-MM-DD 字符串;其它一律拒。
function parseExamDate(raw) {
  if (raw == null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ok: false };
  const t = Date.parse(`${raw}T00:00:00Z`);
  if (Number.isNaN(t)) return { ok: false };
  return { ok: true, value: raw };
}

// null | 1.0–6.0 的数字(写作分制,0.5 一档,前端已 clamp;这里只做范围防呆)。
function parseScore(raw) {
  if (raw == null || raw === "") return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 6) return { ok: false };
  return { ok: true, value: Math.round(n * 2) / 2 };
}

// PostgREST/Postgres 在「列还不存在」时的报错特征(迁移未跑)。
function isMissingColumn(error) {
  if (!error) return false;
  const code = error.code || "";
  if (code === "42703" || code === "PGRST204") return true; // undefined_column / schema cache miss
  const msg = String(error.message || "").toLowerCase();
  return /column/.test(msg) && (/exam_date|target_score|current_score|study_plan_updated_at|schema cache/.test(msg));
}

export async function POST(request) {
  try {
    if (limiter.isLimited(getIp(request))) return jsonError(429, "Too many requests");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const body = await request.json().catch(() => ({}));
    const code = normalizeCode(body?.code);
    if (!code || code.length !== 6) return jsonError(400, "code is required (6 chars)");

    const exam = parseExamDate(body?.examDate);
    if (!exam.ok) return jsonError(400, "examDate must be YYYY-MM-DD or null");
    const target = parseScore(body?.targetScore);
    if (!target.ok) return jsonError(400, "targetScore must be 1–6 or null");
    const current = parseScore(body?.currentScore);
    if (!current.ok) return jsonError(400, "currentScore must be 1–6 or null");

    const { data, error } = await supabaseAdmin
      .from("users")
      .update({
        exam_date: exam.value,
        target_score: target.value,
        current_score: current.value,
        study_plan_updated_at: new Date().toISOString(),
      })
      .eq("code", code)
      .select("code");

    if (error) {
      // fail-open:迁移未跑 → 列不存在 → 软失败(不打扰用户,不污染错误监控)。
      if (isMissingColumn(error)) {
        return Response.json({ ok: false, persisted: false, pending: true });
      }
      return jsonError(400, error.message || "Save study plan failed");
    }

    // 该 code 不存在(0 行受影响):也算软失败,不报错。
    const persisted = Array.isArray(data) && data.length > 0;
    return Response.json({ ok: true, persisted });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
