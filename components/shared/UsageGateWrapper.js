"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { getSavedCode } from "../../lib/AuthContext";
import { useUsageGate } from "../../lib/useUsageGate";
import UsageLimitModal from "./UsageLimitModal";
import { C, FONT } from "./ui";

/**
 * Login prompt shown when an unauthenticated user tries to practice.
 */
function LoginRequiredModal({ onClose }) {
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)", display: "flex", justifyContent: "center",
        alignItems: "center", zIndex: 10000, fontFamily: FONT,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 16, padding: "32px 28px",
          maxWidth: 360, width: "90%", textAlign: "center",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ width: 48, height: 48, borderRadius: 12, background: "linear-gradient(135deg,#087355,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <span style={{ color: "#fff", fontSize: 22, fontWeight: 800 }}>T</span>
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: C.t1 }}>
          需要登录
        </h3>
        <p style={{ fontSize: 14, color: C.t2, marginBottom: 20, lineHeight: 1.6 }}>
          登录后即可开始练习。邮箱注册免费用户每日 3 次练习，登录码用户不限次。
        </p>
        <button
          onClick={onClose}
          style={{
            width: "100%", padding: "12px 0", borderRadius: 10,
            border: "none", background: C.blue, color: "#fff",
            fontSize: 15, fontWeight: 600, cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          去登录
        </button>
      </div>
    </div>,
    document.body
  );
}

/**
 * Wraps a practice task component with login + daily usage checking.
 * - Not logged in → show login prompt, redirect to home
 * - Logged in but no remaining usage → show limit modal
 * - Otherwise → render children
 */
export default function UsageGateWrapper({ children, onExit }) {
  const code = getSavedCode();
  const [showLoginPrompt, setShowLoginPrompt] = useState(!code);
  const { canPractice, limit, loading } = useUsageGate();

  // Not logged in
  if (showLoginPrompt) {
    return (
      <LoginRequiredModal
        onClose={() => {
          setShowLoginPrompt(false);
          onExit();
        }}
      />
    );
  }

  if (loading) return null;

  // Logged in but no usage remaining
  if (!canPractice) {
    return <UsageLimitModal limit={limit} onClose={onExit} />;
  }

  return typeof children === "function" ? children({}) : children;
}
