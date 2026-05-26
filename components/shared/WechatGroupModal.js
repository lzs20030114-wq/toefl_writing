"use client";
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { C, FONT } from "./ui";

const QR_IMAGE_SRC = "/wechat-group-qr.jpg";

export function WechatGroupModal({ open, onClose, rewardDays = 1 }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === "Escape") onClose?.(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="加入微信交流群"
      style={{
        position: "fixed", inset: 0, zIndex: 10001,
        background: "rgba(15,23,42,0.55)",
        WebkitBackdropFilter: "blur(6px)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, fontFamily: FONT,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        style={{
          background: "#fff",
          width: "100%", maxWidth: 380,
          borderRadius: 14,
          border: `1px solid ${C.bdr}`,
          boxShadow: "0 20px 50px rgba(15,23,42,0.25)",
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.t1 }}>感谢反馈 🎉</div>
            <div style={{ fontSize: 12, color: C.green, marginTop: 4 }}>
              已为你增加 {rewardDays} 天 Pro
            </div>
          </div>
          <button
            onClick={() => onClose?.()}
            aria-label="关闭"
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: 22, color: C.t3, lineHeight: 1, padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.6, margin: "12px 0 16px", textAlign: "left" }}>
          扫码加入<strong style={{ color: C.t1 }}>用户交流群</strong>,
          反馈问题、领取更新通知,作者会在群里第一时间回复。
        </div>

        <div
          style={{
            background: C.bg,
            border: `1px solid ${C.bdrSubtle}`,
            borderRadius: 12,
            padding: 16,
            display: "flex", justifyContent: "center", alignItems: "center",
          }}
        >
          <img
            src={QR_IMAGE_SRC}
            alt="微信群二维码"
            width={240}
            height={240}
            style={{ display: "block", width: 240, height: 240, objectFit: "contain" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        </div>

        <div style={{ fontSize: 12, color: C.t3, marginTop: 12, lineHeight: 1.5 }}>
          长按图片保存,或用微信扫一扫
        </div>

        <button
          onClick={() => onClose?.()}
          style={{
            marginTop: 16,
            width: "100%",
            padding: "10px 18px",
            background: C.t1,
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          知道了
        </button>
      </div>
    </div>,
    document.body,
  );
}
