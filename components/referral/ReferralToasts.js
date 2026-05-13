"use client";

/**
 * Two referral-flow toasts, both auto-mounted at the root of the homepage.
 *
 * 1. InvitationCapturedToast — slides in from bottom-right when a user
 *    lands via /?ref=ABC123. Tells them an inviter is waiting + CTA to
 *    sign up. Dismissible. Suppressed once the user is logged in.
 *
 * 2. ActivatedToast — slides in when sessionStore detects that the
 *    invitee's first practice triggered a grant. Tells them they just
 *    helped their friend. Auto-dismisses after 6s.
 *
 * Both subscribe to lib/referral/state.js via useReferralFlow().
 */

import { useEffect, useState } from "react";
import { useReferralFlow } from "../../lib/referral/useReferralFlow";

const DISMISS_KEY = "toefl-referral-capture-toast-dismissed-at";
const DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h
const AUTO_HIDE_AFTER_LOGIN_MS = 2000; // capture toast fades 2s after login

function recentlyDismissed() {
  if (typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markDismissed() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* no-op */ }
}

// ─────────────────────────────────────────────────────────
// InvitationCapturedToast — bottom-right card on /?ref= visit
// ─────────────────────────────────────────────────────────
export function InvitationCapturedToast({ isLoggedIn, onSignupClick }) {
  const { hasCapturedRef, inviterCode } = useReferralFlow();
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  // Show when we have a captured ref and the user isn't logged in (and
  // hasn't dismissed recently).
  useEffect(() => {
    if (!hasCapturedRef) { setVisible(false); return; }
    if (isLoggedIn) { setVisible(false); return; }
    if (recentlyDismissed()) { setVisible(false); return; }
    setVisible(true);
  }, [hasCapturedRef, isLoggedIn]);

  // If user logs in while toast is visible, fade it out gracefully
  useEffect(() => {
    if (visible && isLoggedIn) {
      const t = setTimeout(() => setVisible(false), AUTO_HIDE_AFTER_LOGIN_MS);
      return () => clearTimeout(t);
    }
  }, [visible, isLoggedIn]);

  if (!visible) return null;

  const handleDismiss = (e) => {
    e?.stopPropagation();
    setClosing(true);
    markDismissed();
    setTimeout(() => setVisible(false), 250);
  };

  const handleClick = () => {
    if (typeof onSignupClick === "function") onSignupClick();
  };

  return (
    <>
      <style>{`
        @keyframes ref-toast-in {
          from { transform: translateY(20px) translateX(20px); opacity: 0; }
          to   { transform: translateY(0) translateX(0); opacity: 1; }
        }
        @keyframes ref-toast-out {
          to { transform: translateY(20px); opacity: 0; }
        }
        .ref-capture-toast {
          animation: ref-toast-in 0.35s ease-out forwards;
        }
        .ref-capture-toast.closing {
          animation: ref-toast-out 0.25s ease-in forwards;
        }
      `}</style>
      <div
        role="dialog"
        aria-label="邀请已识别"
        onClick={handleClick}
        className={`ref-capture-toast${closing ? " closing" : ""}`}
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 9500,
          maxWidth: 340,
          padding: "14px 16px 14px 18px",
          background: "linear-gradient(135deg, #ecfdf5 0%, #ecfeff 100%)",
          border: "1px solid rgba(13,150,104,0.28)",
          borderRadius: 14,
          boxShadow: "0 12px 28px rgba(8,115,85,0.18)",
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 26, flexShrink: 0, lineHeight: 1 }}>🎁</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#065f46", lineHeight: 1.4 }}>
            邀请人 <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: 1 }}>{inviterCode}</span> 邀请你加入
          </div>
          <div style={{ fontSize: 12, color: "#0e7c66", marginTop: 4, lineHeight: 1.6 }}>
            注册即送 3 天 Pro 试用 · 完成 1 次练习帮 TA 领 3 天 Pro
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleClick(); }}
            style={{
              marginTop: 8,
              padding: "6px 14px",
              borderRadius: 8,
              border: "none",
              background: "linear-gradient(135deg, #087355, #0891B2)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: 0.2,
            }}
          >
            立即注册 →
          </button>
        </div>
        <button
          aria-label="关闭"
          onClick={handleDismiss}
          style={{
            flexShrink: 0,
            width: 22, height: 22, padding: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: "none", cursor: "pointer",
            color: "#94a39a", fontSize: 14, lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────
// ActivatedToast — slides in when the invitee's first practice grants
// the inviter 3 days.
//
// Persistence: the user just finished a practice and is reading their
// ScoringReport — their attention is on the result, not the toast.
// 6 seconds is too short to register. We now keep the toast visible for
// 30 seconds and expose an × button so the user can dismiss whenever
// they choose to acknowledge it.
// ─────────────────────────────────────────────────────────
const ACTIVATED_AUTO_HIDE_MS = 30_000;

export function ActivatedToast() {
  const { isGranted, grantedDays, inviterCode } = useReferralFlow();
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [shownFor, setShownFor] = useState(null);

  // Show only once per (inviterCode + grantedAt) — we use grantedDays as a
  // signal that something new happened.
  useEffect(() => {
    if (!isGranted || !inviterCode) return;
    const key = `${inviterCode}-${grantedDays}`;
    if (shownFor === key) return;
    setShownFor(key);
    setClosing(false);
    setVisible(true);
    const t = setTimeout(() => {
      setClosing(true);
      setTimeout(() => setVisible(false), 250);
    }, ACTIVATED_AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [isGranted, inviterCode, grantedDays, shownFor]);

  if (!visible) return null;

  const handleClose = (e) => {
    e?.stopPropagation();
    setClosing(true);
    setTimeout(() => setVisible(false), 250);
  };

  return (
    <>
      <style>{`
        @keyframes ref-grant-in {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        @keyframes ref-grant-out {
          to { transform: translateY(20px); opacity: 0; }
        }
        .ref-grant-toast {
          animation: ref-grant-in 0.35s ease-out forwards;
        }
        .ref-grant-toast.closing {
          animation: ref-grant-out 0.25s ease-in forwards;
        }
      `}</style>
      <div
        role="status"
        aria-live="polite"
        className={`ref-grant-toast${closing ? " closing" : ""}`}
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 9500,
          maxWidth: 340,
          padding: "12px 14px 12px 16px",
          background: "#fff",
          border: "1px solid rgba(13,150,104,0.28)",
          borderRadius: 12,
          boxShadow: "0 10px 24px rgba(8,115,85,0.15)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 22, lineHeight: 1, color: "#10b981", flexShrink: 0 }}>✓</span>
        <div style={{ flex: 1, fontSize: 13, color: "#065f46", lineHeight: 1.5 }}>
          已帮邀请人 <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, letterSpacing: 1 }}>{inviterCode}</span> 解锁
          <strong style={{ color: "#087355", margin: "0 4px" }}>{grantedDays || 3} 天 Pro</strong>
        </div>
        <button
          aria-label="关闭"
          onClick={handleClose}
          style={{
            flexShrink: 0,
            width: 24, height: 24, padding: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: "none", cursor: "pointer",
            color: "#94a39a", fontSize: 16, lineHeight: 1, borderRadius: 4,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#5a6b62"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#94a39a"; }}
        >
          ✕
        </button>
      </div>
    </>
  );
}
