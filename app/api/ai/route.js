import { createRequire } from "module";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../lib/rateLimit";
import { lookupUserTier } from "../../../lib/userLookup";
import {
  callDirectOnce as callDirectOnceShared,
  callViaCurlOnce as callViaCurlOnceShared,
  describeUpstreamError,
  isNonEmptyContent,
  isUpstreamTimeoutError,
  resolveUpstreamBudget,
} from "../../../lib/ai/upstream";
import { fail, getRateLimitKey, isOriginAllowed, logApiFailure } from "../../../lib/ai/routeGuards";

// Give the serverless function room to wait for slow DeepSeek responses.
// Without this, Vercel's hobby default (10s) would kill the request long
// before the inner 120s network timeout has a chance. Pro plan honors up
// to 300s; hobby caps to 60s — either way 180 is the ceiling we want.
export const maxDuration = 180;

const require = createRequire(import.meta.url);
const { resolveProxyUrl } = require("../../../lib/ai/deepseekHttp");
const MAX_BODY_BYTES = 120000;
const MAX_SYSTEM_CHARS = 12000;
const MAX_MESSAGE_CHARS = 40000;
// 2026-07-12: 3000→4096。判分锚改造后评分输出(含 ===ERRORS=== 推理段)实测需
// 3.1-3.9K tokens。
// 2026-07-12 再抬 4096→6144: v4-flash 推理 token 计入 completion 预算,4000 下
// 约 10% 采样被推理吃光预算出空正文;writingEval.js 现请求 6000,上限需容纳它。
// Writing reports repeat the response in ANNOTATION and CORRECTED and then
// add a model essay. Reasoning tokens also consume this budget, so 6K can cut
// off a model essay even when the score section itself is valid.
const MAX_TOKENS = 8192;
// 2026-07-12: 写作评分「三路取中位」上限。samples>1 时本请求会在服务端并行发 N 次
// DeepSeek 调用(只扣 1 次用量)。上限 3 是成本护栏——防滥用者靠放大 samples 撑大
// 我们的 DeepSeek 账单。缺省 1 时行为与旧版逐字等价。
const MAX_SAMPLES = 3;
// 2026-09-09: 直连路径(Vercel 线上走这条)的总时间预算。客户端外层 175s、Vercel
// maxDuration 180s,这里留 165s 给上游(含 1 次快速 5xx 重试)。超时用 AbortSignal
// 主动掐掉,让请求仍走 fail() 写 api_error_feedback;否则被 Vercel 在 180s 杀掉时
// 什么都记不到,用户只看到一个没来由的 504。
const DIRECT_TOTAL_BUDGET_MS = 165000;
// 客户端外层超时的合法区间(clientTimeoutMs)。调用方各不相同:听力/阅读讲解 60s、
// 面试评分 120s、写作评分 175s —— 服务端按其中最小者收敛自己的预算,见
// resolveUpstreamBudget。缺省(老客户端不带这个字段)仍用上面的 165s。
const MIN_CLIENT_TIMEOUT_MS = 5000;
const MAX_CLIENT_TIMEOUT_MS = 600000;

const limiter = createRateLimiter("ai", { max: 45 });

function validateBody(body) {
  if (!body || typeof body !== "object") return "Invalid request body.";
  const system = String(body.system || "");
  const message = String(body.message || "");
  const maxTokensRaw = Number(body.maxTokens ?? 2000);
  const temperatureRaw = Number(body.temperature ?? 0.3);
  if (!system.trim()) return "Missing system prompt.";
  if (!message.trim()) return "Missing user prompt.";
  if (system.length > MAX_SYSTEM_CHARS) return `System prompt too long (>${MAX_SYSTEM_CHARS}).`;
  if (message.length > MAX_MESSAGE_CHARS) return `User prompt too long (>${MAX_MESSAGE_CHARS}).`;
  if (!Number.isInteger(maxTokensRaw) || maxTokensRaw <= 0 || maxTokensRaw > MAX_TOKENS) {
    return `maxTokens must be an integer between 1 and ${MAX_TOKENS}.`;
  }
  if (!Number.isFinite(temperatureRaw) || temperatureRaw < 0 || temperatureRaw > 2) {
    return "temperature must be between 0 and 2.";
  }
  const samplesRaw = Number(body.samples ?? 1);
  if (!Number.isInteger(samplesRaw) || samplesRaw < 1 || samplesRaw > MAX_SAMPLES) {
    return `samples must be an integer between 1 and ${MAX_SAMPLES}.`;
  }
  // 可选字段:不带就按服务端默认预算跑(老客户端/服务端到服务端调用)。
  if (body.clientTimeoutMs != null) {
    const t = Number(body.clientTimeoutMs);
    if (!Number.isInteger(t) || t < MIN_CLIENT_TIMEOUT_MS || t > MAX_CLIENT_TIMEOUT_MS) {
      return `clientTimeoutMs must be an integer between ${MIN_CLIENT_TIMEOUT_MS} and ${MAX_CLIENT_TIMEOUT_MS}.`;
    }
  }
  return "";
}

function normalizeGenerationParams(body) {
  const maxTokensRaw = Number(body?.maxTokens ?? 2000);
  const temperatureRaw = Number(body?.temperature ?? 0.3);
  return {
    maxTokens: Math.trunc(maxTokensRaw),
    temperature: temperatureRaw,
  };
}

// samples 已在 validateBody 里校验为 1–3 的整数;这里再夹一次纯属防御,保证
// 非法输入退化为单采样而不是放大调用。
function normalizeSamples(body) {
  const raw = Number(body?.samples ?? 1);
  if (!Number.isInteger(raw)) return 1;
  return Math.max(1, Math.min(MAX_SAMPLES, raw));
}

// 单次上游调用(proxy 路径)——成功返回 content 字符串,失败抛错(交由
// allSettled / 外层 catch 处理)。预算与直连路径同源(见 resolveUpstreamBudget)。
function callViaCurlOnce(apiKey, proxyUrl, params, budgetMs) {
  return callViaCurlOnceShared(apiKey, proxyUrl, params, { timeoutMs: budgetMs });
}

// 单次上游调用(直连路径)——流式拼接 + 无输出看门狗 + 快速失败单次重试。
// 实现见 lib/ai/upstream.js。
function callDirectOnce(apiKey, params, budgetMs) {
  return callDirectOnceShared(apiKey, params, { totalBudgetMs: budgetMs });
}

// 上游失败的统一出口。把「我们自己掐断的超时」单列成 504 + upstream_timeout:
// 它和 502(上游报错)、500(内部异常)的处置完全不同 —— 对用户是「排队中,可重试」,
// 对后台是一眼可筛的一类。2026-09-20 之前这类失败记成 internal 500,查不出根因。
function failUpstream(requestMeta, reason) {
  const status = Number(reason?.status);
  const hasStatus = Number.isFinite(status) && status > 0;
  if (!hasStatus && isUpstreamTimeoutError(reason)) {
    return fail(
      {
        ...requestMeta,
        stage: "deepseek",
        errorType: "upstream_timeout",
        errorDetail: describeUpstreamError(reason) || String(reason?.message || "upstream timeout"),
      },
      504,
      { error: "AI 正在排队，请稍后重试", code: "UPSTREAM_TIMEOUT" },
    );
  }
  return fail(
    { ...requestMeta, stage: "deepseek", errorType: "upstream", errorDetail: describeUpstreamError(reason) },
    hasStatus && status < 500 ? status : 502,
    { error: "AI service temporarily unavailable. Please retry." },
  );
}

// 从 allSettled 结果里挑出成功且非空的 content(保持采样顺序)。
function collectContents(results) {
  return results
    .filter((r) => r.status === "fulfilled" && typeof r.value === "string" && r.value.trim())
    .map((r) => r.value);
}

// 第一个失败采样的原因(用于 0 成功时的错误语义)。
function firstRejectionReason(results) {
  const rejected = results.find((r) => r.status === "rejected");
  return rejected ? rejected.reason : null;
}

// 多采样 fan-out「部分失败」留痕:只要 ≥1 采样成功,请求就整体成功返回,但
// rejected 采样的上游错误若不记录,间歇性上游失败(典型:三发里一发 DeepSeek
// 500)对监控完全隐身 —— 旧单发路径每次上游失败都会写 api_error_feedback,
// 这里补齐同等可观测性。logApiFailure 内部已吞错,不会拖垮成功响应。
function logPartialSampleFailures(requestMeta, results) {
  return Promise.all(
    results
      .filter((r) => r.status === "rejected")
      .map((r) =>
        logApiFailure({
          ...requestMeta,
          stage: "deepseek_partial",
          errorType: "upstream_partial",
          httpStatus: r.reason?.status,
          errorMessage: r.reason?.message || "",
          errorDetail: r.reason?.errText || "",
        })
      )
  );
}

// 空正文一律按上游失败回 502(与其他 upstream 失败同一套文案/状态码),并且**不计用量**
// —— 与本路由既有原则一致:失败的调用不扣次数。errorType 单列 empty_content,好让后台
// /admin-api-errors 一眼区分「上游报错」和「上游回了 200 但正文是空的」。
function failEmptyContent(requestMeta, path, maxTokens) {
  return fail(
    {
      ...requestMeta,
      stage: "deepseek",
      errorType: "empty_content",
      // 详情里带上预算：v4-flash 的推理 token 计入 max_tokens，后台一眼能看出是不是给少了。
      errorDetail: `upstream returned empty content (${path}, samples=1); max_tokens=${maxTokens} (reasoning tokens count toward it)`,
    },
    502,
    { error: "AI service temporarily unavailable. Please retry." },
  );
}

// Atomically record one unit of AI usage for the day, enforcing the cap as a
// race backstop. Prefers the increment_daily_usage RPC (single round-trip, no
// read-then-write race); if that RPC is missing — e.g. the migration hasn't
// been applied yet — it falls back to a best-effort upsert so usage is never
// silently un-metered. Always best-effort: a metering write must never turn a
// successful AI response into an error for the user.
async function recordAiUsage(userCode, cap, day) {
  if (!isSupabaseAdminConfigured || !userCode) return;
  try {
    const { error } = await supabaseAdmin.rpc("increment_daily_usage", {
      p_user_code: userCode,
      p_count: 1,
      p_cap: cap,
      p_date: day,
    });
    if (!error) return;
    await fallbackIncrementUsage(userCode, cap, day);
  } catch {
    await fallbackIncrementUsage(userCode, cap, day);
  }
}

async function fallbackIncrementUsage(userCode, cap, day) {
  try {
    const { data: existing } = await supabaseAdmin
      .from("daily_usage")
      .select("usage_count")
      .eq("user_code", userCode)
      .eq("date", day)
      .maybeSingle();
    const used = existing?.usage_count || 0;
    if (used >= cap) return; // race backstop, mirrors the RPC's cap check
    if (existing) {
      await supabaseAdmin
        .from("daily_usage")
        .update({ usage_count: used + 1 })
        .eq("user_code", userCode)
        .eq("date", day);
    } else {
      await supabaseAdmin
        .from("daily_usage")
        .insert({ user_code: userCode, date: day, usage_count: 1 });
    }
  } catch {
    // Best-effort only — never block a successful AI response on a metering write.
  }
}

export async function POST(request) {
  const requestMeta = {
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
    const bodyError = validateBody(payload);
    if (bodyError) {
      return fail({ ...requestMeta, stage: "input", errorType: "validation" }, 400, { error: bodyError });
    }

    // Server-side usage check + metering. Require a valid user code and enforce
    // the daily limit BEFORE spending a DeepSeek call. The authoritative
    // increment happens AFTER a successful response (see recordAiUsage below) so
    // that (a) the limit cannot be bypassed by a client that simply never calls
    // /api/usage, and (b) failed/transient AI errors don't consume a credit.
    let usageUserCode = "";
    let usageCap = 0;
    let usageDay = "";
    if (isSupabaseAdminConfigured) {
      const userCode = String(payload.userCode || "").toUpperCase().trim();
      if (!userCode || userCode.length !== 6) {
        return fail({ ...requestMeta, stage: "auth", errorType: "missing_user" }, 403, { error: "Authentication required." });
      }
      // 2026-09-13: 这里以前只解构 data,查库失败和「查无此人」都是 user==null,
      // 于是 PostgREST 一次 504 就被当成 403 Invalid user. —— 用户看到红字
      // "API error 403"(hook 直接渲染 e.message),而重试其实就能过。见 lib/userLookup.js。
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
      // Check tier + expiry
      const isPro = user.tier === "legacy" || (user.tier === "pro" && !(user.tier_expires_at && new Date(user.tier_expires_at).getTime() <= Date.now()));
      const dailyLimit = isPro ? 100 : 3;
      const today = new Date().toISOString().split("T")[0];
      const { data: usage } = await supabaseAdmin
        .from("daily_usage")
        .select("usage_count")
        .eq("user_code", userCode)
        .eq("date", today)
        .maybeSingle();
      if ((usage?.usage_count || 0) >= dailyLimit) {
        const errMsg = isPro ? "服务繁忙，请稍后再试" : "Daily limit reached.";
        // `code` lets the client distinguish a free-tier daily limit (show an upgrade
        // path, not a futile "server busy" retry) from a transient rate limit.
        return fail({ ...requestMeta, stage: "usage", errorType: "daily_limit" }, 429, { error: errMsg, code: isPro ? "PRO_DAILY_CAP" : "DAILY_LIMIT" });
      }
      usageUserCode = userCode;
      usageCap = dailyLimit;
      usageDay = today;
    }

    const { system, message } = payload;
    const { maxTokens, temperature } = normalizeGenerationParams(payload);
    const samples = normalizeSamples(payload);
    const upstreamParams = { system, message, maxTokens, temperature };
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const proxyUrl = resolveProxyUrl();
    // 上游预算收敛到客户端的外层超时之内:客户端先放弃后,再等下去既白烧 token,
    // 又让这条失败记成「internal 500」而不是超时。
    const budgetMs = resolveUpstreamBudget(payload.clientTimeoutMs, DIRECT_TOTAL_BUDGET_MS);

    if (proxyUrl) {
      if (samples > 1) {
        // 服务端 fan-out：并行 N 发,收集成功的 content。用量只计 1 次。
        const results = await Promise.allSettled(
          Array.from({ length: samples }, () => callViaCurlOnce(apiKey, proxyUrl, upstreamParams, budgetMs)),
        );
        const contents = collectContents(results);
        if (contents.length === 0) {
          // 0 成功——与单采样 proxy 路径一致:抛错进外层 catch → 500。
          throw firstRejectionReason(results) || new Error("AI service temporarily unavailable.");
        }
        // 部分失败也要留痕(见 logPartialSampleFailures),与计量一起 best-effort。
        await Promise.all([
          recordAiUsage(usageUserCode, usageCap, usageDay),
          logPartialSampleFailures(requestMeta, results),
        ]);
        return Response.json({ content: contents[0], contents });
      }
      const content = await callViaCurlOnce(apiKey, proxyUrl, upstreamParams, budgetMs);
      if (!isNonEmptyContent(content)) return failEmptyContent(requestMeta, "proxy", maxTokens);
      await recordAiUsage(usageUserCode, usageCap, usageDay);
      return Response.json({ content });
    }

    if (samples > 1) {
      // 直连路径 fan-out。单发失败(!res.ok 或网络异常)只算该采样失败。
      const results = await Promise.allSettled(
        Array.from({ length: samples }, () => callDirectOnce(apiKey, upstreamParams, budgetMs)),
      );
      const contents = collectContents(results);
      if (contents.length === 0) {
        // 0 成功——取第一个失败采样的上游错误做分类(超时 504 / 其余 502)。
        return failUpstream(requestMeta, firstRejectionReason(results));
      }
      // 部分失败也要留痕(见 logPartialSampleFailures),与计量一起 best-effort。
      await Promise.all([
        recordAiUsage(usageUserCode, usageCap, usageDay),
        logPartialSampleFailures(requestMeta, results),
      ]);
      return Response.json({ content: contents[0], contents });
    }

    // 单采样直连路径:!res.ok → 502/原状态码,我们掐断的超时 → 504,纯网络异常 → 外层 500。
    try {
      const content = await callDirectOnce(apiKey, upstreamParams, budgetMs);
      if (!isNonEmptyContent(content)) return failEmptyContent(requestMeta, "direct", maxTokens);
      await recordAiUsage(usageUserCode, usageCap, usageDay);
      return Response.json({ content });
    } catch (err) {
      // 带 status 的 HTTP 错误、流里夹带的 {error} 对象(有 errText 无 status)、以及
      // 看门狗/预算掐断的超时,都由 failUpstream 分类。纯网络异常仍走外层 500。
      if (Number(err?.status) > 0 || err?.errText || isUpstreamTimeoutError(err)) {
        return failUpstream(requestMeta, err);
      }
      throw err;
    }
  } catch (e) {
    return fail(
      { ...requestMeta, stage: "server", errorType: "internal" },
      500,
      { error: e.message || "Unexpected server error" }
    );
  }
}
