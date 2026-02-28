import { IapError } from "../errors";
import { mockProvider } from "./mockProvider";

function normalizeProviderName(value) {
  return String(value || "mock").trim().toLowerCase();
}

export function getIapProvider() {
  const name = normalizeProviderName(process.env.IAP_PROVIDER);
  if (name === "mock") return mockProvider;

  throw new IapError(
    "IAP_PROVIDER_NOT_SUPPORTED",
    `IAP provider "${name}" is not supported yet`,
    500
  );
}

