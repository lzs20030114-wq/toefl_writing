"use client";
import Link from "next/link";
import { CHALLENGE_TOKENS as CH, HOME_TOKENS as T } from "../home/theme";
import { useVocabSummary } from "./useVocabSummary";

const ACCENT = "#0891B2";

/**
 * 移动端首页的单词本入口。放在各科目内容之下、底部快捷入口之上 ——
 * 单词本是跨科目的，切到哪个 tab 都该看得见。
 */
export function MobileVocabEntry({ isChallenge, querySuffix = "" }) {
  const { total, todo, ready } = useVocabSummary();
  const t1 = isChallenge ? CH.t1 : T.t1;
  const t2 = isChallenge ? CH.t2 : T.t2;

  const sub = !ready
    ? "查词时点「☆ 收藏到单词本」就能收进来"
    : total === 0
      ? "阅读/听力复盘里点词收藏，按遗忘曲线复习"
      : todo > 0
        ? `今天有 ${todo} 个词该过一遍`
        : `今天过完了，共收藏 ${total} 词`;

  return (
    <Link
      href={`/vocab-notebook${querySuffix}`}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px", marginBottom: 14,
        background: isChallenge ? CH.card : T.card,
        border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`,
        borderRadius: 12, textDecoration: "none", color: "inherit",
      }}
    >
      <span style={{ fontSize: 20 }}>📕</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t1 }}>单词本</div>
        <div style={{ fontSize: 12, color: t2 }}>{sub}</div>
      </div>
      {ready && todo > 0 && (
        <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: ACCENT, borderRadius: 999, padding: "2px 8px" }}>
          {todo}
        </span>
      )}
      <span style={{ color: t2 }}>›</span>
    </Link>
  );
}
