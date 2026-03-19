"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { C, FONT } from "./ui";

const POLL_INTERVAL = 5000;

const PLANS = [
  { id: "pro_weekly", name: "体验卡", price: "¥9.99", duration: "7 天", tag: null },
  { id: "pro_monthly", name: "月卡", price: "¥29.99", duration: "30 天", tag: "热门" },
  { id: "pro_quarterly", name: "季卡", price: "¥69.97", duration: "90 天", tag: "推荐" },
  { id: "pro_yearly", name: "年卡", price: "¥259.88", duration: "365 天", tag: "最划算" },
];

const AFDIAN_URL = "https://ifdian.net/a/treepractice";

/**
 * Upgrade modal — supports both XorPay (in-page QR) and Afdian (redirect) flows.
 * Detects provider from /api/iap/config and renders accordingly.
 */
export default function UpgradeModal({ userCode, currentTier, onClose, onUpgraded }) {
  const isRenew = currentTier === "pro";

  // Provider detection
  const [provider, setProvider] = useState(null);
  useEffect(() => {
    fetch("/api/iap/config")
      .then((r) => r.json())
      .then((d) => setProvider(d.provider || "afdian"))
      .catch(() => setProvider("afdian"));
  }, []);

  const isXorpay = provider === "xorpay";

  // Shared state
  const [upgraded, setUpgraded] = useState(false);
  const [checking, setChecking] = useState(false);
  const pollRef = useRef(null);
  const initialExpiresRef = useRef(null);

  // XorPay state
  const [selectedPlan, setSelectedPlan] = useState("pro_quarterly");
  const [qrUrl, setQrUrl] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState(null);
  const [expiresIn, setExpiresIn] = useState(0);
  const [step, setStep] = useState("select"); // "select" | "qr" | "success"
  const expiresTimerRef = useRef(null);

  // Afdian state
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [afdianOpened, setAfdianOpened] = useState(false);

  // ── Polling logic (shared) ──
  const captureInitialState = useCallback(() => {
    if (initialExpiresRef.current !== null) return;
    fetch(`/api/auth/user-info?code=${encodeURIComponent(userCode)}`)
      .then((r) => r.json())
      .then((d) => { initialExpiresRef.current = d.tier_expires_at || ""; })
      .catch(() => { initialExpiresRef.current = ""; });
  }, [userCode]);

  const checkUpgradeStatus = useCallback(async () => {
    if (!userCode) return false;
    try {
      const res = await fetch(`/api/auth/user-info?code=${encodeURIComponent(userCode)}`);
      if (!res.ok) return false;
      const data = await res.json();
      const nowPro = data.tier === "pro" || data.tier === "legacy";
      const expiryChanged = data.tier_expires_at !== initialExpiresRef.current;
      if (nowPro && (!isRenew || expiryChanged)) {
        setUpgraded(true);
        setStep("success");
        clearInterval(pollRef.current);
        clearInterval(expiresTimerRef.current);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }, [userCode, isRenew]);

  const startPolling = useCallback(() => {
    captureInitialState();
    clearInterval(pollRef.current);
    pollRef.current = setInterval(checkUpgradeStatus, POLL_INTERVAL);
  }, [captureInitialState, checkUpgradeStatus]);

  // Visibility re-check
  useEffect(() => {
    const polling = isXorpay ? step === "qr" : afdianOpened;
    if (!polling || !userCode || upgraded) return;
    function handleVisibility() {
      if (document.visibilityState === "visible") checkUpgradeStatus();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [isXorpay, step, afdianOpened, userCode, upgraded, checkUpgradeStatus]);

  // Cleanup on unmount
  useEffect(() => () => {
    clearInterval(pollRef.current);
    clearInterval(expiresTimerRef.current);
  }, []);

  // ── XorPay: create checkout & get QR ──
  const handleXorpayPay = async (payType) => {
    setQrLoading(true);
    setQrError(null);
    try {
      const res = await fetch("/api/iap/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userCode,
          productId: selectedPlan,
          metadata: { payType },
        }),
      });
      const data = await res.json();
      if (!data.ok || !data.checkout?.qrUrl) {
        throw new Error(data.message || "Failed to create payment");
      }

      // Mobile detection: for alipay on mobile, redirect directly
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile && payType === "alipay" && data.checkout.qrUrl) {
        window.location.href = data.checkout.qrUrl;
        startPolling();
        return;
      }

      setQrUrl(data.checkout.qrUrl);
      setExpiresIn(data.checkout.expiresIn || 300);
      setStep("qr");
      startPolling();

      // Countdown timer
      clearInterval(expiresTimerRef.current);
      let remaining = data.checkout.expiresIn || 300;
      expiresTimerRef.current = setInterval(() => {
        remaining--;
        setExpiresIn(remaining);
        if (remaining <= 0) clearInterval(expiresTimerRef.current);
      }, 1000);
    } catch (e) {
      setQrError(e.message || "支付创建失败，请稍后重试");
    } finally {
      setQrLoading(false);
    }
  };

  // ── Afdian helpers ──
  const handleCopy = async () => {
    if (!userCode) return;
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* no-op */ }
  };

  const handleGoAfdian = () => {
    if (!codeCopied && !copied) {
      handleCopy().then(() => {
        setCodeCopied(true);
        window.open(AFDIAN_URL, "_blank");
        setAfdianOpened(true);
        startPolling();
      });
      return;
    }
    window.open(AFDIAN_URL, "_blank");
    setAfdianOpened(true);
    startPolling();
  };

  // ── Manual check ──
  async function handleManualCheck() {
    if (!userCode || checking) return;
    setChecking(true);
    await checkUpgradeStatus();
    setChecking(false);
  }

  // ── Close ──
  const handleClose = () => {
    clearInterval(pollRef.current);
    clearInterval(expiresTimerRef.current);
    if (upgraded && onUpgraded) onUpgraded();
    onClose();
  };

  // ── Render helpers ──
  const renderSuccess = () => (
    <>
      <div style={{ fontSize: 48, marginBottom: 12 }}>&#127881;</div>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: C.t1 }}>
        {isRenew ? "续费成功！" : "Pro 已开通！"}
      </h3>
      <p style={{ fontSize: 14, color: C.t2, marginBottom: 20, lineHeight: 1.6 }}>
        {isRenew ? "有效期已延长，继续尽情练习吧。" : "无限练习已解锁，尽情使用吧。"}
      </p>
      <button onClick={handleClose} style={btnStyle(C.blue)}>开始练习</button>
    </>
  );

  const renderFeatureHighlights = () => (
    !isRenew && (
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px",
        textAlign: "left", fontSize: 12, color: "#065f46", lineHeight: 1.6,
        background: "#ecfdf5", borderRadius: 10, padding: "10px 14px", marginBottom: 12,
      }}>
        <span>&#10003; 每日练习不限次</span>
        <span>&#10003; 完整 AI 批改报告</span>
        <span>&#10003; 修改建议与范文</span>
        <span>&#10003; 专项练习模式</span>
      </div>
    )
  );

  const renderPlanSelector = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid " + C.bdr, borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
      {PLANS.map((p, i) => {
        const selected = isXorpay && selectedPlan === p.id;
        return (
          <div
            key={p.id}
            onClick={isXorpay ? () => setSelectedPlan(p.id) : undefined}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "9px 14px", borderTop: i > 0 ? "1px solid " + C.bdrSubtle : "none",
              background: selected ? "#f0fdf4" : p.tag === "推荐" && !isXorpay ? "#f0fdf4" : "#fff",
              cursor: isXorpay ? "pointer" : "default",
              outline: selected ? "2px solid #059669" : "none",
              outlineOffset: -2,
              transition: "background 0.15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {isXorpay && (
                <span style={{
                  width: 16, height: 16, borderRadius: "50%",
                  border: selected ? "5px solid #059669" : "2px solid " + C.bdr,
                  display: "inline-block", flexShrink: 0,
                  transition: "border 0.15s",
                }} />
              )}
              <span style={{ fontSize: 13, fontWeight: 600, color: C.t1 }}>{p.name}</span>
              {p.tag && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: p.tag === "推荐" ? "#059669" : p.tag === "最划算" ? "#0891B2" : "#f59e0b", color: "#fff" }}>{p.tag}</span>}
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.t1 }}>{p.price}</span>
              <span style={{ fontSize: 11, color: C.t3, marginLeft: 4 }}>/ {p.duration}</span>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderPollingStatus = () => (
    <div style={{ marginBottom: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{
        fontSize: 12, color: C.blue,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      }}>
        <span style={{
          display: "inline-block", width: 8, height: 8, borderRadius: "50%",
          border: "2px solid " + C.blue, borderTopColor: "transparent",
          animation: "spin 1s linear infinite",
        }} />
        等待付款确认中...
      </div>
      <button onClick={handleManualCheck} disabled={checking} style={{
        padding: "8px 18px", borderRadius: 8,
        border: "1px solid " + C.bdr, background: "#fff",
        color: C.t2, fontSize: 12, fontWeight: 600,
        cursor: checking ? "not-allowed" : "pointer", fontFamily: FONT,
      }}>
        {checking ? "检查中..." : "已完成付款？点击检查"}
      </button>
    </div>
  );

  // ── XorPay flow ──
  const renderXorpayFlow = () => {
    if (step === "qr") {
      const expired = expiresIn <= 0;
      return (
        <>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "linear-gradient(135deg,#087355,#0891B2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 14px",
          }}>
            <span style={{ color: "#fff", fontSize: 22, fontWeight: 800 }}>P</span>
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: C.t1 }}>
            扫码支付
          </h3>

          {expired ? (
            <div style={{ padding: "20px 0", textAlign: "center" }}>
              <p style={{ fontSize: 14, color: C.t2, marginBottom: 12 }}>二维码已过期</p>
              <button onClick={() => { setStep("select"); setQrUrl(null); }} style={btnStyle(C.blue)}>
                重新选择
              </button>
            </div>
          ) : (
            <>
              <div style={{
                background: "#fff", border: "1px solid " + C.bdr, borderRadius: 12,
                padding: 16, display: "flex", flexDirection: "column", alignItems: "center",
                marginBottom: 12,
              }}>
                <QRCodeSVG value={qrUrl} size={200} level="M" />
                <div style={{ marginTop: 10, fontSize: 12, color: C.t3 }}>
                  请使用手机扫描二维码完成支付
                </div>
              </div>
              <div style={{
                fontSize: 13, color: expiresIn <= 60 ? C.red : C.t2,
                textAlign: "center", marginBottom: 12, fontWeight: 600,
              }}>
                {Math.floor(expiresIn / 60)}:{String(expiresIn % 60).padStart(2, "0")} 后过期
              </div>
            </>
          )}

          {!expired && renderPollingStatus()}

          <button onClick={() => { setStep("select"); setQrUrl(null); clearInterval(expiresTimerRef.current); }} style={{
            width: "100%", padding: "10px 0", borderRadius: 10,
            border: "1px solid " + C.bdr, background: "#fff",
            color: C.t2, fontSize: 14, cursor: "pointer", fontFamily: FONT, marginTop: 4,
          }}>
            返回选择
          </button>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      );
    }

    // Step: select plan + payment method
    return (
      <>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: "linear-gradient(135deg,#087355,#0891B2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 14px",
        }}>
          <span style={{ color: "#fff", fontSize: 22, fontWeight: 800 }}>P</span>
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, color: C.t1 }}>
          {isRenew ? "续费 Pro" : "升级 Pro"}
        </h3>

        {renderFeatureHighlights()}

        {isRenew && (
          <p style={{ fontSize: 14, color: C.t2, marginBottom: 16, lineHeight: 1.6 }}>
            续费后有效期将自动延长，在当前到期日基础上叠加。
          </p>
        )}

        {renderPlanSelector()}

        {qrError && (
          <div style={{ fontSize: 13, color: C.red, marginBottom: 10, textAlign: "center" }}>
            {qrError}
          </div>
        )}

        {/* Payment method buttons */}
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <button
            onClick={() => handleXorpayPay("alipay")}
            disabled={qrLoading}
            style={{
              ...btnStyle("#1677FF"),
              flex: 1,
              opacity: qrLoading ? 0.6 : 1,
            }}
          >
            {qrLoading ? "创建中..." : "支付宝"}
          </button>
          <button
            onClick={() => handleXorpayPay("native")}
            disabled={qrLoading}
            style={{
              ...btnStyle("#07C160"),
              flex: 1,
              opacity: qrLoading ? 0.6 : 1,
            }}
          >
            {qrLoading ? "创建中..." : "微信支付"}
          </button>
        </div>

        <div style={{ fontSize: 11, color: C.t3, lineHeight: 1.6, marginBottom: 10, textAlign: "center" }}>
          付款即表示您同意：付费后不支持退款；服务有效期以所购方案为准，到期后恢复免费版。
          <a href="/terms" target="_blank" rel="noopener" style={{ color: C.blue, marginLeft: 2 }}>完整条款</a>
        </div>

        <button onClick={handleClose} style={{
          width: "100%", padding: "10px 0", borderRadius: 10,
          border: "1px solid " + C.bdr, background: "#fff",
          color: C.t2, fontSize: 14, cursor: "pointer", fontFamily: FONT,
        }}>
          取消
        </button>
      </>
    );
  };

  // ── Afdian flow (original) ──
  const renderAfdianFlow = () => (
    <>
      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: "linear-gradient(135deg,#087355,#0891B2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 14px",
      }}>
        <span style={{ color: "#fff", fontSize: 22, fontWeight: 800 }}>P</span>
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, color: C.t1 }}>
        {isRenew ? "续费 Pro" : "升级 Pro"}
      </h3>

      {renderFeatureHighlights()}

      {!isRenew && (
        <>
          {renderPlanSelector()}
          <div style={{ fontSize: 11, color: C.t3, marginBottom: 10, textAlign: "center" }}>
            在爱发电选择对应金额的赞助方案即可
          </div>
        </>
      )}

      {isRenew && (
        <p style={{ fontSize: 14, color: C.t2, marginBottom: 16, lineHeight: 1.6 }}>
          续费后有效期将自动延长，在当前到期日基础上叠加。
        </p>
      )}

      {/* User code */}
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

      {/* Steps */}
      <div style={{
        fontSize: 12, color: C.t2, lineHeight: 1.8, marginBottom: 14,
        textAlign: "left", padding: "0 4px",
      }}>
        <span style={{ fontWeight: 600, color: C.t1 }}>步骤：</span>
        复制登录码 &#8594; 前往爱发电赞助 &#8594; <span style={{ color: "#dc2626", fontWeight: 700 }}>留言栏粘贴登录码</span> &#8594; 付款后回此页自动开通
      </div>

      {/* CTA */}
      <button onClick={handleGoAfdian} style={{
        ...btnStyle((codeCopied || copied) ? C.blue : "#9ca3af"),
        marginBottom: 8,
      }}>
        {(codeCopied || copied) ? "前往爱发电" : "请先复制登录码 &#8593;"}
      </button>

      {afdianOpened && (
        <>
          {renderPollingStatus()}
          <div style={{ fontSize: 11, color: C.t3, lineHeight: 1.5, textAlign: "center", marginBottom: 8 }}>
            付款后请返回此页面，状态会自动更新。
          </div>
        </>
      )}

      <div style={{
        fontSize: 11, color: C.t3, lineHeight: 1.6, marginBottom: 10,
        textAlign: "center",
      }}>
        付款即表示您同意：付费后不支持退款；服务有效期以所购方案为准，到期后恢复免费版。
        <a href="/terms" target="_blank" rel="noopener" style={{ color: C.blue, marginLeft: 2 }}>完整条款</a>
      </div>

      <button onClick={handleClose} style={{
        width: "100%", padding: "10px 0", borderRadius: 10,
        border: "1px solid " + C.bdr, background: "#fff",
        color: C.t2, fontSize: 14, cursor: "pointer", fontFamily: FONT,
      }}>
        取消
      </button>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );

  // ── Main render ──
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
          background: "#fff", borderRadius: 16, padding: "28px 24px",
          maxWidth: 400, width: "90%", textAlign: "center",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
          maxHeight: "90vh", overflowY: "auto", WebkitOverflowScrolling: "touch",
        }}
      >
        {upgraded || step === "success"
          ? renderSuccess()
          : provider === null
            ? <div style={{ padding: 20, color: C.t3, fontSize: 14 }}>加载中...</div>
            : isXorpay
              ? renderXorpayFlow()
              : renderAfdianFlow()
        }
      </div>
    </div>,
    document.body
  );
}

function btnStyle(bg) {
  return {
    width: "100%", padding: "13px 0", borderRadius: 10,
    border: "none", background: bg, color: "#fff",
    fontSize: 15, fontWeight: 600, cursor: "pointer",
    fontFamily: FONT, transition: "background 0.2s",
  };
}
