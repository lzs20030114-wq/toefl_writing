const MOCK_EXAM_HISTORY_KEY = "toefl-mock-exam-history";
const MAX_MOCK_EXAMS = 30;

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
  localStorage.setItem(MOCK_EXAM_HISTORY_KEY, JSON.stringify({ sessions: next }));
}
