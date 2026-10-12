// 练习答疑窗口的本地存档与每日计数。计划见 docs/rag-qa-implementation-plan.md §3。
//
// 存档里有用户自己打的字，必须按账号分键。体积要封顶：单词本、错题池、游客练习记录都把
// localStorage 当真源，答疑存档挤爆配额会让它们写不进去（lib/vocab/vocabStore 专门处理过配额失败）。
// 每一处读写都包 try/catch：隐私模式 / 配额满时答疑照常能问，只是不存。

export const QA_STORE_PREFIX = "reading-qa-v1";
export const QA_DAILY_PREFIX = "reading-qa-daily-v1";
export const QA_MAX_CONVERSATIONS = 100;
export const QA_MAX_STORE_CHARS = 100000;
// 每天最多追问 30 轮（2026-10-12 用户拍板）：Pro 的 /api/ai 每天共 100 次，和写作批改共用，
// 这条线是替用户保住写作批改的额度，不是安全措施。
export const QA_DAILY_LIMIT = 30;

const storeKey = (account) => `${QA_STORE_PREFIX}:${account || "guest"}`;
const dailyKey = (account) => `${QA_DAILY_PREFIX}:${account || "guest"}`;

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

/** 按 updatedAt 从最旧的开始淘汰，直到会话数和序列化长度都落在线内。纯函数。 */
export function pruneStore(store, { maxConversations = QA_MAX_CONVERSATIONS, maxChars = QA_MAX_STORE_CHARS } = {}) {
  const entries = Object.entries(store || {}).sort((a, b) => String(b[1]?.updatedAt || "").localeCompare(String(a[1]?.updatedAt || "")));
  let kept = entries.slice(0, maxConversations);
  while (kept.length > 1 && JSON.stringify(Object.fromEntries(kept)).length > maxChars) kept = kept.slice(0, -1);
  return Object.fromEntries(kept);
}

export function loadConversation(account, key) {
  const c = readJson(storeKey(account), {})[key];
  return c && Array.isArray(c.turns) ? c : null;
}

export function saveConversation(account, key, conversation) {
  try {
    const store = readJson(storeKey(account), {});
    store[key] = { ...conversation, updatedAt: new Date().toISOString() };
    localStorage.setItem(storeKey(account), JSON.stringify(pruneStore(store)));
  } catch {}
}

/** 本地日期（不是 UTC）：北京时间早上 7 点前问的不该算到前一天。 */
export function localDate(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function dailyCount(account, now = new Date()) {
  const v = readJson(dailyKey(account), null);
  return v && v.date === localDate(now) ? Number(v.n) || 0 : 0;
}

export function bumpDaily(account, now = new Date()) {
  const n = dailyCount(account, now) + 1;
  try {
    localStorage.setItem(dailyKey(account), JSON.stringify({ date: localDate(now), n }));
  } catch {}
  return n;
}
