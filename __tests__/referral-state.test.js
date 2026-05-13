/**
 * @jest-environment jsdom
 */
import {
  REFERRAL_STATES,
  REFERRAL_EVENT,
  captureRef,
  markBindStarted,
  markBindSucceeded,
  markBindRejected,
  markActivating,
  markGranted,
  resetReferralState,
  getReferralState,
  subscribeReferralState,
  __test__,
} from "../lib/referral/state";

beforeEach(() => {
  __test__.reset();
  if (typeof localStorage !== "undefined") localStorage.clear();
});

describe("referral state machine — transitions", () => {
  test("starts in idle with no inviter", () => {
    const s = getReferralState();
    expect(s.status).toBe(REFERRAL_STATES.IDLE);
    expect(s.inviterCode).toBeNull();
  });

  test("captureRef moves idle → captured and normalizes the code", () => {
    expect(captureRef({ code: "abc123", source: "link" })).toBe(true);
    const s = getReferralState();
    expect(s.status).toBe(REFERRAL_STATES.CAPTURED);
    expect(s.inviterCode).toBe("ABC123");
    expect(s.source).toBe("link");
    expect(typeof s.capturedAt).toBe("number");
  });

  test("captureRef rejects non-6-char codes", () => {
    expect(captureRef({ code: "abc" })).toBe(false);
    expect(captureRef({ code: "" })).toBe(false);
    expect(captureRef({ code: "abcdefg" })).toBe(true); // truncates to 6
    expect(getReferralState().inviterCode).toBe("ABCDEF");
  });

  test("captureRef ignores a different code once one is captured (first wins)", () => {
    captureRef({ code: "ABC123" });
    expect(captureRef({ code: "XYZ789" })).toBe(false);
    expect(getReferralState().inviterCode).toBe("ABC123");
  });

  test("captureRef is a no-op after grant (lifecycle complete)", () => {
    captureRef({ code: "ABC123" });
    markBindStarted();
    markBindSucceeded();
    markActivating();
    markGranted({ daysAdded: 3 });
    expect(captureRef({ code: "ABC123", source: "link" })).toBe(false);
    expect(getReferralState().status).toBe(REFERRAL_STATES.GRANTED);
  });

  test("full happy path: captured → binding → bound → activating → granted", () => {
    captureRef({ code: "ABC123" });
    expect(getReferralState().status).toBe(REFERRAL_STATES.CAPTURED);

    markBindStarted();
    expect(getReferralState().status).toBe(REFERRAL_STATES.BINDING);
    expect(getReferralState().bindStatus).toBe("pending");

    markBindSucceeded();
    expect(getReferralState().status).toBe(REFERRAL_STATES.BOUND);

    markActivating();
    expect(getReferralState().status).toBe(REFERRAL_STATES.ACTIVATING);

    markGranted({ daysAdded: 3 });
    const final = getReferralState();
    expect(final.status).toBe(REFERRAL_STATES.GRANTED);
    expect(final.grantedDays).toBe(3);
    expect(typeof final.grantedAt).toBe("number");
  });

  test("markGranted accumulates days across multiple grants", () => {
    captureRef({ code: "ABC123" });
    markGranted({ daysAdded: 3 });
    markGranted({ daysAdded: 3 });
    expect(getReferralState().grantedDays).toBe(6);
  });

  test("markBindRejected captures the reason", () => {
    captureRef({ code: "ABC123" });
    markBindStarted();
    markBindRejected("ip_flood");
    const s = getReferralState();
    expect(s.status).toBe(REFERRAL_STATES.REJECTED);
    expect(s.bindStatus).toBe("rejected");
    expect(s.bindReason).toBe("ip_flood");
  });

  test("resetReferralState clears everything back to idle", () => {
    captureRef({ code: "ABC123" });
    markGranted({ daysAdded: 3 });
    resetReferralState();
    const s = getReferralState();
    expect(s.status).toBe(REFERRAL_STATES.IDLE);
    expect(s.inviterCode).toBeNull();
    expect(s.grantedDays).toBe(0);
  });
});

describe("referral state — persistence", () => {
  test("captured state survives module re-read via localStorage", () => {
    captureRef({ code: "ABC123" });
    // Simulate page reload: reset internal state, then re-read via getReferralState.
    __test__.reset();
    const restored = getReferralState();
    expect(restored.inviterCode).toBe("ABC123");
    expect(restored.status).toBe(REFERRAL_STATES.CAPTURED);
  });

  test("expired captures (>30d) are dropped during hydration", () => {
    // Manually write an expired record
    const expired = {
      code: "EXPIRD",
      source: "link",
      capturedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
      status: REFERRAL_STATES.CAPTURED,
    };
    localStorage.setItem("toefl-ref", JSON.stringify(expired));
    __test__.reset();
    expect(getReferralState().inviterCode).toBeNull();
    expect(localStorage.getItem("toefl-ref")).toBeNull();
  });
});

describe("referral state — subscriptions", () => {
  test("subscribers receive an initial snapshot immediately", () => {
    captureRef({ code: "ABC123" });
    const calls = [];
    const unsubscribe = subscribeReferralState((snap) => calls.push(snap));
    expect(calls).toHaveLength(1);
    expect(calls[0].inviterCode).toBe("ABC123");
    unsubscribe();
  });

  test("subscribers receive updates on transitions", () => {
    const calls = [];
    const unsubscribe = subscribeReferralState((snap) => calls.push(snap.status));
    captureRef({ code: "ABC123" });
    markBindStarted();
    markBindSucceeded();
    // Initial snapshot + 3 transitions = 4
    expect(calls).toHaveLength(4);
    expect(calls[1]).toBe(REFERRAL_STATES.CAPTURED);
    expect(calls[2]).toBe(REFERRAL_STATES.BINDING);
    expect(calls[3]).toBe(REFERRAL_STATES.BOUND);
    unsubscribe();
  });

  test("unsubscribe stops notifications", () => {
    const calls = [];
    const unsubscribe = subscribeReferralState((snap) => calls.push(snap.status));
    unsubscribe();
    captureRef({ code: "ABC123" });
    // Only the initial snapshot from subscribe (idle), then nothing
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(REFERRAL_STATES.IDLE);
  });

  test("dispatches a window CustomEvent on state change", () => {
    const seen = [];
    const handler = (e) => seen.push(e.detail.status);
    window.addEventListener(REFERRAL_EVENT, handler);
    captureRef({ code: "ABC123" });
    markBindStarted();
    expect(seen).toEqual([REFERRAL_STATES.CAPTURED, REFERRAL_STATES.BINDING]);
    window.removeEventListener(REFERRAL_EVENT, handler);
  });
});
