"use client";
import Link from "next/link";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "../home/theme";
import { useMistakeSummary } from "./useMistakePool";
import { isPlainLeftClick, useMistakeHomeNavigation } from "./MistakeHomeNavigation";

export const MISTAKE_ACCENT = "#E11D48";

export function formatBadgeCount(n) {
  return n > 99 ? "99+" : String(n);
}

/**
 * 首页左侧栏的错题本入口（紧跟单词本）。角标 = 错题本里现有的错题数（去重、未移出）。
 * 写法照抄 VocabNavItem：真 <Link>，普通左键原地切换首页 section。
 */
export function MistakeNavItem({ isChallenge, isActive = false }) {
  const { total, ready } = useMistakeSummary();
  const navigate = useMistakeHomeNavigation();

  const navItemHover = isChallenge ? CH.navItemHover : T.navItemHover;
  const t2 = isChallenge ? CH.t2 : T.t2;
  const t1 = isChallenge ? CH.t1 : T.t1;

  return (
    <Link
      href="/?section=mistakes"
      data-nav-id="mistake-notebook"
      aria-current={isActive ? "page" : undefined}
      onClick={(event) => {
        if (navigate && isPlainLeftClick(event)) {
          event.preventDefault();
          navigate();
        }
      }}
      style={{
        width: "100%",
        boxSizing: "border-box",
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 12px",
        borderRadius: 8,
        background: isActive ? (isChallenge ? CH.navItemActive : T.navItemActive) : "transparent",
        textDecoration: "none",
        color: "inherit",
        fontFamily: HOME_FONT,
        textAlign: "left",
        transition: "background 150ms ease",
        position: "relative",
        marginBottom: 2,
      }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = navItemHover; }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
    >
      {isActive && <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, background: isChallenge ? CH.accent : MISTAKE_ACCENT }} />}
      <span style={{ fontSize: 16, width: 24, textAlign: "center", flexShrink: 0 }}>📒</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? t1 : t2 }}>错题本</div>
      </div>
      {ready && total > 0 && (
        <span
          title={`错题本里有 ${total} 道错题`}
          style={{
            fontSize: 10, fontWeight: 800, color: "#fff", background: MISTAKE_ACCENT,
            borderRadius: 999, padding: "2px 7px", flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatBadgeCount(total)}
        </span>
      )}
    </Link>
  );
}
