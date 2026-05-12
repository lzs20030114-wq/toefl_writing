const AUTH_STORAGE_KEY = "toefl-user-code";
const AUTH_METHOD_KEY = "toefl-auth-method";
const AUTH_TIER_KEY = "toefl-user-tier";
const AUTH_EMAIL_KEY = "toefl-user-email";
const AUTH_HAS_PASSWORD_KEY = "toefl-has-password";

// Cookie backup for the user code. iOS Safari occasionally drops localStorage
// under memory pressure (and ITP-style cleanups), leaving the user logged out
// even though their session is still valid server-side. Cookies survive those
// purges. We mirror just the user code (the only piece needed to re-auth);
// tier / email get re-fetched from /api/auth/user-info on next load.
const COOKIE_USER_CODE = "tp_user_code";
const COOKIE_MAX_AGE_DAYS = 90;

function readCookie(name) {
  if (typeof document === "undefined") return "";
  const target = `${name}=`;
  const parts = String(document.cookie || "").split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) {
      try { return decodeURIComponent(trimmed.slice(target.length)); }
      catch { return ""; }
    }
  }
  return "";
}

function writeCookie(name, value, maxAgeDays) {
  if (typeof document === "undefined") return;
  const days = Number.isFinite(maxAgeDays) ? maxAgeDays : COOKIE_MAX_AGE_DAYS;
  const maxAge = days * 24 * 60 * 60;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

function deleteCookie(name) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/**
 * Called once at app boot (from ClientBootstrap). If localStorage was cleared
 * (e.g. iOS purge) but the cookie still has the user code, restore it. The
 * user lands on a logged-in page instead of being kicked back to login.
 */
export function restoreUserCodeFromCookie() {
  if (typeof window === "undefined") return;
  try {
    const local = localStorage.getItem(AUTH_STORAGE_KEY);
    if (local) return;
    const cookieCode = readCookie(COOKIE_USER_CODE);
    if (cookieCode && /^[A-Z0-9]{6}$/.test(cookieCode)) {
      localStorage.setItem(AUTH_STORAGE_KEY, cookieCode);
    }
  } catch {
    // best-effort
  }
}

export function getSavedCode() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_STORAGE_KEY);
}

export function getSavedAuthMethod() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_METHOD_KEY) || "code";
}

export function getSavedTier() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_TIER_KEY) || "free";
}

export function getSavedEmail() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_EMAIL_KEY) || null;
}

export function getSavedHasPassword() {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(AUTH_HAS_PASSWORD_KEY) === "true";
}

export function saveAuth(code, { authMethod, tier, email, hasPassword } = {}) {
  if (typeof window === "undefined") return;
  const normalizedCode = String(code || "").toUpperCase().trim();
  localStorage.setItem(AUTH_STORAGE_KEY, normalizedCode);
  if (authMethod) localStorage.setItem(AUTH_METHOD_KEY, authMethod);
  if (tier) localStorage.setItem(AUTH_TIER_KEY, tier);
  if (email) localStorage.setItem(AUTH_EMAIL_KEY, email);
  if (hasPassword !== undefined) localStorage.setItem(AUTH_HAS_PASSWORD_KEY, String(!!hasPassword));
  // Mirror the user code to a cookie so iOS Safari purges don't log the user out.
  if (normalizedCode) writeCookie(COOKIE_USER_CODE, normalizedCode);
}

export function clearAuth() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(AUTH_METHOD_KEY);
  localStorage.removeItem(AUTH_TIER_KEY);
  localStorage.removeItem(AUTH_EMAIL_KEY);
  localStorage.removeItem(AUTH_HAS_PASSWORD_KEY);
  deleteCookie(COOKIE_USER_CODE);
}

// Backward compatibility
export function saveCode(code) {
  saveAuth(code, { authMethod: "code" });
}

export function clearCode() {
  clearAuth();
}
