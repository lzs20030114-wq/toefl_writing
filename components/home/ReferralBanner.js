"use client";

import { useState, useEffect } from "react";
import { HOME_FONT, HOME_TOKENS as T } from "./theme";
import { useReferralFlow } from "../../lib/referral/useReferralFlow";

const DISMISS_KEY = "toefl-referral-banner-dismissed-at";
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isDismissedRecently() {
  if (typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markDismissed() {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* no-op */ }
}

/**
 * Collapsible referral banner shown above task cards on the homepage.
 * Mirrors the existing PromoBanner pattern (collapse/expand on click) but
 * carries a separate CTA that opens MyReferralModal.
 *
 * Single-sided reward: invitee keeps existing 3-day auto-trial; inviter gets
 * +3 days after invitee completes ≥1 practice. Max 30 days lifetime.
 *
 * Props:
 *  - isLoggedIn: boolean
 *  - onOpen:    () => void — opens the referral modal (or login modal if signed out)
 *  - fadeIn:    (ms) => style — entry animation helper
 */
export function ReferralBanner({ isLoggedIn, onOpen, fadeIn }) {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  // Hide this "share with friends" banner when the user is themselves
  // arriving via an invitation — they're not the inviter, and the
  // InvitationCapturedToast already pitches them. Showing both is
  // visually redundant and confuses the social context.
  const { hasCapturedRef } = useReferralFlow();

  useEffect(() => {
    if (!isDismissedRecently()) setVisible(true);
  }, []);

  if (!visible) return null;
  if (hasCapturedRef && !isLoggedIn) return null;

  const handleDismiss = (e) => {
    e.stopPropagation();
    markDismissed();
    setVisible(false);
  };

  const handleCta = (e) => {
    e.stopPropagation();
    onOpen?.();
  };

  const safeFadeIn = typeof fadeIn === "function" ? fadeIn(120) : {};

  return (
    <>
      <style>{`
        @keyframes referral-gift-wobble {
          0%, 100% { transform: rotate(-2deg); }
          50%      { transform: rotate(2deg); }
        }
      `}</style>
      <div
        style={{
          marginBottom: 14,
          background: "linear-gradient(135deg, #ecfdf5 0%, #ecfeff 100%)",
          border: "1px solid rgba(13,150,104,0.22)",
          borderRadius: 12,
          overflow: "hidden",
          fontFamily: HOME_FONT,
          boxShadow: "0 1px 2px rgba(8,115,85,0.05)",
          ...safeFadeIn,
        }}
      >
        {/* Header — always visible, click to toggle */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen((v) => !v); }}
          style={{
            padding: "11px 14px 11px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            cursor: "pointer",
          }}
        >
          <span
            aria-hidden
            style={{
              fontSize: 20,
              display: "inline-flex",
              transformOrigin: "center",
              animation: "referral-gift-wobble 4s ease-in-out infinite",
              flexShrink: 0,
            }}
          >🎁</span>

          <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: "#065f46", lineHeight: 1.4 }}>
            备考搭子也来用一下？<span style={{ color: T.primary }}>邀请一人送 3 天 Pro</span>
          </div>

          <span
            style={{
              flexShrink: 0,
              padding: "4px 11px",
              borderRadius: 999,
              background: "rgba(8,115,85,0.1)",
              color: "#0e7c66",
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
              transition: "background 0.15s",
            }}
          >
            {open ? "收起" : "查看详情"}
          </span>

          <button
            aria-label="关闭活动通知"
            onClick={handleDismiss}
            style={{
              flexShrink: 0,
              width: 22, height: 22,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "#94a39a",
              fontSize: 13,
              lineHeight: 1,
              padding: 0,
              marginLeft: 2,
              borderRadius: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#5a6b62"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#94a39a"; }}
          >
            ✕
          </button>
        </div>

        {/* Expanded body — slide open */}
        <div
          style={{
            maxHeight: open ? 220 : 0,
            opacity: open ? 1 : 0,
            overflow: "hidden",
            transition: "max-height 0.3s ease, opacity 0.25s ease",
            padding: open ? "0 16px 14px" : "0 16px",
          }}
        >
          <p style={{ margin: 0, fontSize: 12, color: "#0e7c66", lineHeight: 1.75 }}>
            把邀请码或链接发给朋友。TA 注册并完成 1 次练习后，<strong style={{ color: T.primary }}>你的 Pro 自动 +3 天</strong>。新人本来就有 3 天免费试用——TA 不亏，你白拿。最多累计 30 天。
          </p>
          <button
            onClick={handleCta}
            style={{
              marginTop: 10,
              padding: "8px 18px",
              borderRadius: 8,
              border: "none",
              background: "linear-gradient(135deg, #087355, #0891B2)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: HOME_FONT,
              letterSpacing: 0.2,
              transition: "transform 0.1s ease",
            }}
            onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.97)"; }}
            onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          >
            {isLoggedIn ? "查看我的邀请链接 →" : "登录开始邀请 →"}
          </button>
        </div>
      </div>
    </>
  );
}
