"use client";
import { useEffect, useRef } from "react";

/**
 * Draft persistence helper for in-progress task state.
 *
 * Many task components (Build a Sentence, CTW, RDL, Listening MCQ, LCR…)
 * keep the user's current answers/selections in plain React useState. That
 * state is lost on reload. This hook autosaves the value to localStorage
 * under a stable key and clears it when the task is submitted.
 *
 * Usage:
 *   const [answers, setAnswers] = useState(() => loadDraft(key) ?? defaultValue);
 *   useDraftPersist(key, answers, { enabled: !submitted });
 *   // on successful submit: clearDraft(key)
 *
 * The key naming convention is `tp-draft:<task>:<scope-id>` — e.g.
 *   `tp-draft:ctw:rdl-12`
 *   `tp-draft:rdl:passage-9`
 *   `tp-draft:listening-mcq:lat-3`
 *   `tp-draft:bs:set-1762345678`
 *
 * The shape of the stored value is up to the caller; we just JSON-encode it.
 */

const STORAGE_PREFIX = "tp-draft:";
const DEBOUNCE_MS = 500;

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function buildDraftKey(task, scopeId) {
  if (!task || scopeId == null || scopeId === "") return "";
  return `${STORAGE_PREFIX}${task}:${scopeId}`;
}

export function loadDraft(key) {
  if (!isBrowser() || !key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveDraft(key, value) {
  if (!isBrowser() || !key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota or serialize error — autosave is best-effort
  }
}

export function clearDraft(key) {
  if (!isBrowser() || !key) return;
  try {
    localStorage.removeItem(key);
  } catch {}
}

/**
 * List all stored drafts whose key starts with `tp-draft:<task>:`.
 * Each entry is `{ scopeId, value }` where scopeId is everything after
 * the second colon (typically the item id or batch hash). Filters out
 * drafts that contain no actual user input via `hasContent`.
 */
export function listActiveDrafts(task) {
  if (!isBrowser() || !task) return [];
  const prefix = `${STORAGE_PREFIX}${task}:`;
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const value = loadDraft(k);
      if (value == null) continue;
      if (!draftHasContent(value)) continue;
      out.push({ key: k, scopeId: k.slice(prefix.length), value });
    }
  } catch {
    // ignore
  }
  return out;
}

/** Heuristic for "the user actually typed/selected something" across the
 *  shapes our task drafts use. Returns false for empty arrays / all-null
 *  selections / blank strings. */
export function draftHasContent(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) {
    return value.some((v) => v != null && (typeof v !== "string" || v.length > 0));
  }
  if (typeof value === "object") {
    if (Array.isArray(value.selections) && value.selections.some((s) => s != null)) return true;
    if (Array.isArray(value.answers) && value.answers.length > 0) return true;
    if (typeof value.text === "string" && value.text.length > 0) return true;
    if (Number.isInteger(value.currentQ) && value.currentQ > 0) return true;
    if (Number.isInteger(value.qIndex) && value.qIndex > 0) return true;
  }
  return false;
}

/**
 * Debounced autosave of `value` to localStorage under `key`. Disable via
 * `enabled: false` (e.g. once the task is submitted).
 *
 * Note: the loading / clearing sites are explicit in the caller — this hook
 * only handles the write side, to keep the existing useState init paths
 * obvious.
 */
export function useDraftPersist(key, value, { enabled = true, debounceMs = DEBOUNCE_MS } = {}) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!key || !enabled) return undefined;
    const t = setTimeout(() => {
      if (!enabledRef.current) return;
      saveDraft(key, value);
    }, debounceMs);
    return () => clearTimeout(t);
  }, [key, value, enabled, debounceMs]);
}
