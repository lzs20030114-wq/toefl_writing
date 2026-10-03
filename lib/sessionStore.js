import {
  clearAllSessionsCloud,
  deleteSessionCloud,
  loadSessionsCloud,
  saveSessionCloud,
  updateSessionCloud,
  updateSessionDetailsCloud,
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
let cloudSyncRequest = null;
// Only coordinate writes still in flight; this is not an offline queue.
const pendingCloudWrites = new Map();
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

function syncCloudHistory() {
  if (!currentUserCode || !isSupabaseConfigured) return Promise.resolve();
  const requestCode = currentUserCode;
  // A foreground refresh must not replace optimistic submissions with a read
  // taken before their inserts commit. The final write schedules a fresh read.
  const pending = pendingCloudWrites.get(requestCode);
  if (pending) {
    return pending.done.then(() => requestCode === currentUserCode ? syncCloudHistory() : undefined);
  }
  if (cloudSyncRequest?.code === requestCode && cloudSyncRequest.version === cloudSyncVersion) {
    return cloudSyncRequest.promise;
  }
  const requestVersion = ++cloudSyncVersion;
  const request = { code: requestCode, version: requestVersion, promise: null };
  request.promise = (async () => {
    try {
      const { sessions, error } = await loadSessionsCloud(requestCode);
      if (requestVersion !== cloudSyncVersion || requestCode !== currentUserCode) return;
      if (!error) {
        cloudHistCache = { sessions: Array.isArray(sessions) ? sessions : [] };
        emitHistoryUpdated();
      }
    } catch (error) {
      console.warn("History refresh failed", error);
    } finally {
      if (cloudSyncRequest === request) cloudSyncRequest = null;
    }
  })();
  cloudSyncRequest = request;
  return request.promise;
}

export function setCurrentUser(code, { refresh = false } = {}) {
  const normalized = String(code || "").trim().toUpperCase() || null;
  if (normalized === currentUserCode) return refresh ? syncCloudHistory() : undefined;
  currentUserCode = normalized;
  cloudSyncVersion += 1;
  // Never show the previous account while the next account's read is pending.
  cloudHistCache = { sessions: [] };
  emitHistoryUpdated();
  return syncCloudHistory();
}

function beginCloudWrite(userCode) {
  let pending = pendingCloudWrites.get(userCode);
  if (!pending) {
    let resolve;
    pending = { count: 0, done: new Promise((done) => { resolve = done; }), resolve: () => resolve() };
    pendingCloudWrites.set(userCode, pending);
  }
  pending.count += 1;
  cloudSyncVersion += 1; // invalidate reads started before any insert/update/delete
  return () => {
    pending.count -= 1;
    if (pending.count === 0) {
      pendingCloudWrites.delete(userCode);
      pending.resolve();
      if (userCode === currentUserCode) syncCloudHistory();
    }
  };
}

function persistSessionToCloud(userCode, session) {
  const finish = beginCloudWrite(userCode);
  saveSessionCloud(userCode, session)
    .then(({ error }) => { if (error) console.error(error); })
    .catch((error) => console.error(error))
    .finally(finish);
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
  persistSessionToCloud(currentUserCode, nextItem);
  // NOTE: daily usage is now metered server-side in /api/ai at the point of the
  // AI call (single authoritative counter that cannot be bypassed). Saving a
  // session no longer consumes a credit — local auto-graded practice
  // (reading/listening/build-sentence) is intentionally free.
  if (currentUserCode) {
    maybeActivateReferral(currentUserCode);
  }
}

// 给一条**已经保存过**的记录打补丁（目前唯一用途：写作讲评 lesson 在评分之后
// 30 秒左右才到，必须补进那条已经落库的练习记录，否则用户回历史页只看得到评分）。
//
// matcher 用 { practiceRootId, practiceAttempt }——details 里本来就有这两个字段，
// 且能唯一定位「这一题的第 N 次作答」；用数组下标或 date 都会在云端重排后错位。
// 本地路径直接改 localStorage；云端路径要等 id 回来（saveSess 的乐观插入还没有 id
// 时先 syncCloudHistory 一次再找），仍找不到就放弃并 warn，绝不抛错打断调用方。
export async function updateSessionDetails(matcher, patchFn) {
  const rootId = String(matcher?.practiceRootId || "").trim();
  const attemptRaw = Number(matcher?.practiceAttempt);
  const attempt = Number.isFinite(attemptRaw) ? attemptRaw : null;
  if (!rootId || typeof patchFn !== "function") return false;

  const matches = (item) => {
    const d = item?.details;
    if (!d || typeof d !== "object" || Array.isArray(d)) return false;
    if (String(d.practiceRootId || "") !== rootId) return false;
    if (attempt !== null && Number(d.practiceAttempt) !== attempt) return false;
    return true;
  };
  const findLast = (list) => {
    for (let i = (list?.length || 0) - 1; i >= 0; i -= 1) {
      if (matches(list[i])) return i;
    }
    return -1;
  };
  const applyPatch = (details) => {
    try {
      const next = patchFn(details);
      return next && typeof next === "object" && !Array.isArray(next) ? next : null;
    } catch (e) {
      console.warn("updateSessionDetails: patch failed", e);
      return null;
    }
  };

  if (!currentUserCode || !isSupabaseConfigured) {
    if (!isBrowser()) return false;
    const h = loadFromLocalStorage();
    const idx = findLast(h.sessions);
    if (idx < 0) return false;
    const nextDetails = applyPatch(h.sessions[idx].details);
    if (!nextDetails) return false;
    h.sessions[idx] = { ...h.sessions[idx], details: nextDetails };
    writeHistoryLocalStorage(h);
    return true;
  }

  const requestCode = currentUserCode;
  let sessions = Array.isArray(cloudHistCache?.sessions) ? cloudHistCache.sessions : [];
  let idx = findLast(sessions);
  // 没找到，或找到的那条还没有 id（saveSess 的乐观插入尚未回同步）——再同步一次。
  if (idx < 0 || sessions[idx]?.id == null) {
    await syncCloudHistory();
    if (requestCode !== currentUserCode) return false;
    sessions = Array.isArray(cloudHistCache?.sessions) ? cloudHistCache.sessions : [];
    idx = findLast(sessions);
  }
  if (idx < 0 || sessions[idx]?.id == null) {
    console.warn("updateSessionDetails: session not found in cloud cache", rootId);
    return false;
  }
  const nextDetails = applyPatch(sessions[idx].details);
  if (!nextDetails) return false;
  const id = sessions[idx].id;
  const finish = beginCloudWrite(requestCode);
  const nextSessions = [...sessions];
  nextSessions[idx] = { ...sessions[idx], details: nextDetails };
  cloudHistCache = { sessions: nextSessions };
  emitHistoryUpdated();
  try {
    const { error } = await updateSessionDetailsCloud(requestCode, id, nextDetails);
    if (error) {
      console.warn("updateSessionDetails: cloud update failed", error);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("updateSessionDetails: cloud update failed", error);
    return false;
  } finally {
    finish();
  }
}

// 按「记录标识」整条打补丁（标识与 deleteSession 同一口径：云端行 id / 本地数组下标）。
// patchFn(session) 返回新的整条 session（含 score / details），返回 null 视为放弃。
// 和 updateSessionDetails 的区别：不靠 practiceRootId 定位（评分中途离开页面存下的失败记录没有它），
// 且 score 与 details 一起写——真题记录「重试评分」要把新分数补回去。
// 任何失败都只返回 false，绝不抛错打断调用方。
export async function patchSession(identifier, patchFn) {
  if (typeof patchFn !== "function") return false;
  const apply = (session) => {
    try {
      const next = patchFn(session);
      return next && typeof next === "object" && !Array.isArray(next) ? next : null;
    } catch (e) {
      console.warn("patchSession: patch failed", e);
      return null;
    }
  };

  if (!currentUserCode || !isSupabaseConfigured) {
    if (!isBrowser()) return false;
    const h = loadFromLocalStorage();
    const idx = Number(identifier);
    if (!Number.isInteger(idx) || !h.sessions[idx]) return false;
    const next = apply(h.sessions[idx]);
    if (!next) return false;
    h.sessions[idx] = next;
    writeHistoryLocalStorage(h);
    return true;
  }

  const requestCode = currentUserCode;
  const id = Number(identifier);
  if (!Number.isInteger(id)) return false;
  const sessions = Array.isArray(cloudHistCache?.sessions) ? cloudHistCache.sessions : [];
  const idx = sessions.findIndex((s) => Number(s?.id) === id);
  if (idx < 0) return false;
  const next = apply(sessions[idx]);
  if (!next) return false;
  const finish = beginCloudWrite(requestCode);
  const nextSessions = [...sessions];
  nextSessions[idx] = next;
  cloudHistCache = { sessions: nextSessions };
  emitHistoryUpdated();
  try {
    const { error } = await updateSessionCloud(requestCode, id, next);
    if (error) {
      console.warn("patchSession: cloud update failed", error);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("patchSession: cloud update failed", error);
    return false;
  } finally {
    finish();
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
  persistSessionToCloud(currentUserCode, nextItem);
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
  const finish = beginCloudWrite(currentUserCode);
  const sessions = Array.isArray(cloudHistCache?.sessions) ? [...cloudHistCache.sessions] : [];
  cloudHistCache = { sessions: sessions.filter((s) => Number(s?.id) !== id) };
  emitHistoryUpdated();
  deleteSessionCloud(id)
    .then(({ error }) => { if (error) console.error(error); })
    .catch((error) => console.error(error))
    .finally(finish);
  return loadHist();
}

export function clearAllSessions() {
  if (!currentUserCode || !isSupabaseConfigured) return clearAllFromLocalStorage();

  const finish = beginCloudWrite(currentUserCode);
  cloudHistCache = { sessions: [] };
  emitHistoryUpdated();
  clearAllSessionsCloud(currentUserCode)
    .then(({ error }) => { if (error) console.error(error); })
    .catch((error) => console.error(error))
    .finally(finish);
  return { sessions: [] };
}

export async function importLocalSessionsToCloud() {
  if (!currentUserCode || !isSupabaseConfigured) {
    return { imported: 0, error: "Supabase not configured or user not logged in" };
  }
  const local = loadFromLocalStorage();
  const sessions = Array.isArray(local?.sessions) ? local.sessions : [];
  const requestCode = currentUserCode;
  const finish = beginCloudWrite(requestCode);
  let imported = 0;
  try {
    for (const s of sessions) {
      const { error } = await saveSessionCloud(requestCode, normalizeSession(s));
      if (error) return { imported, error };
      imported += 1;
    }
    if (imported > 0) clearAllFromLocalStorage();
  } catch (error) {
    return { imported, error: error?.message || String(error) };
  } finally {
    finish();
  }
  if (requestCode === currentUserCode) await syncCloudHistory();
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
