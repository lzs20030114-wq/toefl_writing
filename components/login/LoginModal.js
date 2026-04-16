import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { sendEmailOTP, verifyEmailOTP, signInWithPassword, setPassword } from "../../lib/emailAuth";
import { verifyCode } from "../../lib/authCode";
import { C, FONT } from "../shared/ui";
import { EyeIcon } from "./EyeIcon";
import { I18N } from "./i18n";

function normalizeInputCode(v) {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

// ── Shared styles builder ──
function buildStyles(compact) {
  const s = compact
    ? { overlay: 10, box: "16px 14px 14px", hd: 8, hdFont: 15, tab: 10, tabPad: "7px 0", inp: "9px 10px", inpFont: 13, btnMt: 6, btnPad: "9px 0", link: 6, help: 6, terms: 6, gap: 6 }
    : { overlay: 20, box: "28px 24px 24px", hd: 16, hdFont: 18, tab: 18, tabPad: "9px 0", inp: "11px 12px", inpFont: 14, btnMt: 10, btnPad: "11px 0", link: 12, help: 10, terms: 14, gap: 10 };
  const baseInput = { width: "100%", fontSize: s.inpFont, borderRadius: 10, border: "1.5px solid " + C.bdr, outline: "none", boxSizing: "border-box", fontFamily: FONT };
  const inputStyle = { ...baseInput, padding: s.inp };
  // Use longhand padding for password inputs to avoid React shorthand/longhand conflict warning
  const inpParts = String(s.inp).split(/\s+/);
  const passwordInputStyle = { ...baseInput, paddingTop: inpParts[0], paddingBottom: inpParts[0], paddingLeft: inpParts[1] || inpParts[0], paddingRight: 40 };
  const btnStyle = (disabled) => ({ width: "100%", marginTop: s.btnMt, padding: s.btnPad, borderRadius: 10, border: "none", background: disabled ? "#9ca3af" : C.blue, color: "#fff", fontSize: s.inpFont, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", fontFamily: FONT });
  return { s, inputStyle, passwordInputStyle, btnStyle };
}

// ── Tab bar (shared between email + code tabs) ──
function TabBar({ activeTab, setActiveTab, t, s, onError }) {
  return (
    <div style={{ display: "flex", borderBottom: "2px solid " + C.bdrSubtle, marginBottom: s.tab }}>
      {[
        { key: "email", label: t.emailTab },
        { key: "code", label: t.codeTab },
      ].map(({ key, label }) => (
        <button
          key={key}
          onClick={() => { setActiveTab(key); onError(""); }}
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
  );
}

// ── SetPassword view ──
function SetPasswordView({ t, styles, loading, onSetPassword }) {
  const [newPassword, setNewPw] = useState("");
  const [confirmPassword, setConfirmPw] = useState("");
  const [showNewPassword, setShowNew] = useState(false);
  const { s, passwordInputStyle, btnStyle } = styles;

  const handleSubmit = () => onSetPassword(newPassword, confirmPassword);

  return (
    <div>
      <div style={{ position: "relative", marginBottom: s.gap }}>
        <input
          type={showNewPassword ? "text" : "password"}
          placeholder={t.newPasswordPlaceholder}
          value={newPassword}
          onChange={(e) => setNewPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && document.getElementById("confirm-pw")?.focus()}
          autoComplete="new-password"
          autoFocus
          style={passwordInputStyle}
        />
        <EyeIcon visible={showNewPassword} onClick={() => setShowNew(!showNewPassword)} />
      </div>
      <div style={{ position: "relative" }}>
        <input
          id="confirm-pw"
          type={showNewPassword ? "text" : "password"}
          placeholder={t.confirmPasswordPlaceholder}
          value={confirmPassword}
          onChange={(e) => setConfirmPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          autoComplete="new-password"
          style={passwordInputStyle}
        />
      </div>
      <button onClick={handleSubmit} disabled={loading} style={btnStyle(loading)}>
        {loading ? t.settingPassword : t.setPasswordBtn}
      </button>
    </div>
  );
}

// ── OTP send + verify view (used by "otp" and "forgot" flows) ──
function OTPView({ t, styles, compact, emailInput, setEmailInput, loading, setLoading, setError, onVerified, goToPassword, showTerms }) {
  const [otpSent, setOtpSent] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const { s, inputStyle, btnStyle } = styles;

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleSend = async () => {
    const email = emailInput.trim();
    if (!email) { setError(t.invalidEmail); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError(t.invalidEmailFormat); return; }
    setLoading(true); setError("");
    const { error: sendError } = await sendEmailOTP(email);
    setLoading(false);
    if (sendError) { setError(sendError); return; }
    setOtpSent(true); setResendCooldown(60);
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    const email = emailInput.trim();
    if (!email) return;
    setLoading(true); setError("");
    const { error: sendError } = await sendEmailOTP(email);
    setLoading(false);
    if (sendError) { setError(sendError); return; }
    setResendCooldown(60);
  };

  const handleVerify = async () => {
    if (otpInput.length < 6) { setError(t.invalidOtp); return; }
    setLoading(true); setError("");
    const result = await verifyEmailOTP(emailInput.trim(), otpInput);
    setLoading(false);
    if (result.error) { setError(result.error); return; }
    onVerified(result);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="email"
          placeholder={t.emailPlaceholder}
          value={emailInput}
          onChange={(e) => { setEmailInput(e.target.value); if (otpSent) { setOtpSent(false); setOtpInput(""); } }}
          onKeyDown={(e) => e.key === "Enter" && (!otpSent ? handleSend() : handleVerify())}
          autoComplete="email"
          autoFocus
          style={{ flex: 1, ...inputStyle }}
        />
        <button
          onClick={otpSent ? handleResend : handleSend}
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
            onKeyDown={(e) => e.key === "Enter" && handleVerify()}
            maxLength={6}
            autoComplete="one-time-code"
            autoFocus
            style={{ width: "100%", padding: s.inp, fontSize: 16, borderRadius: 10, border: "1.5px solid " + C.bdr, outline: "none", boxSizing: "border-box", fontFamily: "monospace", letterSpacing: 6, textAlign: "center" }}
          />
          <button onClick={handleVerify} disabled={loading} style={btnStyle(loading)}>
            {loading ? t.otpVerifying : t.login}
          </button>
          <div style={{ marginTop: s.help, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: compact ? "5px 8px" : "8px 10px" }}>
            <p style={{ fontSize: 11, color: "#b45309", textAlign: "center", margin: 0, lineHeight: 1.4 }}>{t.otpHelper}</p>
            <p style={{ fontSize: 11, color: "#92400e", textAlign: "center", margin: "2px 0 0", lineHeight: 1.4 }}>{t.otpContactFallback}</p>
          </div>
        </div>
      )}

      {!otpSent && !compact && showTerms && (
        <p style={{ fontSize: 12, color: C.t3, textAlign: "center", marginTop: s.help, marginBottom: 0 }}>{t.emailAutoRegister}</p>
      )}

      <div style={{ textAlign: "center", marginTop: s.link }}>
        <button onClick={goToPassword} style={{ background: "none", border: "none", color: C.blue, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: FONT }}>
          {t.backToPassword}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// LoginModal — coordinator
// ═══════════════════════════════════════════
export function LoginModal({ t, onClose, onLoginSuccess }) {
  const [view, setView] = useState("password"); // "password" | "otp" | "forgot" | "setPassword"
  const [activeTab, setActiveTab] = useState("email");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingLogin, setPendingLogin] = useState(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const check = () => setCompact(window.innerHeight < 700 || window.innerWidth < 500);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const styles = buildStyles(compact);
  const { s, inputStyle, passwordInputStyle, btnStyle } = styles;

  // ── View navigation ──
  const goToOtp = () => { setView("otp"); setError(""); };
  const goToPassword = () => { setView("password"); setError(""); setPasswordInput(""); };
  const goToForgot = () => { setView("forgot"); setError(""); };

  // ── Password login ──
  const handlePasswordLogin = async () => {
    if (!agreedTerms) { setError(t.agreeTerms); return; }
    const email = emailInput.trim();
    if (!email) { setError(t.invalidEmail); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError(t.invalidEmailFormat); return; }
    if (!passwordInput) { setError(t.passwordTooShort); return; }
    setLoading(true); setError("");
    const result = await signInWithPassword(email, passwordInput);
    setLoading(false);
    if (result.error) { setError(t.passwordLoginFailed); return; }
    if (!result.has_password) { setPendingLogin(result); setView("setPassword"); return; }
    onLoginSuccess({ code: result.userCode, tier: result.tier, email: result.email, auth_method: result.auth_method, has_password: true, proTrial: result.proTrial });
  };

  // ── Code login ──
  const handleCodeLogin = async () => {
    if (!agreedTerms) { setError(t.agreeTerms); return; }
    const normalized = normalizeInputCode(codeInput);
    if (normalized.length < 6) { setError(t.invalidCode); return; }
    setLoading(true); setError("");
    const { valid, error: verifyError, tier, email, auth_method, proTrial } = await verifyCode(normalized);
    setLoading(false);
    if (!valid) { setError(verifyError || t.invalidCode); return; }
    onLoginSuccess({ code: normalized, tier, email, auth_method: auth_method || "code", proTrial });
  };

  // ── OTP verified callback ──
  const handleOTPVerified = (result) => {
    const { userCode: code, tier, email, auth_method, has_password, isNewUser, proTrial } = result;
    if (view === "forgot" || !has_password) {
      setPendingLogin({ userCode: code, tier, email: email || emailInput.trim(), auth_method: auth_method || "email", isNewUser, proTrial });
      setView("setPassword");
      return;
    }
    onLoginSuccess({ code, tier, email: email || emailInput.trim(), auth_method: auth_method || "email", has_password: true, isNewUser, proTrial });
  };

  // ── Set password callback ──
  const handleSetPassword = async (newPw, confirmPw) => {
    if (newPw.length < 8) { setError(t.passwordTooShort); return; }
    if (newPw !== confirmPw) { setError(t.passwordMismatch); return; }
    setLoading(true); setError("");
    const { error: pwError } = await setPassword(newPw);
    setLoading(false);
    if (pwError) { setError(pwError); return; }
    if (pendingLogin) {
      onLoginSuccess({ code: pendingLogin.userCode, tier: pendingLogin.tier, email: pendingLogin.email, auth_method: pendingLogin.auth_method, has_password: true, isNewUser: pendingLogin.isNewUser, proTrial: pendingLogin.proTrial });
    }
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: s.overlay, fontFamily: FONT }}>
      <div className="tp-modal-body" style={{ position: "relative", width: "100%", maxWidth: 440, background: "#fff", border: "1px solid " + C.bdr, borderRadius: 14, padding: s.box, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        {/* Close */}
        <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", cursor: "pointer", padding: 4, color: C.t3, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: s.hd }}>
          <div style={{ fontSize: s.hdFont, fontWeight: 700, color: C.t1, marginBottom: compact ? 2 : 4 }}>
            {view === "setPassword" ? t.setPasswordTitle : t.modalTitle}
          </div>
          {!compact && <div style={{ fontSize: 12, color: C.t2 }}>{view === "setPassword" ? t.setPasswordSubtitle : t.modalSubtitle}</div>}
          {view !== "setPassword" && <div style={{ fontSize: 11, color: C.t3, marginTop: compact ? 2 : 6 }}>{t.firstTimeHint}</div>}
        </div>

        {/* ═══ Views ═══ */}
        {view === "setPassword" && (
          <SetPasswordView t={t} styles={styles} loading={loading} onSetPassword={handleSetPassword} />
        )}

        {view === "password" && activeTab === "email" && (
          <div>
            <TabBar activeTab={activeTab} setActiveTab={setActiveTab} t={t} s={s} onError={setError} />
            <input type="email" placeholder={t.emailPlaceholder} value={emailInput} onChange={(e) => setEmailInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && document.getElementById("pw-input")?.focus()} autoComplete="email" autoFocus style={{ ...inputStyle, marginBottom: s.gap }} />
            <div style={{ position: "relative" }}>
              <input id="pw-input" type={showPassword ? "text" : "password"} placeholder={t.passwordPlaceholder} value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handlePasswordLogin()} autoComplete="current-password" style={passwordInputStyle} />
              <EyeIcon visible={showPassword} onClick={() => setShowPassword(!showPassword)} />
            </div>
            <button onClick={handlePasswordLogin} disabled={loading} style={btnStyle(loading)}>{loading ? t.loggingIn : t.login}</button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: s.link }}>
              <button onClick={goToForgot} style={{ background: "none", border: "none", color: C.t3, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: FONT }}>{t.forgotPassword}</button>
              <button onClick={goToOtp} style={{ background: "none", border: "none", color: C.blue, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: FONT }}>{t.otpFallback}</button>
            </div>
            {!compact && <p style={{ fontSize: 12, color: C.t3, textAlign: "center", marginTop: s.help, marginBottom: 0 }}>{t.emailHelper}</p>}
          </div>
        )}

        {view === "password" && activeTab === "code" && (
          <div>
            <TabBar activeTab={activeTab} setActiveTab={setActiveTab} t={t} s={s} onError={setError} />
            <input data-testid="login-code-input" type="text" placeholder={t.codePlaceholder} value={codeInput} onChange={(e) => setCodeInput(normalizeInputCode(e.target.value))} onKeyDown={(e) => e.key === "Enter" && handleCodeLogin()} maxLength={6} autoFocus style={{ width: "100%", padding: s.inp, fontSize: 16, borderRadius: 10, border: "1.5px solid " + C.bdr, outline: "none", boxSizing: "border-box", fontFamily: "monospace", letterSpacing: 6, textAlign: "center", textTransform: "uppercase" }} />
            <button onClick={handleCodeLogin} disabled={loading} style={btnStyle(loading)}>{loading ? t.loggingIn : t.login}</button>
            {!compact && <p style={{ fontSize: 12, color: C.t3, textAlign: "center", marginTop: s.help, marginBottom: 0 }}>{t.codeHelper}</p>}
          </div>
        )}

        {(view === "otp" || view === "forgot") && (
          <OTPView
            t={t} styles={styles} compact={compact}
            emailInput={emailInput} setEmailInput={setEmailInput}
            loading={loading} setLoading={setLoading} setError={setError}
            onVerified={handleOTPVerified} goToPassword={goToPassword}
            showTerms={view === "otp"}
          />
        )}

        {/* Terms checkbox */}
        {(view === "password" || view === "otp") && (
          <label style={{ display: "flex", alignItems: "flex-start", gap: compact ? 6 : 8, marginTop: s.terms, cursor: "pointer", fontSize: compact ? 11 : 12, color: C.t2, lineHeight: 1.5 }}>
            <input type="checkbox" checked={agreedTerms} onChange={(e) => setAgreedTerms(e.target.checked)} style={{ marginTop: 2, flexShrink: 0, cursor: "pointer" }} />
            <span>我已阅读并同意<a href="/terms" target="_blank" rel="noopener" style={{ color: C.blue, textDecoration: "underline" }}>《使用条款与隐私政策》</a></span>
          </label>
        )}

        {/* Error */}
        {error && (
          <div role="alert" style={{ marginTop: s.gap, color: C.red, fontSize: 12, padding: compact ? "5px 8px" : "7px 10px", background: "#fff5f5", borderRadius: 8, textAlign: "center" }}>
            {error}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
