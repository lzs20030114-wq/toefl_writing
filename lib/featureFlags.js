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

// Speaking open-beta: during the test window, open Speaking (practice + exam) to
// free users too — a single client-readable switch so it's instantly revertible.
// NEXT_PUBLIC_ means the same call works in pages (build-inlined) and in the
// transcribe route (server). Spec uses "1" (not "true") as the on value.
export function isSpeakingOpenBetaEnabled() {
  return process.env.NEXT_PUBLIC_SPEAKING_OPEN_BETA === "1";
}
