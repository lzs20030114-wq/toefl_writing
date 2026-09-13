"use client";
import Link from "next/link";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "../home/theme";
import { useVocabSummary } from "./useVocabSummary";

const ACCENT = "#0891B2";
const ACCENT_SOFT = "#ECFEFF";

/**
 * 首页右栏的单词本入口。
 *
 * 放在打卡日历下面是有意的：用户做完当天的练习、看完连胜火苗，视线正好落到
 * 「今天还有 N 个词要过」——复习被挂在已经养成的打卡动作后面，而不是另起一个
 * 需要自己想起来的任务。
 */
export function VocabSideCard({ isChallenge, cardStyle, fadeIn }) {
  const { total, todo, dueReview, newToday, ready } = useVocabSummary();

  const t1 = isChallenge ? CH.t1 : T.t1;
  const t2 = isChallenge ? CH.t2 : T.t2;
  const t3 = isChallenge ? CH.t2 : T.t3;
  const hairline = isChallenge ? CH.cardBorder : T.bdrSubtle;

  const empty = ready && total === 0;

  return (
    <Link
      href="/vocab-notebook"
      style={{
        ...cardStyle("14px 16px 15px"),
        ...(fadeIn ? fadeIn(320) : {}),
        display: "block",
        textDecoration: "none",
        color: "inherit",
        fontFamily: HOME_FONT,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: empty ? 8 : 12 }}>
        <span
          style={{
            width: 26, height: 26, borderRadius: 9, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: isChallenge ? "rgba(8,145,178,0.16)" : ACCENT_SOFT,
            border: `1px solid ${isChallenge ? "rgba(8,145,178,0.28)" : "#a5e8f0"}`,
            fontSize: 13,
          }}
        >
          📕
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: t1, flex: 1, minWidth: 0 }}>单词本</span>
        {ready && todo > 0 && (
          <span
            style={{
              fontSize: 10, fontWeight: 800, color: "#fff", background: ACCENT,
              borderRadius: 999, padding: "2px 8px", flexShrink: 0,
            }}
          >
            {todo}
          </span>
        )}
      </div>

      {empty ? (
        <div style={{ fontSize: 11.5, color: t2, lineHeight: 1.75 }}>
          阅读复盘时点原文里的任意一个词，在词典弹窗里点「☆ 收藏到单词本」，
          之后按遗忘曲线提醒你复习。
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
            <span
              style={{
                fontSize: 32, fontWeight: 800, lineHeight: 1,
                color: todo > 0 ? ACCENT : t3,
                fontVariantNumeric: "tabular-nums", letterSpacing: -1.5,
              }}
            >
              {ready ? todo : "—"}
            </span>
            <span style={{ fontSize: 11.5, color: t2, fontWeight: 600 }}>
              {todo > 0 ? "个词今天该过" : "今天的词过完了"}
            </span>
          </div>
          {ready && todo > 0 && (
            <div style={{ fontSize: 10.5, color: t3, marginTop: 4 }}>
              到期复习 {dueReview} · 新词 {newToday}
            </div>
          )}
          <div
            style={{
              marginTop: 11, paddingTop: 9, borderTop: `1px solid ${hairline}`,
              fontSize: 10.5, color: t3, display: "flex", alignItems: "center", gap: 6,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span>共收藏 {ready ? total : "—"} 词</span>
            <span style={{ marginLeft: "auto", color: ACCENT, fontWeight: 700 }}>
              {todo > 0 ? "去复习 ›" : "查看 ›"}
            </span>
          </div>
        </>
      )}
    </Link>
  );
}
