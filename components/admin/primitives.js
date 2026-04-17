"use client";
import React from "react";
import Link from "next/link";
import { C } from "../shared/ui";

// Shared admin UI primitives. Keep this file dependency-light so pages can
// compose consistently without redefining the same visual styles.

export function Card({ children, padding = 16, style }) {
  return (
    <div style={{
      background: "#fff",
      border: "1px solid " + C.bdr,
      borderRadius: 10,
      padding,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      ...style,
    }}>
      {children}
    </div>
  );
}

export function StatCard({ value, label, color, sub, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "#fff",
        border: "1px solid " + C.bdr,
        borderRadius: 10,
        padding: "18px 16px",
        minWidth: 0,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        cursor: onClick ? "pointer" : "default",
        transition: "transform 0.12s",
      }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={(e) => { if (onClick) e.currentTarget.style.transform = "translateY(0)"; }}
    >
      <div style={{ fontSize: 26, fontWeight: 800, color: color || C.nav, lineHeight: 1.1 }}>
        {value ?? "--"}
      </div>
      <div style={{ fontSize: 12, color: C.t2, marginTop: 6 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.t3, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export function SectionCard({ title, href, right, children, padding = 16 }) {
  return (
    <div style={{
      background: "#fff",
      border: "1px solid " + C.bdr,
      borderRadius: 10,
      overflow: "hidden",
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{
        padding: "12px 16px",
        borderBottom: "1px solid " + C.bdr,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.nav }}>{title}</span>
        {right != null ? right : (href ? (
          <Link href={href} style={{ fontSize: 12, color: C.blue, textDecoration: "none", fontWeight: 600 }}>
            详情 &rarr;
          </Link>
        ) : null)}
      </div>
      <div style={{ padding }}>{children}</div>
    </div>
  );
}

export function MetricRow({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
      <span style={{ fontSize: 13, color: C.t2 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: color || C.t1 }}>{value ?? "--"}</span>
    </div>
  );
}

export function Skeleton({ width, height }) {
  return (
    <div style={{
      width: width || "100%",
      height: height || 20,
      borderRadius: 6,
      background: "linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)",
      backgroundSize: "200% 100%",
      animation: "adm-shimmer 1.5s infinite",
    }} />
  );
}

export function ShimmerCSS() {
  return (
    <style>{`@keyframes adm-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
  );
}

export function PageHeader({ title, subtitle, right }) {
  return (
    <div style={{
      marginBottom: 20,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      flexWrap: "wrap",
    }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.nav }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {right && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{right}</div>}
    </div>
  );
}

export function Badge({ children, color = "#64748b", bg }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 700,
      color: color,
      background: bg || `${color}15`,
      letterSpacing: 0.2,
      lineHeight: 1.6,
    }}>
      {children}
    </span>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="adm-tabs" style={{
      display: "flex",
      gap: 4,
      padding: 4,
      background: "#f1f5f9",
      borderRadius: 10,
      marginBottom: 16,
      flexWrap: "wrap",
    }}>
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{
              flex: "1 1 100px",
              padding: "8px 12px",
              borderRadius: 7,
              border: "none",
              background: isActive ? "#fff" : "transparent",
              color: isActive ? C.nav : C.t2,
              fontSize: 13,
              fontWeight: isActive ? 700 : 600,
              cursor: "pointer",
              boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              transition: "background 0.15s",
            }}
          >
            {t.label}{t.count != null ? <span style={{ marginLeft: 6, fontSize: 11, color: C.t3 }}>{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function Button({ children, onClick, variant = "primary", disabled, style, size = "md", type = "button" }) {
  const sizes = {
    sm: { padding: "6px 12px", fontSize: 12 },
    md: { padding: "8px 16px", fontSize: 13 },
    lg: { padding: "10px 22px", fontSize: 14 },
  };
  const variants = {
    primary: { background: C.nav, color: "#fff", border: "1px solid " + C.nav },
    secondary: { background: "#fff", color: C.t1, border: "1px solid " + C.bdr },
    danger: { background: "#dc2626", color: "#fff", border: "1px solid #dc2626" },
    success: { background: "#16a34a", color: "#fff", border: "1px solid #16a34a" },
    ghost: { background: "transparent", color: C.t2, border: "1px solid transparent" },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...sizes[size],
        ...variants[variant],
        borderRadius: 8,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "opacity 0.12s",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function EmptyState({ title = "暂无数据", hint }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 20px", color: C.t3 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.t2 }}>{title}</div>
      {hint && <div style={{ fontSize: 12, marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

export function InlineAlert({ tone = "info", children }) {
  const tones = {
    info: { bg: "#eff6ff", color: "#1e40af", border: "#bfdbfe" },
    warn: { bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
    error: { bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
    success: { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
  };
  const t = tones[tone] || tones.info;
  return (
    <div style={{
      background: t.bg,
      color: t.color,
      border: "1px solid " + t.border,
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 13,
      fontWeight: 500,
    }}>
      {children}
    </div>
  );
}

export function KV({ label, children, mono }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "5px 0", alignItems: "flex-start" }}>
      <div style={{ flexShrink: 0, width: 90, fontSize: 12, color: C.t3, paddingTop: 1 }}>{label}</div>
      <div style={{
        flex: 1,
        fontSize: 13,
        color: C.t1,
        fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit",
        wordBreak: "break-word",
      }}>
        {children}
      </div>
    </div>
  );
}
