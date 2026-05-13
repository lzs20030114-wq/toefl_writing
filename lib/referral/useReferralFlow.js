"use client";

import { useEffect, useState } from "react";
import {
  REFERRAL_STATES,
  getReferralState,
  subscribeReferralState,
} from "./state";

/**
 * React hook that subscribes to the referral state machine.
 * Returns the live state plus convenience flags for UI rendering.
 *
 * SSR-safe: initial render uses an idle/empty state, then hydrates from
 * localStorage on mount. This matches the pattern used elsewhere in the
 * app (MistakeNotebook, PostWritingPracticePage) to avoid hydration
 * mismatches.
 */
export function useReferralFlow() {
  // Start with idle SSR-safe state. Real state lands on mount.
  const [snap, setSnap] = useState({
    status: REFERRAL_STATES.IDLE,
    inviterCode: null,
    source: null,
    capturedAt: null,
    bindStatus: null,
    bindReason: null,
    grantedDays: 0,
    grantedAt: null,
  });

  useEffect(() => {
    // Pull the latest state right after mount and subscribe to further changes.
    setSnap(getReferralState());
    const unsubscribe = subscribeReferralState(setSnap);
    return unsubscribe;
  }, []);

  return {
    ...snap,
    hasCapturedRef: !!snap.inviterCode && snap.status !== REFERRAL_STATES.GRANTED,
    isCaptured: snap.status === REFERRAL_STATES.CAPTURED,
    isBinding: snap.status === REFERRAL_STATES.BINDING,
    isBound: snap.status === REFERRAL_STATES.BOUND,
    isActivating: snap.status === REFERRAL_STATES.ACTIVATING,
    isGranted: snap.status === REFERRAL_STATES.GRANTED,
    isRejected: snap.status === REFERRAL_STATES.REJECTED,
  };
}
