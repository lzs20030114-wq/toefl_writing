// Tracks the recent topic history per (task, user) scope so the picker can
// enforce two invariants on consecutive questions:
//
//   1. Next topic ≠ immediately preceding topic
//   2. Any 5 consecutive picks contain ≥ 3 distinct topics
//      (blocks the A-B-A-B-A ping-pong that rule #1 alone doesn't catch)
//
// State is persisted to localStorage so it survives reloads and tab switches.

const STORAGE_PREFIX = "toefl-recent-topics";
const AUTH_STORAGE_KEY = "toefl-user-code";
const WINDOW_SIZE = 4; // we evaluate the 5-window constraint when picking the 5th

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function getUserSuffix() {
  if (!isBrowser()) return "guest";
  try {
    const code = String(localStorage.getItem(AUTH_STORAGE_KEY) || "").trim().toUpperCase();
    return code || "guest";
  } catch {
    return "guest";
  }
}

function storageKey(scope) {
  return `${STORAGE_PREFIX}::${scope}::${getUserSuffix()}`;
}

/** Return the last WINDOW_SIZE topics for the scope, oldest-first. */
export function getRecentTopics(scope) {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/** Append a topic to the recent history, capped at WINDOW_SIZE (FIFO). */
export function pushRecentTopic(scope, topic) {
  if (!isBrowser()) return;
  const value = topic == null ? "" : String(topic);
  if (!value) return;
  try {
    const current = getRecentTopics(scope);
    const next = [...current, value].slice(-WINDOW_SIZE);
    localStorage.setItem(storageKey(scope), JSON.stringify(next));
  } catch {
    /* quota / private mode — fall through silently */
  }
}

/**
 * Topics the picker must avoid when choosing the next question.
 *
 * Always includes the immediately preceding topic (rule #1). When the recent
 * window is full and has ≤ 2 distinct topics, all of those are added too —
 * forcing the next pick to introduce a 3rd distinct topic so the 5-question
 * sliding window stays at ≥ 3 distinct (rule #2).
 */
export function getForbiddenTopics(scope) {
  const recent = getRecentTopics(scope);
  const forbidden = new Set();
  if (recent.length === 0) return forbidden;
  forbidden.add(recent[recent.length - 1]);
  if (recent.length >= WINDOW_SIZE) {
    const distinct = new Set(recent);
    if (distinct.size <= 2) {
      for (const t of distinct) forbidden.add(t);
    }
  }
  return forbidden;
}

/**
 * Pick an item respecting both diversity rules. Falls back gracefully:
 *   Tier 1: topic ∉ forbidden  (full constraint)
 *   Tier 2: topic ≠ last only  (when forbidden empties the pool)
 *   Tier 3: any item            (last resort)
 *
 * After picking, the chosen topic is pushed into the recent history.
 */
export function pickWithTopicDiversity(items, scope, topicKeyFn) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const forbidden = getForbiddenTopics(scope);
  let pool = items.filter((it) => !forbidden.has(topicKeyFn(it)));

  if (pool.length === 0) {
    const recent = getRecentTopics(scope);
    const lastTopic = recent[recent.length - 1] || null;
    pool = lastTopic
      ? items.filter((it) => topicKeyFn(it) !== lastTopic)
      : items;
  }
  if (pool.length === 0) pool = items;

  const picked = pool[Math.floor(Math.random() * pool.length)];
  pushRecentTopic(scope, topicKeyFn(picked) || "");
  return picked;
}
