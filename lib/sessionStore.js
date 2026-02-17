const HISTORY_KEY = "toefl-hist";
const MAX_HISTORY = 50;
const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";
const HISTORY_UPDATED_EVENT = "toefl-history-updated";

function emitHistoryUpdated() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(HISTORY_UPDATED_EVENT));
  } catch {
    // no-op
  }
}

export function loadHist() {
  if (!isBrowser()) return { sessions: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{"sessions":[]}');
    if (!parsed || !Array.isArray(parsed.sessions)) return { sessions: [] };
    return parsed;
  } catch {
    return { sessions: [] };
  }
}

export function saveSess(s) {
  if (!isBrowser()) return;
  const h = loadHist();
  h.sessions.push({ attempts: 1, ...s, date: new Date().toISOString() });
  if (h.sessions.length > MAX_HISTORY) h.sessions = h.sessions.slice(-MAX_HISTORY);

  // Guard against quota errors by trimming oldest entries incrementally.
  const next = [...h.sessions];
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ ...h, sessions: next }));
    emitHistoryUpdated();
  } catch (e) {
    const keeps = [];
    for (let keep = next.length - 5; keep > 0; keep -= 5) keeps.push(keep);
    if (next.length > 0 && !keeps.includes(1)) keeps.push(1);
    for (const keep of keeps) {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify({ ...h, sessions: next.slice(-keep) }));
        emitHistoryUpdated();
        return;
      } catch {
        continue;
      }
    }
    console.error(e);
  }
}

export function upsertMockSess(s, mockSessionId) {
  if (!isBrowser()) return;
  const h = loadHist();
  const nextItem = { attempts: 1, ...s, date: new Date().toISOString() };
  const canUpsert = typeof mockSessionId === "string" && mockSessionId.trim().length > 0;
  const idx = canUpsert
    ? h.sessions.findIndex((x) => x?.type === "mock" && x?.details?.mockSessionId === mockSessionId)
    : -1;
  if (idx >= 0) {
    h.sessions[idx] = { ...h.sessions[idx], ...nextItem };
  } else {
    h.sessions.push(nextItem);
  }
  if (h.sessions.length > MAX_HISTORY) h.sessions = h.sessions.slice(-MAX_HISTORY);

  const next = [...h.sessions];
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ ...h, sessions: next }));
    emitHistoryUpdated();
  } catch (e) {
    const keeps = [];
    for (let keep = next.length - 5; keep > 0; keep -= 5) keeps.push(keep);
    if (next.length > 0 && !keeps.includes(1)) keeps.push(1);
    for (const keep of keeps) {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify({ ...h, sessions: next.slice(-keep) }));
        emitHistoryUpdated();
        return;
      } catch {
        continue;
      }
    }
    console.error(e);
  }
}

export function deleteSession(index) {
  if (!isBrowser()) return { sessions: [] };
  try {
    const h = loadHist();
    const target = h.sessions[index];
    const mockSessionId =
      target?.type === "mock" && typeof target?.details?.mockSessionId === "string"
        ? target.details.mockSessionId.trim()
        : "";
    if (mockSessionId) {
      h.sessions = h.sessions.filter(
        (s, i) => i !== index && !(s?.type === "mock" && s?.details?.mockSessionId === mockSessionId)
      );
    } else {
      h.sessions.splice(index, 1);
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
    emitHistoryUpdated();
    return h;
  } catch (e) {
    console.error(e);
    return loadHist();
  }
}

export function clearAllSessions() {
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

export function loadDoneIds(key) {
  if (!isBrowser()) return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}

export function addDoneIds(key, ids) {
  if (!isBrowser()) return;
  try {
    const done = loadDoneIds(key);
    ids.forEach((id) => done.add(id));
    localStorage.setItem(key, JSON.stringify([...done]));
  } catch (e) {
    console.error(e);
  }
}

export const SESSION_STORE_EVENTS = {
  HISTORY_UPDATED_EVENT,
};
