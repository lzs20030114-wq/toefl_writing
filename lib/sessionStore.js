export function loadHist() {
  try {
    return JSON.parse(localStorage.getItem("toefl-hist") || '{"sessions":[]}');
  } catch {
    return { sessions: [] };
  }
}

export function saveSess(s) {
  try {
    const h = loadHist();
    h.sessions.push({ attempts: 1, ...s, date: new Date().toISOString() });
    if (h.sessions.length > 50) h.sessions = h.sessions.slice(-50);
    localStorage.setItem("toefl-hist", JSON.stringify(h));
  } catch (e) {
    console.error(e);
  }
}

export function deleteSession(index) {
  try {
    const h = loadHist();
    h.sessions.splice(index, 1);
    localStorage.setItem("toefl-hist", JSON.stringify(h));
    return h;
  } catch (e) {
    console.error(e);
    return loadHist();
  }
}

export function clearAllSessions() {
  try {
    localStorage.setItem("toefl-hist", JSON.stringify({ sessions: [] }));
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
