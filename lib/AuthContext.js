const AUTH_STORAGE_KEY = "toefl-user-code";
const AUTH_METHOD_KEY = "toefl-auth-method";
const AUTH_TIER_KEY = "toefl-user-tier";
const AUTH_EMAIL_KEY = "toefl-user-email";
const AUTH_HAS_PASSWORD_KEY = "toefl-has-password";

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
  localStorage.setItem(AUTH_STORAGE_KEY, String(code || "").toUpperCase().trim());
  if (authMethod) localStorage.setItem(AUTH_METHOD_KEY, authMethod);
  if (tier) localStorage.setItem(AUTH_TIER_KEY, tier);
  if (email) localStorage.setItem(AUTH_EMAIL_KEY, email);
  if (hasPassword !== undefined) localStorage.setItem(AUTH_HAS_PASSWORD_KEY, String(!!hasPassword));
}

export function clearAuth() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(AUTH_METHOD_KEY);
  localStorage.removeItem(AUTH_TIER_KEY);
  localStorage.removeItem(AUTH_EMAIL_KEY);
  localStorage.removeItem(AUTH_HAS_PASSWORD_KEY);
}

// Backward compatibility
export function saveCode(code) {
  saveAuth(code, { authMethod: "code" });
}

export function clearCode() {
  clearAuth();
}
