"use client";
import { useEffect, useState } from "react";
import { verifyCode } from "../lib/authCode";
import { clearCode, getSavedCode, saveCode } from "../lib/AuthContext";
import { getLocalSessionCount, importLocalSessionsToCloud } from "../lib/sessionStore";
import { isSupabaseConfigured } from "../lib/supabase";
import { C, FONT } from "./shared/ui";

const UI_LANG_KEY = "toefl-ui-lang";

const I18N = {
  zh: {
    checking: "验证登录状态...",
    title: "TOEFL iBT 写作训练",
    subtitle: "内测访问",
    onlyIssuedCode: "请输入已发放的登录码",
    codePlaceholder: "输入 6 位登录码",
    login: "登录",
    loggingIn: "登录中...",
    helper: "登录码由管理员发放。请联系管理员获取可用登录码。",
    invalidLength: "请输入 6 位登录码",
    invalidCode: "登录码无效或未激活。",
    importPrefix: "检测到本设备有",
    importSuffix: "条旧练习记录，是否导入到当前云端账户？",
    import: "导入",
    importing: "导入中...",
    skip: "跳过",
    langZh: "中文",
    langEn: "EN",
  },
  en: {
    checking: "Checking login status...",
    title: "TOEFL iBT Writing Trainer",
    subtitle: "Private Beta Access",
    onlyIssuedCode: "Enter an issued access code",
    codePlaceholder: "Enter 6-character code",
    login: "Sign In",
    loggingIn: "Signing in...",
    helper: "Access codes are issued by admin only. Contact admin to receive an active code.",
    invalidLength: "Please enter a 6-character code.",
    invalidCode: "Code is invalid or not active.",
    importPrefix: "Found",
    importSuffix: "local practice records on this device. Import to this cloud account?",
    import: "Import",
    importing: "Importing...",
    skip: "Skip",
    langZh: "中文",
    langEn: "EN",
  },
};

function normalizeInputCode(v) {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function LangToggle({ lang, onChange }) {
  return (
    <div style={{ display: "inline-flex", gap: 4, background: "#f1f5f9", borderRadius: 999, padding: 2 }}>
      <button
        onClick={() => onChange("zh")}
        style={{
          border: "none",
          background: lang === "zh" ? "#fff" : "transparent",
          color: lang === "zh" ? C.nav : C.t2,
          borderRadius: 999,
          padding: "2px 10px",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: FONT,
        }}
      >
        {I18N.zh.langZh}
      </button>
      <button
        onClick={() => onChange("en")}
        style={{
          border: "none",
          background: lang === "en" ? "#fff" : "transparent",
          color: lang === "en" ? C.nav : C.t2,
          borderRadius: 999,
          padding: "2px 10px",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: FONT,
        }}
      >
        {I18N.en.langEn}
      </button>
    </div>
  );
}

function LoadingScreen({ text }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.t2, fontSize: 14 }}>{text}</div>
    </div>
  );
}

function LoginScreen({ t, lang, setLang, inputCode, setInputCode, error, loading, onLogin }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 560, background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <LangToggle lang={lang} onChange={setLang} />
        </div>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.nav, marginBottom: 6 }}>{t.title}</div>
          <div style={{ fontSize: 13, color: C.t2 }}>{t.subtitle}</div>
        </div>

        <div style={{ border: "1px solid " + C.bdr, borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t.onlyIssuedCode}</div>
          <input
            data-testid="login-code-input"
            value={inputCode}
            onChange={(e) => setInputCode(normalizeInputCode(e.target.value))}
            placeholder={t.codePlaceholder}
            style={{
              width: "100%",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              padding: "10px 12px",
              fontFamily: "monospace",
              fontSize: 28,
              letterSpacing: 8,
              textAlign: "center",
              textTransform: "uppercase",
              marginBottom: 10,
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={onLogin}
            disabled={loading}
            style={{
              width: "100%",
              border: "1px solid " + C.blue,
              background: loading ? "#9ca3af" : C.blue,
              color: "#fff",
              borderRadius: 6,
              padding: "8px 14px",
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: FONT,
              fontWeight: 700,
            }}
          >
            {loading ? t.loggingIn : t.login}
          </button>
        </div>

        {error ? <div style={{ marginTop: 12, color: C.red, fontSize: 13 }}>{error}</div> : null}
        <div style={{ marginTop: 14, fontSize: 12, color: C.t2, lineHeight: 1.6 }}>{t.helper}</div>
      </div>
    </div>
  );
}

function ImportPrompt({ t, count, onImport, onSkip, loading }) {
  return (
    <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13, color: "#7c2d12" }}>
      <div style={{ marginBottom: 8 }}>
        {t.importPrefix} {count} {t.importSuffix}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onImport} disabled={loading} style={{ border: "1px solid #fdba74", background: "#ffedd5", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}>
          {loading ? t.importing : t.import}
        </button>
        <button onClick={onSkip} disabled={loading} style={{ border: "1px solid #fdba74", background: "#fff", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}>
          {t.skip}
        </button>
      </div>
    </div>
  );
}

export default function LoginGate({ children }) {
  const initialLang = (() => {
    if (typeof window === "undefined") return "zh";
    const saved = localStorage.getItem(UI_LANG_KEY);
    return saved === "en" ? "en" : "zh";
  })();

  const [lang, setLangRaw] = useState(initialLang);
  const t = I18N[lang];
  const [state, setState] = useState("checking");
  const [userCode, setUserCode] = useState(null);
  const [inputCode, setInputCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showImportPrompt, setShowImportPrompt] = useState(false);
  const [importing, setImporting] = useState(false);

  const setLang = (next) => {
    const n = next === "en" ? "en" : "zh";
    setLangRaw(n);
    try {
      localStorage.setItem(UI_LANG_KEY, n);
    } catch {
      // no-op
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setState("authenticated");
      setUserCode(null);
      return;
    }

    const saved = getSavedCode();
    if (saved) {
      verifyCode(saved).then(({ valid }) => {
        if (valid) {
          const normalized = normalizeInputCode(saved);
          setUserCode(normalized);
          setShowImportPrompt(getLocalSessionCount() > 0);
          setState("authenticated");
        } else {
          clearCode();
          setState("login");
        }
      });
    } else {
      setState("login");
    }
  }, []);

  const handleLogin = async () => {
    const normalized = normalizeInputCode(inputCode);
    if (normalized.length < 6) {
      setError(t.invalidLength);
      return;
    }
    setLoading(true);
    setError("");
    const { valid, error: verifyError } = await verifyCode(normalized);
    setLoading(false);
    if (!valid) {
      setError(verifyError || t.invalidCode);
      return;
    }
    saveCode(normalized);
    setUserCode(normalized);
    setShowImportPrompt(getLocalSessionCount() > 0);
    setState("authenticated");
  };

  const handleLogout = () => {
    clearCode();
    setUserCode(null);
    setInputCode("");
    setShowImportPrompt(false);
    setState(isSupabaseConfigured ? "login" : "authenticated");
  };

  const handleImport = async () => {
    setImporting(true);
    const { error: importError } = await importLocalSessionsToCloud();
    setImporting(false);
    if (importError) {
      setError(importError);
      return;
    }
    setShowImportPrompt(false);
  };

  if (state === "checking") return <LoadingScreen text={t.checking} />;
  if (state === "login") {
    return (
      <LoginScreen
        t={t}
        lang={lang}
        setLang={setLang}
        inputCode={inputCode}
        setInputCode={setInputCode}
        error={error}
        loading={loading}
        onLogin={handleLogin}
      />
    );
  }

  if (typeof children === "function") {
    return (
      <>
        {showImportPrompt ? (
          <div style={{ maxWidth: 760, margin: "12px auto 0", padding: "0 20px" }}>
            <ImportPrompt t={t} count={getLocalSessionCount()} onImport={handleImport} onSkip={() => setShowImportPrompt(false)} loading={importing} />
          </div>
        ) : null}
        {children({ userCode, onLogout: handleLogout })}
      </>
    );
  }
  return children;
}
