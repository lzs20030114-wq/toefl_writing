/**
 * Referral lifecycle state machine — single source of truth on the client.
 *
 * Lifecycle:
 *   idle ─ captureRef(code, source) ──→  captured
 *   captured ─ bindStarted() ────────→  binding
 *   binding ─ bindSucceeded({...}) ──→  bound
 *   binding ─ bindRejected(reason) ──→  rejected
 *   bound ─ practiceCompleted() ─────→  activating
 *   activating ─ granted({days,...}) →  granted
 *   * ─ reset() ─────────────────────→  idle
 *
 * All UI components (toast, modal badge, banner, sidebar) subscribe via
 * useReferralFlow(). The store also dispatches DOM CustomEvents on the
 * window so non-React code (sessionStore.js, ClientBootstrap) can wire in.
 */

const STORAGE_KEY = "toefl-ref";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const REFERRAL_STATES = Object.freeze({
  IDLE: "idle",
  CAPTURED: "captured",
  BINDING: "binding",
  BOUND: "bound",
  REJECTED: "rejected",
  ACTIVATING: "activating",
  GRANTED: "granted",
});

export const REFERRAL_EVENT = "toefl-referral-state";

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function nowMs() {
  return Date.now();
}

// ─────────────────────────────────────────────────────────
// Internal state — module-level singleton. SSR-safe (browser-only writes).
// ─────────────────────────────────────────────────────────
const state = {
  status: REFERRAL_STATES.IDLE,
  inviterCode: null,
  source: null,            // 'link' | 'manual' | null
  capturedAt: null,
  bindStatus: null,        // null | 'pending' | 'rejected'
  bindReason: null,        // rejection reason string when applicable
  grantedDays: 0,          // days awarded (cumulative)
  grantedAt: null,
};

const listeners = new Set();

function snapshot() {
  return { ...state };
}

function persist() {
  if (!isBrowser()) return;
  if (state.status === REFERRAL_STATES.IDLE) return;
  try {
    const payload = {
      code: state.inviterCode,
      source: state.source,
      capturedAt: state.capturedAt,
      status: state.status,
      bindStatus: state.bindStatus,
      bindReason: state.bindReason,
      grantedDays: state.grantedDays,
      grantedAt: state.grantedAt,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* no-op */
  }
}

function hydrateFromStorage() {
  if (!isBrowser()) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data?.code) return;
    const age = nowMs() - (Number(data.capturedAt) || 0);
    if (age > TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    state.inviterCode = normalizeCode(data.code);
    state.source = data.source || "link";
    state.capturedAt = Number(data.capturedAt) || nowMs();
    state.status = data.status || REFERRAL_STATES.CAPTURED;
    state.bindStatus = data.bindStatus || null;
    state.bindReason = data.bindReason || null;
    state.grantedDays = Number(data.grantedDays) || 0;
    state.grantedAt = data.grantedAt || null;
  } catch {
    /* no-op */
  }
}

function emit() {
  const snap = snapshot();
  listeners.forEach((fn) => {
    try { fn(snap); } catch { /* swallow */ }
  });
  if (isBrowser()) {
    try {
      window.dispatchEvent(new CustomEvent(REFERRAL_EVENT, { detail: snap }));
    } catch { /* no-op */ }
  }
}

let hydrated = false;

function ensureHydrated() {
  if (hydrated) return;
  hydrated = true;
  hydrateFromStorage();
}

// ─────────────────────────────────────────────────────────
// Public API — read
// ─────────────────────────────────────────────────────────
export function getReferralState() {
  ensureHydrated();
  return snapshot();
}

export function subscribeReferralState(fn) {
  if (typeof fn !== "function") return () => {};
  ensureHydrated();
  listeners.add(fn);
  // Push current state immediately so subscribers don't miss the initial value
  try { fn(snapshot()); } catch { /* swallow */ }
  return () => { listeners.delete(fn); };
}

// ─────────────────────────────────────────────────────────
// Public API — write (dispatched from various code paths)
// ─────────────────────────────────────────────────────────

/** Called by ClientBootstrap when ?ref= is detected in the URL. */
export function captureRef({ code, source = "link" }) {
  ensureHydrated();
  const normalized = normalizeCode(code);
  if (normalized.length !== 6) return false;
  // First inviter wins — don't overwrite an existing capture
  if (state.inviterCode && state.inviterCode !== normalized) return false;
  if (state.status === REFERRAL_STATES.GRANTED) return false;

  state.inviterCode = normalized;
  state.source = source;
  state.capturedAt = nowMs();
  if (state.status === REFERRAL_STATES.IDLE) {
    state.status = REFERRAL_STATES.CAPTURED;
  }
  persist();
  emit();
  return true;
}

/** Called by LoginGate just before POSTing /api/referral/bind. */
export function markBindStarted() {
  if (!state.inviterCode) return;
  state.status = REFERRAL_STATES.BINDING;
  state.bindStatus = "pending";
  state.bindReason = null;
  persist();
  emit();
}

/** Called by LoginGate when bind API returns ok+pending. */
export function markBindSucceeded() {
  state.status = REFERRAL_STATES.BOUND;
  state.bindStatus = "pending";
  state.bindReason = null;
  persist();
  emit();
}

/** Called by LoginGate when bind API returns ok=false or a non-pending status. */
export function markBindRejected(reason) {
  state.status = REFERRAL_STATES.REJECTED;
  state.bindStatus = "rejected";
  state.bindReason = String(reason || "unknown");
  persist();
  emit();
}

/** Called by sessionStore when activate API is about to fire. */
export function markActivating() {
  if (state.status === REFERRAL_STATES.GRANTED) return;
  state.status = REFERRAL_STATES.ACTIVATING;
  persist();
  emit();
}

/** Called by sessionStore when activate API returns granted=true. */
export function markGranted({ daysAdded = 0 } = {}) {
  state.status = REFERRAL_STATES.GRANTED;
  state.grantedDays = (state.grantedDays || 0) + (Number(daysAdded) || 0);
  state.grantedAt = nowMs();
  persist();
  emit();
}

/** Clear all referral state — used on logout or manual reset. */
export function resetReferralState() {
  state.status = REFERRAL_STATES.IDLE;
  state.inviterCode = null;
  state.source = null;
  state.capturedAt = null;
  state.bindStatus = null;
  state.bindReason = null;
  state.grantedDays = 0;
  state.grantedAt = null;
  if (isBrowser()) {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* no-op */ }
  }
  emit();
}

// ─────────────────────────────────────────────────────────
// Test hooks (do NOT use in production code)
// ─────────────────────────────────────────────────────────
export const __test__ = {
  reset() {
    state.status = REFERRAL_STATES.IDLE;
    state.inviterCode = null;
    state.source = null;
    state.capturedAt = null;
    state.bindStatus = null;
    state.bindReason = null;
    state.grantedDays = 0;
    state.grantedAt = null;
    hydrated = false;
    listeners.clear();
  },
  _internalSnapshot: snapshot,
};
