"use client";
import { C, FONT } from "./ui";

export default function UsageLimitModal({ limit, onClose }) {
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
          maxWidth: 360,
          width: "90%",
          textAlign: "center",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 12 }}>&#9203;</div>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: C.t1 }}>
          今日免费次数已用完
        </h3>
        <p style={{ fontSize: 14, color: C.t2, marginBottom: 20, lineHeight: 1.6 }}>
          免费版每日 {limit} 次练习机会已全部使用。
          升级 Pro 版享受无限练习。
        </p>
        <a
          href="https://afdian.com/a/treepractice"
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
          了解 Pro 版
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
