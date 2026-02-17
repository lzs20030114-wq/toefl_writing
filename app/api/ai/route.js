import { createRequire } from "module";
import { createHash } from "crypto";

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
  const clientId = String(request.headers.get("x-client-id") || "").trim();
  if (clientId && clientId.length <= 128) return `cid:${clientId}`;
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
  if (!Number.isFinite(maxTokensRaw) || maxTokensRaw <= 0 || maxTokensRaw > MAX_TOKENS) {
    return `maxTokens must be between 1 and ${MAX_TOKENS}.`;
  }
  if (!Number.isFinite(temperatureRaw) || temperatureRaw < 0 || temperatureRaw > 2) {
    return "temperature must be between 0 and 2.";
  }
  return "";
}

export async function POST(request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return Response.json({ error: `Request body too large (>${MAX_BODY_BYTES} bytes).` }, { status: 413 });
    }
    if (!isOriginAllowed(request)) {
      return Response.json({ error: "Forbidden origin." }, { status: 403 });
    }
    const rateKey = getRateLimitKey(request);
    if (rateKey && isRateLimited(rateKey)) {
      return Response.json({ error: "Rate limit exceeded. Please retry shortly." }, { status: 429 });
    }
    const payload = await request.json();
    const bodyError = validateBody(payload);
    if (bodyError) {
      return Response.json({ error: bodyError }, { status: 400 });
    }
    const { system, message, maxTokens, temperature } = payload;
    const proxyUrl = resolveProxyUrl();
    if (proxyUrl) {
      const content = await callDeepSeekViaCurl({
        apiKey: process.env.DEEPSEEK_API_KEY,
        proxyUrl,
        timeoutMs: 70000,
        payload: {
          model: "deepseek-chat",
          max_tokens: maxTokens || 2000,
          temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.3,
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
        max_tokens: maxTokens || 2000,
        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.3,
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: message },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return Response.json(
        { error: "DeepSeek API error: " + res.status, detail: errText },
        { status: res.status }
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    return Response.json({ content });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
