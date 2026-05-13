/**
 * Backwards-compatible shim over lib/referral/state.js.
 *
 * Historical API surface (captureRefFromUrl / getStoredRef / setStoredRef /
 * clearStoredRef) is preserved so existing call sites — ClientBootstrap,
 * LoginGate, LoginModal — keep working without churn. New code should
 * import from lib/referral/state.js or use useReferralFlow() directly.
 */

import {
  captureRef,
  getReferralState,
  resetReferralState,
  REFERRAL_STATES,
} from "./referral/state";

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

/**
 * Read ?ref= from current URL, persist into the referral state machine, then
 * strip the param from the visible URL.
 */
export function captureRefFromUrl() {
  if (!isBrowser()) return;
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("ref");
    if (!raw) return;

    const code = normalizeCode(raw);
    if (code.length !== 6) return;

    captureRef({ code, source: "link" });

    // Strip ?ref= from visible URL so users sharing the cleaned URL don't propagate ambiguity
    params.delete("ref");
    const nextSearch = params.toString();
    const nextUrl = window.location.pathname + (nextSearch ? `?${nextSearch}` : "") + window.location.hash;
    window.history.replaceState({}, "", nextUrl);
  } catch {
    /* no-op */
  }
}

/**
 * Returns { code, source } | null — compatible with the old call sites.
 */
export function getStoredRef() {
  const s = getReferralState();
  // Treat "granted" as "no longer a pending ref" — old call sites use this
  // to decide whether to bind on signup, which doesn't apply after grant.
  if (!s.inviterCode || s.status === REFERRAL_STATES.GRANTED) return null;
  return { code: s.inviterCode, source: s.source || "link" };
}

/**
 * Persist a manually-typed inviter code (from the signup form).
 */
export function setStoredRef(code, source = "manual") {
  captureRef({ code, source });
}

/**
 * Clear the stored ref (called after successful bind, on logout, etc.).
 * For backwards compatibility this fully resets the state — call sites
 * that want finer control should use lib/referral/state.js directly.
 */
export function clearStoredRef() {
  resetReferralState();
}
