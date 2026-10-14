// 真题收藏夹：题目级（不是记录级）收藏，本地优先 + 云同步（仿 lib/notes/noteStore.js）。
//
// 一条收藏 = 一道真题（题型 + 当前题目 id）：同一道题练多少次都只占一条，收藏夹里点「去做这道题」
// 直接进 /real-bank?type=…&item=…，「看最近一次记录」回练习记录页逐题回顾。
// 造句 / 听力应答是一套一条记录：用这套的第一题 id 当代表，进真题专区时再按它找回所在的套。
// 收藏条目自带快照（题型 / 话题 / 来源分档 / 考试日期），记录删了收藏夹照样能显示、照样能去做。
//
// 存储：localStorage 按账号分 key 是真源（点了星马上要变色，不能等网络）；登录后与 /api/real-favorites
// （表 real_bank_favorites，scripts/sql/real-bank-favorites.sql）双向合并，按 key 取 updatedAt 新的一份。
// 取消收藏是软删除（deletedAt），否则一台设备上取消的收藏会被另一台的旧副本复活。

import { getSavedCode } from "./AuthContext";

const BASE_KEY = "toefl-real-favorites-v1";
const AUTH_STORAGE_KEY = "toefl-user-code";
export const REAL_FAVORITES_MAX = 500;
export const REAL_FAVORITES_UPDATED_EVENT = "toefl-real-favorites-updated";
const SYNC_DELAY = 2500;
const PUSH_BATCH = 100;
const REQUEST_TIMEOUT_MS = 15000;

const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";
const syncState = new Map(); // account → { timer, running, pending, retries, pulled }

function accountKey() {
  if (!isBrowser()) return "guest";
  try {
    const code = String(getSavedCode() || localStorage.getItem(AUTH_STORAGE_KEY) || "").trim().toUpperCase();
    return code || "guest";
  } catch {
    return "guest";
  }
}

function scopedKey(account) {
  return `${BASE_KEY}::${account === "guest" ? "guest" : `user:${account}`}`;
}

/** 收藏的身份：题型 + 题目 id。缺任何一个都不能收藏（整卷模考记录本身没有单一题目）。 */
export function realFavoriteKey(subtype, itemId) {
  const t = String(subtype || "").trim();
  const id = String(itemId || "").trim();
  return t && id ? `${t}:${id}` : "";
}

const favTime = (v) => {
  const t = new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};
const stamp = (f) => favTime(f?.updatedAt || f?.addedAt);
const valid = (f) => !!f && typeof f === "object" && realFavoriteKey(f.subtype, f.itemId) === f.key;

/** 两份收藏表按 key 合并：updatedAt 新的赢（软删除也参与比较）。 */
export function mergeRealFavorites(a, b) {
  const out = {};
  for (const f of [...Object.values(a || {}), ...Object.values(b || {})]) {
    if (!valid(f)) continue;
    const cur = out[f.key];
    if (!cur || stamp(f) > stamp(cur)) out[f.key] = f;
  }
  return out;
}

// 有效收藏与软删除墓碑各保留最近的 REAL_FAVORITES_MAX 条（只防 localStorage 配额被撑爆）。
function cap(items) {
  const all = Object.values(items).sort((x, y) => stamp(y) - stamp(x));
  const live = all.filter((f) => !f.deletedAt).slice(0, REAL_FAVORITES_MAX);
  const dead = all.filter((f) => f.deletedAt).slice(0, REAL_FAVORITES_MAX);
  return Object.fromEntries([...live, ...dead].map((f) => [f.key, f]));
}

function read(account = accountKey()) {
  if (!isBrowser()) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(scopedKey(account)) || "null");
    return raw && typeof raw === "object" && raw.items && typeof raw.items === "object" ? raw.items : {};
  } catch {
    return {};
  }
}

function write(items, account = accountKey()) {
  if (!isBrowser()) return false;
  try {
    localStorage.setItem(scopedKey(account), JSON.stringify({ v: 1, items: cap(items) }));
  } catch {
    return false;
  }
  try {
    window.dispatchEvent(new Event(REAL_FAVORITES_UPDATED_EVENT));
  } catch { /* 老浏览器没有 Event 构造器也不影响已写入 */ }
  return true;
}

/** 当前账号的全部收藏（不含已取消的），最近收藏的在前。 */
export function loadRealFavorites() {
  return Object.values(read())
    .filter((f) => valid(f) && !f.deletedAt)
    .sort((a, b) => String(b.addedAt || "").localeCompare(String(a.addedAt || "")));
}

export function isRealFavorite(key) {
  const f = key ? read()[key] : null;
  return !!f && !f.deletedAt;
}

const str = (v, max = 160) => String(v ?? "").slice(0, max);

/** 收藏一道题；已收藏则只刷新快照（保留原收藏时间）。返回是否写入成功。 */
export function addRealFavorite(fav) {
  const key = realFavoriteKey(fav?.subtype, fav?.itemId);
  if (!key) return false;
  const account = accountKey();
  const items = read(account);
  const prev = items[key] && !items[key].deletedAt ? items[key] : null;
  const now = new Date().toISOString();
  items[key] = {
    key,
    subtype: str(fav.subtype, 40),
    itemId: str(fav.itemId, 200),
    subtitle: str(fav.subtitle),
    tier: str(fav.tier, 40),
    examDate: str(fav.examDate, 40),
    addedAt: prev?.addedAt || now,
    updatedAt: now,
  };
  const ok = write(items, account);
  if (ok) scheduleRealFavoritesSync(account);
  return ok;
}

export function removeRealFavorite(key) {
  const account = accountKey();
  const items = read(account);
  if (!items[key] || items[key].deletedAt) return false;
  const now = new Date().toISOString();
  items[key] = { ...items[key], deletedAt: now, updatedAt: now };
  const ok = write(items, account);
  if (ok) scheduleRealFavoritesSync(account);
  return ok;
}

/** 切换收藏；返回切换后的状态（true = 已收藏）。 */
export function toggleRealFavorite(fav) {
  const key = realFavoriteKey(fav?.subtype, fav?.itemId);
  if (!key) return false;
  if (isRealFavorite(key)) {
    removeRealFavorite(key);
    return false;
  }
  return addRealFavorite(fav);
}

/** 订阅收藏变化（本页切换 / 别的标签页改动 / 云端拉回）；返回取消订阅函数。顺带触发一次云端拉取。 */
export function subscribeRealFavorites(cb) {
  if (!isBrowser()) return () => {};
  const on = () => cb(loadRealFavorites());
  const onStorage = (e) => { if (!e.key || e.key.startsWith(BASE_KEY)) on(); };
  window.addEventListener(REAL_FAVORITES_UPDATED_EVENT, on);
  window.addEventListener("storage", onStorage);
  on();
  ensureRealFavoritesPulled();
  return () => {
    window.removeEventListener(REAL_FAVORITES_UPDATED_EVENT, on);
    window.removeEventListener("storage", onStorage);
  };
}

/** 收藏夹「去做这道题」：真题专区同题型，带 item 让选题页直接打开这道（造句 / 听力应答打开所在的那一套）。 */
export function realFavoriteHref(fav) {
  const qs = new URLSearchParams();
  qs.set("type", fav.subtype);
  qs.set("item", fav.itemId);
  return `/real-bank?${qs.toString()}`;
}

/* ── 云同步 ─────────────────────────────────────────────────────── */

async function fetchJson(url, init) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    const r = await fetch(url, { ...init, signal: ctrl?.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 拉云端 → 合并进本地 → 把本地改过的推上去。游客不同步。 */
export async function syncRealFavoritesOnce(account = accountKey()) {
  if (!account || account === "guest" || typeof fetch === "undefined") return false;
  const remote = await fetchJson(`/api/real-favorites?code=${encodeURIComponent(account)}`);
  const remoteList = (Array.isArray(remote.favorites) ? remote.favorites : []).filter(valid);
  const remoteByKey = Object.fromEntries(remoteList.map((f) => [f.key, f]));
  // 合并时以「现在」的本地为准：拉取期间用户可能又点了星。
  const merged = mergeRealFavorites(read(account), remoteByKey);
  const toPush = Object.values(merged).filter((f) => !remoteByKey[f.key] || stamp(f) > stamp(remoteByKey[f.key]));
  const local = read(account);
  const next = mergeRealFavorites(local, merged);
  if (JSON.stringify(next) !== JSON.stringify(local)) write(next, account);
  for (let i = 0; i < toPush.length; i += PUSH_BATCH) {
    await fetchJson("/api/real-favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: account, favorites: toPush.slice(i, i + PUSH_BATCH) }),
    });
  }
  return true;
}

export function scheduleRealFavoritesSync(account = accountKey(), delay = SYNC_DELAY) {
  if (!account || account === "guest" || typeof window === "undefined") return;
  const st = syncState.get(account) || { timer: null, running: false, pending: false, retries: 0 };
  syncState.set(account, st);
  if (st.running) {
    st.pending = true;
    return;
  }
  clearTimeout(st.timer);
  st.timer = setTimeout(async () => {
    st.running = true;
    try {
      await syncRealFavoritesOnce(account);
      st.retries = 0;
    } catch {
      st.retries += 1;
      if (st.retries <= 5) st.pending = true;
    } finally {
      st.running = false;
      if (st.pending) {
        st.pending = false;
        scheduleRealFavoritesSync(account, st.retries ? Math.min(60000, 2000 * 2 ** (st.retries - 1)) : SYNC_DELAY);
      }
    }
  }, delay);
}

/** 打开练习记录页时拉一次（每个账号每次页面加载只拉一次）。 */
export function ensureRealFavoritesPulled(account = accountKey()) {
  if (!account || account === "guest") return;
  const st = syncState.get(account) || { timer: null, running: false, pending: false, retries: 0 };
  syncState.set(account, st);
  if (st.pulled) return;
  st.pulled = true;
  scheduleRealFavoritesSync(account, 0);
}
