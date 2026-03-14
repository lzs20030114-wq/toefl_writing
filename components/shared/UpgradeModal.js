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
export default function UpgradeModal({ userCode, currentTier, onClose, onUpgraded }) {
  const isRenew = currentTier === "pro";
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

  const [codeCopied, setCodeCopied] = useState(false);

  const handleGoAfdian = () => {
    if (!codeCopied && !copied) {
      // Force copy first, then open
      handleCopy().then(() => {
        setCodeCopied(true);
        window.open(AFDIAN_URL, "_blank");
        setAfdianOpened(true);
      });
      return;
    }
    window.open(AFDIAN_URL, "_blank");
    setAfdianOpened(true);
  };

  // Snapshot tier_expires_at before opening Afdian, so we can detect renewals too
  const initialExpiresRef = useRef(null);

  // Poll for tier/expiry change after user opens Afdian
  useEffect(() => {
    if (!afdianOpened || !userCode || upgraded) return;

    // Capture initial state on first poll start
    if (initialExpiresRef.current === null) {
      fetch(`/api/auth/user-info?code=${encodeURIComponent(userCode)}`)
        .then((r) => r.json())
        .then((d) => { initialExpiresRef.current = d.tier_expires_at || ""; })
        .catch(() => { initialExpiresRef.current = ""; });
    }

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/user-info?code=${encodeURIComponent(userCode)}`);
        if (!res.ok) return;
        const data = await res.json();
        const nowPro = data.tier === "pro" || data.tier === "legacy";
        const expiryChanged = data.tier_expires_at !== initialExpiresRef.current;
        if (nowPro && (!isRenew || expiryChanged)) {
          setUpgraded(true);
          clearInterval(pollRef.current);
        }
      } catch { /* ignore */ }
    }, POLL_INTERVAL);

    return () => clearInterval(pollRef.current);
  }, [afdianOpened, userCode, upgraded, isRenew]);

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
              {isRenew ? "续费成功！" : "Pro 已开通！"}
            </h3>
            <p style={{ fontSize: 14, color: C.t2, marginBottom: 20, lineHeight: 1.6 }}>
              {isRenew ? "有效期已延长，继续尽情练习吧。" : "无限练习已解锁，尽情使用吧。"}
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
              {isRenew ? "续费 Pro" : "升级 Pro"}
            </h3>
            <p style={{ fontSize: 14, color: C.t2, marginBottom: 16, lineHeight: 1.6 }}>
              {isRenew ? "续费后有效期将自动延长，在当前到期日基础上叠加。" : "解锁无限练习次数，不受每日额度限制。"}
            </p>

            {/* User code — big and unmissable */}
            <div style={{
              background: "#fef3c7", border: "2px solid #f59e0b", borderRadius: 12,
              padding: "16px", marginBottom: 12,
            }}>
              <div style={{
                fontSize: 13, fontWeight: 700, color: "#92400e", marginBottom: 8,
                textAlign: "center",
              }}>
                &#9888;&#65039; 付款时必须在「留言」栏粘贴此码，否则无法自动开通
              </div>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                background: "#fff", borderRadius: 8, padding: "12px 16px",
                border: "1px solid #fde68a",
              }}>
                <span style={{
                  fontSize: 26, fontWeight: 900, fontFamily: "monospace",
                  letterSpacing: 6, color: C.t1,
                }}>
                  {userCode}
                </span>
                <button
                  onClick={() => { handleCopy(); setCodeCopied(true); }}
                  style={{
                    padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                    border: "none",
                    background: copied ? "#059669" : "#f59e0b",
                    color: "#fff",
                    cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap",
                    transition: "background 0.2s",
                  }}
                >
                  {copied ? "&#10003; 已复制" : "复制登录码"}
                </button>
              </div>
            </div>

            {/* Steps — compact */}
            <div style={{
              fontSize: 12, color: C.t2, lineHeight: 1.8, marginBottom: 14,
              textAlign: "left", padding: "0 4px",
            }}>
              <span style={{ fontWeight: 600, color: C.t1 }}>步骤：</span>
              复制登录码 &#8594; 前往爱发电赞助 &#8594; <span style={{ color: "#dc2626", fontWeight: 700 }}>留言栏粘贴登录码</span> &#8594; 付款后回此页自动开通
            </div>

            {/* CTA */}
            <button
              onClick={handleGoAfdian}
              style={{
                width: "100%", padding: "13px 0", borderRadius: 10,
                border: "none",
                background: (codeCopied || copied) ? C.blue : "#9ca3af",
                color: "#fff",
                fontSize: 15, fontWeight: 600, cursor: "pointer",
                fontFamily: FONT, marginBottom: 8,
                transition: "background 0.2s",
              }}
            >
              {(codeCopied || copied) ? "前往爱发电" : "请先复制登录码 &#8593;"}
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

            {/* Payment terms reminder */}
            <div style={{
              fontSize: 11, color: C.t3, lineHeight: 1.6, marginBottom: 10,
              textAlign: "center",
            }}>
              付款即表示您同意：付费后不支持退款；服务有效期以所购方案为准，到期后恢复免费版。
              <a href="/terms" target="_blank" rel="noopener" style={{ color: C.blue, marginLeft: 2 }}>完整条款</a>
            </div>

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
