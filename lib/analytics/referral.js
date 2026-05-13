"use client";

/**
 * Client-side helpers for tracking the referral funnel.
 *
 * Funnel events (chronological):
 *   link_visit         — user opened a /?ref=ABC123 URL
 *   modal_open         — login modal opened (used to derive intent)
 *   bind_attempt       — POST /api/referral/bind fired
 *   bind_success       — bind returned ok+pending
 *   bind_rejected      — bind returned ok=false or ip_flood/self_ref/etc.
 *   first_practice     — invitee completed first practice, triggering activate
 *   grant_success      — inviter's tier extended by 3 days
 *   share_link_copied  — inviter clicked "复制链接" in MyReferralPanel
 *   share_text_copied  — inviter clicked "复制文案"
 *
 * Events are fire-and-forget POST to /api/analytics/referral. Failures are
 * silently swallowed — we never want a tracking error to break user flow.
 */

const ENDPOINT = "/api/analytics/referral";

const VALID_EVENTS = new Set([
  "link_visit",
  "modal_open",
  "bind_attempt",
  "bind_success",
  "bind_rejected",
  "first_practice",
  "grant_success",
  "share_link_copied",
  "share_text_copied",
]);

function isBrowser() {
  return typeof window !== "undefined" && typeof fetch !== "undefined";
}

/**
 * Fire a referral analytics event. Fire-and-forget; safe to await or ignore.
 *
 * @param {string} event   One of VALID_EVENTS
 * @param {object} [opts]
 * @param {string} [opts.inviterCode]  6-char inviter code (when known)
 * @param {string} [opts.inviteeCode]  6-char invitee code (when known)
 * @param {string} [opts.source]       'link' | 'manual' (for bind events)
 * @param {string} [opts.reason]       rejection reason (for bind_rejected)
 * @param {object} [opts.metadata]     small JSON-serializable extras
 */
export function trackReferralEvent(event, opts = {}) {
  if (!isBrowser()) return;
  if (!VALID_EVENTS.has(event)) return;
  try {
    const body = JSON.stringify({
      event,
      inviterCode: opts.inviterCode || null,
      inviteeCode: opts.inviteeCode || null,
      source: opts.source || null,
      reason: opts.reason || null,
      metadata: opts.metadata && typeof opts.metadata === "object" ? opts.metadata : null,
    });
    // Use keepalive so the request survives page unload (e.g. on navigation
    // immediately after binding succeeds).
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => { /* swallow */ });
  } catch {
    /* swallow */
  }
}
