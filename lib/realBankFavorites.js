// 真题收藏夹：题目级（不是记录级）收藏，本地优先、按账号分 key 的 localStorage 存储
// （仿 lib/mistakes/pool.js 的 ::user:CODE / ::guest）。
//
// 一条收藏 = 一道真题（题型 + 当前题目 id）：同一道题练多少次都只占一条，收藏夹里点「去做这道题」
// 直接进 /real-bank?type=…&item=…，「看最近一次记录」回练习记录页逐题回顾。
// 造句 / 听力应答是一套一条记录：用这套的第一题 id 当代表，进真题专区时再按它找回所在的套。
// 收藏条目自带快照（题型 / 话题 / 来源分档 / 考试日期），记录删了收藏夹照样能显示、照样能去做。

import { getSavedCode } from "./AuthContext";

const BASE_KEY = "toefl-real-favorites-v1";
const AUTH_STORAGE_KEY = "toefl-user-code";
const MAX_FAVORITES = 500;
export const REAL_FAVORITES_UPDATED_EVENT = "toefl-real-favorites-updated";

const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";

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

function read() {
  if (!isBrowser()) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(scopedKey(accountKey())) || "null");
    return raw && typeof raw === "object" && raw.items && typeof raw.items === "object" ? raw.items : {};
  } catch {
    return {};
  }
}

function write(items) {
  if (!isBrowser()) return false;
  try {
    localStorage.setItem(scopedKey(accountKey()), JSON.stringify({ v: 1, items }));
  } catch {
    return false;
  }
  try {
    window.dispatchEvent(new Event(REAL_FAVORITES_UPDATED_EVENT));
  } catch { /* 老浏览器没有 Event 构造器也不影响已写入 */ }
  return true;
}

/** 当前账号的全部收藏，最近收藏的在前。 */
export function loadRealFavorites() {
  return Object.values(read())
    .filter((f) => f && realFavoriteKey(f.subtype, f.itemId) === f.key)
    .sort((a, b) => String(b.addedAt || "").localeCompare(String(a.addedAt || "")));
}

export function isRealFavorite(key) {
  return !!key && !!read()[key];
}

const str = (v, max = 160) => String(v ?? "").slice(0, max);

/** 收藏一道题；已收藏则只刷新快照（保留原收藏时间）。返回是否写入成功。 */
export function addRealFavorite(fav) {
  const key = realFavoriteKey(fav?.subtype, fav?.itemId);
  if (!key) return false;
  const items = read();
  const prev = items[key];
  items[key] = {
    key,
    subtype: str(fav.subtype, 40),
    itemId: str(fav.itemId, 200),
    subtitle: str(fav.subtitle),
    tier: str(fav.tier, 40),
    examDate: str(fav.examDate, 40),
    addedAt: prev?.addedAt || new Date().toISOString(),
  };
  // 超上限挤掉最早收藏的（正常用不到，只防 localStorage 配额被撑爆）。
  const keys = Object.keys(items);
  if (keys.length > MAX_FAVORITES) {
    keys
      .sort((a, b) => String(items[a].addedAt).localeCompare(String(items[b].addedAt)))
      .slice(0, keys.length - MAX_FAVORITES)
      .forEach((k) => { delete items[k]; });
  }
  return write(items);
}

export function removeRealFavorite(key) {
  const items = read();
  if (!items[key]) return false;
  delete items[key];
  return write(items);
}

/** 切换收藏；返回切换后的状态（true = 已收藏）。 */
export function toggleRealFavorite(fav) {
  const key = realFavoriteKey(fav?.subtype, fav?.itemId);
  if (!key) return false;
  if (read()[key]) {
    removeRealFavorite(key);
    return false;
  }
  return addRealFavorite(fav);
}

/** 订阅收藏变化（本页切换 / 别的标签页改动）；返回取消订阅函数。 */
export function subscribeRealFavorites(cb) {
  if (!isBrowser()) return () => {};
  const on = () => cb(loadRealFavorites());
  const onStorage = (e) => { if (!e.key || e.key.startsWith(BASE_KEY)) on(); };
  window.addEventListener(REAL_FAVORITES_UPDATED_EVENT, on);
  window.addEventListener("storage", onStorage);
  on();
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
