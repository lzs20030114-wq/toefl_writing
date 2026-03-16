"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { getSavedCode, getSavedTier } from "../../lib/AuthContext";
import { useUsageGate } from "../../lib/useUsageGate";
import UsageLimitModal from "./UsageLimitModal";
import UpgradeModal from "./UpgradeModal";
import { C, FONT } from "./ui";

/**
 * Login prompt shown when an unauthenticated user tries to practice.
 */
function LoginRequiredModal({ onGoLogin }) {
  return createPortal(
    <div
      onClick={onGoLogin}
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
          onClick={onGoLogin}
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
 * Blurred overlay for free users trying to access practice mode.
 */
function PracticeLockedGate({ children, onExit, userCode }) {
  const [showUpgrade, setShowUpgrade] = useState(false);
  return (
    <>
      {/* Blurred, non-interactive preview */}
      <div style={{ filter: "blur(6px) saturate(0.5)", pointerEvents: "none", userSelect: "none", WebkitUserSelect: "none", opacity: 0.6 }}>
        {typeof children === "function" ? children({}) : children}
      </div>

      {/* Overlay card */}
      {createPortal(
        <div
          onClick={onExit}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 10000, fontFamily: FONT, padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 16, padding: "32px 28px",
              maxWidth: 400, width: "90%", textAlign: "center",
              boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
            }}
          >
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: "linear-gradient(135deg,#087355,#0891B2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <span style={{ color: "#fff", fontSize: 22, fontWeight: 800 }}>P</span>
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: C.t1 }}>
              专项练习 · Pro 专属
            </h3>
            <p style={{ fontSize: 14, color: C.t2, marginBottom: 20, lineHeight: 1.6 }}>
              升级 Pro 解锁专项练习模式：自选题目、不限时间、反复练习薄弱项。
            </p>
            <button
              onClick={() => setShowUpgrade(true)}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 10,
                border: "none", background: C.blue, color: "#fff",
                fontSize: 15, fontWeight: 600, cursor: "pointer",
                fontFamily: FONT, marginBottom: 8,
              }}
            >
              升级 Pro
            </button>
            <button
              onClick={onExit}
              style={{
                width: "100%", padding: "10px 0", borderRadius: 10,
                border: "1px solid " + C.bdr, background: "#fff",
                color: C.t2, fontSize: 14, cursor: "pointer", fontFamily: FONT,
              }}
            >
              返回
            </button>
          </div>
        </div>,
        document.body
      )}

      {showUpgrade && (
        <UpgradeModal
          userCode={userCode}
          currentTier="free"
          onClose={() => setShowUpgrade(false)}
          onUpgraded={() => window.location.reload()}
        />
      )}
    </>
  );
}

/**
 * Wraps a practice task component with login + daily usage checking.
 * - Not logged in → show login prompt, redirect to home
 * - Practice mode + free tier → show blurred gate with upgrade prompt
 * - Logged in but no remaining usage → show limit modal
 * - Otherwise → render children
 */
export default function UsageGateWrapper({ children, onExit, practiceMode }) {
  const code = getSavedCode();
  const tier = getSavedTier();
  const router = useRouter();
  const [showLoginPrompt, setShowLoginPrompt] = useState(!code);
  const { canPractice, limit, loading } = useUsageGate();

  // Not logged in
  if (showLoginPrompt) {
    return (
      <LoginRequiredModal
        onGoLogin={() => {
          setShowLoginPrompt(false);
          router.push("/?login=1");
        }}
      />
    );
  }

  // Practice mode requires pro or legacy
  if (practiceMode === "practice" && tier !== "pro" && tier !== "legacy") {
    return (
      <PracticeLockedGate onExit={onExit} userCode={code}>
        {children}
      </PracticeLockedGate>
    );
  }

  if (loading) return null;

  // Logged in but no usage remaining
  if (!canPractice) {
    return <UsageLimitModal limit={limit} onClose={onExit} userCode={code} />;
  }

  return typeof children === "function" ? children({}) : children;
}
