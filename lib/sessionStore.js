import {
  clearAllSessionsCloud,
  deleteSessionCloud,
  loadSessionsCloud,
  saveSessionCloud,
} from "./cloudSessionStore";
import { isSupabaseConfigured } from "./supabase";
import { BANK_EPOCH_CURRENT } from "./history/bankVersion";

const HISTORY_KEY = "toefl-hist";
const MAX_HISTORY = 50;
const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";
const HISTORY_UPDATED_EVENT = "toefl-history-updated";

let currentUserCode = null;
let cloudHistCache = { sessions: [] };
let cloudSyncVersion = 0;
const AUTH_STORAGE_KEY = "toefl-user-code";

// Tracks which user codes have triggered referral activation this tab session,
// so we don't fire the request on every single session save.
const referralActivationAttempted = new Set();

// Lazy import to avoid pulling the referral state machine into modules that
// don't need it (sessionStore is imported very widely). Keeps the dependency
// graph minimal.
async function dispatchReferralGrant(payload) {
  try {
    const mod = await import("./referral/state");
    if (typeof mod?.markActivating === "function") mod.markActivating();
    if (payload?.granted && typeof mod?.markGranted === "function") {
      mod.markGranted({ daysAdded: Number(payload.daysAdded) || 0 });
    }
  } catch { /* swallow */ }
  try {
    const tracker = await import("./analytics/referral");
    if (payload?.granted && typeof tracker?.trackReferralEvent === "function") {
      tracker.trackReferralEvent("grant_success", {
        inviterCode: payload?.inviterCode || null,
        inviteeCode: payload?.inviteeCode || null,
      });
    } else if (typeof tracker?.trackReferralEvent === "function") {
      tracker.trackReferralEvent("first_practice", { inviteeCode: payload?.inviteeCode || null });
    }
  } catch { /* swallow */ }
}

function maybeActivateReferral(userCode) {
  if (!userCode || referralActivationAttempted.has(userCode)) return;
  referralActivationAttempted.add(userCode);
  // Fire-and-forget; server-side activation is idempotent + gated by session count.
  fetch("/api/referral/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inviteeCode: userCode }),
  })
    .then((r) => r.json())
    .then((data) => {
      // Server returns { ok, granted, daysAdded, inviterCode, reason }.
      // Push the result through the referral state machine so toasts /
      // analytics / future notification bell all stay in sync.
      dispatchReferralGrant({
        granted: !!(data?.ok && data?.granted),
        daysAdded: data?.daysAdded,
        inviterCode: data?.inviterCode,
        inviteeCode: userCode,
      });
    })
    .catch(() => {
      // Allow retry on next save by removing from the set
      referralActivationAttempted.delete(userCode);
    });
}

function getScopedDoneKey(key) {
  const safeKey = String(key || "").trim();
  const persistedCode =
    !currentUserCode && isBrowser() ? String(localStorage.getItem(AUTH_STORAGE_KEY) || "").trim().toUpperCase() : "";
  const scopeCode = currentUserCode || persistedCode;
  const scope = scopeCode ? `user:${scopeCode}` : "guest";
  return `${safeKey}::${scope}`;
}

function emitHistoryUpdated() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(HISTORY_UPDATED_EVENT));
  } catch {
    // no-op
  }
}

function normalizeSession(s) {
  const base = { attempts: 1, ...s, date: s?.date || new Date().toISOString() };
  // Stamp the current bank generation so future re-banks can tell V2 (and later)
  // sessions apart precisely. Only object-shaped details get the stamp — bs stores
  // details as an array, and detail-less sessions fall back to date in isV1Session.
  if (base.details && typeof base.details === "object" && !Array.isArray(base.details)) {
    base.details = { ...base.details, bankEpoch: BANK_EPOCH_CURRENT };
  }
  return base;
}

function loadFromLocalStorage() {
  if (!isBrowser()) return { sessions: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{\"sessions\":[]}");
    if (!parsed || !Array.isArray(parsed.sessions)) return { sessions: [] };
    return parsed;
  } catch {
    return { sessions: [] };
  }
}

function writeHistoryLocalStorage(nextHist) {
  if (!isBrowser()) return;
  const next = Array.isArray(nextHist?.sessions) ? [...nextHist.sessions] : [];
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ sessions: next }));
    emitHistoryUpdated();
  } catch (e) {
    const keeps = [];
    for (let keep = next.length - 5; keep > 0; keep -= 5) keeps.push(keep);
    if (next.length > 0 && !keeps.includes(1)) keeps.push(1);
    for (const keep of keeps) {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify({ sessions: next.slice(-keep) }));
        emitHistoryUpdated();
        return;
      } catch {
        continue;
      }
    }
    console.error(e);
  }
}

function saveToLocalStorage(s) {
  if (!isBrowser()) return;
  const h = loadFromLocalStorage();
  h.sessions.push(normalizeSession(s));
  if (h.sessions.length > MAX_HISTORY) h.sessions = h.sessions.slice(-MAX_HISTORY);
  writeHistoryLocalStorage(h);
}

function upsertMockToLocalStorage(s, mockSessionId) {
  if (!isBrowser()) return;
  const h = loadFromLocalStorage();
  const nextItem = normalizeSession(s);
  const canUpsert = typeof mockSessionId === "string" && mockSessionId.trim().length > 0;
  const idx = canUpsert
    ? h.sessions.findIndex((x) => x?.type === "mock" && x?.details?.mockSessionId === mockSessionId)
    : -1;
  if (idx >= 0) h.sessions[idx] = { ...h.sessions[idx], ...nextItem };
  else h.sessions.push(nextItem);

  if (h.sessions.length > MAX_HISTORY) h.sessions = h.sessions.slice(-MAX_HISTORY);
  writeHistoryLocalStorage(h);
}

function deleteFromLocalStorage(index) {
  if (!isBrowser()) return { sessions: [] };
  try {
    const h = loadFromLocalStorage();
    const idx = Number(index);
    const target = Number.isInteger(idx) ? h.sessions[idx] : null;
    const mockSessionId =
      target?.type === "mock" && typeof target?.details?.mockSessionId === "string"
        ? target.details.mockSessionId.trim()
        : "";
    if (mockSessionId) {
      h.sessions = h.sessions.filter(
        (s, i) => i !== idx && !(s?.type === "mock" && s?.details?.mockSessionId === mockSessionId)
      );
    } else if (Number.isInteger(idx) && idx >= 0) {
      h.sessions.splice(idx, 1);
    }
    writeHistoryLocalStorage(h);
    return h;
  } catch (e) {
    console.error(e);
    return loadFromLocalStorage();
  }
}

function clearAllFromLocalStorage() {
  if (!isBrowser()) return { sessions: [] };
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ sessions: [] }));
    emitHistoryUpdated();
    return { sessions: [] };
  } catch (e) {
    console.error(e);
    return { sessions: [] };
  }
}

async function syncCloudHistory() {
  if (!currentUserCode || !isSupabaseConfigured) return;
  const requestCode = currentUserCode;
  const requestVersion = ++cloudSyncVersion;
  const { sessions, error } = await loadSessionsCloud(requestCode);
  if (requestVersion !== cloudSyncVersion) return;
  if (requestCode !== currentUserCode) return;
  if (!error) {
    cloudHistCache = { sessions: Array.isArray(sessions) ? sessions : [] };
    emitHistoryUpdated();
  }
}

export function setCurrentUser(code) {
  const normalized = String(code || "").trim().toUpperCase() || null;
  if (normalized === currentUserCode) return;
  currentUserCode = normalized;
  if (!normalized) {
    cloudHistCache = { sessions: [] };
    emitHistoryUpdated();
    return;
  }
  syncCloudHistory();
}

export function loadHist() {
  if (currentUserCode && isSupabaseConfigured) {
    if (!cloudHistCache || !Array.isArray(cloudHistCache.sessions)) {
      cloudHistCache = { sessions: [] };
      syncCloudHistory();
    }
    return cloudHistCache || { sessions: [] };
  }
  return loadFromLocalStorage();
}

export function saveSess(s) {
  // Self-recover: if currentUserCode lost (e.g. page refresh on /build-sentence),
  // restore from localStorage so sessions save to cloud and usage is consumed.
  if (!currentUserCode && isBrowser()) {
    const persisted = String(localStorage.getItem(AUTH_STORAGE_KEY) || "").trim().toUpperCase();
    if (persisted) setCurrentUser(persisted);
  }
  if (!currentUserCode || !isSupabaseConfigured) {
    saveToLocalStorage(s);
    return;
  }
  const nextItem = normalizeSession(s);
  const nextSessions = [...(cloudHistCache?.sessions || []), nextItem];
  cloudHistCache = { sessions: nextSessions.slice(-200) };
  emitHistoryUpdated();
  saveSessionCloud(currentUserCode, nextItem).then(({ error }) => {
    if (error) console.error(error);
    syncCloudHistory();
  });
  // NOTE: daily usage is now metered server-side in /api/ai at the point of the
  // AI call (single authoritative counter that cannot be bypassed). Saving a
  // session no longer consumes a credit — local auto-graded practice
  // (reading/listening/build-sentence) is intentionally free.
  if (currentUserCode) {
    maybeActivateReferral(currentUserCode);
  }
}

export function upsertMockSess(s, mockSessionId) {
  if (!currentUserCode && isBrowser()) {
    const persisted = String(localStorage.getItem(AUTH_STORAGE_KEY) || "").trim().toUpperCase();
    if (persisted) setCurrentUser(persisted);
  }
  if (!currentUserCode || !isSupabaseConfigured) {
    upsertMockToLocalStorage(s, mockSessionId);
    return;
  }
  const nextItem = normalizeSession(s);
  const key = typeof mockSessionId === "string" ? mockSessionId.trim() : "";
  const sessions = [...(cloudHistCache?.sessions || [])];
  const idx = key
    ? sessions.findIndex((x) => x?.type === "mock" && x?.details?.mockSessionId === key)
    : -1;
  const isNewSession = idx < 0;
  if (idx >= 0) sessions[idx] = { ...sessions[idx], ...nextItem };
  else sessions.push(nextItem);
  cloudHistCache = { sessions: sessions.slice(-200) };
  emitHistoryUpdated();
  saveSessionCloud(currentUserCode, nextItem).then(({ error }) => {
    if (error) console.error(error);
    syncCloudHistory();
  });
  // Usage is metered server-side in /api/ai per AI call. A standard mock's 3
  // writing tasks each hit /api/ai, so the mock still costs 3 — no client-side
  // consume needed (and adaptive/auto-graded mocks correctly cost nothing).
  if (isNewSession && currentUserCode) {
    maybeActivateReferral(currentUserCode);
  }
}

export function deleteSession(identifier) {
  if (!currentUserCode || !isSupabaseConfigured) return deleteFromLocalStorage(identifier);

  const id = Number(identifier);
  if (!Number.isInteger(id)) return loadHist();
  const sessions = Array.isArray(cloudHistCache?.sessions) ? [...cloudHistCache.sessions] : [];
  cloudHistCache = { sessions: sessions.filter((s) => Number(s?.id) !== id) };
  emitHistoryUpdated();
  deleteSessionCloud(id).then(({ error }) => {
    if (error) console.error(error);
    syncCloudHistory();
  });
  return loadHist();
}

export function clearAllSessions() {
  if (!currentUserCode || !isSupabaseConfigured) return clearAllFromLocalStorage();

  cloudHistCache = { sessions: [] };
  emitHistoryUpdated();
  clearAllSessionsCloud(currentUserCode).then(({ error }) => {
    if (error) console.error(error);
    syncCloudHistory();
  });
  return { sessions: [] };
}

export async function importLocalSessionsToCloud() {
  if (!currentUserCode || !isSupabaseConfigured) {
    return { imported: 0, error: "Supabase not configured or user not logged in" };
  }
  const local = loadFromLocalStorage();
  const sessions = Array.isArray(local?.sessions) ? local.sessions : [];
  let imported = 0;
  for (const s of sessions) {
    const { error } = await saveSessionCloud(currentUserCode, normalizeSession(s));
    if (error) return { imported, error };
    imported += 1;
  }
  if (imported > 0) clearAllFromLocalStorage();
  await syncCloudHistory();
  return { imported, error: null };
}

export function clearLocalSessions() {
  return clearAllFromLocalStorage();
}

export function getLocalSessionCount() {
  return (loadFromLocalStorage()?.sessions || []).length;
}

export function loadDoneIds(key) {
  if (!isBrowser()) return new Set();
  try {
    const scopedKey = getScopedDoneKey(key);
    const scopedRaw = localStorage.getItem(scopedKey);
    if (scopedRaw != null) {
      return new Set(JSON.parse(scopedRaw || "[]"));
    }
    const legacyRaw = localStorage.getItem(key);
    const migrated = new Set(JSON.parse(legacyRaw || "[]"));
    if (migrated.size > 0) {
      localStorage.setItem(scopedKey, JSON.stringify([...migrated]));
    }
    return migrated;
  } catch {
    return new Set();
  }
}

export function addDoneIds(key, ids) {
  if (!isBrowser()) return;
  try {
    const done = loadDoneIds(key);
    ids.forEach((id) => done.add(id));
    localStorage.setItem(getScopedDoneKey(key), JSON.stringify([...done]));
  } catch (e) {
    console.error(e);
  }
}

export const SESSION_STORE_EVENTS = {
  HISTORY_UPDATED_EVENT,
};
