"use client";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const QR_IMAGE_SRC = "/wechat-group-qr.jpg";

/**
 * 微信群二维码图片,点击可全屏放大。
 * 在主页侧边栏、移动端首页、反馈弹窗等处复用。
 */
export function WechatQrImage({ size = 200, radius = 4, alt = "微信群二维码" }) {
  const [zoomed, setZoomed] = useState(false);

  // 放大态下:Esc 关闭放大;用捕获阶段 + stopImmediatePropagation,
  // 避免触发外层弹窗自己的 Esc 关闭逻辑(只关放大,不关弹窗)。
  useEffect(() => {
    if (!zoomed) return;
    function onKey(e) {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setZoomed(false);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zoomed]);

  return (
    <>
      <img
        src={QR_IMAGE_SRC}
        alt={`${alt}(点击放大)`}
        width={size}
        height={size}
        role="button"
        tabIndex={0}
        onClick={() => setZoomed(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setZoomed(true); }
        }}
        style={{ display: "block", width: size, height: size, objectFit: "contain", borderRadius: radius, cursor: "zoom-in" }}
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
      {zoomed && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="放大查看二维码"
          onClick={() => setZoomed(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 10050,
            background: "rgba(15,23,42,0.85)",
            WebkitBackdropFilter: "blur(4px)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24, cursor: "zoom-out",
          }}
        >
          <img
            src={QR_IMAGE_SRC}
            alt={alt}
            style={{
              display: "block", width: "auto", height: "auto",
              maxWidth: "92vw", maxHeight: "92vh",
              borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
