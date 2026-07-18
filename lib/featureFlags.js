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

// Credits use two independent server switches so merely exposing wallets cannot
// accidentally start blocking paid AI requests. The safe rollout order is:
// CREDITS_ENABLED -> seed/observe balances -> CREDITS_ENFORCEMENT_ENABLED.
export function isCreditsEnabledServer() {
  return isTrue(process.env.CREDITS_ENABLED);
}

export function isCreditsEnforcementEnabledServer() {
  return isCreditsEnabledServer() && isTrue(process.env.CREDITS_ENFORCEMENT_ENABLED);
}

export function isCreditsEnabledClient() {
  return isTrue(process.env.NEXT_PUBLIC_CREDITS_ENABLED);
}

// Speaking open-beta: during the test window, open Speaking (practice + exam) to
// free users too — a single client-readable switch so it's instantly revertible.
// NEXT_PUBLIC_ means the same call works in pages (build-inlined) and in the
// transcribe route (server). Spec uses "1" (not "true") as the on value.
export function isSpeakingOpenBetaEnabled() {
  return process.env.NEXT_PUBLIC_SPEAKING_OPEN_BETA === "1";
}
