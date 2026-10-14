"use client";
// 真题练习记录页共用的小件与配色（设计稿「真题练习记录 优化版」的取色 / 尺寸 / 圆角照搬）。
import React from "react";
import { TIER_CHIP } from "./realBankMeta";

export const FONT_STACK = "'Plus Jakarta Sans','Noto Sans SC','Segoe UI',sans-serif";
export const READ_FONT = "'Open Sans','Noto Sans SC',sans-serif";
export const MONO = "'Courier New',monospace";

// 对 / 一般 / 错 / 没作答（跳过 / 没录）四档的配色：c 主色、bg 浅底、soft 更浅、bd 描边。
export const LV = {
  ok: { c: "#059669", bg: "#D1FAE5", soft: "#F0FDF4", bd: "#BBF7D0" },
  mid: { c: "#D97706", bg: "#FEF3C7", soft: "#FFFBEB", bd: "#FDE68A" },
  bad: { c: "#DC2626", bg: "#FEE2E2", soft: "#FEF2F2", bd: "#FECACA" },
  none: { c: "#94a39a", bg: "#EEF2EF", soft: "#F7F9F8", bd: "#E3E9E5" },
};

export const RING = 2 * Math.PI * 23;

/** 悬停样式：进入时覆盖 over 里的内联样式，离开时还原（替代设计稿的 style-hover）。 */
export function hoverStyle(over) {
  return {
    onMouseEnter: (e) => {
      const el = e.currentTarget;
      el._rbPrev = {};
      Object.keys(over).forEach((k) => { el._rbPrev[k] = el.style[k]; el.style[k] = over[k]; });
    },
    onMouseLeave: (e) => {
      const el = e.currentTarget;
      const prev = el._rbPrev || {};
      Object.keys(prev).forEach((k) => { el.style[k] = prev[k]; });
    },
  };
}

export function TierBadge({ tier, label }) {
  if (!label) return null;
  const c = TIER_CHIP[tier] || TIER_CHIP.legacy;
  return (
    <span style={{ display: "inline-flex", padding: "1px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700, lineHeight: 1.5, color: c.color, background: c.bg, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

export function Chev({ open, size = 12, rotate = false }) {
  const t = rotate ? "rotate(-90deg)" : open ? "rotate(180deg)" : "none";
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" style={{ transform: t, transition: "transform .2s", flexShrink: 0 }} aria-hidden="true">
      <path d="M2.5 4.25 6 7.75l3.5-3.5" stroke="#94a39a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 得分环：pct 为空（未评分）时只画底环。 */
export function ScoreRing({ pct, label, color, size = 52, track = "#ebf0ed", fill = "none" }) {
  const has = Number.isFinite(pct);
  const fs = !has || String(label).length > 4 ? 11 : 13;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 56 56">
        <circle cx="28" cy="28" r="23" fill={fill} stroke={track} strokeWidth="4" />
        <circle cx="28" cy="28" r="23" fill="none" stroke={has ? color : "transparent"} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={has ? `${(pct / 100) * RING} ${RING}` : `0 ${RING * 2}`} transform="rotate(-90 28 28)" />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: fs, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{label}</span>
    </div>
  );
}

/** 题型图标方块。 */
export function IconBox({ meta, size = 34, radius = 10, fs }) {
  const font = fs || (meta.icon === "Aa" ? Math.round(size * 0.36) : Math.round(size * 0.44));
  return (
    <div style={{ width: size, height: size, borderRadius: radius, background: `${meta.color}14`, color: meta.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: font, fontWeight: 700, flexShrink: 0 }}>
      {meta.icon}
    </div>
  );
}

export const pillBtn = {
  padding: "6px 11px", borderRadius: 8, border: "1px solid #dde5df", background: "#fff", color: "#5a6b62",
  fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};

export const cardStyle = { background: "#fff", border: "1px solid #dde5df", borderRadius: 14 };

/** 收藏星标按钮（题目级收藏，见 lib/realBankFavorites.js）。compact = 行内小图标，否则是带字的按钮。 */
export function FavButton({ on, onToggle, compact = false }) {
  const label = on ? "取消收藏这道题" : "收藏这道题";
  const star = (
    <svg width={compact ? 15 : 13} height={compact ? 15 : 13} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.6l1.95 4.1 4.45.55-3.28 3.08.84 4.42L8 11.6l-3.96 2.15.84-4.42L1.6 6.25l4.45-.55L8 1.6z"
        fill={on ? "#F59E0B" : "none"} stroke={on ? "#F59E0B" : "#94a39a"} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
  const click = (e) => { e.stopPropagation(); onToggle(); };
  if (compact) {
    return (
      <button type="button" data-testid="real-fav-toggle" aria-pressed={on} aria-label={label} title={label} onClick={click}
        onKeyDown={(e) => e.stopPropagation()}
        style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}
        {...hoverStyle({ background: "#fef3c7" })}>{star}</button>
    );
  }
  return (
    <button type="button" data-testid="real-fav-toggle" aria-pressed={on} title={label} onClick={click}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 8, border: `1px solid ${on ? "#FCD34D" : "#dde5df"}`, background: on ? "#FFFBEB" : "#fff", color: on ? "#B45309" : "#5a6b62", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" }}>
      {star}{on ? "已收藏" : "收藏"}
    </button>
  );
}
