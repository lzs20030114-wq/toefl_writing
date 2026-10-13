// 原文批注的本地存档 + 云同步。和单词本同一个思路（lib/vocab/vocabStore.js）：
// localStorage 是真源（点了马上要看到），登录后 /api/notes 双向合并，按 id 取 updatedAt 新的一份，
// 删除是软删除（deletedAt），否则一台设备上删掉的笔记会被另一台的旧副本复活。

import { getSavedCode } from "../AuthContext";
import { mergeNotes, capNotes, passageKey } from "./passageNotes";

export const NOTE_STORE_PREFIX = "passage-notes-v1";
const SYNC_DELAY = 2500;
const PUSH_BATCH = 100;
const REQUEST_TIMEOUT_MS = 15000;

const listeners = new Set();
const syncState = new Map(); // account → { timer, running, pending, pulled }

export function noteAccount() {
  try {
    return String(getSavedCode() || "").trim().toUpperCase() || "guest";
  } catch {
    return "guest";
  }
}

const storeKey = (account) => `${NOTE_STORE_PREFIX}:${account || "guest"}`;

export function loadAllNotes(account = noteAccount()) {
  try {
    const raw = localStorage.getItem(storeKey(account));
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v?.notes) ? v.notes : [];
  } catch {
    return [];
  }
}

function writeAll(account, notes) {
  try {
    localStorage.setItem(storeKey(account), JSON.stringify({ notes: capNotes(notes) }));
  } catch {}
  for (const fn of listeners) {
    try { fn(account); } catch {}
  }
}

/** 某篇文章上的有效笔记。 */
export function notesForPassage(passage, account = noteAccount()) {
  const key = passageKey(passage);
  if (!key) return [];
  return loadAllNotes(account).filter((n) => n.passageKey === key && !n.deletedAt);
}

export function saveNote(note, account = noteAccount()) {
  const next = { ...note, updatedAt: new Date().toISOString() };
  const all = loadAllNotes(account).filter((n) => n.id !== next.id);
  all.push(next);
  writeAll(account, all);
  scheduleNoteSync(account);
  return next;
}

export function deleteNote(id, account = noteAccount()) {
  const all = loadAllNotes(account);
  const cur = all.find((n) => n.id === id);
  if (!cur) return;
  const now = new Date().toISOString();
  writeAll(account, all.map((n) => (n.id === id ? { ...n, deletedAt: now, updatedAt: now } : n)));
  scheduleNoteSync(account);
}

export function subscribeNotes(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

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
export async function syncNotesOnce(account = noteAccount()) {
  if (!account || account === "guest" || typeof fetch === "undefined") return false;
  const remote = await fetchJson(`/api/notes?code=${encodeURIComponent(account)}`);
  const remoteNotes = Array.isArray(remote.notes) ? remote.notes : [];
  // 合并时以「现在」的本地为准：拉取期间用户可能又存了一条。
  const merged = mergeNotes(loadAllNotes(account), remoteNotes);
  const remoteById = new Map(remoteNotes.map((n) => [n.id, n]));
  // 要推的：本地有、云端没有或比云端新的。
  const toPush = merged.filter((n) => {
    const r = remoteById.get(n.id);
    return !r || new Date(n.updatedAt).getTime() > new Date(r.updatedAt).getTime();
  });
  writeAll(account, mergeNotes(loadAllNotes(account), merged));
  for (let i = 0; i < toPush.length; i += PUSH_BATCH) {
    await fetchJson("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: account, notes: toPush.slice(i, i + PUSH_BATCH) }),
    });
  }
  return true;
}

export function scheduleNoteSync(account = noteAccount(), delay = SYNC_DELAY) {
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
      await syncNotesOnce(account);
      st.retries = 0;
    } catch {
      st.retries += 1;
      if (st.retries <= 5) st.pending = true;
    } finally {
      st.running = false;
      if (st.pending) {
        st.pending = false;
        scheduleNoteSync(account, st.retries ? Math.min(60000, 2000 * 2 ** (st.retries - 1)) : SYNC_DELAY);
      }
    }
  }, delay);
}

/** 打开带原文的记录页时拉一次（每个账号每次页面加载只拉一次）。 */
export function ensureNotesPulled(account = noteAccount()) {
  if (!account || account === "guest") return;
  const st = syncState.get(account) || { timer: null, running: false, pending: false, retries: 0 };
  syncState.set(account, st);
  if (st.pulled) return;
  st.pulled = true;
  scheduleNoteSync(account, 0);
}
