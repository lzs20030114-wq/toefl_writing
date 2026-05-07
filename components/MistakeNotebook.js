"use client";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { loadHist, SESSION_STORE_EVENTS } from "../lib/sessionStore";
import { formatLocalDateTime, translateGrammarPoint } from "../lib/utils";
import { C, FONT, PageShell, SurfaceCard, DisclosureSection } from "./shared/ui";
import { useBsAiExplain, BsAiExplainBlock } from "./buildSentence/useBsAiExplain";
import { useMistakeFavorites } from "./buildSentence/useMistakeFavorites";
import { callAI } from "../lib/ai/client";

/* ── helpers ── */

function extractMistakes(sessions) {
  // Filter BS sessions that have details with wrong answers.
  // We preserve the original detail index (_index) so each mistake has a
  // stable (session_id, detail_index) pointer for the favorites feature.
  return sessions
    .filter((s) => s.type === "bs" && Array.isArray(s.details))
    .map((s, idx) => {
      const wrongs = s.details
        .map((d, i) => ({ ...d, _index: i }))
        .filter((d) => !d.isCorrect);
      if (wrongs.length === 0) return null;
      return {
        key: s.date || `session-${idx}`,
        sessionId: s.id ?? null,
        date: s.date,
        correct: s.correct ?? 0,
        total: s.total ?? s.details.length,
        wrongCount: wrongs.length,
        details: wrongs,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date)); // newest first
}

/** Build the snapshot we persist when a mistake is starred. Self-contained so
 *  the card still renders if the source session is later deleted. */
function buildSnapshot(detail, sessionDate) {
  return {
    prompt: detail?.prompt || "",
    userAnswer: detail?.userAnswer || "",
    correctAnswer: detail?.correctAnswer || "",
    grammar_points: Array.isArray(detail?.grammar_points) ? detail.grammar_points : [],
    sessionDate: sessionDate || null,
  };
}

/** Render a favorite row as a synthetic "detail" the existing MistakeCard
 *  understands. This lets the favorites tab reuse the same card. */
function favoriteToDetail(fav) {
  const s = fav?.snapshot || {};
  return {
    prompt: s.prompt || "",
    userAnswer: s.userAnswer || "",
    correctAnswer: s.correctAnswer || "",
    grammar_points: Array.isArray(s.grammar_points) ? s.grammar_points : [],
    isCorrect: false,
    _index: fav?.detail_index ?? null,
    _favoriteSessionDate: s.sessionDate || null,
  };
}

function allGrammarFreq(groups) {
  const freq = {};
  for (const g of groups) {
    for (const d of g.details) {
      for (const gp of d.grammar_points || []) {
        freq[gp] = (freq[gp] || 0) + 1;
      }
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, label: translateGrammarPoint(tag), count }));
}

function topGrammarPoints(groups, limit = 3) {
  return allGrammarFreq(groups).slice(0, limit);
}

function buildAnalysisPrompt(groups, totalWrong, gpFreq) {
  const totalSessions = groups.length;
  const totalQuestions = groups.reduce((n, g) => n + g.total, 0);
  const errorRate = totalQuestions > 0 ? ((totalWrong / totalQuestions) * 100).toFixed(1) : 0;

  // Top 8 grammar weaknesses
  const top8 = gpFreq.slice(0, 8).map((gp) => `${gp.label}(${gp.tag}): ${gp.count}次`).join("、");

  // Recent trend: compare first half vs second half of sessions
  const mid = Math.ceil(totalSessions / 2);
  const olderHalf = groups.slice(mid); // older (groups are newest-first)
  const newerHalf = groups.slice(0, mid);
  const olderRate = olderHalf.reduce((n, g) => n + g.wrongCount, 0) / Math.max(olderHalf.reduce((n, g) => n + g.total, 0), 1);
  const newerRate = newerHalf.reduce((n, g) => n + g.wrongCount, 0) / Math.max(newerHalf.reduce((n, g) => n + g.total, 0), 1);
  const trend = newerRate < olderRate - 0.05 ? "进步明显" : newerRate > olderRate + 0.05 ? "有退步趋势" : "基本持平";

  // Sample 3 representative wrong answers for context
  const samples = [];
  for (const g of groups) {
    for (const d of g.details) {
      if (samples.length < 3) {
        samples.push(`错答:"${d.userAnswer}" → 正确:"${d.correctAnswer}" [${(d.grammar_points || []).join(",")}]`);
      }
    }
  }

  return `学生在 TOEFL Build a Sentence 拖拽造句练习中的错题数据如下：

总练习次数：${totalSessions} 套（共 ${totalQuestions} 题）
总错题数：${totalWrong} 题（错误率 ${errorRate}%）
近期趋势：${trend}（前半段错误率 ${(olderRate * 100).toFixed(1)}% → 后半段 ${(newerRate * 100).toFixed(1)}%）

语法薄弱点分布（按出错频率排序）：
${top8}

典型错误示例：
${samples.join("\n")}

请用中文给出简洁的分析报告（200字以内），包含：
1. 最需要优先攻克的 2-3 个语法薄弱点及具体建议
2. 近期学习趋势评价
3. 一句鼓励的话`;
}

const ANALYSIS_SYSTEM = "你是一位专业的 TOEFL 写作辅导老师。根据学生的错题数据，给出简洁精准的薄弱点分析和学习建议。语气友善专业，不要废话。";

/* ── word diff ── */

function wordDiff(user, correct) {
  const uw = user.split(/\s+/);
  const cw = correct.split(/\s+/);
  // Simple token-level diff: walk through correct words, highlight mismatches
  const result = [];
  const maxLen = Math.max(uw.length, cw.length);
  for (let i = 0; i < maxLen; i++) {
    const u = uw[i] || "";
    const c = cw[i] || "";
    if (u.toLowerCase() === c.toLowerCase()) {
      result.push({ word: c, match: true });
    } else {
      if (u) result.push({ word: u, match: false, type: "wrong" });
      if (c) result.push({ word: c, match: false, type: "correct" });
    }
  }
  return result;
}

/* ── sub-components ── */

function StarButton({ starred, onClick, disabled }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled}
      aria-label={starred ? "取消收藏" : "收藏此错题"}
      title={starred ? "取消收藏" : "收藏此错题"}
      style={{
        flexShrink: 0,
        background: hover ? "#fef3c7" : "transparent",
        border: "none",
        borderRadius: 999,
        width: 32,
        height: 32,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontSize: 20,
        lineHeight: 1,
        color: starred ? "#f59e0b" : "#94a3b8",
        transition: "color 0.15s, background 0.15s",
        padding: 0,
      }}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}

function MistakeCard({ detail, explainKey, aiExplains, isLegacy, handleAiExplain, sessionId, detailIndex, sessionDate, isStarred, onToggleStar }) {
  const diff = useMemo(
    () => wordDiff(detail.userAnswer || "", detail.correctAnswer || ""),
    [detail.userAnswer, detail.correctAnswer],
  );
  const showStar = sessionId != null && detailIndex != null && typeof onToggleStar === "function";
  const starred = showStar ? !!isStarred : false;

  const handleStarClick = useCallback(() => {
    if (!showStar) return;
    onToggleStar(sessionId, detailIndex, buildSnapshot(detail, sessionDate));
  }, [showStar, sessionId, detailIndex, detail, sessionDate, onToggleStar]);

  return (
    <div
      style={{
        padding: "14px 16px",
        borderLeft: `4px solid ${C.red}`,
        background: "#fff",
        borderRadius: 6,
        marginBottom: 10,
      }}
    >
      {/* prompt + star */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, fontSize: 13, color: C.t2, lineHeight: 1.5 }}>
          {detail.prompt}
        </div>
        {showStar ? (
          <StarButton starred={starred} onClick={handleStarClick} />
        ) : null}
      </div>

      {/* user answer */}
      <div style={{ fontSize: 13.5, marginBottom: 4, lineHeight: 1.6 }}>
        <span style={{ fontWeight: 700, color: C.t2, marginRight: 6, fontSize: 12 }}>你的答案</span>
        <span style={{ color: C.red }}>{detail.userAnswer}</span>
      </div>

      {/* correct answer */}
      <div style={{ fontSize: 13.5, marginBottom: 8, lineHeight: 1.6 }}>
        <span style={{ fontWeight: 700, color: C.t2, marginRight: 6, fontSize: 12 }}>正确答案</span>
        <span style={{ color: C.green }}>{detail.correctAnswer}</span>
      </div>

      {/* grammar tags */}
      {(detail.grammar_points || []).length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 4 }}>
          {detail.grammar_points.map((gp, i) => (
            <span
              key={i}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: C.blue,
                background: C.ltB,
                borderRadius: 999,
                padding: "2px 9px",
              }}
            >
              {translateGrammarPoint(gp)}
            </span>
          ))}
        </div>
      )}

      {/* AI explanation */}
      <BsAiExplainBlock
        explainKey={explainKey}
        detail={detail}
        aiExplains={aiExplains}
        isLegacy={isLegacy}
        handleAiExplain={handleAiExplain}
      />
    </div>
  );
}

function StatsBar({ groups, totalWrong }) {
  const topGP = topGrammarPoints(groups);
  const gpFreq = useMemo(() => allGrammarFreq(groups), [groups]);
  const [analysis, setAnalysis] = useState({ loading: false, text: null, error: null });
  const [showDetail, setShowDetail] = useState(false);

  const handleAnalyze = useCallback(async () => {
    if (analysis.loading) return;
    setAnalysis({ loading: true, text: null, error: null });
    try {
      const prompt = buildAnalysisPrompt(groups, totalWrong, gpFreq);
      const text = await callAI(ANALYSIS_SYSTEM, prompt, 500, 30000, 0.4);
      setAnalysis({ loading: false, text, error: null });
    } catch (e) {
      setAnalysis({ loading: false, text: null, error: e.message || "分析失败" });
    }
  }, [groups, totalWrong, gpFreq, analysis.loading]);

  return (
    <SurfaceCard style={{ padding: "16px 18px", marginBottom: 16 }}>
      {/* top row: numbers + analyze button */}
      <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.red }}>{totalWrong}</div>
          <div style={{ fontSize: 12, color: C.t3 }}>道错题</div>
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.t1 }}>{groups.length}</div>
          <div style={{ fontSize: 12, color: C.t3 }}>套练习</div>
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.blue }}>{gpFreq.length}</div>
          <div style={{ fontSize: 12, color: C.t3 }}>个语法点</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <button
            onClick={handleAnalyze}
            disabled={analysis.loading}
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#fff",
              background: analysis.loading ? "#9ca3af" : "linear-gradient(135deg, #7c3aed, #6d28d9)",
              border: "none",
              borderRadius: 8,
              padding: "9px 18px",
              cursor: analysis.loading ? "default" : "pointer",
              boxShadow: analysis.loading ? "none" : "0 2px 8px rgba(124,58,237,0.25)",
              transition: "all 0.2s",
            }}
          >
            {analysis.loading ? "⏳ 分析中..." : analysis.text ? "🔄 重新分析" : "🔍 AI 问题分析"}
          </button>
        </div>
      </div>

      {/* grammar point frequency bar */}
      {gpFreq.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.t2 }}>语法薄弱点分布</span>
            {gpFreq.length > 5 && (
              <button
                onClick={() => setShowDetail(!showDetail)}
                style={{ fontSize: 11, color: C.blue, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}
              >
                {showDetail ? "收起" : `查看全部 ${gpFreq.length} 个`}
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(showDetail ? gpFreq : gpFreq.slice(0, 5)).map((gp) => {
              const maxCount = gpFreq[0].count;
              const pct = (gp.count / maxCount) * 100;
              return (
                <div key={gp.tag} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 100, fontSize: 12, fontWeight: 600, color: C.t2, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {gp.label}
                  </div>
                  <div style={{ flex: 1, height: 18, background: C.bg, borderRadius: 4, overflow: "hidden", position: "relative" }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: pct > 60 ? "linear-gradient(90deg, #fbbf24, #f59e0b)" : pct > 30 ? "linear-gradient(90deg, #86efac, #22c55e)" : `linear-gradient(90deg, ${C.ltB}, ${C.blue})`,
                        borderRadius: 4,
                        transition: "width 0.4s ease",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.t1, width: 28, textAlign: "right", flexShrink: 0 }}>
                    {gp.count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AI analysis result */}
      {analysis.text && (
        <div
          style={{
            marginTop: 14,
            padding: "14px 16px",
            background: "linear-gradient(135deg, #faf5ff, #f3e8ff)",
            border: "1px solid #e9d5ff",
            borderRadius: 10,
            fontSize: 13.5,
            color: "#1e1b4b",
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed", marginBottom: 8 }}>🔍 AI 分析报告</div>
          {analysis.text}
        </div>
      )}
      {analysis.error && (
        <div style={{ marginTop: 10, fontSize: 12, color: C.red }}>
          分析失败：{analysis.error}
        </div>
      )}
    </SurfaceCard>
  );
}

/* ── main component ── */

function TabBar({ tab, setTab, totalWrong, favoritesCount }) {
  const tabs = [
    { key: "all", label: "全部错题", count: totalWrong },
    { key: "favorites", label: "★ 收藏", count: favoritesCount },
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        background: "#f1f5f9",
        borderRadius: 10,
        marginBottom: 14,
      }}
    >
      {tabs.map((t) => {
        const active = t.key === tab;
        return (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              border: "none",
              background: active ? "#fff" : "transparent",
              color: active ? C.t1 : C.t2,
              borderRadius: 7,
              padding: "7px 14px",
              fontSize: 13,
              fontWeight: active ? 700 : 500,
              cursor: "pointer",
              boxShadow: active ? "0 1px 2px rgba(15,23,42,0.08)" : "none",
              transition: "all 0.15s",
            }}
          >
            {t.label}
            <span style={{ marginLeft: 6, color: active ? C.t2 : C.t3, fontSize: 12, fontWeight: 600 }}>
              {t.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function MistakeNotebook({ onBack }) {
  const [hist, setHist] = useState(() => loadHist());
  const [tab, setTab] = useState("all");
  const { aiExplains, isLegacy, handleAiExplain } = useBsAiExplain();
  const { favorites, isStarred, toggleStar, error: favError } = useMistakeFavorites();

  // Listen for session store updates
  useEffect(() => {
    const refresh = () => setHist(loadHist());
    const timer = setInterval(refresh, 3000);
    if (typeof window !== "undefined" && SESSION_STORE_EVENTS?.UPDATED) {
      window.addEventListener(SESSION_STORE_EVENTS.UPDATED, refresh);
    }
    return () => {
      clearInterval(timer);
      if (typeof window !== "undefined" && SESSION_STORE_EVENTS?.UPDATED) {
        window.removeEventListener(SESSION_STORE_EVENTS.UPDATED, refresh);
      }
    };
  }, []);

  const groups = useMemo(
    () => extractMistakes(hist?.sessions || []),
    [hist],
  );

  const totalWrong = useMemo(
    () => groups.reduce((n, g) => n + g.wrongCount, 0),
    [groups],
  );

  const favoritesCount = favorites?.length || 0;

  return (
    <PageShell>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: `1px solid ${C.bdr}`,
            borderRadius: 8,
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 600,
            color: C.t2,
            cursor: "pointer",
          }}
        >
          ← 返回
        </button>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.t1, margin: 0 }}>
            错题本
          </h1>
          <div style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>
            Build a Sentence 练习中的错题
          </div>
        </div>
      </div>

      {/* empty state — only when both tabs would be empty */}
      {groups.length === 0 && favoritesCount === 0 ? (
        <SurfaceCard style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 6 }}>
            暂无错题
          </div>
          <div style={{ fontSize: 13, color: C.t3, lineHeight: 1.6 }}>
            完成几套 Build a Sentence 练习后，答错的题会自动收录在这里。
          </div>
        </SurfaceCard>
      ) : (
        <>
          <TabBar tab={tab} setTab={setTab} totalWrong={totalWrong} favoritesCount={favoritesCount} />
          {favError ? (
            <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 6, background: "#fef2f2", color: "#b91c1c", fontSize: 12 }}>
              收藏夹同步出错：{favError}
            </div>
          ) : null}

          {tab === "all" ? (
            <>
              {groups.length > 0 ? (
                <>
                  <StatsBar groups={groups} totalWrong={totalWrong} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {groups.map((g, gi) => (
                      <DisclosureSection
                        key={g.key}
                        title={`第 ${groups.length - gi} 套 · ${g.wrongCount}/${g.total} 错题`}
                        preview={formatLocalDateTime(g.date)}
                        badge={`${g.wrongCount} 题`}
                        icon="✗"
                        defaultOpen={gi === 0}
                        contentStyle={{ padding: "12px 14px", background: C.bg }}
                      >
                        {g.details.map((d, di) => (
                          <MistakeCard
                            key={`${g.key}-${di}`}
                            detail={d}
                            explainKey={`mn-${gi}-${di}`}
                            aiExplains={aiExplains}
                            isLegacy={isLegacy}
                            handleAiExplain={handleAiExplain}
                            sessionId={g.sessionId}
                            detailIndex={d._index}
                            sessionDate={g.date}
                            isStarred={isStarred(g.sessionId, d._index)}
                            onToggleStar={toggleStar}
                          />
                        ))}
                      </DisclosureSection>
                    ))}
                  </div>
                </>
              ) : (
                <SurfaceCard style={{ padding: "32px 24px", textAlign: "center" }}>
                  <div style={{ fontSize: 14, color: C.t2 }}>暂无错题记录。</div>
                </SurfaceCard>
              )}
            </>
          ) : (
            // Favorites tab
            <>
              {favoritesCount === 0 ? (
                <SurfaceCard style={{ padding: "40px 24px", textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 10, color: "#f59e0b" }}>★</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 6 }}>
                    暂无收藏的错题
                  </div>
                  <div style={{ fontSize: 13, color: C.t3, lineHeight: 1.6 }}>
                    在错题卡片右上角点击 ☆ 来收藏。
                  </div>
                </SurfaceCard>
              ) : (
                <SurfaceCard style={{ padding: "12px 14px", background: C.bg }}>
                  {favorites.map((f, fi) => {
                    const synthDetail = favoriteToDetail(f);
                    return (
                      <MistakeCard
                        key={f.id}
                        detail={synthDetail}
                        explainKey={`fav-${f.id}`}
                        aiExplains={aiExplains}
                        isLegacy={isLegacy}
                        handleAiExplain={handleAiExplain}
                        sessionId={f.session_id}
                        detailIndex={f.detail_index}
                        sessionDate={f.snapshot?.sessionDate || f.created_at}
                        isStarred={true}
                        onToggleStar={toggleStar}
                      />
                    );
                  })}
                </SurfaceCard>
              )}
            </>
          )}
        </>
      )}
    </PageShell>
  );
}

/**
 * Helper for homepage: count total BS mistakes from sessions.
 * Lightweight — call from HomePageClient to show badge count.
 */
export function countBsMistakes(sessions) {
  if (!Array.isArray(sessions)) return 0;
  return sessions
    .filter((s) => s.type === "bs" && Array.isArray(s.details))
    .reduce((n, s) => n + s.details.filter((d) => !d.isCorrect).length, 0);
}
