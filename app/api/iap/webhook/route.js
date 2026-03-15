import { IapError, toIapError } from "../../../../lib/iap/errors";
import { handleWebhook } from "../../../../lib/iap/service";
import { getIapProvider } from "../../../../lib/iap/providers";

const WH_RL_WINDOW = 60_000;
const WH_RL_MAX = 20;
const whBuckets = globalThis.__toeflWebhookRLBuckets || new Map();
if (!globalThis.__toeflWebhookRLBuckets) globalThis.__toeflWebhookRLBuckets = whBuckets;

function getIp(req) {
  return req.headers.get("cf-connecting-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || req.headers.get("x-real-ip")
    || "unknown";
}

function isWebhookRateLimited(ip) {
  const now = Date.now();
  for (const [k, v] of whBuckets) { if (now - v.t > WH_RL_WINDOW) whBuckets.delete(k); }
  const b = whBuckets.get(ip);
  if (!b || now - b.t > WH_RL_WINDOW) { whBuckets.set(ip, { t: now, c: 1 }); return false; }
  b.c++;
  return b.c > WH_RL_MAX;
}

function jsonError(error) {
  const e = error instanceof IapError ? error : toIapError(error);
  return Response.json(
    {
      ok: false,
      error: e.code,
      message: e.message,
      details: e.details || null,
    },
    { status: e.status || 500 }
  );
}

export async function POST(request) {
  if (isWebhookRateLimited(getIp(request))) {
    return Response.json({ ec: 200, em: "" }, { status: 429 });
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

    // Provider-specific response format (e.g. Afdian needs { ec: 200, em: "" })
    if (provider?.formatWebhookResponse) {
      return Response.json(provider.formatWebhookResponse(result, null), { status: 200 });
    }
    return Response.json(result, { status: 200 });
  } catch (e) {
    console.error("[webhook] Error:", e.message || e);

    if (provider?.formatWebhookResponse) {
      const body = provider.formatWebhookResponse(null, e);
      // Return HTTP 503 for temporary failures so provider retries
      const httpStatus = (e?.status === 502 || e?.status === 503) ? 503 : 200;
      return Response.json(body, { status: httpStatus });
    }
    return jsonError(e);
  }
}
