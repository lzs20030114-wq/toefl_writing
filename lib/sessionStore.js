const HISTORY_KEY = "toefl-hist";
const MAX_HISTORY = 50;

export function loadHist() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{"sessions":[]}');
    if (!parsed || !Array.isArray(parsed.sessions)) return { sessions: [] };
    return parsed;
  } catch {
    return { sessions: [] };
  }
}

export function saveSess(s) {
  const h = loadHist();
  h.sessions.push({ attempts: 1, ...s, date: new Date().toISOString() });
  if (h.sessions.length > MAX_HISTORY) h.sessions = h.sessions.slice(-MAX_HISTORY);

  // Guard against quota errors by trimming oldest entries incrementally.
  const next = [...h.sessions];
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ ...h, sessions: next }));
  } catch (e) {
    for (let keep = next.length - 5; keep > 0; keep -= 5) {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify({ ...h, sessions: next.slice(-keep) }));
        return;
      } catch {
        continue;
      }
    }
    console.error(e);
  }
}

export function deleteSession(index) {
  try {
    const h = loadHist();
    h.sessions.splice(index, 1);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
    return h;
  } catch (e) {
    console.error(e);
    return loadHist();
  }
}

export function clearAllSessions() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ sessions: [] }));
    return { sessions: [] };
  } catch (e) {
    console.error(e);
    return { sessions: [] };
  }
}

export function loadDoneIds(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}

export function addDoneIds(key, ids) {
  try {
    const done = loadDoneIds(key);
    ids.forEach((id) => done.add(id));
    localStorage.setItem(key, JSON.stringify([...done]));
  } catch (e) {
    console.error(e);
  }
}
