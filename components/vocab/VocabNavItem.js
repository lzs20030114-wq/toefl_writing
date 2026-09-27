"use client";
import Link from "next/link";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "../home/theme";
import { useVocabSummary } from "./useVocabSummary";
import { useVocabHomeNavigation } from "./VocabHomeNavigation";

const ACCENT = "#0891B2";

/**
 * 首页左侧栏「Sections」列表末尾的单词本入口。
 *
 * 之前放在右栏打卡日历下面，要滚到页底才看得见，用户反馈找不到；
 * 侧栏是首屏常驻、每次进首页都会扫一眼的位置，所以挪到这里。
 * 复用 NavSidebar 的 section 选中态，并显示「今天该过 N 词」角标。
 */
export function VocabNavItem({ isChallenge, isActive = false }) {
  const { todo, ready } = useVocabSummary();
  const navigate = useVocabHomeNavigation();

  const navItemHover = isChallenge ? CH.navItemHover : T.navItemHover;
  const t2 = isChallenge ? CH.t2 : T.t2;
  const t1 = isChallenge ? CH.t1 : T.t1;

  return (
    <Link
      href="/?section=vocab"
      data-nav-id="vocab-notebook"
      aria-current={isActive ? "page" : undefined}
      onClick={(event) => {
        if (navigate && !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
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
      {isActive && <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, background: isChallenge ? CH.accent : T.primary }} />}
      <span style={{ fontSize: 16, width: 24, textAlign: "center", flexShrink: 0 }}>📕</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? t1 : t2 }}>单词本</div>
      </div>
      {ready && todo > 0 && (
        <span
          title={`今天有 ${todo} 个词该过`}
          style={{
            fontSize: 10, fontWeight: 800, color: "#fff", background: ACCENT,
            borderRadius: 999, padding: "2px 7px", flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {todo}
        </span>
      )}
    </Link>
  );
}
