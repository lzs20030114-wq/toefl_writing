import { iapJsonError } from "../../../../lib/iap/errors";
import { handleWebhook } from "../../../../lib/iap/service";
import { buildMockWebhookPayload, signMockWebhookPayload } from "../../../../lib/iap/providers/mockProvider";

function assertSimulationAllowed() {
  const allowed = String(process.env.IAP_ALLOW_MOCK_WEBHOOK_SIMULATION || "").trim().toLowerCase() === "true";
  if (!allowed) {
    throw new IapError(
      "IAP_MOCK_WEBHOOK_SIMULATION_DISABLED",
      "Set IAP_ALLOW_MOCK_WEBHOOK_SIMULATION=true to enable this endpoint",
      403
    );
  }
}

export async function POST(request) {
  try {
    assertSimulationAllowed();
    const body = await request.json().catch(() => ({}));
    const rawBody = buildMockWebhookPayload({
      userCode: body?.userCode,
      productId: body?.productId,
      providerRef: body?.providerRef,
      eventType: body?.eventType,
    });
    const signature = signMockWebhookPayload(rawBody);

    const headers = new Headers({ "x-iap-signature": signature });
    const result = await handleWebhook({ headers, rawBody });
    return Response.json(result, { status: 200 });
  } catch (e) {
    return iapJsonError(e);
  }
}

