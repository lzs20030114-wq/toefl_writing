import { iapJsonError } from "../../../../lib/iap/errors";
import { handleWebhook } from "../../../../lib/iap/service";
import { getIapProvider } from "../../../../lib/iap/providers";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { createLogger } from "../../../../lib/logger";
import { createHmac, timingSafeEqual } from "crypto";

const log = createLogger("webhook");

const limiter = createRateLimiter("webhook", { max: 20 });

/**
 * 可选的 webhook 路由级预验证。
 * 如果设置了 IAP_WEBHOOK_SECRET，则要求请求带 ?secret=xxx 或 x-webhook-secret header。
 * 这是 provider 级签名验证之上的额外防护层，可以在解析 body 之前拒绝明显的伪造请求。
 */
function verifyRouteSecret(request) {
  const secret = (process.env.IAP_WEBHOOK_SECRET || "").trim();
  if (!secret) return true; // not configured — skip route-level check

  // Check query param: /api/iap/webhook?secret=xxx
  const url = new URL(request.url);
  const qsSecret = url.searchParams.get("secret") || "";
  if (qsSecret && safeCompare(qsSecret, secret)) return true;

  // Check header: x-webhook-secret
  const headerSecret = request.headers.get("x-webhook-secret") || "";
  if (headerSecret && safeCompare(headerSecret, secret)) return true;

  return false;
}

function safeCompare(a, b) {
  try {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export async function POST(request) {
  if (limiter.isLimited(getIp(request))) {
    return Response.json({ ec: 200, em: "" }, { status: 429 });
  }

  // Route-level pre-check: reject if webhook secret is configured but not provided
  if (!verifyRouteSecret(request)) {
    log.error("Webhook route secret mismatch", { ip: getIp(request) });
    return new Response("Forbidden", { status: 403 });
  }

  let provider;
  try {
    provider = getIapProvider();
  } catch {
    provider = null;
  }

  try {
    const rawBody = await request.text();
    const result = await handleWebhook({ headers: request.headers, rawBody });

    // Provider-specific response format (e.g. Afdian needs { ec: 200, em: "" }, XorPay needs "success")
    if (provider?.formatWebhookResponse) {
      const resp = provider.formatWebhookResponse(result, null);
      if (resp?.__raw) {
        return new Response(resp.body, { status: resp.status || 200 });
      }
      return Response.json(resp, { status: 200 });
    }
    return Response.json(result, { status: 200 });
  } catch (e) {
    log.error("Error processing webhook", { error: e.message || String(e) });

    if (provider?.formatWebhookResponse) {
      const resp = provider.formatWebhookResponse(null, e);
      if (resp?.__raw) {
        const httpStatus = (e?.status === 502 || e?.status === 503) ? 503 : (resp.status || 200);
        return new Response(resp.body, { status: httpStatus });
      }
      // Return HTTP 503 for temporary failures so provider retries
      const httpStatus = (e?.status === 502 || e?.status === 503) ? 503 : 200;
      return Response.json(resp, { status: httpStatus });
    }
    return iapJsonError(e);
  }
}
