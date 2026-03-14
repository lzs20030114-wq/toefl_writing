"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { C, FONT } from "./ui";

const AFDIAN_URL = "https://afdian.com/a/treepractice";
const POLL_INTERVAL = 5000; // 5s

/**
 * Upgrade modal with:
 * 1. Shows user code + copy button + instructions
 * 2. Opens Afdian in new tab
 * 3. Polls /api/auth/user-info to detect tier upgrade
 * 4. Shows success state when pro is activated
 */
export default function UpgradeModal({ userCode, onClose, onUpgraded }) {
  const [copied, setCopied] = useState(false);
  const [afdianOpened, setAfdianOpened] = useState(false);
  const [upgraded, setUpgraded] = useState(false);
  const pollRef = useRef(null);

  const handleCopy = async () => {
    if (!userCode) return;
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* no-op */ }
  };

  const handleGoAfdian = () => {
    window.open(AFDIAN_URL, "_blank");
    setAfdianOpened(true);
  };

  // Poll for tier change after user opens Afdian
  useEffect(() => {
    if (!afdianOpened || !userCode || upgraded) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/user-info?code=${encodeURIComponent(userCode)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.tier === "pro" || data.tier === "legacy") {
          setUpgraded(true);
          clearInterval(pollRef.current);
        }
      } catch { /* ignore */ }
    }, POLL_INTERVAL);

    return () => clearInterval(pollRef.current);
  }, [afdianOpened, userCode, upgraded]);

  const handleClose = () => {
    clearInterval(pollRef.current);
    if (upgraded && onUpgraded) onUpgraded();
    onClose();
  };

  return createPortal(
    <div
      onClick={handleClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)", display: "flex", justifyContent: "center",
        alignItems: "center", zIndex: 10000, fontFamily: FONT, padding: 20,
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
        {upgraded ? (
          /* ── Success state ── */
          <>
            <div style={{ fontSize: 48, marginBottom: 12 }}>&#127881;</div>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: C.t1 }}>
              Pro 已开通！
            </h3>
            <p style={{ fontSize: 14, color: C.t2, marginBottom: 20, lineHeight: 1.6 }}>
              无限练习已解锁，尽情使用吧。
            </p>
            <button
              onClick={handleClose}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 10,
                border: "none", background: C.blue, color: "#fff",
                fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
              }}
            >
              开始练习
            </button>
          </>
        ) : (
          /* ── Pre-checkout state ── */
          <>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: "linear-gradient(135deg,#087355,#0891B2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <span style={{ color: "#fff", fontSize: 22, fontWeight: 800 }}>P</span>
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: C.t1 }}>
              升级 Pro
            </h3>
            <p style={{ fontSize: 14, color: C.t2, marginBottom: 16, lineHeight: 1.6 }}>
              解锁无限练习次数，不受每日额度限制。
            </p>

            {/* Instructions */}
            <div style={{
              background: "#f8fafc", border: "1px solid " + C.bdr, borderRadius: 10,
              padding: "14px 16px", marginBottom: 16, textAlign: "left",
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.t1, marginBottom: 10 }}>
                操作步骤：
              </div>
              <div style={{ fontSize: 12, color: C.t2, lineHeight: 1.8 }}>
                1. 复制下方登录码<br />
                2. 点击「前往爱发电」选择方案并赞助<br />
                3. 赞助时将登录码粘贴到「留言」栏<br />
                4. 付款完成后回到此页面，系统自动开通
              </div>
            </div>

            {/* User code */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "#ecfdf5", border: "1px solid #bbf7d0", borderRadius: 10,
              padding: "12px 16px", marginBottom: 16,
            }}>
              <span style={{ fontSize: 11, color: C.t2, whiteSpace: "nowrap" }}>你的登录码</span>
              <span style={{
                flex: 1, fontSize: 20, fontWeight: 800, fontFamily: "monospace",
                letterSpacing: 4, color: C.t1, textAlign: "center",
              }}>
                {userCode}
              </span>
              <button
                onClick={handleCopy}
                style={{
                  padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${copied ? C.blue : C.bdr}`,
                  background: copied ? "#eff6ff" : "#fff",
                  color: copied ? C.blue : C.t2,
                  cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap",
                }}
              >
                {copied ? "已复制" : "复制"}
              </button>
            </div>

            {/* CTA */}
            <button
              onClick={handleGoAfdian}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 10,
                border: "none", background: C.blue, color: "#fff",
                fontSize: 15, fontWeight: 600, cursor: "pointer",
                fontFamily: FONT, marginBottom: 8,
              }}
            >
              前往爱发电
            </button>

            {afdianOpened && (
              <div style={{
                fontSize: 12, color: C.blue, marginBottom: 8,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                <span style={{
                  display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                  border: "2px solid " + C.blue, borderTopColor: "transparent",
                  animation: "spin 1s linear infinite",
                }} />
                等待付款确认中...
              </div>
            )}

            <button
              onClick={handleClose}
              style={{
                width: "100%", padding: "10px 0", borderRadius: 10,
                border: "1px solid " + C.bdr, background: "#fff",
                color: C.t2, fontSize: 14, cursor: "pointer", fontFamily: FONT,
              }}
            >
              取消
            </button>

            {/* Spinner animation */}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
