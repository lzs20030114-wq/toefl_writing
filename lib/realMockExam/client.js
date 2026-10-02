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
