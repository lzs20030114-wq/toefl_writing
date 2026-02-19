import { createRequire } from "module";
import { createHash } from "crypto";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";

const require = createRequire(import.meta.url);
const { callDeepSeekViaCurl, resolveProxyUrl } = require("../../../lib/ai/deepseekHttp");
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 45;
const MAX_BODY_BYTES = 120000;
const MAX_SYSTEM_CHARS = 12000;
const MAX_MESSAGE_CHARS = 40000;
const MAX_TOKENS = 3000;

const rateLimitBuckets = globalThis.__toeflRateLimitBuckets || new Map();
if (!globalThis.__toeflRateLimitBuckets) {
  globalThis.__toeflRateLimitBuckets = rateLimitBuckets;
}

function getClientIp(request) {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

function getRateLimitKey(request) {
  const ip = getClientIp(request);
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

function isRateLimited(ip, now = Date.now()) {
  for (const [key, meta] of rateLimitBuckets.entries()) {
    if (now - meta.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitBuckets.delete(key);
    }
  }
  const bucket = rateLimitBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
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
  if (!origin) return true;
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

async function fail(meta, status, payload) {
  await logApiFailure({
    ...meta,
    httpStatus: status,
    errorMessage: payload?.error || "Unknown error",
    errorDetail: payload?.detail || "",
  });
  return Response.json(payload, { status });
}

export async function POST(request) {
  const requestMeta = {
    clientId: request.headers.get("x-client-id") || "",
    clientIp: getClientIp(request),
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
    if (rateKey && isRateLimited(rateKey)) {
      return fail({ ...requestMeta, stage: "rate_limit", errorType: "rate_limit" }, 429, { error: "Rate limit exceeded. Please retry shortly." });
    }
    const payload = await request.json();
    const bodyError = validateBody(payload);
    if (bodyError) {
      return fail({ ...requestMeta, stage: "input", errorType: "validation" }, 400, { error: bodyError });
    }
    const { system, message } = payload;
    const { maxTokens, temperature } = normalizeGenerationParams(payload);
    const proxyUrl = resolveProxyUrl();
    if (proxyUrl) {
      const content = await callDeepSeekViaCurl({
        apiKey: process.env.DEEPSEEK_API_KEY,
        proxyUrl,
        timeoutMs: 70000,
        payload: {
          model: "deepseek-chat",
          max_tokens: maxTokens,
          temperature,
          stream: false,
          messages: [
            { role: "system", content: system },
            { role: "user", content: message },
          ],
        },
      });
      return Response.json({ content });
    }

    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.DEEPSEEK_API_KEY,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: maxTokens,
        temperature,
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: message },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return fail(
        { ...requestMeta, stage: "deepseek", errorType: "upstream" },
        res.status,
        { error: "DeepSeek API error: " + res.status, detail: errText },
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    return Response.json({ content });
  } catch (e) {
    return fail(
      { ...requestMeta, stage: "server", errorType: "internal" },
      500,
      { error: e.message || "Unexpected server error" }
    );
  }
}
