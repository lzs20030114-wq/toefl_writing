"use client";
import { useState } from "react";
import { C, FONT } from "./ui";

const AFDIAN_URL = "https://afdian.com/a/treepractice";

export default function UsageLimitModal({ limit, onClose, userCode }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!userCode) return;
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* no-op */ }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
        fontFamily: FONT,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: "32px 28px",
          maxWidth: 380,
          width: "90%",
          textAlign: "center",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 12 }}>&#9203;</div>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: C.t1 }}>
          今日免费次数已用完
        </h3>
        <p style={{ fontSize: 14, color: C.t2, marginBottom: 16, lineHeight: 1.6 }}>
          免费版每日 {limit} 次练习机会已全部使用。
          升级 Pro 版享受无限练习。
        </p>

        {/* User code + copy for Afdian remark */}
        {userCode && (
          <div style={{
            background: "#f8fafc", border: "1px solid " + C.bdr, borderRadius: 10,
            padding: "12px 16px", marginBottom: 16, textAlign: "left",
          }}>
            <div style={{ fontSize: 12, color: C.t2, marginBottom: 8, lineHeight: 1.5 }}>
              在爱发电赞助时，请将登录码粘贴到「留言」栏，系统将自动为你开通 Pro：
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                flex: 1, fontSize: 18, fontWeight: 800, fontFamily: "monospace",
                letterSpacing: 4, color: C.t1,
              }}>
                {userCode}
              </span>
              <button
                onClick={handleCopy}
                style={{
                  padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${copied ? C.blue : C.bdr}`,
                  background: copied ? "#eff6ff" : "#fff",
                  color: copied ? C.blue : C.t2,
                  cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap",
                }}
              >
                {copied ? "已复制" : "复制"}
              </button>
            </div>
          </div>
        )}

        <a
          href={AFDIAN_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "block",
            width: "100%",
            padding: "12px 0",
            borderRadius: 10,
            border: "none",
            background: C.blue,
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            marginBottom: 10,
            textDecoration: "none",
            textAlign: "center",
            boxSizing: "border-box",
          }}
        >
          前往爱发电升级 Pro
        </a>
        <button
          onClick={onClose}
          style={{
            width: "100%",
            padding: "10px 0",
            borderRadius: 10,
            border: "1px solid " + C.bdr,
            background: "#fff",
            color: C.t2,
            fontSize: 14,
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          明天再来
        </button>
      </div>
    </div>
  );
}
