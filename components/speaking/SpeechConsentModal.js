"use client";

import { useState } from "react";
import { C, FONT, Btn } from "../shared/ui";
import { getSavedCode } from "../../lib/AuthContext";

/**
 * Modal asking the user to grant consent before we upload their audio
 * recordings to OpenAI Whisper. Required for PIPL compliance (voice is
 * personal information; sending to a third party requires explicit consent).
 *
 * Triggered when /api/speech/transcribe returns code=NEEDS_CONSENT.
 *
 * Props:
 *   open        — boolean, whether the modal is rendered
 *   onClose()   — user cancelled / closed without granting
 *   onGranted() — user clicked Grant and the API call succeeded; caller can
 *                 now retry whatever STT request triggered the modal
 */
export function SpeechConsentModal({ open, onClose, onGranted }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  async function handleGrant() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/speech/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_code: (getSavedCode() || "").toUpperCase(),
          action: "grant",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        setError(body?.error || `授权失败 (HTTP ${res.status})`);
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      if (onGranted) onGranted();
    } catch (e) {
      setError("网络异常，请重试。");
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="speech-consent-title"
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
        {/* Header */}
        <div style={{ padding: "20px 24px 12px" }}>
          <div style={{ fontSize: 22, marginBottom: 8 }}>🎙️</div>
          <h2 id="speech-consent-title" style={{
            fontSize: 17, fontWeight: 800, color: C.t1, margin: 0,
          }}>
            语音识别授权
          </h2>
        </div>

        {/* Body */}
        <div style={{ padding: "0 24px", fontSize: 13.5, color: C.t1, lineHeight: 1.7 }}>
          <p style={{ marginTop: 0 }}>
            为对你的口语回答进行自动识别和评分，我们需要将你的录音发送到
            OpenAI Whisper 服务（位于美国）。
          </p>
          <div style={{
            background: "#F8FAFC", border: `1px solid ${C.bdr}`, borderRadius: 10,
            padding: "12px 14px", fontSize: 12.5, color: C.t2, lineHeight: 1.65,
            marginBottom: 8,
          }}>
            <div style={{ marginBottom: 6 }}>
              <span style={{ color: C.green, marginRight: 6 }}>✓</span>
              录音仅用于即时识别，识别完成后立即丢弃。
            </div>
            <div style={{ marginBottom: 6 }}>
              <span style={{ color: C.green, marginRight: 6 }}>✓</span>
              我们的服务器不会保留你的音频副本。
            </div>
            <div>
              <span style={{ color: C.green, marginRight: 6 }}>✓</span>
              你可以随时在「账号」中撤回本次授权。
            </div>
          </div>
          <p style={{ fontSize: 12, color: C.t3, marginTop: 12, marginBottom: 16 }}>
            如不同意，你仍然可以录音并回放，但本题不会获得自动评分。
          </p>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            margin: "0 24px 12px", padding: "8px 12px",
            background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8,
            fontSize: 12, color: "#991B1B",
          }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{
          display: "flex", gap: 10, padding: "12px 24px 20px", justifyContent: "flex-end",
        }}>
          <Btn variant="secondary" onClick={onClose} disabled={submitting}>
            不同意
          </Btn>
          <Btn onClick={handleGrant} disabled={submitting}>
            {submitting ? "处理中…" : "同意并开始识别"}
          </Btn>
        </div>
      </div>
    </div>
  );
}
