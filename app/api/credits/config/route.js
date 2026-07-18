import {
  isCreditsEnabledClient,
  isCreditsEnabledServer,
  isCreditsEnforcementEnabledServer,
} from "../../../../lib/featureFlags";
import {
  listCreditActions,
  listCreditPlans,
  listCreditTopUps,
} from "../../../../lib/credits/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const enabled = isCreditsEnabledServer();
  const clientVisible = isCreditsEnabledClient();
  if (!enabled || !clientVisible) {
    return Response.json(
      { enabled: false, enforcementEnabled: false, clientVisible: false },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    {
      enabled,
      enforcementEnabled: isCreditsEnforcementEnabledServer(),
      clientVisible,
      plans: listCreditPlans(),
      topUps: listCreditTopUps(),
      actions: listCreditActions(),
      message: "Credit infrastructure is staged behind disabled feature flags.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
