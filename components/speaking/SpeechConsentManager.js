"use client";

import { useState, useEffect } from "react";
import { C, FONT, Btn } from "../shared/ui";
import { getSavedCode } from "../../lib/AuthContext";
import {
  clearSpeechConsent,
  hasLocalSpeechConsent,
  SPEECH_CONSENT_EVENT,
} from "./speechConsentState";

/**
 * SpeechConsentManager — the "manage / revoke voice authorization" dialog.
 *
 * Complements SpeechConsentModal (which GRANTS consent). Here the user reviews
 * their current authorization and can revoke it. Revoking calls the same
 * /api/speech/consent endpoint with action:"revoke", which stamps
 * speech_consent_revoked_at AND cascade-deletes every retained recording +
 * storage object for the user. A partial failure (PURGE_FAILED) is surfaced
 * loudly — we never claim deletion succeeded when it didn't.
 *
 * Consent version shown here is the current disclosure version (v2). The revoke
 * entry is only surfaced (see SpeechAuthEntry) when a local grant marker exists,
 * and markers are only written by v2 grants, so the label is accurate.
 *
 * Props:
 *   open        — boolean, whether the dialog is rendered
 *   onClose()   — user dismissed the dialog
 *   onRevoked() — revoke succeeded; caller can hide the entry point
 */

// Mirrors SPEECH_CONSENT_VERSION in lib/speech/retentionPolicy.js. Duplicated as
// a plain literal to avoid pulling a server-side policy module into the client
// bundle; keep in sync if the consent disclosure version bumps.
const CONSENT_VERSION = 2;

export function SpeechConsentManager({ open, onClose, onRevoked }) {
  // "info" → status + revoke button; "confirm" → second confirmation;
  // "done" → success acknowledgement.
  const [view, setView] = useState("info");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Reset to the initial view each time the dialog opens.
  useEffect(() => {
    if (open) {
      setView("info");
      setSubmitting(false);
      setError("");
    }
  }, [open]);

  if (!open) return null;

  async function handleRevoke() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/speech/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_code: (getSavedCode() || "").toUpperCase(),
          action: "revoke",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        // Includes PURGE_FAILED (revoke stamped but recordings not fully
        // deleted). Surface the server's message verbatim — never silent, never
        // a false "deleted" claim. The user stays on the confirm view and can
        // retry, which re-stamps + re-attempts the purge.
        setError(body?.error || `撤回失败 (HTTP ${res.status})`);
        setSubmitting(false);
        return;
      }
      clearSpeechConsent();
      setSubmitting(false);
      setView("done");
      if (onRevoked) onRevoked();
    } catch {
      setError("网络异常，请重试。");
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="speech-consent-manage-title"
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, fontFamily: FONT,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose?.(); }}
    >
      <div
        style={{
          background: "#fff", borderRadius: 16, maxWidth: 480, width: "100%",
          boxShadow: "0 24px 64px rgba(15,23,42,0.30)", overflow: "hidden",
        }}
      >
        {view === "info" && (
          <>
            {/* Header */}
            <div style={{ padding: "20px 24px 12px" }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>🎙️</div>
              <h2 id="speech-consent-manage-title" style={{
                fontSize: 17, fontWeight: 800, color: C.t1, margin: 0,
              }}>
                语音授权管理
              </h2>
            </div>

            {/* Current status */}
            <div style={{ padding: "0 24px", fontSize: 13.5, color: C.t1, lineHeight: 1.7 }}>
              <div style={{
                background: C.ltB, border: "1px solid #bbf7d0", borderRadius: 10,
                padding: "12px 14px", fontSize: 13, color: C.t1, marginBottom: 12,
              }}>
                <span style={{ color: C.green, marginRight: 6, fontWeight: 700 }}>✓</span>
                当前状态：已同意语音识别授权（v{CONSENT_VERSION}）
              </div>
              <p style={{ marginTop: 0, fontSize: 12.5, color: C.t2 }}>
                此授权允许我们将你的口语录音上传服务器、提交给境外第三方语音服务进行转写与
                发音评估，并在测试期内保存部分录音（最多 90 天）用于评分质量改进。
              </p>
              <p style={{ fontSize: 12, color: C.t3, marginTop: 8, marginBottom: 16 }}>
                你可以随时撤回授权。撤回后我们会停止保存并删除已留存的录音。
              </p>
            </div>

            {/* Actions */}
            <div style={{
              display: "flex", gap: 10, padding: "8px 24px 20px", justifyContent: "space-between",
            }}>
              <button
                onClick={() => setView("confirm")}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 13, color: C.red, fontWeight: 700, fontFamily: FONT,
                  textDecoration: "underline", textUnderlineOffset: 3, padding: "10px 2px",
                }}
              >
                撤回授权
              </button>
              <Btn variant="secondary" onClick={onClose}>关闭</Btn>
            </div>
          </>
        )}

        {view === "confirm" && (
          <>
            {/* Header */}
            <div style={{ padding: "20px 24px 12px" }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>⚠️</div>
              <h2 id="speech-consent-manage-title" style={{
                fontSize: 17, fontWeight: 800, color: C.t1, margin: 0,
              }}>
                确认撤回语音授权？
              </h2>
            </div>

            {/* Warning */}
            <div style={{ padding: "0 24px", fontSize: 13.5, color: C.t1, lineHeight: 1.7 }}>
              <div style={{
                background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10,
                padding: "12px 14px", fontSize: 12.5, color: "#991B1B", lineHeight: 1.7,
                marginBottom: 8,
              }}>
                <div style={{ marginBottom: 6 }}>• 已保存的录音将被<strong>永久删除，无法恢复</strong>。</div>
                <div style={{ marginBottom: 6 }}>• 撤回后<strong>口语 AI 评分将不可用</strong>。</div>
                <div>• 如需继续使用口语评分，需要<strong>重新授权</strong>。</div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                margin: "0 24px 12px", padding: "8px 12px",
                background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8,
                fontSize: 12, color: "#991B1B", lineHeight: 1.6,
              }}>
                {error}
              </div>
            )}

            {/* Actions */}
            <div style={{
              display: "flex", gap: 10, padding: "8px 24px 20px", justifyContent: "flex-end",
            }}>
              <Btn variant="secondary" onClick={() => setView("info")} disabled={submitting}>
                返回
              </Btn>
              <Btn variant="danger" onClick={handleRevoke} disabled={submitting}>
                {submitting ? "撤回中…" : "确认撤回"}
              </Btn>
            </div>
          </>
        )}

        {view === "done" && (
          <>
            {/* Header */}
            <div style={{ padding: "20px 24px 12px" }}>
              <div style={{ fontSize: 22, marginBottom: 8, color: C.green }}>✓</div>
              <h2 id="speech-consent-manage-title" style={{
                fontSize: 17, fontWeight: 800, color: C.t1, margin: 0,
              }}>
                已撤回语音授权
              </h2>
            </div>

            {/* Body */}
            <div style={{ padding: "0 24px", fontSize: 13.5, color: C.t1, lineHeight: 1.7 }}>
              <div style={{
                background: C.ltB, border: "1px solid #bbf7d0", borderRadius: 10,
                padding: "12px 14px", fontSize: 13, color: C.t1, marginBottom: 8,
              }}>
                <span style={{ color: C.green, marginRight: 6, fontWeight: 700 }}>✓</span>
                已停止保存并删除你留存的录音。
              </div>
              <p style={{ fontSize: 12, color: C.t3, marginTop: 8, marginBottom: 16 }}>
                再次进入录音题时，会重新征询你的授权。
              </p>
            </div>

            {/* Actions */}
            <div style={{
              display: "flex", gap: 10, padding: "8px 24px 20px", justifyContent: "flex-end",
            }}>
              <Btn onClick={onClose}>关闭</Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * SpeechAuthEntry — the low-key page-bottom link that opens SpeechConsentManager.
 *
 * Rendered once at the Speaking page root (a document-flow sibling below the
 * task/picker content, so it sits at the very bottom — discoverable by scrolling
 * but never in the way). Self-gating: shows only when a logged-in user has a
 * local consent marker, so users who never authorized voice never see it.
 *
 * It re-reads the marker on the same-tab consent-change event and cross-tab
 * `storage` event, so granting (in SpeechConsentModal) or revoking updates the
 * link's visibility without a reload.
 */
export function SpeechAuthEntry() {
  const [code, setCode] = useState("");
  const [hasConsent, setHasConsent] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const c = (getSavedCode() || "").toUpperCase();
      setCode(c);
      setHasConsent(hasLocalSpeechConsent(c));
    };
    refresh();
    window.addEventListener(SPEECH_CONSENT_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SPEECH_CONSENT_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // Nothing to manage for logged-out users or those without a local grant.
  if (!code) return null;

  return (
    <>
      {hasConsent && (
        <div style={{ textAlign: "center", padding: "28px 20px 40px", fontFamily: FONT }}>
          <button
            onClick={() => setOpen(true)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 12, color: C.t3, textDecoration: "underline",
              textUnderlineOffset: 3, fontFamily: FONT,
            }}
          >
            语音授权管理
          </button>
        </div>
      )}
      {/* Kept mounted while open even after the marker clears, so the revoke
          success view can finish showing before the dialog closes. */}
      <SpeechConsentManager
        open={open}
        onClose={() => setOpen(false)}
        onRevoked={() => setHasConsent(false)}
      />
    </>
  );
}
