import { isIapEnabledServer } from "../featureFlags";
import { IapError } from "./errors";

export function assertIapEnabled() {
  if (!isIapEnabledServer()) {
    throw new IapError("IAP_DISABLED", "IAP feature is disabled", 404);
  }
}

