"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { verifyCode } from "../lib/authCode";
import { sendEmailOTP, verifyEmailOTP, signOut } from "../lib/emailAuth";
import { clearAuth, getSavedCode, saveAuth } from "../lib/AuthContext";
import { clearLocalSessions, getLocalSessionCount, importLocalSessionsToCloud } from "../lib/sessionStore";
import { isSupabaseConfigured } from "../lib/supabase";
import { C, FONT } from "./shared/ui";

const UI_LANG_KEY = "toefl-ui-lang";
const IMPORT_DISMISSED_KEY = "toefl-import-dismissed";

const I18N = {
  zh: {
    checking: "验证登录状态...",
    emailTab: "邮箱登录",
    codeTab: "登录码",
    emailPlaceholder: "输入邮箱地址",
    sendOtp: "发送验证码",
    sendingOtp: "发送中...",
    emailHelper: "免费用户每日 3 次练习机会",
    emailAutoRegister: "未注册的邮箱将自动创建账户",
    codePlaceholder: "输入 6 位登录码",
    login: "登录",
    loggingIn: "登录中...",
    codeHelper: "在小红书购买的登录码请在此输入",
    otpTitle: "验证邮箱",
    otpSentTo: "验证码已发送至",
    otpPlaceholder: "输入 6 位验证码",
    otpVerify: "确认",
    otpVerifying: "验证中...",
    otpBack: "返回",
    otpHelper: "没收到？请检查垃圾邮件，或等待 1 分钟后重试",
    resendOtp: "重新发送",
    invalidEmail: "请输入邮箱",
    invalidEmailFormat: "邮箱格式不正确",
    invalidCode: "请输入 6 位登录码",
    invalidOtp: "请输入 6 位验证码",
    modalTitle: "登录后开始练习",
    modalSubtitle: "免费用户每日 3 次练习，登录码 / Pro 用户不限次",
    importPrefix: "检测到本设备有",
    importSuffix: "条旧练习记录，是否导入到当前云端账户？",
    import: "导入",
    importing: "导入中...",
    skip: "跳过",
    dismiss: "不再提示",
    dismissConfirmTitle: "删除本地记录？",
    dismissConfirmBody: "将清除本设备上的旧练习记录，并不再显示此提示。此操作不可恢复。",
    dismissConfirmOk: "确认删除",
    dismissConfirmCancel: "取消",
  },
  en: {
    checking: "Checking login status...",
    emailTab: "Email",
    codeTab: "Access Code",
    emailPlaceholder: "Enter email address",
    sendOtp: "Send Code",
    sendingOtp: "Sending...",
    emailHelper: "Free users get 3 daily sessions",
    emailAutoRegister: "Unregistered emails will be auto-enrolled",
    codePlaceholder: "Enter 6-character code",
    login: "Sign In",
    loggingIn: "Signing in...",
    codeHelper: "Enter the code purchased from Xiaohongshu",
    otpTitle: "Verify Email",
    otpSentTo: "Verification code sent to",
    otpPlaceholder: "Enter 6-digit code",
    otpVerify: "Verify",
    otpVerifying: "Verifying...",
    otpBack: "Back",
    otpHelper: "Didn't receive it? Check spam, or wait 1 minute to retry",
    resendOtp: "Resend",
    invalidEmail: "Please enter an email",
    invalidEmailFormat: "Invalid email format",
    invalidCode: "Please enter a 6-character code",
    invalidOtp: "Please enter a 6-digit code",
    modalTitle: "Sign in to start practicing",
    modalSubtitle: "Free users get 3 daily sessions. Code / Pro users get unlimited access.",
    importPrefix: "Found",
    importSuffix: "local practice records on this device. Import to this cloud account?",
    import: "Import",
    importing: "Importing...",
    skip: "Skip",
    dismiss: "Don't ask again",
    dismissConfirmTitle: "Delete local records?",
    dismissConfirmBody: "This will permanently delete the old practice records on this device and hide this prompt forever.",
    dismissConfirmOk: "Delete & Dismiss",
    dismissConfirmCancel: "Cancel",
  },
};

function normalizeInputCode(v) {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function ImportPrompt({ t, count, onImport, onSkip, onDismiss, loading }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13, color: "#7c2d12" }}>
        <div style={{ marginBottom: 8 }}>
          {t.importPrefix} {count} {t.importSuffix}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onImport} disabled={loading} style={{ border: "1px solid #fdba74", background: "#ffedd5", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontFamily: FONT }}>
            {loading ? t.importing : t.import}
          </button>
          <button onClick={onSkip} disabled={loading} style={{ border: "1px solid #fdba74", background: "#fff", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontFamily: FONT }}>
            {t.skip}
          </button>
          <button onClick={() => setConfirmOpen(true)} disabled={loading} style={{ border: "none", background: "none", color: "#9a3412", fontSize: 12, padding: "6px 4px", cursor: "pointer", textDecoration: "underline", fontFamily: FONT }}>
            {t.dismiss}
          </button>
        </div>
      </div>

      {confirmOpen && (
        <div
          onClick={() => setConfirmOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 12, padding: "24px 24px 20px", width: 320, boxShadow: "0 10px 40px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", gap: 14, fontFamily: FONT }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.t1, marginBottom: 6 }}>{t.dismissConfirmTitle}</div>
              <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.6 }}>{t.dismissConfirmBody}</div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmOpen(false)} style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid " + C.bdr, background: "#fff", color: C.t2, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
                {t.dismissConfirmCancel}
              </button>
              <button
                onClick={() => { setConfirmOpen(false); onDismiss(); }}
                style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: C.red, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}
              >
                {t.dismissConfirmOk}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════
// Login Modal — renders as a portal overlay
// ═══════════════════════════════════════════
function LoginModal({ t, onClose, onLoginSuccess }) {
  const [activeTab, setActiveTab] = useState("email");
  const [emailInput, setEmailInput] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleSendOTP = async () => {
    const email = emailInput.trim();
    if (!email) { setError(t.invalidEmail); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError(t.invalidEmailFormat); return; }
    setLoading(true);
    setError("");
    const { error: sendError } = await sendEmailOTP(email);
    setLoading(false);
    if (sendError) { setError(sendError); return; }
    setOtpSent(true);
    setResendCooldown(60);
  };

  const handleResendOTP = async () => {
    if (resendCooldown > 0) return;
    const email = emailInput.trim();
    if (!email) return;
    setLoading(true);
    setError("");
    const { error: sendError } = await sendEmailOTP(email);
    setLoading(false);
    if (sendError) { setError(sendError); return; }
    setResendCooldown(60);
  };

  const handleVerifyOTP = async () => {
    if (otpInput.length < 6) { setError(t.invalidOtp); return; }
    setLoading(true);
    setError("");
    const { userCode: code, tier, email, auth_method, isNewUser, error: verifyError } = await verifyEmailOTP(emailInput.trim(), otpInput);
    setLoading(false);
    if (verifyError) { setError(verifyError); return; }
    onLoginSuccess({ code, tier, email: email || emailInput.trim(), auth_method: auth_method || "email", isNewUser });
  };

  const handleCodeLogin = async () => {
    const normalized = normalizeInputCode(codeInput);
    if (normalized.length < 6) { setError(t.invalidCode); return; }
    setLoading(true);
    setError("");
    const { valid, error: verifyError, tier, email, auth_method } = await verifyCode(normalized);
    setLoading(false);
    if (!valid) { setError(verifyError || t.invalidCode); return; }
    onLoginSuccess({ code: normalized, tier, email, auth_method: auth_method || "code" });
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: FONT }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 440, background: "#fff", border: "1px solid " + C.bdr, borderRadius: 14, padding: "28px 24px 24px", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}
      >
        {/* ── Header ── */}
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.t1, marginBottom: 4 }}>{t.modalTitle}</div>
          <div style={{ fontSize: 12, color: C.t2 }}>{t.modalSubtitle}</div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "2px solid " + C.bdrSubtle, marginBottom: 18 }}>
          {[
            { key: "email", label: t.emailTab },
            { key: "code", label: t.codeTab },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setActiveTab(key); setError(""); }}
              style={{
                flex: 1, padding: "9px 0", border: "none", background: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 600, fontFamily: FONT,
                color: activeTab === key ? C.blue : C.t3,
                borderBottom: activeTab === key ? "2px solid " + C.blue : "2px solid transparent",
                marginBottom: -2, transition: "all 0.2s",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Email Tab — single view: email + OTP + resend */}
        {activeTab === "email" && (
          <div>
            {/* Email input + send button */}
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="email"
                placeholder={t.emailPlaceholder}
                value={emailInput}
                onChange={(e) => { setEmailInput(e.target.value); if (otpSent) { setOtpSent(false); setOtpInput(""); } }}
                onKeyDown={(e) => e.key === "Enter" && (!otpSent ? handleSendOTP() : handleVerifyOTP())}
                autoFocus
                style={{ flex: 1, padding: "11px 12px", fontSize: 14, borderRadius: 10, border: "1.5px solid " + C.bdr, outline: "none", boxSizing: "border-box", fontFamily: FONT }}
              />
              <button
                onClick={otpSent ? handleResendOTP : handleSendOTP}
                disabled={loading || resendCooldown > 0}
                style={{
                  flexShrink: 0, padding: "0 14px", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 600, fontFamily: FONT,
                  background: (loading || resendCooldown > 0) ? "#e5e7eb" : C.blue,
                  color: (loading || resendCooldown > 0) ? C.t3 : "#fff",
                  cursor: (loading || resendCooldown > 0) ? "default" : "pointer",
                  whiteSpace: "nowrap", minWidth: 90,
                }}
              >
                {loading && !otpSent ? t.sendingOtp : resendCooldown > 0 ? `${resendCooldown}s` : otpSent ? t.resendOtp : t.sendOtp}
              </button>
            </div>

            {/* OTP input — appears after sending */}
            {otpSent && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: C.t2, marginBottom: 6 }}>{t.otpSentTo} <strong>{emailInput.trim()}</strong></div>
                <input
                  type="text"
                  placeholder={t.otpPlaceholder}
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => e.key === "Enter" && handleVerifyOTP()}
                  maxLength={6}
                  autoFocus
                  style={{ width: "100%", padding: 10, fontSize: 22, borderRadius: 10, border: "1.5px solid " + C.bdr, outline: "none", boxSizing: "border-box", fontFamily: "monospace", letterSpacing: 8, textAlign: "center" }}
                />
                <button
                  onClick={handleVerifyOTP}
                  disabled={loading}
                  style={{ width: "100%", marginTop: 10, padding: "11px 0", borderRadius: 10, border: "none", background: loading ? "#9ca3af" : C.blue, color: "#fff", fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontFamily: FONT }}
                >
                  {loading ? t.otpVerifying : t.login}
                </button>
              </div>
            )}

            <p style={{ fontSize: 11, color: C.t3, textAlign: "center", marginTop: 10 }}>{t.emailHelper}</p>
            <p style={{ fontSize: 11, color: C.t3, textAlign: "center", marginTop: 4 }}>{t.emailAutoRegister}</p>
          </div>
        )}

        {/* Code Tab */}
        {activeTab === "code" && (
          <div>
            <input
              data-testid="login-code-input"
              type="text"
              placeholder={t.codePlaceholder}
              value={codeInput}
              onChange={(e) => setCodeInput(normalizeInputCode(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && handleCodeLogin()}
              maxLength={6}
              autoFocus
              style={{ width: "100%", padding: "11px 12px", fontSize: 24, borderRadius: 10, border: "1.5px solid " + C.bdr, outline: "none", boxSizing: "border-box", fontFamily: "monospace", letterSpacing: 8, textAlign: "center", textTransform: "uppercase" }}
            />
            <button
              onClick={handleCodeLogin}
              disabled={loading}
              style={{ width: "100%", marginTop: 12, padding: "11px 0", borderRadius: 10, border: "none", background: loading ? "#9ca3af" : C.blue, color: "#fff", fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontFamily: FONT }}
            >
              {loading ? t.loggingIn : t.login}
            </button>
            <p style={{ fontSize: 11, color: C.t3, textAlign: "center", marginTop: 10 }}>{t.codeHelper}</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ marginTop: 10, color: C.red, fontSize: 12, padding: "7px 10px", background: "#fff5f5", borderRadius: 8, textAlign: "center" }}>
            {error}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ═══════════════════════════════════════════
// LoginGate — always renders children,
// provides showLoginModal for on-demand login
// ═══════════════════════════════════════════
export default function LoginGate({ children }) {
  const initialLang = (() => {
    if (typeof window === "undefined") return "zh";
    const saved = localStorage.getItem(UI_LANG_KEY);
    return saved === "en" ? "en" : "zh";
  })();

  const [lang] = useState(initialLang);
  const t = I18N[lang];
  const [ready, setReady] = useState(false);
  const [userCode, setUserCode] = useState(null);
  const [userTier, setUserTier] = useState("free");
  const [userEmail, setUserEmail] = useState(null);
  const [authMethod, setAuthMethod] = useState("code");
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  // Import prompt
  const [showImportPrompt, setShowImportPrompt] = useState(false);
  const [importing, setImporting] = useState(false);

  const isLoggedIn = !!userCode;

  // ── Initialization: try to restore session silently ──
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }

    const saved = getSavedCode();
    if (saved) {
      verifyCode(saved).then(({ valid, tier, email, auth_method }) => {
        if (valid) {
          const normalized = normalizeInputCode(saved);
          setUserCode(normalized);
          setUserTier(tier || "free");
          setUserEmail(email || null);
          setAuthMethod(auth_method || "code");
          saveAuth(normalized, { authMethod: auth_method, tier, email });
          setShowImportPrompt(
            (() => { try { return localStorage.getItem(IMPORT_DISMISSED_KEY) !== "1"; } catch { return true; } })()
            && getLocalSessionCount() > 0
          );
        } else {
          clearAuth();
        }
        setReady(true);
      });
    } else {
      setReady(true);
    }
  }, []);

  // ── Auto-open login modal if ?login=1 in URL ──
  useEffect(() => {
    if (!ready || isLoggedIn) return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("login") === "1") {
        setLoginModalOpen(true);
        // Clean up URL
        const url = new URL(window.location.href);
        url.searchParams.delete("login");
        window.history.replaceState({}, "", url.pathname + url.search);
      }
    } catch { /* no-op */ }
  }, [ready, isLoggedIn]);

  // ── Welcome toast ──
  const [welcomeMsg, setWelcomeMsg] = useState(null);

  // ── Login success callback ──
  function handleLoginSuccess({ code, tier, email, auth_method, isNewUser }) {
    saveAuth(code, { authMethod: auth_method, tier, email });
    setUserCode(code);
    setUserTier(tier || "free");
    setUserEmail(email || null);
    setAuthMethod(auth_method || "code");
    setLoginModalOpen(false);
    setShowImportPrompt(
      (() => { try { return localStorage.getItem(IMPORT_DISMISSED_KEY) !== "1"; } catch { return true; } })()
      && getLocalSessionCount() > 0
    );
    if (isNewUser) {
      setWelcomeMsg("欢迎！已为你自动创建账户");
      setTimeout(() => setWelcomeMsg(null), 4000);
    }
  }

  // ── Logout ──
  const handleLogout = async () => {
    clearAuth();
    await signOut();
    setUserCode(null);
    setUserTier("free");
    setUserEmail(null);
    setAuthMethod("code");
    setShowImportPrompt(false);
  };

  // ── Show login modal ──
  const showLoginModal = () => setLoginModalOpen(true);

  // ── Import ──
  const handleDismiss = () => {
    clearLocalSessions();
    try { localStorage.setItem(IMPORT_DISMISSED_KEY, "1"); } catch { /* no-op */ }
    setShowImportPrompt(false);
  };

  const handleImport = async () => {
    setImporting(true);
    const { error: importError } = await importLocalSessionsToCloud();
    setImporting(false);
    if (importError) return;
    setShowImportPrompt(false);
  };

  // Don't render until we've checked saved auth (prevents flash)
  if (!ready) return null;

  if (typeof children === "function") {
    return (
      <>
        {showImportPrompt && isLoggedIn ? (
          <div style={{ maxWidth: 760, margin: "12px auto 0", padding: "0 20px" }}>
            <ImportPrompt t={t} count={getLocalSessionCount()} onImport={handleImport} onSkip={() => setShowImportPrompt(false)} onDismiss={handleDismiss} loading={importing} />
          </div>
        ) : null}
        {loginModalOpen && (
          <LoginModal
            t={t}
            onClose={() => setLoginModalOpen(false)}
            onLoginSuccess={handleLoginSuccess}
          />
        )}
        {welcomeMsg && (
          <div style={{ position: "fixed", top: 64, left: "50%", transform: "translateX(-50%)", background: C.blue, color: "#fff", padding: "10px 24px", borderRadius: 10, fontSize: 14, fontWeight: 600, zIndex: 10001, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", fontFamily: FONT }}>
            {welcomeMsg}
          </div>
        )}
        {children({
          userCode,
          userTier,
          userEmail,
          authMethod,
          isLoggedIn,
          showLoginModal,
          onLogout: handleLogout,
        })}
      </>
    );
  }
  return children;
}
