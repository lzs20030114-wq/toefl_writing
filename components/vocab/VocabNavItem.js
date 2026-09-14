"use client";
import Link from "next/link";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "../home/theme";
import { useVocabSummary } from "./useVocabSummary";

const ACCENT = "#0891B2";

/**
 * 首页左侧栏「Sections」列表末尾的单词本入口。
 *
 * 之前放在右栏打卡日历下面，要滚到页底才看得见，用户反馈找不到；
 * 侧栏是首屏常驻、每次进首页都会扫一眼的位置，所以挪到这里。
 * 它是独立路由（/vocab-notebook）不是 section，所以用 Link 跳页而不是切 activeSection，
 * 视觉上照 NavSidebar 的 section 项一比一排版，只多一个「今天该过 N 词」的角标。
 */
export function VocabNavItem({ isChallenge }) {
  const { todo, ready } = useVocabSummary();

  const navItemHover = isChallenge ? CH.navItemHover : T.navItemHover;
  const t2 = isChallenge ? CH.t2 : T.t2;

  return (
    <Link
      href="/vocab-notebook"
      data-nav-id="vocab-notebook"
      style={{
        width: "100%",
        boxSizing: "border-box",
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 12px",
        borderRadius: 8,
        background: "transparent",
        textDecoration: "none",
        color: "inherit",
        fontFamily: HOME_FONT,
        textAlign: "left",
        transition: "background 150ms ease",
        marginBottom: 2,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = navItemHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ fontSize: 16, width: 24, textAlign: "center", flexShrink: 0 }}>📕</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: t2 }}>单词本</div>
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
