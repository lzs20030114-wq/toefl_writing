import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { callDeepSeekViaCurl, resolveProxyUrl } = require("../../../lib/ai/deepseekHttp");
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 45;

const rateLimitBuckets = globalThis.__toeflRateLimitBuckets || new Map();
if (!globalThis.__toeflRateLimitBuckets) {
  globalThis.__toeflRateLimitBuckets = rateLimitBuckets;
}

function getClientIp(request) {
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
  const origin = request.headers.get("origin") || "";
  const host = request.headers.get("host") || "";
  const fallback = `${ua}|${origin}|${host}`.trim();
  if (!fallback) return null;
  return `fallback:${fallback}`;
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

export async function POST(request) {
  try {
    const rateKey = getRateLimitKey(request);
    if (rateKey && isRateLimited(rateKey)) {
      return Response.json({ error: "Rate limit exceeded. Please retry shortly." }, { status: 429 });
    }
    const { system, message, maxTokens, temperature } = await request.json();
    const proxyUrl = resolveProxyUrl();
    if (proxyUrl) {
      const content = callDeepSeekViaCurl({
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
