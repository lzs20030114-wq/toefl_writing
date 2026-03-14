import { IapError, toIapError } from "../../../../lib/iap/errors";
import { handleWebhook } from "../../../../lib/iap/service";
import { getIapProvider } from "../../../../lib/iap/providers";

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

    // Afdian etc.: always return success format to prevent infinite retries
    if (provider?.formatWebhookResponse) {
      return Response.json(provider.formatWebhookResponse(null, e), { status: 200 });
    }
    return jsonError(e);
  }
}
