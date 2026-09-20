import { createHash } from "crypto";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../supabaseAdmin";
import { getIp } from "../rateLimit";

// /api/ai 与 /api/ai/lesson 共用的请求守卫 + 失败留痕。
// 2026-09-20 从 app/api/ai/route.js 原样抽出(行为逐字节不变),让讲评路由不必
// 复制一份同源校验/限流 key/错误表写入的实现。

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

export function isOriginAllowed(request) {
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

export function getRateLimitKey(request) {
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

export async function logApiFailure(meta) {
  if (!isSupabaseAdminConfigured) return;
  try {
    await supabaseAdmin.from("api_error_feedback").insert({
      endpoint: meta?.endpoint ? String(meta.endpoint) : "/api/ai",
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

export async function fail(meta, status, payload) {
  // 2026-09-09: 原写法 `payload?.detail || ""` 会把 meta.errorDetail(上游原文)无条件
  // 覆盖成空 —— 后台 /admin-api-errors 的「详情」列因此一直是空的,502 排查无从下手。
  await logApiFailure({
    ...meta,
    httpStatus: status,
    errorMessage: payload?.error || "Unknown error",
    errorDetail: payload?.detail || meta?.errorDetail || "",
  });
  return Response.json(payload, { status });
}

export { getIp };
