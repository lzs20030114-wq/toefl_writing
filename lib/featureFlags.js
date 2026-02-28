function isTrue(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function isIapEnabledServer() {
  if (isTrue(process.env.IAP_ENABLED)) return true;
  return isTrue(process.env.NEXT_PUBLIC_IAP_ENABLED);
}

export function isIapEnabledClient() {
  return isTrue(process.env.NEXT_PUBLIC_IAP_ENABLED);
}

