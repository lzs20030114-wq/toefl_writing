"use client";
import { useEffect, useRef, useState } from "react";
import { FirstSetSurveyModal } from "./shared/FirstSetSurveyModal";
import { AUTH_CHANGED_EVENT, getSavedCode } from "../lib/AuthContext";
import { SESSION_STORE_EVENTS } from "../lib/sessionStore";

/**
 * Globally mounted (from app/layout.js). Watches for session-history updates
 * and auth changes; if the current user has finished at least one set and has
 * not yet seen the first-set survey, opens the FirstSetSurveyModal once.
 *
 * Submitting the survey extends the user's Pro by 1 day (handled server-side).
 * Dismissing records a "dismissed" row so the modal never reappears.
 */
export default function FirstSetSurveyTrigger() {
  const [state, setState] = useState({
    open: false,
    proDaysLeft: 0,
    rewardDays: 1,
  });
  const checkedForCodeRef = useRef(new Set());
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function maybeShow() {
      if (inFlightRef.current) return;
      const userCode = getSavedCode();
      if (!userCode) return;
      if (checkedForCodeRef.current.has(userCode)) return;
      inFlightRef.current = true;
      try {
        const res = await fetch(
          `/api/survey/first-set?userCode=${encodeURIComponent(userCode)}`,
          { method: "GET", cache: "no-store" },
        );
        if (!res.ok) {
          checkedForCodeRef.current.add(userCode);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        // Only memoize the "already checked" state when the answer is
        // conclusive — either the user has already been asked (so we will
        // never need to ask again), or the modal is about to open. If the
        // user simply has no sessions yet (race between optimistic
        // emitHistoryUpdated and the cloud insert in saveSess), leave the
        // dedup unset so the next HISTORY_UPDATED event can re-check.
        if (data?.alreadyAsked || data?.shouldShow) {
          checkedForCodeRef.current.add(userCode);
        }
        if (data?.shouldShow) {
          setState({
            open: true,
            proDaysLeft: Number(data.proDaysLeft) || 0,
            rewardDays: Number(data.rewardDays) || 1,
          });
        }
      } catch {
        checkedForCodeRef.current.add(userCode);
      } finally {
        inFlightRef.current = false;
      }
    }

    function onHistoryUpdate() {
      // After a new session save, re-check (the user may have just completed
      // their first set). The per-userCode dedup means we still make at most
      // one network call per session.
      maybeShow();
    }

    function onAuthChange() {
      // New login → re-check for the new user.
      checkedForCodeRef.current.clear();
      setState((s) => ({ ...s, open: false }));
      maybeShow();
    }

    // Initial check (covers case where user already had >=1 session on load).
    maybeShow();
    window.addEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, onHistoryUpdate);
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChange);

    return () => {
      cancelled = true;
      window.removeEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, onHistoryUpdate);
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChange);
    };
  }, []);

  async function handleSubmit(responses) {
    const userCode = getSavedCode();
    if (!userCode) throw new Error("未登录");
    const res = await fetch("/api/survey/first-set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userCode, responses }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || "提交失败");
    }
    setState((s) => ({ ...s, open: false }));
  }

  async function handleDismiss() {
    const userCode = getSavedCode();
    setState((s) => ({ ...s, open: false }));
    if (!userCode) return;
    try {
      await fetch("/api/survey/first-set/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode }),
      });
    } catch {
      // best-effort; if the dismiss write fails the modal will re-show next load
    }
  }

  return (
    <FirstSetSurveyModal
      open={state.open}
      proDaysLeft={state.proDaysLeft}
      rewardDays={state.rewardDays}
      onSubmit={handleSubmit}
      onDismiss={handleDismiss}
    />
  );
}
