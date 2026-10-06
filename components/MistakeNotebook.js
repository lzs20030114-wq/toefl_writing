"use client";
import React, { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { translateGrammarPoint } from "../lib/utils";
import { C, PageShell, SurfaceCard } from "./shared/ui";
import { callAI, mapAiHelperError, AI_HELPER_MAX_TOKENS } from "../lib/ai/client";
import { getSavedTier } from "../lib/AuthContext";
import { useMistakePool } from "./mistakes/useMistakePool";
import { MistakeItemCard, useMistakeAi } from "./mistakes/MistakeCardView";
import { activeCards, removeCards, restoreCards, setStarred, summarizePool } from "../lib/mistakes/pool";
import { SUBJECT_META, SUBTYPE_META } from "../lib/mistakes/extract";
import { relativeDay, pct } from "../lib/mistakes/format";

// 错题本（2026-10 改版，方案 docs/mistake-notebook-redesign-2026-10-06.md）：
//   - 入口在首页左侧栏 / 移动端顶部，内嵌在首页中栏（embedded）；旧地址 /mistake-notebook 重定向过来
//   - 数据来自本地错题池（lib/mistakes/pool）：一题一条、跨练习去重、含模考错题
//   - 列表只负责「看 + 整理（收藏 / 移出）」；集中重做走 /mistake-drill（选题型 + 数量 → 做题 → 统计报告）
//   - 不做掌握判定 / 今日队列（2026-10-06 用户拍板）

const PAGE_SIZE = 30;
const SUBJECT_ORDER = ["bs", "reading", "listening"];
const SUBTYPES_BY_SUBJECT = {
  bs: ["bs"],
  reading: ["ctw", "rdl", "ap"],
  listening: ["lcr", "la", "lc", "lat"],
};

/* ── 拼句：语法薄弱点 + AI 问题分析（Pro） ── */

function grammarFreq(cards) {
  const freq = {};
  for (const c of cards) {
    for (const gp of c.brief?.grammar_points || []) freq[gp] = (freq[gp] || 0) + (c.wrongCount || 1);
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, label: translateGrammarPoint(tag), count }));
}

function buildAnalysisPrompt(cards, gpFreq, drills) {
  const totalWrongTimes = cards.reduce((n, c) => n + (c.wrongCount || 1), 0);
  const repeated = cards.filter((c) => (c.wrongCount || 1) >= 2).length;
  const top8 = gpFreq.slice(0, 8).map((gp) => `${gp.label}(${gp.tag}): ${gp.count}次`).join("、");
  const samples = cards
    .slice()
    .sort((a, b) => (b.wrongCount || 1) - (a.wrongCount || 1))
    .slice(0, 3)
    .map((c) => `错答:"${c.brief?.userAnswer || ""}" → 正确:"${c.brief?.correctAnswer || ""}" [${(c.brief?.grammar_points || []).join(",")}]`);
  const bsDrills = (drills || []).filter((d) => d?.byType?.bs?.total > 0).slice(-5);
  const drillLine = bsDrills.length > 0
    ? bsDrills.map((d) => `${d.byType.bs.correct}/${d.byType.bs.total}`).join("、")
    : "暂无";

  return `学生在 TOEFL Build a Sentence 拖拽造句练习中的错题数据如下：

错题本里共 ${cards.length} 道不同的错题（累计答错 ${totalWrongTimes} 次，其中 ${repeated} 道错过两次以上）
最近几次集中重做错题的拼句成绩：${drillLine}

语法薄弱点分布（按出错次数排序）：
${top8 || "（题目没有语法点标注）"}

典型错误示例：
${samples.join("\n")}

请用中文给出简洁的分析报告（200字以内），包含：
1. 最需要优先攻克的 2-3 个语法薄弱点及具体建议
2. 反复出错的题说明了什么
3. 一句鼓励的话`;
}

const ANALYSIS_SYSTEM = "你是一位专业的 TOEFL 写作辅导老师。根据学生的错题数据，给出简洁精准的薄弱点分析和学习建议。语气友善专业，不要废话。";

function BsAnalysis({ cards, drills, isLegacy }) {
  const gpFreq = useMemo(() => grammarFreq(cards), [cards]);
  const [showAll, setShowAll] = useState(false);
  const [analysis, setAnalysis] = useState({ loading: false, text: null, error: null });
  const [proHint, setProHint] = useState(false);

  const handleAnalyze = useCallback(async () => {
    // AI 问题分析走 DeepSeek，Pro 专属
    if (!isLegacy) {
      setProHint(true);
      setTimeout(() => setProHint(false), 3500);
      return;
    }
    if (analysis.loading) return;
    setAnalysis({ loading: true, text: null, error: null });
    try {
      const prompt = buildAnalysisPrompt(cards, gpFreq, drills);
      const text = await callAI(ANALYSIS_SYSTEM, prompt, AI_HELPER_MAX_TOKENS, 60000, 0.4);
      setAnalysis({ loading: false, text, error: null });
    } catch (e) {
      setAnalysis({ loading: false, text: null, error: mapAiHelperError(e) });
    }
  }, [cards, gpFreq, drills, analysis.loading, isLegacy]);

  if (cards.length === 0) return null;
  const maxCount = gpFreq[0]?.count || 1;

  return (
    <SurfaceCard style={{ padding: "14px 16px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>拼句语法薄弱点</div>
        <div style={{ fontSize: 12, color: C.t3 }}>按出错次数统计</div>
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={analysis.loading}
          title={!isLegacy ? "AI 问题分析是 Pro 功能" : undefined}
          style={{
            marginLeft: "auto",
            fontSize: 12.5, fontWeight: 700, color: "#fff",
            background: analysis.loading ? "#9ca3af" : !isLegacy ? "#64748b" : "#6d28d9",
            border: "none", borderRadius: 8, padding: "7px 14px",
            cursor: analysis.loading ? "default" : "pointer", fontFamily: "inherit",
          }}
        >
          {analysis.loading ? "分析中..." : !isLegacy ? "🔒 AI 问题分析 · Pro" : analysis.text ? "重新分析" : "AI 问题分析"}
        </button>
      </div>
      {proHint && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", padding: "8px 12px", borderRadius: 6 }}>
          AI 问题分析是 Pro 功能，升级后即可使用。
        </div>
      )}
      {gpFreq.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
          {(showAll ? gpFreq : gpFreq.slice(0, 5)).map((gp) => (
            <div key={gp.tag} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 110, fontSize: 12, fontWeight: 600, color: C.t2, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gp.label}</div>
              <div style={{ flex: 1, minWidth: 0, height: 14, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${(gp.count / maxCount) * 100}%`, height: "100%", background: SUBJECT_META.bs.color, opacity: 0.75, borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.t1, width: 28, textAlign: "right", flexShrink: 0 }}>{gp.count}</span>
            </div>
          ))}
          {gpFreq.length > 5 && (
            <button type="button" onClick={() => setShowAll(!showAll)} style={{ alignSelf: "flex-start", fontSize: 12, color: C.blue, background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0, fontFamily: "inherit" }}>
              {showAll ? "收起" : `查看全部 ${gpFreq.length} 个`}
            </button>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 10, fontSize: 12, color: C.t3 }}>这些题没有语法点标注（真题拼句不带语法点）。</div>
      )}
      {analysis.text && (
        <div style={{ marginTop: 12, padding: "12px 14px", background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 10, fontSize: 13.5, color: "#1e1b4b", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed", marginBottom: 6 }}>AI 分析报告</div>
          {analysis.text}
        </div>
      )}
      {analysis.error && <div style={{ marginTop: 10, fontSize: 12, color: C.red }}>分析失败：{analysis.error}</div>}
    </SurfaceCard>
  );
}

/* ── 顶部摘要卡 ── */

function SummaryCard({ summary }) {
  const chips = Object.keys(SUBTYPE_META)
    .filter((st) => summary.bySubtype[st] > 0)
    .map((st) => `${SUBTYPE_META[st].label} ${summary.bySubtype[st]}`);
  const last = summary.lastDrill;
  return (
    <SurfaceCard style={{ padding: "18px 20px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 800, color: C.t1, fontVariantNumeric: "tabular-nums" }}>{summary.total}</span>
            <span style={{ fontSize: 13, color: C.t2 }}>道错题</span>
          </div>
          <div style={{ fontSize: 12.5, color: C.t2, marginTop: 4, lineHeight: 1.6 }}>
            {chips.length > 0 ? chips.join(" · ") : "做拼句、阅读、听力练习时答错的题会自动收进来"}
          </div>
          <div style={{ fontSize: 12, color: C.t3, marginTop: 4 }}>
            收藏 {summary.starred} · 本周新增 {summary.weekNew} · 还没重做过 {summary.neverDrilled}
            {last ? ` · 上次练错题：${relativeDay(last.at)} ${last.total} 题对 ${last.correct}（${pct(last.correct, last.total)}%）` : ""}
          </div>
        </div>
        <Link
          href="/mistake-drill"
          data-testid="mistake-drill-entry"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: summary.total > 0 ? "#E11D48" : "#cbd5e1",
            color: "#fff", fontWeight: 700, fontSize: 14,
            borderRadius: 10, padding: "11px 22px", textDecoration: "none",
            pointerEvents: summary.total > 0 ? "auto" : "none",
            flexShrink: 0,
          }}
          aria-disabled={summary.total === 0}
        >
          练错题 →
        </Link>
      </div>
    </SurfaceCard>
  );
}

/* ── 筛选条 ── */

function Chip({ active, onClick, children, color = C.t1, soft = "#fff" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        border: `1px solid ${active ? color : C.bdr}`,
        background: active ? soft : "#fff",
        color: active ? color : C.t2,
        borderRadius: 999,
        padding: "5px 12px",
        fontSize: 12.5,
        fontWeight: active ? 700 : 500,
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

const TIME_OPTIONS = [
  { key: "all", label: "全部时间", days: null },
  { key: "7", label: "最近 7 天", days: 7 },
  { key: "30", label: "最近 30 天", days: 30 },
];

/* ── 主组件 ── */

export default function MistakeNotebook({ onBack, embedded = false, initialSection, initialSubject }) {
  const { pool, ready } = useMistakePool({ derive: true, migrateFavorites: true });
  const ai = useMistakeAi();
  const [subject, setSubject] = useState(() => {
    const s = initialSubject || initialSection;
    return SUBJECT_META[s] ? s : "all";
  });
  const [subtype, setSubtype] = useState(null);
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [onlyUndrilled, setOnlyUndrilled] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const [timeKey, setTimeKey] = useState("all");
  const [sort, setSort] = useState("recent");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [isLegacy, setIsLegacy] = useState(false);

  useEffect(() => {
    const tier = getSavedTier();
    setIsLegacy(tier === "pro" || tier === "legacy");
  }, []);

  useEffect(() => { setLimit(PAGE_SIZE); }, [subject, subtype, onlyStarred, onlyUndrilled, showRemoved, timeKey, sort]);

  const summary = useMemo(() => summarizePool(pool), [pool]);
  const all = useMemo(() => activeCards(pool), [pool]);
  const removed = useMemo(() => Object.values(pool.cards || {}).filter((c) => c && c.deletedAt), [pool]);

  const filtered = useMemo(() => {
    const base = showRemoved ? removed : all;
    const days = TIME_OPTIONS.find((t) => t.key === timeKey)?.days;
    const since = days ? Date.now() - days * 86400000 : null;
    const list = base.filter((c) => {
      if (subject !== "all" && c.subject !== subject) return false;
      if (subtype && c.subtype !== subtype) return false;
      if (onlyStarred && !c.starred) return false;
      if (onlyUndrilled && c.lastDrill) return false;
      if (since && new Date(c.lastWrongAt || 0).getTime() < since) return false;
      return true;
    });
    return list.sort((a, b) => {
      if (sort === "most") {
        const d = (b.wrongCount || 1) - (a.wrongCount || 1);
        if (d !== 0) return d;
      }
      return new Date(b.lastWrongAt || 0) - new Date(a.lastWrongAt || 0);
    });
  }, [all, removed, showRemoved, subject, subtype, onlyStarred, onlyUndrilled, timeKey, sort]);

  const bsCards = useMemo(() => all.filter((c) => c.subject === "bs"), [all]);

  const toggleStar = useCallback((card) => setStarred(card.key, !card.starred), []);
  const remove = useCallback((card) => removeCards([card.key]), []);
  const restore = useCallback((card) => restoreCards([card.key]), []);

  const body = (
    <>
      {!ready ? (
        <SurfaceCard style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: C.t3 }}>正在整理错题...</div>
        </SurfaceCard>
      ) : (
        <>
          <SummaryCard summary={summary} />

          {/* 科目 */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <Chip active={subject === "all"} onClick={() => { setSubject("all"); setSubtype(null); }}>全部 {summary.total}</Chip>
            {SUBJECT_ORDER.map((s) => (
              <Chip key={s} active={subject === s} color={SUBJECT_META[s].color} soft={SUBJECT_META[s].soft} onClick={() => { setSubject(s); setSubtype(null); }}>
                {SUBJECT_META[s].label} {summary.bySubject[s] || 0}
              </Chip>
            ))}
          </div>
          {/* 题型 */}
          {subject !== "all" && SUBTYPES_BY_SUBJECT[subject].length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {SUBTYPES_BY_SUBJECT[subject].filter((st) => summary.bySubtype[st] > 0).map((st) => (
                <Chip key={st} active={subtype === st} color={SUBJECT_META[subject].color} soft={SUBJECT_META[subject].soft} onClick={() => setSubtype(subtype === st ? null : st)}>
                  {SUBTYPE_META[st].label} {summary.bySubtype[st]}
                </Chip>
              ))}
            </div>
          )}
          {/* 状态 / 时间 / 排序 */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <Chip active={onlyStarred} color="#d97706" soft="#fffbeb" onClick={() => setOnlyStarred(!onlyStarred)}>★ 收藏</Chip>
            <Chip active={onlyUndrilled} onClick={() => setOnlyUndrilled(!onlyUndrilled)}>还没重做过</Chip>
            {TIME_OPTIONS.map((t) => (
              <Chip key={t.key} active={timeKey === t.key} onClick={() => setTimeKey(t.key)}>{t.label}</Chip>
            ))}
            <span style={{ flex: 1 }} />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="排序"
              style={{ fontSize: 12.5, border: `1px solid ${C.bdr}`, borderRadius: 8, padding: "5px 8px", background: "#fff", color: C.t2, fontFamily: "inherit" }}
            >
              <option value="recent">最近错的在前</option>
              <option value="most">错得最多在前</option>
            </select>
            {removed.length > 0 && (
              <Chip active={showRemoved} onClick={() => setShowRemoved(!showRemoved)}>已移出 {removed.length}</Chip>
            )}
          </div>

          {!showRemoved && (subject === "all" || subject === "bs") && !subtype && bsCards.length > 0 && (
            <BsAnalysis cards={bsCards} drills={pool.drills} isLegacy={isLegacy} />
          )}

          {filtered.length === 0 ? (
            <SurfaceCard style={{ padding: "40px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 6 }}>
                {summary.total === 0 && !showRemoved ? "暂无错题" : "没有符合条件的错题"}
              </div>
              <div style={{ fontSize: 13, color: C.t3, lineHeight: 1.6 }}>
                {summary.total === 0 && !showRemoved
                  ? "拼句、阅读（填词 / 日常 / 学术）、听力（应答 / 公告 / 对话 / 讲座）以及阅读听力模考里答错的题，会自动收在这里。口语和写作没有标准答案，不收。"
                  : "换个筛选条件看看。"}
              </div>
            </SurfaceCard>
          ) : (
            <>
              <div style={{ fontSize: 12, color: C.t3, marginBottom: 8 }}>共 {filtered.length} 道</div>
              {filtered.slice(0, limit).map((card) => (
                <MistakeItemCard
                  key={card.key}
                  card={card}
                  items={pool.items}
                  ai={ai}
                  onToggleStar={showRemoved ? undefined : toggleStar}
                  onRemove={showRemoved ? undefined : remove}
                  onRestore={showRemoved ? restore : undefined}
                  drillHref={showRemoved ? undefined : `/mistake-drill?key=${encodeURIComponent(card.key)}`}
                />
              ))}
              {filtered.length > limit && (
                <div style={{ textAlign: "center", margin: "6px 0 18px" }}>
                  <button
                    type="button"
                    onClick={() => setLimit(limit + PAGE_SIZE)}
                    style={{ border: `1px solid ${C.bdr}`, background: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13, color: C.t2, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    再显示 {Math.min(PAGE_SIZE, filtered.length - limit)} 道
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );

  if (embedded) {
    return (
      <div data-testid="mistake-notebook">
        <div style={{ marginBottom: 14 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.t1, margin: 0 }}>错题本</h1>
          <div style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>做错的题自动收集 · 一题一条 · 可按题型抽题集中重做</div>
        </div>
        {body}
      </div>
    );
  }

  return (
    <PageShell>
      <div data-testid="mistake-notebook">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: C.t1, margin: 0 }}>错题本</h1>
            <div style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>做错的题自动收集 · 一题一条 · 可按题型抽题集中重做</div>
          </div>
          {onBack && (
            <button
              onClick={onBack}
              style={{ background: "none", border: `1px solid ${C.bdr}`, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, color: C.t2, cursor: "pointer", flexShrink: 0 }}
            >
              返回
            </button>
          )}
        </div>
        {body}
      </div>
    </PageShell>
  );
}
