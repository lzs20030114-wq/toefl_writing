"use client";
import { useEffect, useState } from "react";
import { verifyCode } from "../lib/authCode";
import { signOut } from "../lib/emailAuth";
import { clearAuth, getSavedCode, getSavedTier, getSavedEmail, getSavedAuthMethod, getSavedHasPassword, saveAuth } from "../lib/AuthContext";
import { clearLocalSessions, getLocalSessionCount, importLocalSessionsToCloud } from "../lib/sessionStore";
import { usePageView } from "../lib/usePageView";
import { C, FONT } from "./shared/ui";
import { I18N, UI_LANG_KEY, IMPORT_DISMISSED_KEY, PRO_TRIAL_NOTIFIED_KEY } from "./login/i18n";
import { LoginModal } from "./login/LoginModal";
import { ProTrialGiftModal } from "./login/ProTrialModal";
import { ImportPrompt } from "./login/ImportPrompt";

function normalizeInputCode(v) {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

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
  const [showImportPrompt, setShowImportPrompt] = useState(false);
  const [importing, setImporting] = useState(false);
  const [welcomeMsg, setWelcomeMsg] = useState(null);
  const [proTrialModal, setProTrialModal] = useState(false);

  const isLoggedIn = !!userCode;

  usePageView(userCode);

  // ── Initialization: restore from cache instantly, verify in background ──
  useEffect(() => {
    const saved = getSavedCode();
    if (saved) {
      const normalized = normalizeInputCode(saved);
      setUserCode(normalized);
      setUserTier(getSavedTier() || "free");
      setUserEmail(getSavedEmail() || null);
      setAuthMethod(getSavedAuthMethod() || "code");
      setHasPassword(getSavedHasPassword());
      setShowImportPrompt(
        (() => { try { return localStorage.getItem(IMPORT_DISMISSED_KEY) !== "1"; } catch { return true; } })()
        && getLocalSessionCount() > 0
      );
      setReady(true);

      verifyCode(saved).then(({ valid, tier, email, auth_method, has_password, proTrial, networkError }) => {
        if (valid) {
          setUserTier(tier || "free");
          setUserEmail(email || null);
          setAuthMethod(auth_method || "code");
          setHasPassword(has_password || false);
          saveAuth(normalized, { authMethod: auth_method, tier, email, hasPassword: has_password });
          maybeShowTrialModal(proTrial, tier);
        } else if (!networkError) {
          clearAuth();
          setUserCode(null); setUserTier("free"); setUserEmail(null); setAuthMethod("code"); setHasPassword(false);
        }
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
        const url = new URL(window.location.href);
        url.searchParams.delete("login");
        window.history.replaceState({}, "", url.pathname + url.search);
      }
    } catch { /* no-op */ }
  }, [ready, isLoggedIn]);

  function maybeShowTrialModal(proTrial, tier) {
    if (proTrial && tier === "pro") {
      try { if (localStorage.getItem(PRO_TRIAL_NOTIFIED_KEY) !== "1") setProTrialModal(true); } catch { /* no-op */ }
    }
  }

  function dismissTrialModal() {
    setProTrialModal(false);
    try { localStorage.setItem(PRO_TRIAL_NOTIFIED_KEY, "1"); } catch { /* no-op */ }
  }

  function handleLoginSuccess({ code, tier, email, auth_method, has_password: hp, isNewUser, proTrial }) {
    saveAuth(code, { authMethod: auth_method, tier, email, hasPassword: hp });
    setUserCode(code); setUserTier(tier || "free"); setUserEmail(email || null);
    setAuthMethod(auth_method || "code"); setHasPassword(hp || false);
    setLoginModalOpen(false);
    setShowImportPrompt(
      (() => { try { return localStorage.getItem(IMPORT_DISMISSED_KEY) !== "1"; } catch { return true; } })()
      && getLocalSessionCount() > 0
    );
    if (proTrial && tier === "pro") {
      maybeShowTrialModal(proTrial, tier);
    } else if (isNewUser) {
      setWelcomeMsg("欢迎！已为你自动创建账户");
      setTimeout(() => setWelcomeMsg(null), 4000);
    }
  }

  const handleLogout = async () => {
    clearAuth(); await signOut();
    setUserCode(null); setUserTier("free"); setUserEmail(null); setAuthMethod("code"); setHasPassword(false);
    setShowImportPrompt(false);
  };

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

  if (!ready) return null;

  if (typeof children === "function") {
    return (
      <>
        {showImportPrompt && isLoggedIn && (
          <div style={{ maxWidth: 760, margin: "12px auto 0", padding: "0 20px" }}>
            <ImportPrompt t={t} count={getLocalSessionCount()} onImport={handleImport} onSkip={() => setShowImportPrompt(false)} onDismiss={handleDismiss} loading={importing} />
          </div>
        )}
        {loginModalOpen && <LoginModal t={t} onClose={() => setLoginModalOpen(false)} onLoginSuccess={handleLoginSuccess} />}
        {proTrialModal && <ProTrialGiftModal t={t} onClose={dismissTrialModal} />}
        {welcomeMsg && (
          <div style={{ position: "fixed", top: 64, left: "50%", transform: "translateX(-50%)", background: C.blue, color: "#fff", padding: "10px 24px", borderRadius: 10, fontSize: 14, fontWeight: 600, zIndex: 10001, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", fontFamily: FONT }}>
            {welcomeMsg}
          </div>
        )}
        {children({ userCode, userTier, userEmail, authMethod, hasPassword, isLoggedIn, showLoginModal: () => setLoginModalOpen(true), onLogout: handleLogout })}
      </>
    );
  }
  return children;
}
