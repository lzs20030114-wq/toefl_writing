import { getSavedCode } from "../AuthContext";
import { loadDoneIds, setCurrentUser } from "../sessionStore";
import { DONE_STORAGE_KEYS } from "../questionSelector";

export class RealMockError extends Error {
  constructor(message, { code = "REAL_MOCK_ERROR", deficits = [], activeAttemptId = null } = {}) {
    super(message);
    this.name = "RealMockError";
    this.code = code;
    this.deficits = deficits;
    this.activeAttemptId = activeAttemptId;
  }
}

function userCode() {
  const code = String(getSavedCode() || "").trim().toUpperCase();
  if (!code) throw new RealMockError("请先登录后再开始真题模考。", { code: "LOGIN_REQUIRED" });
  return code;
}

export function collectLocalRealMockDoneIds() {
  const ids = new Set();
  for (const key of Object.values(DONE_STORAGE_KEYS)) {
    if (localStorage.getItem(`${key}::user:${userCode()}`) == null) continue;
    for (const id of loadDoneIds(key)) if (typeof id === "string") ids.add(id);
  }
  try {
    const history = JSON.parse(localStorage.getItem("toefl-hist") || "{}");
    for (const session of history.sessions || []) {
      // Legacy local history has no owner marker. Do not import another account's records.
      const owner = String(session?.userCode || session?.user_code || "").toUpperCase();
      if (!owner || owner !== userCode()) continue;
      const d = session.details;
      if (Array.isArray(d)) d.forEach((item) => item?.qid && ids.add(item.qid));
      else if (d && typeof d === "object") {
        if (d.realMock) { for (const id of d.seenItemIds || []) if (id) ids.add(id); continue; }
        for (const id of [d.itemId, d.setId, d.promptId, d.promptData?.id, ...(d.itemIds || [])]) if (id) ids.add(id);
        for (const item of d.items || []) if (item?.id || item?.itemId) ids.add(item.id || item.itemId);
      }
    }
  } catch { /* malformed local cache cannot authorize reusing cloud-seen items */ }
  return [...ids];
}

async function call(body) {
  let response;
  try {
    response = await fetch("/api/real-mock-exam", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userCode: userCode(), ...body }),
    });
  } catch {
    throw new RealMockError("无法连接真题模考服务，请稍后重试。", { code: "NETWORK_ERROR" });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new RealMockError(data.error || "真题模考请求失败", { code: data.code, deficits: data.deficits, activeAttemptId: data.activeAttemptId });
  return data;
}

export async function prepareRealMockExam(section, { restartAttemptId } = {}) {
  setCurrentUser(userCode());
  // A finished paper whose server-side finish never landed still blocks a new
  // paper of the same section (ACTIVE_ATTEMPT) for up to the 2-hour lease.
  await flushPendingFinishes();
  const data = await call({ action: "prepare", section, doneIds: collectLocalRealMockDoneIds(), ...(restartAttemptId && { restartAttemptId }) });
  return data.paper;
}

export async function markRealMockSeen(paper, items, { answered = false } = {}) {
  const refs = (Array.isArray(items) ? items : [items]).map((item) => ({ id: item?.id, taskType: item?.taskType }));
  return call({ action: "seen", attemptId: paper?.attemptId, items: refs, answered: !!answered });
}

export async function routeRealMockExam(paper, path) {
  return call({ action: "route", attemptId: paper?.attemptId, path });
}

export async function finishRealMockExam(paper) {
  return call({ action: "finish", attemptId: paper?.attemptId });
}

// ── Finish after the record is saved ──
// `finish` only releases the paper's still-unseen reservations; the 2-hour lease
// would release them anyway. So a completed exam must never wait on it: shells
// save the record first, then call finishRealMockExamReliably(). An attempt whose
// finish never lands is remembered here and finished before the next prepare.

const PENDING_FINISH_KEY = "toefl-real-mock-pending-finish";
const PENDING_FINISH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// The server can never finish these (wrong id / wrong account): stop retrying.
const UNFINISHABLE_CODES = new Set(["ATTEMPT_NOT_FOUND", "INVALID_ATTEMPT", "INVALID_USER"]);

function readPendingFinishes() {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_FINISH_KEY) || "[]");
    return Array.isArray(list) ? list.filter((x) => x && typeof x.attemptId === "string") : [];
  } catch {
    return [];
  }
}

function writePendingFinishes(list) {
  try {
    if (list.length) localStorage.setItem(PENDING_FINISH_KEY, JSON.stringify(list.slice(-20)));
    else localStorage.removeItem(PENDING_FINISH_KEY);
  } catch { /* storage unavailable: the lease still expires on its own */ }
}

function forgetPendingFinish(attemptId) {
  writePendingFinishes(readPendingFinishes().filter((x) => x.attemptId !== attemptId));
}

export function rememberPendingFinish(paper) {
  const attemptId = String(paper?.attemptId || "");
  if (!attemptId) return;
  const owner = String(paper?.userCode || getSavedCode() || "").trim().toUpperCase();
  const list = readPendingFinishes().filter((x) => x.attemptId !== attemptId);
  list.push({ attemptId, userCode: owner, section: String(paper?.section || ""), savedAt: Date.now() });
  writePendingFinishes(list);
}

/** Best effort: finish every remembered attempt of the signed-in account. Never throws. */
export async function flushPendingFinishes() {
  let code;
  try { code = userCode(); } catch { return; }
  for (const entry of readPendingFinishes().filter((x) => x.userCode === code)) {
    try {
      await call({ action: "finish", attemptId: entry.attemptId });
      forgetPendingFinish(entry.attemptId);
    } catch (error) {
      if (UNFINISHABLE_CODES.has(error?.code) || Date.now() - (Number(entry.savedAt) || 0) > PENDING_FINISH_MAX_AGE_MS) {
        forgetPendingFinish(entry.attemptId);
      }
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Finish a paper whose record is already saved. Remembered as pending first, so a
 * tab closed mid-retry is still finished before the next prepare. Never throws;
 * resolves true once the server confirmed.
 */
export async function finishRealMockExamReliably(paper, { delays = [0, 1500, 4000] } = {}) {
  if (!paper?.attemptId) return false;
  rememberPendingFinish(paper);
  for (const delay of delays) {
    if (delay) await sleep(delay);
    try {
      await finishRealMockExam(paper);
      forgetPendingFinish(paper.attemptId);
      return true;
    } catch (error) {
      if (UNFINISHABLE_CODES.has(error?.code)) {
        forgetPendingFinish(paper.attemptId);
        return false;
      }
    }
  }
  return false;
}
