"use client";
import { useEffect } from "react";
import { installSmoothScrollPolyfill } from "../lib/smoothScrollPolyfill";
import { restoreUserCodeFromCookie } from "../lib/AuthContext";
import { captureRefFromUrl } from "../lib/referralCapture";
import { getReferralState } from "../lib/referral/state";
import { trackReferralEvent } from "../lib/analytics/referral";

/**
 * Mounts in the root layout to run one-time client-side bootstrap:
 *  - installs the smoothScroll polyfill on Safari < 15.3 (no-op on modern browsers)
 *  - restores the user code from cookie if localStorage was purged (iOS Safari
 *    sometimes drops localStorage under memory pressure but keeps cookies)
 *  - captures ?ref=XXXXXX from URL into localStorage for referral binding at signup
 *  - fires a `link_visit` funnel event when a fresh capture happens, so the
 *    admin dashboard can compute link-click → bind conversion
 *
 * Renders nothing.
 */
export default function ClientBootstrap() {
  useEffect(() => {
    installSmoothScrollPolyfill();
    restoreUserCodeFromCookie();
    // Snapshot before/after so we can detect a fresh capture from this load.
    const before = getReferralState();
    captureRefFromUrl();
    const after = getReferralState();
    if (after.inviterCode && after.inviterCode !== before.inviterCode) {
      trackReferralEvent("link_visit", {
        inviterCode: after.inviterCode,
        source: after.source || "link",
      });
    }
  }, []);
  return null;
}
