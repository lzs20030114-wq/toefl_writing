/**
 * Client helpers for /api/mistakes/favorites.
 *
 * Mirrors the shape of lib/cloudSessionStore.js: thin fetch wrappers that
 * return { data, error } and surface the API error message verbatim.
 */

const ENDPOINT = "/api/mistakes/favorites";

async function parseResponse(res) {
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!res.ok) {
    return { data: null, error: body?.error || `HTTP ${res.status}` };
  }
  return { data: body, error: null };
}

export async function loadFavoritesCloud(userCode, { limit = 200 } = {}) {
  const code = String(userCode || "").trim().toUpperCase();
  if (!code) return { data: { favorites: [] }, error: null };
  const res = await fetch(`${ENDPOINT}?code=${encodeURIComponent(code)}&limit=${limit}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  return parseResponse(res);
}

export async function addFavoriteCloud(userCode, { subject = "bs", sessionId, detailIndex, snapshot }) {
  const code = String(userCode || "").trim().toUpperCase();
  if (!code) return { data: null, error: "Missing user code" };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, subject, sessionId, detailIndex, snapshot }),
  });
  return parseResponse(res);
}

/**
 * Remove a favorite by either its id or the (sessionId, detailIndex) pointer.
 * Pass either { id } or { sessionId, detailIndex }.
 */
export async function removeFavoriteCloud(userCode, target) {
  const code = String(userCode || "").trim().toUpperCase();
  if (!code) return { data: null, error: "Missing user code" };
  const params = new URLSearchParams({ code });
  if (target?.id != null) {
    params.set("id", String(target.id));
  } else if (target?.sessionId != null && target?.detailIndex != null) {
    params.set("session", String(target.sessionId));
    params.set("index", String(target.detailIndex));
  } else {
    return { data: null, error: "Provide id or {sessionId, detailIndex}" };
  }
  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  return parseResponse(res);
}
