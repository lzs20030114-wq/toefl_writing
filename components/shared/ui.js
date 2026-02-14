"use client";
import React, { useEffect } from "react";
import { fmt } from "../../lib/utils";

/* --- Theme --- */
export const C = { nav: "#003366", navDk: "#002244", bg: "#f0f0f0", bdr: "#ccc", t1: "#333", t2: "#666", blue: "#0066cc", green: "#28a745", orange: "#ff8c00", red: "#dc3545", ltB: "#e8f0fe" };
export const FONT = "'Segoe UI','Helvetica Neue',Arial,sans-serif";

export function Btn({ children, onClick, disabled, variant, ...props }) {
  const colors = { primary: { bg: C.blue, c: "#fff" }, secondary: { bg: "#fff", c: C.blue }, success: { bg: C.green, c: "#fff" }, danger: { bg: C.red, c: "#fff" } };
  const s = colors[variant || "primary"] || colors.primary;
  return <button onClick={onClick} disabled={disabled} style={{ background: disabled ? "#ccc" : s.bg, color: disabled ? "#888" : s.c, border: "1px solid " + (disabled ? "#ccc" : s.bg), padding: "8px 24px", borderRadius: 4, fontSize: 14, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", fontFamily: FONT }} {...props}>{children}</button>;
}

export function Toast({ message, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", background: C.red, color: "#fff", padding: "10px 24px", borderRadius: 6, fontSize: 14, fontWeight: 600, zIndex: 9999, boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
      {message}
    </div>
  );
}

export function TopBar({ title, section, timeLeft, isRunning, qInfo, onExit }) {
  return (
    <div style={{ background: C.nav, color: "#fff", padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 48, fontFamily: FONT, fontSize: 14, borderBottom: "3px solid " + C.navDk, position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}><span style={{ fontWeight: 700, fontSize: 15 }}>TOEFL iBT</span><span style={{ opacity: 0.5 }}>|</span><span style={{ fontSize: 13 }}>{section}</span></div>
      <div style={{ fontSize: 13, opacity: 0.9 }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {qInfo && <span style={{ fontSize: 12, opacity: 0.8 }}>{qInfo}</span>}
        {timeLeft !== undefined && <div style={{ background: timeLeft <= 60 ? "rgba(220,53,69,0.6)" : "rgba(255,255,255,0.13)", padding: "4px 12px", borderRadius: 4, fontFamily: "Consolas,monospace", fontSize: 16, fontWeight: 700 }}>{fmt(timeLeft)}</div>}
        <button onClick={onExit} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12, fontFamily: FONT }}>Exit</button>
      </div>
    </div>
  );
}
