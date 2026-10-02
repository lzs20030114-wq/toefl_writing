import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../lib/rateLimit";
import { isOriginAllowed } from "../../../lib/ai/routeGuards";
import { prepareAttempt, getAttempt, transitionAttempt } from "../../../lib/realMockExam/repository";
import { getRealMockConfig } from "../../../lib/realMockExam/config";

const limiter = createRateLimiter("real-mock-exam", { window: 60_000, max: 90 });
const fail = (status, code, error, extras = {}) => Response.json({ ok: false, code, error, ...extras }, { status });
const codeOf = (raw) => String(raw || "").trim().toUpperCase();

function authorizedItems(attempt, refs) {
  const allowed = [...(attempt.snapshot?.m1Items || [])];
  if (attempt.route) allowed.push(...(attempt.snapshot?.m2ByPath?.[attempt.route] || []));
  const result = [];
  for (const ref of refs) {
    const id = String(ref?.id || "");
    const type = String(ref?.taskType || "");
    const match = allowed.find((item) => item.id === id && item.taskType === type);
    if (!match) return null;
    result.push(match);
  }
  return result;
}

export async function POST(request) {
  try {
    if (limiter.isLimited(getIp(request))) return fail(429, "RATE_LIMITED", "请求过于频繁，请稍后重试。");
    if (!isOriginAllowed(request)) return fail(403, "FORBIDDEN_ORIGIN", "请求来源无效。");
    if (!isSupabaseAdminConfigured) return fail(503, "DATABASE_UNAVAILABLE", "真题模考数据库暂不可用。");
    const body = await request.json().catch(() => ({}));
    const userCode = codeOf(body.userCode || body.code);
    if (!/^[A-Z0-9]{6}$/.test(userCode)) return fail(400, "INVALID_USER", "请先登录有效账号。");
    const { data: user, error: userError } = await supabaseAdmin.from("users")
      .select("code,tier,tier_expires_at,status").eq("code", userCode).maybeSingle();
    if (userError) throw new Error(userError.message);
    if (!user || ["disabled", "inactive", "suspended"].includes(String(user.status || "").toLowerCase())) return fail(403, "INVALID_USER", "账号不存在或不可用。");
    const activePro = user.tier === "legacy" || (user.tier === "pro" && (!user.tier_expires_at || Date.parse(user.tier_expires_at) > Date.now()));
    if (!activePro) return fail(403, "PRO_REQUIRED", "真题模考需要 Pro 权限。");

    const action = String(body.action || "prepare");
    if (action === "prepare") {
      const section = String(body.section || "");
      if (!getRealMockConfig(section)) return fail(400, "INVALID_SECTION", "未知科目。");
      const localDoneIds = Array.isArray(body.doneIds) ? body.doneIds.filter((x) => typeof x === "string").slice(0, 20000) : [];
      const result = await prepareAttempt(userCode, section, localDoneIds, body.restartAttemptId || null);
      return result.ok ? Response.json({ ok: true, paper: result.paper, resumed: !!result.resumed })
        : fail(["REAL_MOCK_EXHAUSTED", "ACTIVE_ATTEMPT"].includes(result.code) ? 409 : 503, result.code, result.error || "未做真题数量不足，无法组成完整试卷。", { deficits: result.deficits || [], activeAttemptId: result.activeAttemptId });
    }
    if (!["seen", "route", "finish"].includes(action)) return fail(400, "INVALID_ACTION", "未知操作。");
    const attemptId = String(body.attemptId || "");
    if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return fail(400, "INVALID_ATTEMPT", "试卷编号无效。");
    const attempt = await getAttempt(userCode, attemptId);
    if (!attempt) return fail(404, "ATTEMPT_NOT_FOUND", "找不到这份试卷。");
    if (attempt.status !== "active") return action === "finish" ? Response.json({ ok: true, status: "ok" }) : fail(409, "ATTEMPT_FINISHED", "这份试卷已结束。");
    if (Date.parse(attempt.lease_expires_at) <= Date.now() && action !== "finish") return fail(409, "ATTEMPT_EXPIRED", "试卷预留已过期，请重新开始。");
    let keys = [];
    let path = null;
    if (action === "seen") {
      const refs = Array.isArray(body.items) ? body.items : body.items ? [body.items] : [];
      if (!refs.length || refs.length > 50) return fail(400, "INVALID_ITEMS", "每次须标记 1 至 50 道题。");
      const matched = authorizedItems(attempt, refs);
      if (!matched) return fail(400, "INVALID_ITEMS", "题目不属于这份试卷的当前路线。");
      keys = [...new Set(matched.flatMap((item) => item.realMockKeys || []))];
    } else if (action === "route") {
      path = String(body.path || "");
      if (!["upper", "lower"].includes(path)) return fail(400, "INVALID_ROUTE", "路线必须是 upper 或 lower。");
      keys = [...new Set([...(attempt.snapshot?.m1Items || []), ...(attempt.snapshot?.m2ByPath?.[path] || [])].flatMap((item) => item.realMockKeys || []))];
    }
    const result = await transitionAttempt(userCode, attemptId, action, keys, path, body.answered === true);
    if (result?.status !== "ok") return fail(409, "TRANSITION_REJECTED", result?.status || "试卷状态更新失败。");
    return Response.json({ ok: true, status: result.status });
  } catch (error) {
    console.error("[real-mock-exam]", error);
    return fail(503, "REAL_MOCK_ERROR", "真题模考服务暂不可用，请稍后重试。");
  }
}
