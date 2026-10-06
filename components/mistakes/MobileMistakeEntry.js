"use client";
import Link from "next/link";
import { CHALLENGE_TOKENS as CH, HOME_TOKENS as T } from "../home/theme";
import { useMistakeSummary } from "./useMistakePool";
import { isPlainLeftClick, useMistakeHomeNavigation } from "./MistakeHomeNavigation";
import { MISTAKE_ACCENT, formatBadgeCount } from "./MistakeNavItem";

/**
 * 移动端首页的错题本入口：跨科目，放在单词本入口下面、科目 tab 上面，切到哪个 tab 都看得见。
 * （旧版只有写作 tab 里一张「拼句错题本」卡，手机用户找不到阅读 / 听力错题。）
 */
export function MobileMistakeEntry({ isChallenge, querySuffix = "", isActive = false }) {
  const { total, bySubject, ready } = useMistakeSummary();
  const navigate = useMistakeHomeNavigation();
  const t1 = isChallenge ? CH.t1 : T.t1;
  const t2 = isChallenge ? CH.t2 : T.t2;

  const parts = [
    bySubject.bs ? `拼句 ${bySubject.bs}` : null,
    bySubject.reading ? `阅读 ${bySubject.reading}` : null,
    bySubject.listening ? `听力 ${bySubject.listening}` : null,
  ].filter(Boolean);
  const sub = !ready || total === 0
    ? "拼句、阅读、听力做错的题自动收进来，可抽题集中重做"
    : `${parts.join(" · ")} · 抽题集中重做`;

  return (
    <Link
      href={`/?section=mistakes${querySuffix ? `&${querySuffix.slice(1)}` : ""}`}
      aria-current={isActive ? "page" : undefined}
      onClick={(event) => {
        if (navigate && isPlainLeftClick(event)) {
          event.preventDefault();
          navigate();
        }
      }}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 16px", marginBottom: 12,
        background: isActive ? (isChallenge ? CH.navItemActive : T.roseSoft) : (isChallenge ? CH.card : T.card),
        border: `1px solid ${isActive ? (isChallenge ? CH.accent : MISTAKE_ACCENT) : (isChallenge ? CH.cardBorder : T.bdr)}`,
        borderRadius: 12, textDecoration: "none", color: "inherit",
      }}
    >
      <span style={{ fontSize: 20 }}>📒</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t1 }}>错题本</div>
        <div style={{ fontSize: 12, color: t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
      </div>
      {ready && total > 0 && (
        <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: MISTAKE_ACCENT, borderRadius: 999, padding: "2px 8px" }}>
          {formatBadgeCount(total)}
        </span>
      )}
      <span style={{ color: t2 }}>›</span>
    </Link>
  );
}
