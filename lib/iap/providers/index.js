import { IapError } from "../errors";
import { afdianProvider } from "./afdianProvider";
import { mockProvider } from "./mockProvider";
import { xorpayProvider } from "./xorpayProvider";

function normalizeProviderName(value) {
  return String(value || "").trim().toLowerCase();
}

export function getIapProvider() {
  const name = normalizeProviderName(process.env.IAP_PROVIDER);
  if (!name) {
    throw new IapError("IAP_NOT_CONFIGURED", "IAP_PROVIDER env is not set", 500);
  }
  if (name === "mock") return mockProvider;
  if (name === "afdian") return afdianProvider;
  if (name === "xorpay") return xorpayProvider;

  throw new IapError(
    "IAP_PROVIDER_NOT_SUPPORTED",
    `IAP provider "${name}" is not supported yet`,
    500
  );
}

