"use client";
import React, { useEffect } from "react";
import { fmt } from "../../lib/utils";

export const C = {
  nav: "#0f172a",
  navDk: "#0b1220",
  bg: "#f4f7f5",
  card: "#ffffff",
  bdr: "#dde5df",
  bdrSubtle: "#ebf0ed",
  t1: "#1a2420",
  t2: "#5a6b62",
  t3: "#94a39a",
  blue: "#0d9668",
  green: "#15803d",
  orange: "#d97706",
  red: "#dc2626",
  ltB: "#ecfdf5",
  softBlue: "#eff6ff",
  softAmber: "#fffbeb",
  shadow: "0 1px 3px rgba(10,40,25,0.04), 0 1px 2px rgba(10,40,25,0.02)",
};
export const FONT = "'Plus Jakarta Sans','Noto Sans SC','Segoe UI',sans-serif";


export function Btn({ children, onClick, disabled, variant, ...props }) {
  const colors = {
    primary: { bg: C.blue, c: "#fff", b: C.blue },
    secondary: { bg: "#fff", c: C.t2, b: C.bdr },
    success: { bg: C.green, c: "#fff", b: C.green },
    danger: { bg: C.red, c: "#fff", b: C.red },
  };
  const s = colors[variant || "primary"] || colors.primary;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? "#d1d5db" : s.bg,
        color: disabled ? "#6b7280" : s.c,
        border: "1px solid " + (disabled ? "#d1d5db" : s.b),
        padding: "10px 18px",
        borderRadius: 10,
        fontSize: 14,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: FONT,
        boxShadow: disabled ? "none" : C.shadow,
        transition: "background 120ms ease, border-color 120ms ease, transform 120ms ease",
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export function Toast({ message, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", background: C.red, color: "#fff", padding: "10px 24px", borderRadius: 10, fontSize: 14, fontWeight: 700, zIndex: 9999, boxShadow: "0 10px 30px rgba(0,0,0,0.18)" }}>
      {message}
    </div>
  );
}

export function ChevronIcon({ open = false, size = 12, color = C.t3 }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size + 6,
        height: size + 6,
        color,
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 180ms ease",
        flexShrink: 0,
      }}
    >
      <svg viewBox="0 0 12 12" width={size} height={size} fill="none">
        <path d="M2.5 4.25 6 7.75l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function TopBar({ title, section, timeLeft, isRunning, qInfo, onExit }) {
  return (
    <div className="tp-topbar" style={{ background: "rgba(255,255,255,0.92)", color: C.t1, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, fontFamily: FONT, fontSize: 14, borderBottom: "1px solid " + C.bdrSubtle, backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#087355,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#fff", fontSize: 13, fontWeight: 800 }}>T</span>
        </div>
        <span className="tp-brand-name" style={{ fontWeight: 700, fontSize: 15 }}>TreePractice</span>
        <span className="tp-brand-sep" style={{ opacity: 0.35 }}>|</span>
        <span style={{ fontSize: 13, color: C.t2 }}>{section}</span>
      </div>
      <div className="tp-topbar-mid" style={{ fontSize: 13, color: C.t2 }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {qInfo && <span style={{ fontSize: 12, color: C.t2 }}>{qInfo}</span>}
        {timeLeft !== undefined && <div style={{ background: timeLeft <= 60 ? "#fee2e2" : C.ltB, color: timeLeft <= 60 ? C.red : C.blue, padding: "6px 12px", borderRadius: 999, fontFamily: "Consolas,monospace", fontSize: 15, fontWeight: 700, border: "1px solid " + (timeLeft <= 60 ? "#fecaca" : "#d1fae5") }}>{fmt(timeLeft)}</div>}
        <button onClick={onExit} style={{ background: "#fff", border: "1px solid " + C.bdr, color: C.t2, padding: "8px 12px", borderRadius: 10, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: FONT }}>返回</button>
      </div>
    </div>
  );
}

export function PageShell({ children, narrow = false }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <div className="tp-shell-inner" style={{ maxWidth: narrow ? 920 : 1100, margin: "0 auto", padding: "24px 20px 48px" }}>
        {children}
      </div>
    </div>
  );
}

export function SurfaceCard({ children, style, tone = "default", className }) {
  const toneStyle = tone === "soft"
    ? { background: C.ltB, borderColor: "#d1fae5" }
    : tone === "warn"
      ? { background: C.softAmber, borderColor: "#fde68a" }
      : { background: C.card, borderColor: C.bdr };
  return (
    <div className={className} style={{ background: toneStyle.background, border: "1px solid " + toneStyle.borderColor, borderRadius: 14, boxShadow: C.shadow, ...style }}>
      {children}
    </div>
  );
}

export function InfoStrip({ children, tone = "soft", style }) {
  const toneStyle = tone === "warn"
    ? { background: C.softAmber, borderColor: "#fde68a", color: "#92400e" }
    : { background: C.ltB, borderColor: "#bbf7d0", color: C.t2 };
  return (
    <div style={{ background: toneStyle.background, border: "1px solid " + toneStyle.borderColor, color: toneStyle.color, borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 1.6, ...style }}>
      {children}
    </div>
  );
}

export function DisclosureSection({
  title,
  preview = "",
  children,
  defaultOpen = false,
  open,
  onToggle,
  icon = null,
  badge = null,
  containerStyle,
  summaryStyle,
  contentStyle,
}) {
  const controlled = typeof open === "boolean";
  const [innerOpen, setInnerOpen] = React.useState(defaultOpen);
  const isOpen = controlled ? open : innerOpen;

  function handleToggle() {
    if (!controlled) setInnerOpen((prev) => !prev);
    if (typeof onToggle === "function") onToggle();
  }

  return (
    <SurfaceCard style={{ overflow: "hidden", ...containerStyle }}>
      <button
        onClick={handleToggle}
        aria-expanded={isOpen}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "11px 13px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          ...summaryStyle,
        }}
      >
        {icon ? (
          <div style={{ width: 29, height: 29, borderRadius: 9, background: C.ltB, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>
            {icon}
          </div>
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.t1 }}>{title}</div>
          {preview ? <div style={{ fontSize: 10.5, color: C.t3, marginTop: 2 }}>{preview}</div> : null}
        </div>
        {badge != null ? <span style={{ fontSize: 10.5, fontWeight: 700, color: C.blue, background: C.softBlue, borderRadius: 999, padding: "2px 8px" }}>{badge}</span> : null}
        <span style={{ fontSize: 10.5, color: C.t3 }}>{isOpen ? "收起" : "展开"}</span>
        <ChevronIcon open={isOpen} />
      </button>
      {isOpen ? <div style={{ borderTop: "1px solid " + C.bdrSubtle, ...contentStyle }}>{children}</div> : null}
    </SurfaceCard>
  );
}
