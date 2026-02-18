const AUTH_STORAGE_KEY = "toefl-user-code";

export function getSavedCode() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_STORAGE_KEY);
}

export function saveCode(code) {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_STORAGE_KEY, String(code || "").toUpperCase().trim());
}

export function clearCode() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

