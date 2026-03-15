import { iapJsonError } from "../../../../lib/iap/errors";
import { handleWebhook } from "../../../../lib/iap/service";
import { getIapProvider } from "../../../../lib/iap/providers";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { createLogger } from "../../../../lib/logger";

const log = createLogger("webhook");

const limiter = createRateLimiter("webhook", { max: 20 });

export async function POST(request) {
  if (limiter.isLimited(getIp(request))) {
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
    log.error("Error processing webhook", { error: e.message || String(e) });

    if (provider?.formatWebhookResponse) {
      const body = provider.formatWebhookResponse(null, e);
      // Return HTTP 503 for temporary failures so provider retries
      const httpStatus = (e?.status === 502 || e?.status === 503) ? 503 : 200;
      return Response.json(body, { status: httpStatus });
    }
    return iapJsonError(e);
  }
}
