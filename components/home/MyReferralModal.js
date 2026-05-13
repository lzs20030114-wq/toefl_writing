"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { HOME_FONT, HOME_TOKENS as T } from "./theme";
import { MyReferralPanel } from "./MyReferralPanel";

/**
 * Portal-rendered modal wrapping MyReferralPanel — opened from the homepage
 * ReferralBanner click (logged-in users only).
 */
export function MyReferralModal({ userCode, onClose }) {
  // Lock background scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.45)",
        WebkitBackdropFilter: "blur(4px)", backdropFilter: "blur(4px)",
        zIndex: 10000,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
        fontFamily: HOME_FONT,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 440,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#fff",
          border: `1px solid ${T.bdr}`,
          borderRadius: 14,
          padding: "22px 22px 18px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 22 }}>🎁</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: T.t1, lineHeight: 1.2 }}>邀请备考搭子</div>
              <div style={{ fontSize: 11, color: T.t3, marginTop: 2 }}>每邀请 1 位，得 3 天 Pro</div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            style={{
              width: 28, height: 28, borderRadius: 8,
              border: `1px solid ${T.bdrSubtle}`,
              background: "#fff",
              color: T.t3,
              fontSize: 14,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>

        <MyReferralPanel userCode={userCode} />
      </div>
    </div>,
    document.body
  );
}
