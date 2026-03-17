"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { verifyCode } from "../lib/authCode";
import { sendEmailOTP, verifyEmailOTP, signInWithPassword, setPassword, signOut } from "../lib/emailAuth";
import { clearAuth, getSavedCode, getSavedTier, getSavedEmail, getSavedAuthMethod, getSavedHasPassword, saveAuth } from "../lib/AuthContext";
import { clearLocalSessions, getLocalSessionCount, importLocalSessionsToCloud } from "../lib/sessionStore";
import { isSupabaseConfigured } from "../lib/supabase";
import { usePageView } from "../lib/usePageView";
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
    otpHelper: "没收到？请检查垃圾箱/广告邮件，或等 1 分钟后重新发送",
    otpContactFallback: "仍然收不到？请联系 3582786720@qq.com 获取帮助",
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
    // Password-related
    passwordPlaceholder: "输入密码",
    forgotPassword: "忘记密码？",
    otpFallback: "用验证码登录",
    backToPassword: "用密码登录",
    setPasswordTitle: "设置密码",
    setPasswordSubtitle: "设置密码后，下次可以直接用密码登录，无需验证码",
    newPasswordPlaceholder: "设置密码（至少 8 位）",
    confirmPasswordPlaceholder: "确认密码",
    setPasswordBtn: "设置密码",
    settingPassword: "设置中...",
    passwordTooShort: "密码至少 8 位",
    passwordMismatch: "两次输入的密码不一致",
    passwordLoginFailed: "邮箱或密码不正确",
    firstTimeHint: "首次登录请用验证码登录，登录后自动注册",
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
    otpHelper: "Didn't receive it? Check spam/junk folder, or wait 1 min to resend",
    otpContactFallback: "Still not arriving? Contact 3582786720@qq.com for help",
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
    // Password-related
    passwordPlaceholder: "Enter password",
    forgotPassword: "Forgot password?",
    otpFallback: "Sign in with code",
    backToPassword: "Sign in with password",
    setPasswordTitle: "Set Password",
    setPasswordSubtitle: "Set a password so you can sign in directly next time without email verification",
    newPasswordPlaceholder: "New password (min 8 chars)",
    confirmPasswordPlaceholder: "Confirm password",
    setPasswordBtn: "Set Password",
    settingPassword: "Setting...",
    passwordTooShort: "Password must be at least 8 characters",
    passwordMismatch: "Passwords do not match",
    passwordLoginFailed: "Incorrect email or password",
    firstTimeHint: "First time? Use email verification to sign up automatically",
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

// ── Password visibility toggle icon ──
function EyeIcon({ visible, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={-1}
      style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, color: C.t3, display: "flex", alignItems: "center" }}
    >
      {visible ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      )}
    </button>
  );
}

// ═══════════════════════════════════════════
// Login Modal — renders as a portal overlay
// ═══════════════════════════════════════════
function LoginModal({ t, onClose, onLoginSuccess }) {
  // view: "password" | "otp" | "forgot" | "setPassword"
  const [view, setView] = useState("password");
  const [activeTab, setActiveTab] = useState("email");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  // Pending login data — held while user sets password
  const [pendingLogin, setPendingLogin] = useState(null);

  // Mobile compact mode — reduce spacing to fit one screen
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const check = () => setCompact(window.innerHeight < 700 || window.innerWidth < 500);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Spacing values — compact for mobile
  const s = compact
    ? { overlay: 10, box: "16px 14px 14px", hd: 8, hdFont: 15, tab: 10, tabPad: "7px 0", inp: "9px 10px", inpFont: 13, btnMt: 6, btnPad: "9px 0", link: 6, help: 6, terms: 6, gap: 6 }
    : { overlay: 20, box: "28px 24px 24px", hd: 16, hdFont: 18, tab: 18, tabPad: "9px 0", inp: "11px 12px", inpFont: 14, btnMt: 10, btnPad: "11px 0", link: 12, help: 10, terms: 14, gap: 10 };

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // ── Password login ──
  const handlePasswordLogin = async () => {
    if (!agreedTerms) { setError(t === I18N.zh ? "请先同意使用条款" : "Please agree to the terms first"); return; }
    const email = emailInput.trim();
    if (!email) { setError(t.invalidEmail); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError(t.invalidEmailFormat); return; }
    if (!passwordInput) { setError(t.passwordTooShort); return; }
    setLoading(true);
    setError("");
    const result = await signInWithPassword(email, passwordInput);
    setLoading(false);
    if (result.error) { setError(t.passwordLoginFailed); return; }
    if (!result.has_password) {
      // Need to set password (shouldn't happen for password login, but handle edge case)
      setPendingLogin(result);
      setView("setPassword");
      return;
    }
    onLoginSuccess({ code: result.userCode, tier: result.tier, email: result.email, auth_method: result.auth_method, has_password: true });
  };

  // ── OTP flow (used in "otp" and "forgot" views) ──
  const handleSendOTP = async () => {
    if (view !== "forgot" && !agreedTerms) { setError(t === I18N.zh ? "请先同意使用条款" : "Please agree to the terms first"); return; }
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
    const { userCode: code, tier, email, auth_method, has_password, isNewUser, error: verifyError } = await verifyEmailOTP(emailInput.trim(), otpInput);
    setLoading(false);
    if (verifyError) { setError(verifyError); return; }

    if (view === "forgot") {
      // After verifying OTP in forgot flow, go to set password
      setPendingLogin({ userCode: code, tier, email: email || emailInput.trim(), auth_method: auth_method || "email" });
      setView("setPassword");
      return;
    }

    if (!has_password) {
      // Force password setup
      setPendingLogin({ userCode: code, tier, email: email || emailInput.trim(), auth_method: auth_method || "email", isNewUser });
      setView("setPassword");
      return;
    }
    onLoginSuccess({ code, tier, email: email || emailInput.trim(), auth_method: auth_method || "email", has_password: true, isNewUser });
  };

  // ── Set password ──
  const handleSetPassword = async () => {
    if (newPassword.length < 8) { setError(t.passwordTooShort); return; }
    if (newPassword !== confirmPassword) { setError(t.passwordMismatch); return; }
    setLoading(true);
    setError("");
    const { error: pwError } = await setPassword(newPassword);
    setLoading(false);
    if (pwError) { setError(pwError); return; }
    // Complete login
    if (pendingLogin) {
      onLoginSuccess({ code: pendingLogin.userCode, tier: pendingLogin.tier, email: pendingLogin.email, auth_method: pendingLogin.auth_method, has_password: true, isNewUser: pendingLogin.isNewUser });
    }
  };

  // ── Code login (unchanged) ──
  const handleCodeLogin = async () => {
    if (!agreedTerms) { setError(t === I18N.zh ? "请先同意使用条款" : "Please agree to the terms first"); return; }
    const normalized = normalizeInputCode(codeInput);
    if (normalized.length < 6) { setError(t.invalidCode); return; }
    setLoading(true);
    setError("");
    const { valid, error: verifyError, tier, email, auth_method } = await verifyCode(normalized);
    setLoading(false);
    if (!valid) { setError(verifyError || t.invalidCode); return; }
    onLoginSuccess({ code: normalized, tier, email, auth_method: auth_method || "code" });
  };

  // ── Switch view helpers ──
  const goToOtp = () => { setView("otp"); setError(""); setOtpSent(false); setOtpInput(""); };
  const goToPassword = () => { setView("password"); setError(""); setPasswordInput(""); };
  const goToForgot = () => { setView("forgot"); setError(""); setOtpSent(false); setOtpInput(""); };

  // ── Shared input style ──
  const inputStyle = { width: "100%", padding: s.inp, fontSize: s.inpFont, borderRadius: 10, border: "1.5px solid " + C.bdr, outline: "none", boxSizing: "border-box", fontFamily: FONT };
  const passwordInputStyle = { ...inputStyle, paddingRight: 40 };
  const btnStyle = (disabled) => ({ width: "100%", marginTop: s.btnMt, padding: s.btnPad, borderRadius: 10, border: "none", background: disabled ? "#9ca3af" : C.blue, color: "#fff", fontSize: s.inpFont, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", fontFamily: FONT });

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: s.overlay, fontFamily: FONT }}
    >
      <div
        className="tp-modal-body"
        style={{ position: "relative", width: "100%", maxWidth: 440, background: "#fff", border: "1px solid " + C.bdr, borderRadius: 14, padding: s.box, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", cursor: "pointer", padding: 4, color: C.t3, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        {/* ── Header ── */}
        <div style={{ textAlign: "center", marginBottom: s.hd }}>
          <div style={{ fontSize: s.hdFont, fontWeight: 700, color: C.t1, marginBottom: compact ? 2 : 4 }}>
            {view === "setPassword" ? t.setPasswordTitle : t.modalTitle}
          </div>
          {!compact && (
            <div style={{ fontSize: 12, color: C.t2 }}>
              {view === "setPassword" ? t.setPasswordSubtitle : t.modalSubtitle}
            </div>
          )}
          {view !== "setPassword" && (
            <div style={{ fontSize: 11, color: C.t3, marginTop: compact ? 2 : 6 }}>
              {t.firstTimeHint}
            </div>
          )}
        </div>

        {/* ═══ Set Password View ═══ */}
        {view === "setPassword" && (
          <div>
            <div style={{ position: "relative", marginBottom: s.gap }}>
              <input
                type={showNewPassword ? "text" : "password"}
                placeholder={t.newPasswordPlaceholder}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && document.getElementById("confirm-pw")?.focus()}
                autoFocus
                style={passwordInputStyle}
              />
              <EyeIcon visible={showNewPassword} onClick={() => setShowNewPassword(!showNewPassword)} />
            </div>
            <div style={{ position: "relative" }}>
              <input
                id="confirm-pw"
                type={showNewPassword ? "text" : "password"}
                placeholder={t.confirmPasswordPlaceholder}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSetPassword()}
                style={passwordInputStyle}
              />
            </div>
            <button onClick={handleSetPassword} disabled={loading} style={btnStyle(loading)}>
              {loading ? t.settingPassword : t.setPasswordBtn}
            </button>
          </div>
        )}

        {/* ═══ Password View (default) ═══ */}
        {view === "password" && activeTab === "email" && (
          <div>
            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: "2px solid " + C.bdrSubtle, marginBottom: s.tab }}>
              {[
                { key: "email", label: t.emailTab },
                { key: "code", label: t.codeTab },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setActiveTab(key); setError(""); }}
                  style={{
                    flex: 1, padding: s.tabPad, border: "none", background: "none", cursor: "pointer",
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

            <input
              type="email"
              placeholder={t.emailPlaceholder}
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && document.getElementById("pw-input")?.focus()}
              autoFocus
              style={{ ...inputStyle, marginBottom: s.gap }}
            />
            <div style={{ position: "relative" }}>
              <input
                id="pw-input"
                type={showPassword ? "text" : "password"}
                placeholder={t.passwordPlaceholder}
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handlePasswordLogin()}
                style={passwordInputStyle}
              />
              <EyeIcon visible={showPassword} onClick={() => setShowPassword(!showPassword)} />
            </div>
            <button onClick={handlePasswordLogin} disabled={loading} style={btnStyle(loading)}>
              {loading ? t.loggingIn : t.login}
            </button>

            {/* Links row */}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: s.link }}>
              <button onClick={goToForgot} style={{ background: "none", border: "none", color: C.t3, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: FONT }}>
                {t.forgotPassword}
              </button>
              <button onClick={goToOtp} style={{ background: "none", border: "none", color: C.blue, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: FONT }}>
                {t.otpFallback}
              </button>
            </div>

            {!compact && <p style={{ fontSize: 12, color: C.t3, textAlign: "center", marginTop: s.help, marginBottom: 0 }}>{t.emailHelper}</p>}
          </div>
        )}

        {/* ═══ Code Tab (inside password view) ═══ */}
        {view === "password" && activeTab === "code" && (
          <div>
            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: "2px solid " + C.bdrSubtle, marginBottom: s.tab }}>
              {[
                { key: "email", label: t.emailTab },
                { key: "code", label: t.codeTab },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setActiveTab(key); setError(""); }}
                  style={{
                    flex: 1, padding: s.tabPad, border: "none", background: "none", cursor: "pointer",
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

            <input
              data-testid="login-code-input"
              type="text"
              placeholder={t.codePlaceholder}
              value={codeInput}
              onChange={(e) => setCodeInput(normalizeInputCode(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && handleCodeLogin()}
              maxLength={6}
              autoFocus
              style={{ width: "100%", padding: s.inp, fontSize: 16, borderRadius: 10, border: "1.5px solid " + C.bdr, outline: "none", boxSizing: "border-box", fontFamily: "monospace", letterSpacing: 6, textAlign: "center", textTransform: "uppercase" }}
            />
            <button onClick={handleCodeLogin} disabled={loading} style={btnStyle(loading)}>
              {loading ? t.loggingIn : t.login}
            </button>
            {!compact && <p style={{ fontSize: 12, color: C.t3, textAlign: "center", marginTop: s.help, marginBottom: 0 }}>{t.codeHelper}</p>}
          </div>
        )}

        {/* ═══ OTP View ═══ */}
        {view === "otp" && (
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
                style={{ flex: 1, ...inputStyle }}
              />
              <button
                onClick={otpSent ? handleResendOTP : handleSendOTP}
                disabled={loading || resendCooldown > 0}
                style={{
                  flexShrink: 0, padding: "0 14px", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 600, fontFamily: FONT,
                  background: (loading || resendCooldown > 0) ? "#e5e7eb" : C.blue,
                  color: (loading || resendCooldown > 0) ? C.t3 : "#fff",
                  cursor: (loading || resendCooldown > 0) ? "default" : "pointer",
                  whiteSpace: "nowrap", minWidth: compact ? 76 : 90,
                }}
              >
                {loading && !otpSent ? t.sendingOtp : resendCooldown > 0 ? `${resendCooldown}s` : otpSent ? t.resendOtp : t.sendOtp}
              </button>
            </div>

            {/* OTP input — appears after sending */}
            {otpSent && (
              <div style={{ marginTop: s.gap }}>
                <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>{t.otpSentTo} <strong>{emailInput.trim()}</strong></div>
                <input
                  type="text"
                  placeholder={t.otpPlaceholder}
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => e.key === "Enter" && handleVerifyOTP()}
                  maxLength={6}
                  autoFocus
                  style={{ width: "100%", padding: s.inp, fontSize: 16, borderRadius: 10, border: "1.5px solid " + C.bdr, outline: "none", boxSizing: "border-box", fontFamily: "monospace", letterSpacing: 6, textAlign: "center" }}
                />
                <button onClick={handleVerifyOTP} disabled={loading} style={btnStyle(loading)}>
                  {loading ? t.otpVerifying : t.login}
                </button>
                <div style={{ marginTop: s.help, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: compact ? "5px 8px" : "8px 10px" }}>
                  <p style={{ fontSize: 11, color: "#b45309", textAlign: "center", margin: 0, lineHeight: 1.4 }}>{t.otpHelper}</p>
                  <p style={{ fontSize: 11, color: "#92400e", textAlign: "center", margin: "2px 0 0", lineHeight: 1.4 }}>{t.otpContactFallback}</p>
                </div>
              </div>
            )}

            {!otpSent && !compact && (
              <p style={{ fontSize: 12, color: C.t3, textAlign: "center", marginTop: s.help, marginBottom: 0 }}>{t.emailAutoRegister}</p>
            )}

            {/* Back to password link */}
            <div style={{ textAlign: "center", marginTop: s.link }}>
              <button onClick={goToPassword} style={{ background: "none", border: "none", color: C.blue, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: FONT }}>
                {t.backToPassword}
              </button>
            </div>
          </div>
        )}

        {/* ═══ Forgot Password View ═══ */}
        {view === "forgot" && (
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
                style={{ flex: 1, ...inputStyle }}
              />
              <button
                onClick={otpSent ? handleResendOTP : handleSendOTP}
                disabled={loading || resendCooldown > 0}
                style={{
                  flexShrink: 0, padding: "0 14px", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 600, fontFamily: FONT,
                  background: (loading || resendCooldown > 0) ? "#e5e7eb" : C.blue,
                  color: (loading || resendCooldown > 0) ? C.t3 : "#fff",
                  cursor: (loading || resendCooldown > 0) ? "default" : "pointer",
                  whiteSpace: "nowrap", minWidth: compact ? 76 : 90,
                }}
              >
                {loading && !otpSent ? t.sendingOtp : resendCooldown > 0 ? `${resendCooldown}s` : otpSent ? t.resendOtp : t.sendOtp}
              </button>
            </div>

            {otpSent && (
              <div style={{ marginTop: s.gap }}>
                <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>{t.otpSentTo} <strong>{emailInput.trim()}</strong></div>
                <input
                  type="text"
                  placeholder={t.otpPlaceholder}
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => e.key === "Enter" && handleVerifyOTP()}
                  maxLength={6}
                  autoFocus
                  style={{ width: "100%", padding: s.inp, fontSize: 16, borderRadius: 10, border: "1.5px solid " + C.bdr, outline: "none", boxSizing: "border-box", fontFamily: "monospace", letterSpacing: 6, textAlign: "center" }}
                />
                <button onClick={handleVerifyOTP} disabled={loading} style={btnStyle(loading)}>
                  {loading ? t.otpVerifying : t.otpVerify}
                </button>
                <div style={{ marginTop: s.help, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: compact ? "5px 8px" : "8px 10px" }}>
                  <p style={{ fontSize: 11, color: "#b45309", textAlign: "center", margin: 0, lineHeight: 1.4 }}>{t.otpHelper}</p>
                  <p style={{ fontSize: 11, color: "#92400e", textAlign: "center", margin: "2px 0 0", lineHeight: 1.4 }}>{t.otpContactFallback}</p>
                </div>
              </div>
            )}

            {/* Back to password link */}
            <div style={{ textAlign: "center", marginTop: s.link }}>
              <button onClick={goToPassword} style={{ background: "none", border: "none", color: C.blue, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: FONT }}>
                {t.backToPassword}
              </button>
            </div>
          </div>
        )}

        {/* Terms agreement — show on password, otp, code views (not setPassword/forgot) */}
        {(view === "password" || (view === "otp" && !otpSent)) && (
          <label style={{ display: "flex", alignItems: "flex-start", gap: compact ? 6 : 8, marginTop: s.terms, cursor: "pointer", fontSize: compact ? 11 : 12, color: C.t2, lineHeight: 1.5 }}>
            <input
              type="checkbox"
              checked={agreedTerms}
              onChange={(e) => setAgreedTerms(e.target.checked)}
              style={{ marginTop: 2, flexShrink: 0, cursor: "pointer" }}
            />
            <span>
              我已阅读并同意
              <a href="/terms" target="_blank" rel="noopener" style={{ color: C.blue, textDecoration: "underline" }}>《使用条款与隐私政策》</a>
            </span>
          </label>
        )}

        {/* Error */}
        {error && (
          <div style={{ marginTop: s.gap, color: C.red, fontSize: 12, padding: compact ? "5px 8px" : "7px 10px", background: "#fff5f5", borderRadius: 8, textAlign: "center" }}>
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
  const [hasPassword, setHasPassword] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  // Import prompt
  const [showImportPrompt, setShowImportPrompt] = useState(false);
  const [importing, setImporting] = useState(false);

  const isLoggedIn = !!userCode;

  // ── Analytics: track page views ──
  usePageView(userCode);

  // ── Initialization: restore from cache instantly, verify in background ──
  useEffect(() => {
    const saved = getSavedCode();
    if (saved) {
      // Instantly restore from localStorage cache — no loading flash
      const normalized = normalizeInputCode(saved);
      const cachedTier = getSavedTier() || "free";
      const cachedEmail = getSavedEmail() || null;
      const cachedAuth = getSavedAuthMethod() || "code";
      const cachedHasPassword = getSavedHasPassword();
      setUserCode(normalized);
      setUserTier(cachedTier);
      setUserEmail(cachedEmail);
      setAuthMethod(cachedAuth);
      setHasPassword(cachedHasPassword);
      setShowImportPrompt(
        (() => { try { return localStorage.getItem(IMPORT_DISMISSED_KEY) !== "1"; } catch { return true; } })()
        && getLocalSessionCount() > 0
      );
      setReady(true);

      // Background verify — update tier/email, or logout ONLY on explicit server rejection
      verifyCode(saved).then(({ valid, tier, email, auth_method, has_password, networkError }) => {
        if (valid) {
          setUserTier(tier || "free");
          setUserEmail(email || null);
          setAuthMethod(auth_method || "code");
          setHasPassword(has_password || false);
          saveAuth(normalized, { authMethod: auth_method, tier, email, hasPassword: has_password });
        } else if (!networkError) {
          // Server explicitly said code is invalid/expired — logout
          clearAuth();
          setUserCode(null);
          setUserTier("free");
          setUserEmail(null);
          setAuthMethod("code");
          setHasPassword(false);
        }
        // On network/server error: trust cached localStorage state, don't logout
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
  function handleLoginSuccess({ code, tier, email, auth_method, has_password: hp, isNewUser }) {
    saveAuth(code, { authMethod: auth_method, tier, email, hasPassword: hp });
    setUserCode(code);
    setUserTier(tier || "free");
    setUserEmail(email || null);
    setAuthMethod(auth_method || "code");
    setHasPassword(hp || false);
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
    setHasPassword(false);
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
          hasPassword,
          isLoggedIn,
          showLoginModal,
          onLogout: handleLogout,
        })}
      </>
    );
  }
  return children;
}
