import { IapError } from "../errors";
import { afdianProvider } from "./afdianProvider";
import { mockProvider } from "./mockProvider";

function normalizeProviderName(value) {
  return String(value || "mock").trim().toLowerCase();
}

export function getIapProvider() {
  const name = normalizeProviderName(process.env.IAP_PROVIDER);
  if (name === "mock") return mockProvider;
  if (name === "afdian") return afdianProvider;

  throw new IapError(
    "IAP_PROVIDER_NOT_SUPPORTED",
    `IAP provider "${name}" is not supported yet`,
    500
  );
}

