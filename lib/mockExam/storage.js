const MOCK_EXAM_HISTORY_KEY = "toefl-mock-exam-history";
const MOCK_EXAM_CHECKPOINT_KEY = "toefl-mock-exam-checkpoint";
const MAX_MOCK_EXAMS = 30;
const CHECKPOINT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function loadMockExamHistory() {
  if (!isBrowser()) return { sessions: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(MOCK_EXAM_HISTORY_KEY) || '{"sessions":[]}');
    if (!parsed || !Array.isArray(parsed.sessions)) return { sessions: [] };
    return parsed;
  } catch {
    return { sessions: [] };
  }
}

// ── In-progress checkpoint (survives page refresh) ──

export function saveMockCheckpoint(session, scoringPhase) {
  if (!isBrowser() || !session) return;
  try {
    localStorage.setItem(MOCK_EXAM_CHECKPOINT_KEY, JSON.stringify({
      session,
      scoringPhase,
      savedAt: Date.now(),
    }));
  } catch {
    // quota or permission error — non-fatal
  }
}

export function loadMockCheckpoint() {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(MOCK_EXAM_CHECKPOINT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.session || Date.now() - (data.savedAt || 0) > CHECKPOINT_TTL_MS) {
      clearMockCheckpoint();
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearMockCheckpoint() {
  if (!isBrowser()) return;
  try { localStorage.removeItem(MOCK_EXAM_CHECKPOINT_KEY); } catch {}
}

// ── Session history ──

export function saveMockExamSession(session) {
  if (!isBrowser() || !session) return;
  const history = loadMockExamHistory();
  const idx = history.sessions.findIndex((x) => x?.id === session.id);
  const sessions = [...history.sessions];
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.push(session);
  }
  const next = sessions.slice(-MAX_MOCK_EXAMS);
  try {
    localStorage.setItem(MOCK_EXAM_HISTORY_KEY, JSON.stringify({ sessions: next }));
  } catch (e) {
    // Guard against quota/permission errors by trimming oldest sessions.
    const keeps = [];
    for (let keep = next.length - 5; keep > 0; keep -= 5) keeps.push(keep);
    if (next.length > 0 && !keeps.includes(1)) keeps.push(1);
    for (const keep of keeps) {
      try {
        localStorage.setItem(MOCK_EXAM_HISTORY_KEY, JSON.stringify({ sessions: next.slice(-keep) }));
        return;
      } catch {
        continue;
      }
    }
    console.error(e);
  }
}
