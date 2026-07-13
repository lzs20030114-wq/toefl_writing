import { createRequire } from "module";
import { createHash } from "crypto";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../lib/rateLimit";

// Give the serverless function room to wait for slow DeepSeek responses.
// Without this, Vercel's hobby default (10s) would kill the request long
// before the inner 120s network timeout has a chance. Pro plan honors up
// to 300s; hobby caps to 60s — either way 180 is the ceiling we want.
export const maxDuration = 180;

const require = createRequire(import.meta.url);
const { callDeepSeekViaCurl, resolveProxyUrl } = require("../../../lib/ai/deepseekHttp");
const MAX_BODY_BYTES = 120000;
const MAX_SYSTEM_CHARS = 12000;
const MAX_MESSAGE_CHARS = 40000;
// 2026-07-12: 3000→4096。判分锚改造后评分输出(含 ===ERRORS=== 推理段)实测需
// 3.1-3.9K tokens。
// 2026-07-12 再抬 4096→6144: v4-flash 推理 token 计入 completion 预算,4000 下
// 约 10% 采样被推理吃光预算出空正文;writingEval.js 现请求 6000,上限需容纳它。
const MAX_TOKENS = 6144;
// 2026-07-12: 写作评分「三路取中位」上限。samples>1 时本请求会在服务端并行发 N 次
// DeepSeek 调用(只扣 1 次用量)。上限 3 是成本护栏——防滥用者靠放大 samples 撑大
// 我们的 DeepSeek 账单。缺省 1 时行为与旧版逐字等价。
const MAX_SAMPLES = 3;

const limiter = createRateLimiter("ai", { max: 45 });

function getRateLimitKey(request) {
  const ip = getIp(request);
  if (ip && ip !== "unknown") return `ip:${ip}`;
  const ua = request.headers.get("user-agent") || "";
  const lang = request.headers.get("accept-language") || "";
  const secUa = request.headers.get("sec-ch-ua") || "";
  const host = request.headers.get("host") || "";
  const origin = request.headers.get("origin") || "";
  const raw = `${ua}|${lang}|${secUa}|${host}|${origin}`;
  const digest = createHash("sha1").update(raw).digest("hex");
  return `fp:${digest}`;
}

function normalizeHost(raw) {
  const input = String(raw || "").trim();
  if (!input) return "";
  try {
    if (input.includes("://")) return new URL(input).host.toLowerCase();
    return new URL(`http://${input}`).host.toLowerCase();
  } catch {
    return input.toLowerCase();
  }
}

function isOriginAllowed(request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Browser requests always include Origin on POST.
    // If sec-fetch-site is present (modern browser) but origin is missing, reject.
    const secFetchSite = request.headers.get("sec-fetch-site");
    if (secFetchSite && secFetchSite !== "none") return false;
    // No origin + no sec-fetch-site = likely server-to-server (cURL, etc.) — allow.
    return true;
  }
  const originHost = normalizeHost(origin);
  if (!originHost) return false;
  const host = normalizeHost(request.headers.get("host"));
  const xfh = String(request.headers.get("x-forwarded-host") || "")
    .split(",")
    .map((v) => normalizeHost(v))
    .filter(Boolean);
  return [host, ...xfh].includes(originHost);
}

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

// 构造发往 DeepSeek 的统一 payload(单采样/多采样共用同一形状)。
function buildUpstreamPayload({ system, message, maxTokens, temperature }) {
  return {
    model: "deepseek-v4-flash",
    max_tokens: maxTokens,
    temperature,
    stream: false,
    messages: [
      { role: "system", content: system },
      { role: "user", content: message },
    ],
  };
}

// 单次上游调用(proxy 路径)——沿用 deepseekHttp 的 120s 网络超时,成功返回
// content 字符串,失败抛错(交由 allSettled / 外层 catch 处理)。
function callViaCurlOnce(apiKey, proxyUrl, params) {
  return callDeepSeekViaCurl({
    apiKey,
    proxyUrl,
    // 120s server-side network timeout — matches deepseekHttp default.
    // The client wraps this with a 150s outer race, so the user-visible
    // wait never exceeds 150s but legitimate long evaluations get through.
    timeoutMs: 120000,
    payload: buildUpstreamPayload(params),
  });
}

// 单次上游调用(直连路径)——成功返回 content 字符串;!res.ok 时抛出携带
// { status, errText } 的错误,网络异常照原样抛出(无 status)。多采样模式下
// 单发失败只算该采样失败,不会立刻拖垮整个请求。
async function callDirectOnce(apiKey, params) {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify(buildUpstreamPayload(params)),
  });
  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(`DeepSeek ${res.status}`);
    err.status = res.status;
    err.errText = errText;
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
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

async function logApiFailure(meta) {
  if (!isSupabaseAdminConfigured) return;
  try {
    await supabaseAdmin.from("api_error_feedback").insert({
      endpoint: "/api/ai",
      stage: meta.stage || null,
      http_status: Number(meta.httpStatus || 0) || null,
      error_type: String(meta.errorType || "unknown"),
      error_message: String(meta.errorMessage || "").slice(0, 500),
      error_detail: meta.errorDetail ? String(meta.errorDetail).slice(0, 4000) : null,
      client_id: meta.clientId ? String(meta.clientId).slice(0, 120) : null,
      client_ip: meta.clientIp ? String(meta.clientIp).slice(0, 64) : null,
      origin: meta.origin ? String(meta.origin).slice(0, 300) : null,
      user_agent: meta.userAgent ? String(meta.userAgent).slice(0, 500) : null,
    });
  } catch {
    // Do not block API response when logging fails.
  }
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

async function fail(meta, status, payload) {
  await logApiFailure({
    ...meta,
    httpStatus: status,
    errorMessage: payload?.error || "Unknown error",
    errorDetail: payload?.detail || "",
  });
  return Response.json(payload, { status });
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
      const { data: user } = await supabaseAdmin
        .from("users")
        .select("tier, tier_expires_at")
        .eq("code", userCode)
        .maybeSingle();
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

    if (proxyUrl) {
      if (samples > 1) {
        // 服务端 fan-out：并行 N 发,收集成功的 content。用量只计 1 次。
        const results = await Promise.allSettled(
          Array.from({ length: samples }, () => callViaCurlOnce(apiKey, proxyUrl, upstreamParams)),
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
      const content = await callViaCurlOnce(apiKey, proxyUrl, upstreamParams);
      await recordAiUsage(usageUserCode, usageCap, usageDay);
      return Response.json({ content });
    }

    if (samples > 1) {
      // 直连路径 fan-out。单发失败(!res.ok 或网络异常)只算该采样失败。
      const results = await Promise.allSettled(
        Array.from({ length: samples }, () => callDirectOnce(apiKey, upstreamParams)),
      );
      const contents = collectContents(results);
      if (contents.length === 0) {
        // 0 成功——走现有 fail() 语义,取第一个失败采样的上游错误文本做 errorDetail。
        const reason = firstRejectionReason(results);
        const upstreamStatus = Number(reason?.status);
        const httpStatus = Number.isFinite(upstreamStatus) && upstreamStatus
          ? (upstreamStatus >= 500 ? 502 : upstreamStatus)
          : 502;
        return fail(
          { ...requestMeta, stage: "deepseek", errorType: "upstream", errorDetail: reason?.errText || reason?.message || "" },
          httpStatus,
          { error: "AI service temporarily unavailable. Please retry." },
        );
      }
      // 部分失败也要留痕(见 logPartialSampleFailures),与计量一起 best-effort。
      await Promise.all([
        recordAiUsage(usageUserCode, usageCap, usageDay),
        logPartialSampleFailures(requestMeta, results),
      ]);
      return Response.json({ content: contents[0], contents });
    }

    // 单采样直连路径——与旧版逐字等价:!res.ok → fail(502/status),网络异常 → 外层 catch → 500。
    try {
      const content = await callDirectOnce(apiKey, upstreamParams);
      await recordAiUsage(usageUserCode, usageCap, usageDay);
      return Response.json({ content });
    } catch (err) {
      const upstreamStatus = Number(err?.status);
      if (Number.isFinite(upstreamStatus) && upstreamStatus) {
        // Log full upstream error for debugging, but don't expose details to client
        return fail(
          { ...requestMeta, stage: "deepseek", errorType: "upstream", errorDetail: err.errText || "" },
          upstreamStatus >= 500 ? 502 : upstreamStatus,
          { error: "AI service temporarily unavailable. Please retry." },
        );
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
