"use client";

import Link from "next/link";
import { CHALLENGE_TOKENS as CH, HOME_TOKENS as T } from "./theme";

function Arrow({ color }) {
  return <div style={{ color, fontSize: 15, lineHeight: 1 }}>&gt;</div>;
}

export function HomeTaskCard({ item, hoverKey, setHoverKey, isChallenge, footer }) {
  const { k, href, acc, n, t, d, it, timeLabel, standardLabel, isMock = false } = item;
  const isHover = hoverKey === k;
  const hasFooter = !!footer;

  const inner = (
    <Link
      href={href}
      onMouseEnter={() => setHoverKey(k)}
      onMouseLeave={() => setHoverKey("")}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "stretch",
        position: "relative",
        textDecoration: "none",
        color: "inherit",
        background: isChallenge ? (isMock ? "linear-gradient(180deg,#14101c 0%,#1a0e16 100%)" : CH.card) : (isMock ? T.primarySoft : T.card),
        border: hasFooter ? "none" : (isChallenge ? "none" : `1px solid ${isHover ? `${acc.color}90` : (isMock ? `${T.primary}50` : T.bdr)}`),
        borderRadius: hasFooter ? 0 : (isChallenge && isMock ? 10 : 12),
        overflow: "hidden",
        cursor: "pointer",
        transform: hasFooter ? "none" : (isHover ? "translateY(-2px)" : "translateY(0)"),
        boxShadow: hasFooter ? "none" : (isHover ? (isChallenge ? "0 6px 20px rgba(255,30,30,0.2)" : `0 6px 18px ${acc.color}28`) : T.shadow),
        transition: "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease",
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: isChallenge ? CH.accent : acc.color, opacity: isMock ? (isChallenge ? 0 : 0.45) : (isHover ? 1 : 0), transition: "opacity 150ms ease" }} />
      <div style={{ width: 68, minWidth: 68, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: isChallenge ? CH.timeBg : (isMock ? `${T.primary}18` : acc.soft), padding: "12px 4px", gap: isChallenge ? 3 : 0 }}>
        {isChallenge ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 800, color: CH.accent, animation: "ch-pulse 2s ease-in-out infinite", whiteSpace: "nowrap" }}>{timeLabel}</div>
            <div style={{ fontSize: 10, color: CH.t2, textDecoration: "line-through", whiteSpace: "nowrap" }}>{standardLabel}</div>
          </>
        ) : (
          <div style={{ fontSize: 17, fontWeight: 800, color: acc.color, whiteSpace: "nowrap" }}>{timeLabel}</div>
        )}
      </div>
      <div style={{ width: 1, flexShrink: 0, background: isChallenge ? CH.cardBorder : `linear-gradient(to bottom, transparent, ${acc.color}45, transparent)` }} />
      <div style={{ padding: "14px 16px 14px 18px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontSize: 11, color: isChallenge ? CH.accent : acc.color, fontWeight: 700, marginBottom: 3, letterSpacing: 0.3 }}>{n}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: isChallenge ? CH.t1 : T.t1, marginBottom: 3, lineHeight: 1.3 }}>{t}</div>
        <div style={{ fontSize: 12, color: isChallenge ? CH.t2 : T.t2, lineHeight: 1.4 }}>{d}</div>
      </div>
      <div style={{ padding: "14px 14px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", gap: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", color: isChallenge ? (isMock ? CH.accent : CH.t2) : acc.color, background: isChallenge ? (isMock ? "rgba(255,30,30,0.1)" : "rgba(255,255,255,0.05)") : acc.soft, borderRadius: 6, padding: "3px 7px", border: `1px solid ${isChallenge ? (isMock ? "rgba(255,30,30,0.2)" : "rgba(255,255,255,0.08)") : `${acc.color}30`}` }}>{it}</div>
        {isChallenge && isMock ? <div style={{ fontSize: 10, color: CH.accent, fontWeight: 700, animation: "ch-pulse 1.5s ease-in-out infinite" }}>Challenge</div> : null}
        <Arrow color={isChallenge ? CH.accent : acc.color} />
      </div>
    </Link>
  );

  if (!footer) {
    if (!isChallenge || !isMock) return inner;
    return (
      <div style={{ flex: 1, display: "flex", borderRadius: 12, padding: 2, background: "linear-gradient(90deg,#ff2222,#ff6600,#ff2222,#cc0000)", backgroundSize: "300% 100%", animation: "ch-gradRot 3s ease infinite" }}>
        {inner}
      </div>
    );
  }

  // Card with footer slot (e.g. variant toggle)
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      background: isChallenge ? CH.card : T.card,
      border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`,
      borderRadius: 12, overflow: "hidden",
      boxShadow: T.shadow,
    }}>
      <div style={{ flex: 1, display: "flex" }}>{inner}</div>
      <div style={{ borderTop: `1px solid ${isChallenge ? CH.cardBorder : T.bdrSubtle}` }}>
        {footer}
      </div>
    </div>
  );
}

export function HomeLinkCard({ href, cardKey, hoverKey, setHoverKey, isChallenge, icon, eyebrow, title, description, tone = "primary", badge }) {
  const isHover = hoverKey === cardKey;
  const color = tone === "warning" ? "#D97706" : T.primary;
  const soft = tone === "warning" ? "#FEF3C7" : T.primarySoft;
  const deep = tone === "warning" ? "#92400E" : T.primaryDeep;

  return (
    <Link
      href={href}
      onMouseEnter={() => setHoverKey(cardKey)}
      onMouseLeave={() => setHoverKey("")}
      style={{
        display: "flex",
        alignItems: "stretch",
        position: "relative",
        textDecoration: "none",
        color: "inherit",
        background: isChallenge ? CH.card : T.card,
        border: `1px solid ${isHover ? (isChallenge && tone !== "warning" ? "rgba(134,239,172,0.4)" : color) : (isChallenge ? CH.cardBorder : T.bdr)}`,
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
        transform: isHover ? "translateY(-2px)" : "none",
        boxShadow: isHover ? `0 4px 14px ${color}22` : T.shadow,
        transition: "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease",
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color, opacity: isHover ? 1 : 0, transition: "opacity 150ms ease" }} />
      <div style={{ width: 68, minWidth: 68, display: "flex", alignItems: "center", justifyContent: "center", background: isChallenge ? "rgba(255,255,255,0.05)" : soft, padding: "12px 4px" }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: isChallenge ? "rgba(255,255,255,0.06)" : `${color}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 18, fontWeight: 800 }}>{icon}</span>
        </div>
      </div>
      <div style={{ width: 1, background: isChallenge ? CH.cardBorder : `${color}30`, flexShrink: 0 }} />
      <div style={{ padding: "14px 16px 14px 18px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontSize: 11, color: isChallenge ? color : deep, fontWeight: 700, marginBottom: 3 }}>{eyebrow}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: isChallenge ? CH.t1 : T.t1, marginBottom: 3, lineHeight: 1.3 }}>{title}</div>
        <div style={{ fontSize: 12, color: isChallenge ? CH.t2 : T.t2 }}>{description}</div>
      </div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", gap: 6 }}>
        {badge ? <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", color: isChallenge ? color : deep, background: isChallenge ? "rgba(255,255,255,0.05)" : soft, borderRadius: 6, padding: "3px 8px", border: `1px solid ${isChallenge ? `${color}33` : `${color}30`}` }}>{badge}</div> : null}
        <Arrow color={color} />
      </div>
    </Link>
  );
}
