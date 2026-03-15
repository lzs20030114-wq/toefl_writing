"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { FONT } from "./ui";

/**
 * 移动端底部弹出面板（类似 iOS Action Sheet）。
 * 点击遮罩或拖动 handle 可关闭。
 */
export function BottomSheet({ open, onClose, title, children }) {
  // 禁止背景滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(4px)",
        display: "flex", flexDirection: "column", justifyContent: "flex-end",
        fontFamily: FONT,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: "16px 16px 0 0",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          animation: "bottomSheetUp 0.3s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        {/* Handle bar */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "#d1d5db" }} />
        </div>

        {/* Title */}
        {title && (
          <div style={{ padding: "4px 20px 12px", fontSize: 16, fontWeight: 700, color: "#1a2420" }}>
            {title}
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px", WebkitOverflowScrolling: "touch" }}>
          {children}
        </div>
      </div>

      <style>{`
        @keyframes bottomSheetUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>,
    document.body
  );
}
