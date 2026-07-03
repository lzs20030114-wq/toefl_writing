"use client";

import { useState } from "react";
import { sendEmailOTP, verifyBindEmail } from "../../lib/emailAuth";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";

/* 侧栏小部件：从旧 HomeSidebar 收编的仍在使用的三个 helper。
   颜色一律走 theme token —— pro/已回复用 indigo 族，legacy/已修改用 primary 族。 */

export function FbStatusBadge({ status, hasReply }) {
  if (hasReply) return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: T.indigoSoft, color: T.indigo }}>已回复</span>;
  if (status === "resolved") return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: T.primarySoft, color: T.primaryDeep }}>已修改</span>;
  return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: T.bdrSubtle, color: T.t2 }}>处理中</span>;
}

export function TierBadge({ tier, tierExpiresAt, isChallenge }) {
  if (tier === "legacy") {
    return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: T.primarySoft, color: T.primaryDeep }}>Legacy · 不限次</span>;
  }
  if (tier === "pro") {
    let daysLeft = "";
    if (tierExpiresAt) {
      const diff = Math.ceil((new Date(tierExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      daysLeft = diff > 0 ? ` · 剩余 ${diff} 天` : " · 即将到期";
    }
    return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: T.indigoSoft, color: T.indigo }}>Pro{daysLeft}</span>;
  }
  return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: isChallenge ? "rgba(255,255,255,0.06)" : T.bdrSubtle, color: isChallenge ? CH.t2 : T.t2 }}>免费版</span>;
}

export function BindEmailModal({ userCode, onSuccess, onClose }) {
  const [step, setStep] = useState("input"); // input | otp
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSend = async () => {
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("请输入有效的邮箱地址");
      return;
    }
    setLoading(true);
    setError("");
    const { error: sendErr } = await sendEmailOTP(trimmed);
    setLoading(false);
    if (sendErr) { setError(sendErr); return; }
    setStep("otp");
  };

  const handleVerify = async () => {
    if (otp.length < 6) { setError("请输入 6 位验证码"); return; }
    setLoading(true);
    setError("");
    const { error: bindErr } = await verifyBindEmail(userCode, email.trim(), otp);
    setLoading(false);
    if (bindErr) { setError(bindErr); return; }
    onSuccess(email.trim());
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", WebkitBackdropFilter: "blur(4px)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, padding: "24px 24px 20px", width: 340, boxShadow: "0 10px 40px rgba(0,0,0,0.12)", fontFamily: HOME_FONT }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: T.t1, marginBottom: 12 }}>
          {step === "input" ? "绑定邮箱" : "输入验证码"}
        </div>

        {step === "input" ? (
          <>
            <input
              type="email"
              placeholder="输入邮箱地址"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${T.bdr}`, fontSize: 14, boxSizing: "border-box", fontFamily: HOME_FONT, outline: "none" }}
            />
            <button
              onClick={handleSend}
              disabled={loading}
              style={{ width: "100%", marginTop: 10, padding: "9px 0", borderRadius: 8, border: "none", background: loading ? "#9ca3af" : T.primary, color: "#fff", fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: HOME_FONT }}
            >
              {loading ? "发送中..." : "发送验证码"}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: T.t2, marginBottom: 10 }}>验证码已发送至 <strong>{email}</strong></div>
            <input
              type="text"
              placeholder="6 位验证码"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              maxLength={6}
              autoFocus
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${T.bdr}`, fontSize: 20, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace", letterSpacing: 8, textAlign: "center", boxSizing: "border-box", outline: "none" }}
            />
            <button
              onClick={handleVerify}
              disabled={loading}
              style={{ width: "100%", marginTop: 10, padding: "9px 0", borderRadius: 8, border: "none", background: loading ? "#9ca3af" : T.primary, color: "#fff", fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: HOME_FONT }}
            >
              {loading ? "验证中..." : "确认绑定"}
            </button>
          </>
        )}

        {error && <div style={{ marginTop: 8, fontSize: 12, color: T.rose }}>{error}</div>}

        <button
          onClick={onClose}
          style={{ width: "100%", marginTop: 8, padding: "7px 0", borderRadius: 8, border: `1px solid ${T.bdr}`, background: "#fff", color: T.t2, fontSize: 12, cursor: "pointer", fontFamily: HOME_FONT }}
        >
          取消
        </button>
      </div>
    </div>
  );
}
