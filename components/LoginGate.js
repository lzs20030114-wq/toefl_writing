"use client";
import { useEffect, useState } from "react";
import { createUser, verifyCode } from "../lib/authCode";
import { clearCode, getSavedCode, saveCode } from "../lib/AuthContext";
import { getLocalSessionCount, importLocalSessionsToCloud } from "../lib/sessionStore";
import { isSupabaseConfigured } from "../lib/supabase";
import { C, FONT } from "./shared/ui";

function normalizeInputCode(v) {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function LoadingScreen({ text }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.t2, fontSize: 14 }}>{text}</div>
    </div>
  );
}

function LoginScreen({ inputCode, setInputCode, error, loading, onCreate, onLogin }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 560, background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 24 }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.nav, marginBottom: 6 }}>TOEFL iBT Writing Practice</div>
          <div style={{ fontSize: 13, color: C.t2 }}>2026</div>
        </div>

        <div style={{ border: "1px solid " + C.bdr, borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>已有登录码？</div>
          <input
            data-testid="login-code-input"
            value={inputCode}
            onChange={(e) => setInputCode(normalizeInputCode(e.target.value))}
            placeholder="输入6位登录码"
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
            {loading ? "登录中..." : "登录"}
          </button>
        </div>

        <div style={{ textAlign: "center", color: C.t2, fontSize: 12, margin: "8px 0" }}>- 或 -</div>

        <div style={{ border: "1px solid " + C.bdr, borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>首次使用？</div>
          <button
            onClick={onCreate}
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
            {loading ? "生成中..." : "生成我的登录码"}
          </button>
        </div>

        {error ? <div style={{ marginTop: 12, color: C.red, fontSize: 13 }}>{error}</div> : null}
        <div style={{ marginTop: 16, fontSize: 12, color: C.t2, lineHeight: 1.6 }}>
          登录码用于保存你的练习记录。无需注册邮箱，记住登录码即可跨设备恢复数据。
        </div>
      </div>
    </div>
  );
}

function NewCodeScreen({ code, onConfirm }) {
  async function copyCode() {
    if (!navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // no-op
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 560, background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.nav, marginBottom: 14 }}>你的登录码已生成</div>
        <div style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: "18px 12px", fontFamily: "monospace", fontSize: 40, letterSpacing: 10, fontWeight: 800, color: C.nav, marginBottom: 14 }}>
          {code}
        </div>
        <div style={{ fontSize: 13, color: C.red, lineHeight: 1.7, marginBottom: 12 }}>
          请务必记住或截图保存。这是你的唯一登录凭证，丢失后无法找回。
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={copyCode} style={{ border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontFamily: FONT }}>
            复制到剪贴板
          </button>
          <button
            onClick={onConfirm}
            style={{
              border: "1px solid " + C.blue,
              background: C.blue,
              color: "#fff",
              borderRadius: 6,
              padding: "8px 12px",
              cursor: "pointer",
              fontFamily: FONT,
              fontWeight: 700,
            }}
          >
            我已记住，开始练习
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportPrompt({ count, onImport, onSkip, loading }) {
  return (
    <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13, color: "#7c2d12" }}>
      <div style={{ marginBottom: 8 }}>检测到本设备有 {count} 条旧练习记录。是否导入到你的云端账户？</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onImport} disabled={loading} style={{ border: "1px solid #fdba74", background: "#ffedd5", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}>
          {loading ? "导入中..." : "导入"}
        </button>
        <button onClick={onSkip} disabled={loading} style={{ border: "1px solid #fdba74", background: "#fff", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}>
          跳过
        </button>
      </div>
    </div>
  );
}

export default function LoginGate({ children }) {
  const [state, setState] = useState("checking");
  const [userCode, setUserCode] = useState(null);
  const [inputCode, setInputCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [showImportPrompt, setShowImportPrompt] = useState(false);
  const [importing, setImporting] = useState(false);

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

  const handleCreate = async () => {
    setLoading(true);
    setError("");
    const { code, error: createError } = await createUser();
    setLoading(false);
    if (createError) {
      setError(createError);
      return;
    }
    saveCode(code);
    setNewCode(code);
    setShowCode(true);
  };

  const handleConfirmNewCode = () => {
    setUserCode(newCode);
    setShowCode(false);
    setShowImportPrompt(getLocalSessionCount() > 0);
    setState("authenticated");
  };

  const handleLogin = async () => {
    const normalized = normalizeInputCode(inputCode);
    if (normalized.length < 6) {
      setError("请输入6位登录码");
      return;
    }
    setLoading(true);
    setError("");
    const { valid, error: verifyError } = await verifyCode(normalized);
    setLoading(false);
    if (!valid) {
      setError(verifyError || "登录码无效");
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

  if (state === "checking") return <LoadingScreen text="验证登录状态..." />;
  if (state === "login") {
    if (showCode) return <NewCodeScreen code={newCode} onConfirm={handleConfirmNewCode} />;
    return (
      <LoginScreen
        inputCode={inputCode}
        setInputCode={setInputCode}
        error={error}
        loading={loading}
        onCreate={handleCreate}
        onLogin={handleLogin}
      />
    );
  }

  if (typeof children === "function") {
    return (
      <>
        {showImportPrompt ? (
          <div style={{ maxWidth: 760, margin: "12px auto 0", padding: "0 20px" }}>
            <ImportPrompt count={getLocalSessionCount()} onImport={handleImport} onSkip={() => setShowImportPrompt(false)} loading={importing} />
          </div>
        ) : null}
        {children({ userCode, onLogout: handleLogout })}
      </>
    );
  }
  return children;
}
