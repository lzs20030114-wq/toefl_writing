import { createRequire } from "module";
import { isSupabaseAdminConfigured } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { lookupUserTier } from "../../../../lib/userLookup";
import {
  callDirectOnce,
  callViaCurlOnce,
  describeUpstreamError,
  isNonEmptyContent,
} from "../../../../lib/ai/upstream";
import { fail, getRateLimitKey, isOriginAllowed } from "../../../../lib/ai/routeGuards";
import { buildLessonSystemPrompt, buildLessonUserPrompt } from "../../../../lib/ai/prompts/writingLesson";

// 写作批改的「第二次调用」：讲评(lesson)。评分那一路(/api/ai)一字不动，这里是评分
// 完成后另起的一次独立调用，把报告从「诊断书」变成「一节小型写作课」。
//
// 为什么单独开一条路由而不复用 /api/ai：
//   1) 讲评 prompt 很长，/api/ai 的 MAX_SYSTEM_CHARS=12000 会直接把它挡下；
//   2) prompt 必须留在服务端 —— 走 /api/ai 就等于把它发给客户端，任何人都能拿它
//      当免费通用 AI 用（system/message 都是客户端传的）。
// 防滥用不靠用量计数（评分那次已经计过，讲评不再扣），靠：同源校验 + 独立限流
// (20/min) + 必须是有效用户 + 字段白名单与长度上限。tier 不限制，free 也给。
export const maxDuration = 120;

const require = createRequire(import.meta.url);
const { resolveProxyUrl } = require("../../../../lib/ai/deepseekHttp");

const ENDPOINT = "/api/ai/lesson";
const MAX_BODY_BYTES = 120000;
const MAX_USER_TEXT_CHARS = 8000;
const MIN_USER_TEXT_WORDS = 30;
const MAX_REPORT_CHARS = 20000;
const MAX_PROMPT_DATA_CHARS = 6000;
const VALID_TYPES = new Set(["discussion", "email"]);
// v4-flash 的 reasoning token 计入 completion 预算，讲评正文只有 700 字左右，但推理
// 会先吃掉一大块——给小了就是 finish_reason=length + 空正文（见 /api/ai 的同款事故）。
const LESSON_MAX_TOKENS = 4096;
const LESSON_TEMPERATURE = 0.3;
// 客户端外层 120s、本路由 maxDuration 120s，留 100s 给上游（含 1 次快速 5xx 重试）。
const LESSON_TOTAL_BUDGET_MS = 100000;

const limiter = createRateLimiter("ai-lesson", { max: 20 });

function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function serializedLength(value) {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return Infinity;
  }
}

// 字段白名单 + 长度上限。讲评请求体只认这五个字段，其余一律忽略（不会被转发给上游）。
function validateLessonBody(body) {
  if (!body || typeof body !== "object") return "Invalid request body.";
  const type = String(body.type || "").trim();
  if (!VALID_TYPES.has(type)) return "type must be discussion or email.";

  const userText = String(body.userText || "");
  if (!userText.trim()) return "Missing userText.";
  if (userText.length > MAX_USER_TEXT_CHARS) return `userText too long (>${MAX_USER_TEXT_CHARS}).`;
  if (countWords(userText) < MIN_USER_TEXT_WORDS) return `userText too short (<${MIN_USER_TEXT_WORDS} words).`;

  if (!body.report || typeof body.report !== "object" || Array.isArray(body.report)) {
    return "Missing report.";
  }
  if (serializedLength(body.report) > MAX_REPORT_CHARS) return `report too large (>${MAX_REPORT_CHARS}).`;

  if (body.promptData != null) {
    if (typeof body.promptData !== "object" || Array.isArray(body.promptData)) {
      return "promptData must be an object.";
    }
    if (serializedLength(body.promptData) > MAX_PROMPT_DATA_CHARS) {
      return `promptData too large (>${MAX_PROMPT_DATA_CHARS}).`;
    }
  }
  return "";
}

export async function POST(request) {
  const requestMeta = {
    endpoint: ENDPOINT,
    clientId: request.headers.get("x-client-id") || "",
    clientIp: getIp(request),
    origin: request.headers.get("origin") || "",
    userAgent: request.headers.get("user-agent") || "",
  };
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return fail({ ...requestMeta, stage: "input" }, 413, { error: `Request body too large (>${MAX_BODY_BYTES} bytes).` });
    }
    if (!isOriginAllowed(request)) {
      return fail({ ...requestMeta, stage: "origin" }, 403, { error: "Forbidden origin." });
    }
    const rateKey = getRateLimitKey(request);
    if (rateKey && limiter.isLimited(rateKey)) {
      return fail({ ...requestMeta, stage: "rate_limit", errorType: "rate_limit" }, 429, { error: "Rate limit exceeded. Please retry shortly." });
    }
    const payload = await request.json();
    const bodyError = validateLessonBody(payload);
    if (bodyError) {
      return fail({ ...requestMeta, stage: "input", errorType: "validation" }, 400, { error: bodyError });
    }

    // 必须是有效用户（同 /api/ai 的语义：查库失败 503、查无此人 403），但**不计用量**
    // —— 评分那次调用已经扣过一次，讲评是同一次批改的一部分。
    if (isSupabaseAdminConfigured) {
      const userCode = String(payload.userCode || "").toUpperCase().trim();
      if (!userCode || userCode.length !== 6) {
        return fail({ ...requestMeta, stage: "auth", errorType: "missing_user" }, 403, { error: "Authentication required." });
      }
      const { user, error: userLookupError } = await lookupUserTier(userCode);
      if (userLookupError) {
        return fail(
          {
            ...requestMeta,
            stage: "auth",
            errorType: "user_lookup_failed",
            errorDetail: userLookupError.message || String(userLookupError),
          },
          503,
          { error: "服务暂时不可用，请稍后重试", code: "USER_LOOKUP_FAILED" },
        );
      }
      if (!user) {
        return fail({ ...requestMeta, stage: "auth", errorType: "invalid_user" }, 403, { error: "Invalid user." });
      }
      // tier 不做限制：讲评对 free 用户同样开放。
    }

    const type = String(payload.type || "").trim();
    const upstreamParams = {
      system: buildLessonSystemPrompt(type),
      message: buildLessonUserPrompt({
        type,
        promptData: payload.promptData || null,
        userText: String(payload.userText || ""),
        report: payload.report || {},
      }),
      maxTokens: LESSON_MAX_TOKENS,
      temperature: LESSON_TEMPERATURE,
    };
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const proxyUrl = resolveProxyUrl();

    try {
      const content = proxyUrl
        ? await callViaCurlOnce(apiKey, proxyUrl, upstreamParams, { timeoutMs: LESSON_TOTAL_BUDGET_MS })
        : await callDirectOnce(apiKey, upstreamParams, { totalBudgetMs: LESSON_TOTAL_BUDGET_MS });
      if (!isNonEmptyContent(content)) {
        return fail(
          {
            ...requestMeta,
            stage: "deepseek",
            errorType: "empty_content",
            errorDetail: `upstream returned empty content (${proxyUrl ? "proxy" : "direct"}); max_tokens=${LESSON_MAX_TOKENS} (reasoning tokens count toward it)`,
          },
          502,
          { error: "AI service temporarily unavailable. Please retry." },
        );
      }
      return Response.json({ ok: true, content });
    } catch (err) {
      const upstreamStatus = Number(err?.status);
      const hasStatus = Number.isFinite(upstreamStatus) && upstreamStatus > 0;
      if (hasStatus || err?.errText) {
        return fail(
          { ...requestMeta, stage: "deepseek", errorType: "upstream", errorDetail: describeUpstreamError(err) },
          hasStatus && upstreamStatus < 500 ? upstreamStatus : 502,
          { error: "AI service temporarily unavailable. Please retry." },
        );
      }
      throw err;
    }
  } catch (e) {
    return fail(
      { ...requestMeta, stage: "server", errorType: "internal" },
      500,
      { error: e.message || "Unexpected server error" },
    );
  }
}
