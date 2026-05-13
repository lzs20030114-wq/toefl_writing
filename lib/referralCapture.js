/**
 * Captures the `?ref=ABC123` query param into localStorage so it survives
 * navigation, signup flow, and OTP round-trips. Cleared after binding succeeds.
 *
 * Storage:
 *   localStorage["toefl-ref"] = { code: "ABC123", capturedAt: 1731234567000, source: "link" }
 *   (30-day TTL, ignored if older)
 */

const STORAGE_KEY = "toefl-ref";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

/**
 * Read ?ref= from current URL, persist if valid, then strip the param from
 * the visible URL (history.replaceState) so the user sees a clean URL.
 *
 * Safe to call on every page load — idempotent.
 */
export function captureRefFromUrl() {
  if (!isBrowser()) return;
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("ref");
    if (!raw) return;

    const code = normalizeCode(raw);
    if (code.length !== 6) return;

    // Don't overwrite an existing capture — first inviter wins
    const existing = getStoredRef();
    if (!existing) {
      const payload = { code, capturedAt: Date.now(), source: "link" };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }

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
 * Get the stored referral code (if any, and not expired).
 * Returns { code, source } | null
 */
export function getStoredRef() {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.code) return null;
    if (Date.now() - (data.capturedAt || 0) > TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { code: normalizeCode(data.code), source: data.source || "link" };
  } catch {
    return null;
  }
}

/**
 * Persist a manually-typed inviter code (from the signup form).
 * Only used if there's no link-based capture already.
 */
export function setStoredRef(code, source = "manual") {
  if (!isBrowser()) return;
  const normalized = normalizeCode(code);
  if (normalized.length !== 6) return;
  try {
    const payload = { code: normalized, capturedAt: Date.now(), source };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* no-op */
  }
}

/**
 * Clear the stored ref (called after successful bind).
 */
export function clearStoredRef() {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* no-op */
  }
}
