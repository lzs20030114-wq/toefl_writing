import { isIapEnabledServer } from "../../../../lib/featureFlags";
import { getIapProvider } from "../../../../lib/iap/providers";

export async function GET() {
  let providerName = "unknown";
  try {
    providerName = getIapProvider().name;
  } catch {
    providerName = "invalid";
  }
  const allowMockWebhookSimulation =
    String(process.env.IAP_ALLOW_MOCK_WEBHOOK_SIMULATION || "").trim().toLowerCase() === "true";

  return Response.json(
    {
      enabled: isIapEnabledServer(),
      message: "IAP is protected by feature flag.",
      provider: providerName,
      allowMockWebhookSimulation,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
