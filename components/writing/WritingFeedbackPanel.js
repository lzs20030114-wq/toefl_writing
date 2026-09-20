"use client";
import React, { useState, useEffect, useRef } from "react";
import { FONT, NEUTRAL } from "../shared/ui";
import { getSavedCode, getSavedTier } from "../../lib/AuthContext";
import UpgradeModal from "../shared/UpgradeModal";
import { useIsMobile } from "../../hooks/useIsMobile";
import VocabCEFRPanel from "./VocabCEFRPanel";

const P = {
  ...NEUTRAL,
  primary: "#0d9668", primaryDeep: "#087355", primarySoft: "#ecfdf5",
  teal: "#0891B2", tealSoft: "#ecfeff",
  amber: "#d97706", amberSoft: "#fffbeb",
  rose: "#E11D48", roseSoft: "#fff1f2",
  purple: "#7c3aed", purpleSoft: "#f5f3ff",
  shadowMd: "0 4px 14px rgba(10,40,25,0.06), 0 1px 3px rgba(10,40,25,0.03)",
};

// 三维度小卡的中文标签。rubric 里的 definition / note 是英文内部说明，不渲染。
const DIM_LABELS = [
  { key: "task_fulfillment", label: "任务完成" },
  { key: "organization_coherence", label: "组织连贯" },
  { key: "language_use", label: "语言使用" },
];

function fmtDimScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return String(Math.round(n * 2) / 2);
}

function levelToCategory(level, errorType) {
  if (level === "red") {
    if (String(errorType || "").toLowerCase() === "spelling") return "拼写错误";
    return "语法错误";
  }
  if (level === "orange") return "表达建议";
  return "拔高建议";
}

function segmentsToTokens(segments) {
  return segments.map((seg, idx) => {
    if (seg.type !== "mark") return { id: `t${idx}`, type: "normal", text: seg.text };
    return { id: `err${idx}`, type: "error", level: seg.level, errorType: seg.errorType || "", category: levelToCategory(seg.level, seg.errorType), text: seg.text, suggestion: seg.fix || "", note: seg.note || "" };
  });
}

function ActionBtn({ children, onClick, danger }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: "7px 14px", borderRadius: 8, border: `1px solid ${danger ? "#fecaca" : P.border}`,
        background: hov ? (danger ? "#fee2e2" : P.bg) : P.surface,
        color: danger ? "#dc2626" : P.textSec,
        fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
        transition: "background 0.15s",
      }}
    >
      {children}
    </button>
  );
}

function ProBlur({ isPro, children }) {
  if (isPro) return <>{children}</>;
  return <span style={{ filter: "blur(5px)", userSelect: "none", WebkitUserSelect: "none" }}>{children}</span>;
}

function UpgradeBanner({ onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
        padding: "12px 20px", marginTop: 16,
        background: "linear-gradient(135deg, #ecfdf5, #ecfeff)",
        border: `1px solid ${P.primary}30`, borderRadius: 12,
        cursor: "pointer", transition: "box-shadow 0.2s",
      }}
    >
      <span style={{ fontSize: 14, flexShrink: 0 }}>{"\uD83D\uDD12"}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: P.primaryDeep }}>升级 Pro 解锁完整批改报告</span>
      <span style={{ padding: "5px 14px", borderRadius: 8, background: `linear-gradient(135deg, ${P.primaryDeep}, #0891B2)`, color: "#fff", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>升级</span>
    </div>
  );
}

function PromptCollapse({ type, pd }) {
  if (!pd) return null;
  let content = null;
  if (type === "email") {
    content = (
      <div style={{ fontSize: 13, color: P.textSec, lineHeight: 1.7 }}>
        <div style={{ marginBottom: 8 }}><b style={{ color: P.text }}>场景：</b>{pd.scenario}</div>
        <div style={{ marginBottom: 8 }}><b style={{ color: P.text }}>要求：</b>{pd.direction}</div>
        {Array.isArray(pd.goals) && pd.goals.length > 0 && (
          <div>
            <b style={{ color: P.text }}>三个目标：</b>
            <ol style={{ margin: "6px 0 0 16px", padding: 0 }}>
              {pd.goals.map((g, i) => <li key={i} style={{ marginBottom: 3 }}>{g}</li>)}
            </ol>
          </div>
        )}
      </div>
    );
  } else {
    content = (
      <div style={{ fontSize: 13, color: P.textSec, lineHeight: 1.7 }}>
        {pd.professor && (
          <div style={{ marginBottom: 10 }}>
            <b style={{ color: P.text }}>{pd.professor.name}（教授）：</b>
            <div style={{ marginTop: 3 }}>{pd.professor.text}</div>
          </div>
        )}
        {Array.isArray(pd.students) && pd.students.map((s, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <b style={{ color: P.text }}>{s.name}：</b>
            <span>{s.text}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <details>
      <summary style={{ fontSize: 11, fontWeight: 700, color: P.textDim, textTransform: "uppercase", letterSpacing: 0.5, cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 6, userSelect: "none" }}>
        <span>▶</span> 展开查看原题目 (The Prompt)
      </summary>
      <div style={{ marginTop: 10, padding: "14px 16px", background: P.bg, borderRadius: 10, border: `1px solid ${P.borderSubtle}` }}>
        {content}
      </div>
    </details>
  );
}

export function WritingFeedbackPanel({ fb, type, pd, userText, onNext, onRetry, onExit, topBarHeight = 56, containerHeight, lessonState, onRetryLesson }) {
  const [secondaryTab, setSecondaryTab] = useState("macro");
  // 「现在动手」的三条自查只是给用户自己打勾用的，纯本地 state，不入库。
  const [checkedChecks, setCheckedChecks] = useState({});
  const [activeErrorId, setActiveErrorId] = useState(null);
  const [tooltipFlip, setTooltipFlip] = useState(false);
  const leftPanelRef = useRef(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState("text"); // text | macro | linebyline | sample

  const isPro = (() => {
    try { const t = getSavedTier(); return t === "pro" || t === "legacy"; }
    catch { return false; }
  })();

  useEffect(() => {
    function handleOutside(e) {
      if (!e.target.closest("[data-error-token]")) setActiveErrorId(null);
    }
    document.addEventListener("click", handleOutside);
    return () => document.removeEventListener("click", handleOutside);
  }, []);

  const score = Number.isFinite(Number(fb?.score)) ? Number(fb.score) : null;
  const band = fb?.band != null ? String(fb.band) : null;
  // 2026 TOEFL 6-band conversion: 5→6, 4.5→5.5, 4→5, 3.5→4.5, 3→4, 2.5→3, 2→2, 1.5→1.5, 1→1
  const band6 = score != null ? Math.round(Math.min(6, Math.max(1, score + 1)) * 2) / 2 : null;
  const summary = String(fb?.summary || "").trim();
  const goals = Array.isArray(fb?.goals) ? fb.goals : [];
  const actions = Array.isArray(fb?.actions) ? fb.actions : [];
  const patterns = Array.isArray(fb?.patterns) ? fb.patterns : [];
  const marks = Array.isArray(fb?.annotationSegments) ? fb.annotationSegments : [];
  const comparison = fb?.comparison || { modelEssay: "", points: [] };
  const dims = fb?.rubric?.dimensions || null;
  const errorTriage = fb?.errorTriage || null;
  // 讲评(lesson)：评分之后的第二次调用产物。没有它时整页保持改造前的样子。
  const lesson = fb?.lesson && typeof fb.lesson === "object" ? fb.lesson : null;
  const lessonVerdict = lesson?.verdict || null;
  const hasVerdict = Boolean(
    lessonVerdict && (lessonVerdict.goal || lessonVerdict.now || lessonVerdict.next)
  );
  const lessonFocus = lesson?.focus || null;
  const hasFocus = Boolean(lessonFocus && (lessonFocus.strategy || lessonFocus.rewrite));
  const lessonLanguage = Array.isArray(lesson?.language) ? lesson.language : [];
  const lessonCompare = Array.isArray(lesson?.compare) ? lesson.compare : [];
  const lessonNext = lesson?.next || null;
  const lessonChecks = Array.isArray(lessonNext?.checks) ? lessonNext.checks : [];

  const tokens = segmentsToTokens(marks);
  const errorTokens = tokens.filter((t) => t.type === "error");

  const WRITING_TABS = [
    { id: "macro", label: "宏观评价与建议" },
    { id: "linebyline", label: "逐句批注大纲" },
    { id: "vocab", label: "词汇分析" },
    { id: "sample", label: "范文对比分析" },
  ];

  const taskLabel = type === "email" ? "邮件写作" : "学术讨论";

  function renderActionCards() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {actions.map((a, i) => (
          <div key={i} style={{ background: P.surface, borderRadius: 12, border: `1px solid ${P.borderSubtle}`, borderLeft: `4px solid ${i === 0 ? P.rose : P.amber}`, padding: "14px 16px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: P.text, marginBottom: 10 }}>{a.title || `短板 ${i + 1}`}</div>
            <div style={{ fontSize: 13, color: P.textSec, lineHeight: 1.7, marginBottom: 8 }}>
              <b style={{ color: P.text, background: P.roseSoft, padding: "0 3px", borderRadius: 3 }}>为什么重要：</b> {a.importance || "未提供"}
            </div>
            <div style={{ fontSize: 13, color: P.textSec, lineHeight: 1.7 }}>
              <b style={{ color: P.primaryDeep, background: P.primarySoft, padding: "0 3px", borderRadius: 3 }}>现在可做的：</b> {a.action || "未提供"}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // 「本课只讲一件事」——讲评的主体。loading 放骨架卡，error 给重试按钮，
  // 历史记录页（没有 lessonState 也没有 lesson）什么都不渲染。
  function renderLessonFocus() {
    if (!hasFocus) {
      if (lessonState === "loading") {
        return (
          <div style={{ background: P.surface, borderRadius: 14, border: `1px dashed ${P.border}`, padding: "18px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: P.text, marginBottom: 10 }}>本课只讲一件事</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {[72, 100, 88].map((w, i) => (
                <div key={i} style={{ height: 10, width: `${w}%`, borderRadius: 999, background: P.bg }} />
              ))}
            </div>
            <div style={{ fontSize: 12, color: P.textDim, lineHeight: 1.6 }}>讲评生成中，约 30 秒，可以先看逐句批注</div>
          </div>
        );
      }
      if (lessonState === "error") {
        return (
          <div style={{ background: P.surface, borderRadius: 14, border: `1px solid ${P.border}`, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: P.textSec }}>讲评生成失败</span>
            {onRetryLesson ? <ActionBtn onClick={onRetryLesson}>重新生成讲评</ActionBtn> : null}
          </div>
        );
      }
      return null;
    }
    const rows = [
      { label: "证据", value: lessonFocus.evidence },
      { label: "缺的是", value: lessonFocus.missing },
    ].filter((r) => String(r.value || "").trim());
    return (
      <div style={{ background: P.surface, borderRadius: 14, border: `1px solid ${P.borderSubtle}`, borderLeft: `4px solid ${P.primary}`, padding: "16px 18px", boxShadow: P.shadow }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: P.textDim, letterSpacing: 0.5, marginBottom: 6 }}>本课只讲一件事</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: P.text, lineHeight: 1.5, marginBottom: 12 }}>{lessonFocus.strategy || "本课重点"}</div>
        {rows.map((r) => (
          <div key={r.label} style={{ fontSize: 13, color: P.textSec, lineHeight: 1.75, marginBottom: 8 }}>
            <b style={{ color: P.text }}>{r.label}：</b>{r.value}
          </div>
        ))}
        {String(lessonFocus.rewrite || "").trim() ? (
          <div style={{ marginTop: 10, background: P.primarySoft, border: `1px solid ${P.primary}25`, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: P.primaryDeep, marginBottom: 6 }}>示范改写</div>
            <div style={{ fontSize: 13.5, color: "#052e16", lineHeight: 1.85, fontFamily: "Georgia, 'Times New Roman', serif", whiteSpace: "pre-wrap" }}>{lessonFocus.rewrite}</div>
          </div>
        ) : null}
        {String(lessonFocus.transfer || "").trim() ? (
          <div style={{ marginTop: 10, fontSize: 12.5, color: P.textSec, lineHeight: 1.7 }}>
            <b style={{ color: P.text }}>迁移：</b>{lessonFocus.transfer}
          </div>
        ) : null}
      </div>
    );
  }

  function renderLessonLanguage() {
    if (lessonLanguage.length === 0) return null;
    return (
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 12 }}>先改这几处语言</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lessonLanguage.map((item, i) => (
            <div key={i} style={{ background: P.surface, borderRadius: 10, border: `1px solid ${P.border}`, padding: "11px 13px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontStyle: "italic", color: P.text, lineHeight: 1.65 }}>{item.quote || "（未给出原句）"}</div>
                {item.kind ? (
                  <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap", background: item.kind === "treatable" ? P.tealSoft : P.amberSoft, color: item.kind === "treatable" ? P.teal : P.amber }}>
                    {item.kind === "treatable" ? "可治" : "不可治"}
                  </span>
                ) : null}
              </div>
              {item.fix ? <div style={{ marginTop: 6, fontSize: 12.5, color: P.textSec, lineHeight: 1.7 }}>{item.fix}</div> : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderLessonNext() {
    const task = String(lessonNext?.task || "").trim();
    if (!task && lessonChecks.length === 0) return null;
    return (
      <div style={{ background: P.amberSoft, borderRadius: 14, border: `1px solid ${P.amber}30`, padding: "16px 18px" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: P.text, marginBottom: 10 }}>现在动手</div>
        {task ? <div style={{ fontSize: 13.5, color: P.text, lineHeight: 1.8, marginBottom: lessonChecks.length ? 12 : 0 }}>{task}</div> : null}
        {lessonChecks.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lessonChecks.map((check, i) => (
              <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12.5, color: P.textSec, lineHeight: 1.7, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(checkedChecks[i])}
                  onChange={() => setCheckedChecks((prev) => ({ ...prev, [i]: !prev[i] }))}
                  style={{ marginTop: 3, flexShrink: 0, accentColor: P.primary, cursor: "pointer" }}
                />
                <span style={{ minWidth: 0, textDecoration: checkedChecks[i] ? "line-through" : "none", opacity: checkedChecks[i] ? 0.6 : 1 }}>{check}</span>
              </label>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderMacro() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Score card */}
        <div style={{ background: "#0f2318", borderRadius: 16, padding: "22px 24px", color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <span style={{ fontSize: 48, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{score ?? "--"}</span>
              <span style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", fontWeight: 700, marginBottom: 8 }}>/ 5</span>
            </div>
            {score != null ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                {band6 != null && <span style={{ padding: "3px 10px", background: "rgba(52,211,153,0.15)", color: "#34d399", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>换算 {band6}/6</span>}
                {band ? <span style={{ padding: "2px 8px", background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)", borderRadius: 999, fontSize: 10, fontWeight: 600 }}>{band}</span> : null}
              </div>
            ) : null}
          </div>
          {hasVerdict ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: dims || goals.length ? 18 : 0 }}>
              {[
                { label: "目标", value: lessonVerdict.goal },
                { label: "现状", value: lessonVerdict.now },
                { label: "下一步", value: lessonVerdict.next },
              ].filter((r) => String(r.value || "").trim()).map((r) => (
                <div key={r.label} style={{ fontSize: 13, color: "rgba(255,255,255,0.78)", lineHeight: 1.75 }}>
                  <b style={{ color: "#fff", fontWeight: 800 }}>{r.label}：</b>
                  {r.value}
                </div>
              ))}
            </div>
          ) : summary ? (
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.75, margin: 0, marginBottom: dims || goals.length ? 18 : 0 }}>{summary}</p>
          ) : null}
          {dims ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(3, minmax(0, 1fr))",
                gap: 8,
                marginBottom: type === "email" && goals.length > 0 ? 18 : 0,
              }}
            >
              {DIM_LABELS.map(({ key, label }) => {
                const d = dims[key] || {};
                const reason = String(d.reason || "").trim();
                return (
                  <div key={key} style={{ minWidth: 0, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.55)" }}>{label}</span>
                      <span style={{ fontSize: 16, fontWeight: 800, color: "#34d399" }}>{fmtDimScore(d.score)}</span>
                    </div>
                    {reason ? <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6, color: "rgba(255,255,255,0.72)" }}>{reason}</div> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {type === "email" && goals.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {goals.map((g) => {
                const statusMap = {
                  OK: { label: "已达成", color: "#4ade80", bg: "rgba(74,222,128,0.15)" },
                  PARTIAL: { label: "部分达成", color: "#fb923c", bg: "rgba(251,146,60,0.15)" },
                  MISSING: { label: "未覆盖", color: "#f87171", bg: "rgba(248,113,113,0.15)" },
                };
                const ui = statusMap[String(g.status || "").toUpperCase()] || statusMap.PARTIAL;
                return (
                  <div key={g.index} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 999, background: ui.bg, color: ui.color, fontSize: 10, fontWeight: 800, whiteSpace: "nowrap", flexShrink: 0 }}>{ui.label}</span>
                    <span style={{ fontSize: 12, lineHeight: 1.6, color: "rgba(255,255,255,0.82)" }}>目标 {g.index}：{g.reason || "无说明"}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        {renderLessonFocus()}
        {renderLessonLanguage()}
        {renderLessonNext()}

        {actions.length > 0 ? (
          lesson ? (
            /* 有讲评时，评分那一路给的短板卡降级为可展开的附录：一次只教一件事，
               这两张卡留着备查，但不再和「本课」抢注意力。 */
            <details>
              <summary style={{ fontSize: 12, fontWeight: 700, color: P.textDim, cursor: "pointer", userSelect: "none" }}>
                评分时给出的短板卡
              </summary>
              <div style={{ marginTop: 12 }}>{renderActionCards()}</div>
            </details>
          ) : (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 12 }}>结构与语域优化建议</div>
              {renderActionCards()}
            </div>
          )
        ) : null}

        {patterns.length > 0 ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 12 }}>错误规律总结</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[...patterns].sort((a, b) => Number(b?.count || 0) - Number(a?.count || 0)).map((p, i) => (
                <div key={i} style={{ background: P.surface, borderRadius: 10, border: `1px solid ${P.border}`, padding: "11px 13px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: P.text }}>{p.tag || "未分类"}</span>
                    <span style={{ fontSize: 11, color: P.textDim }}>出现 {Number(p.count || 0)} 次</span>
                  </div>
                  <div style={{ fontSize: 12, color: P.textSec, lineHeight: 1.6 }}>{p.summary || ""}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // ===ERRORS=== 段：模型自己判定的「哪几条真的压分」。放在逐句批注最前面，
  // 让用户先看到决定分数的少数几条，再看全部批注，而不是把小错与大错混成一堆。
  function renderErrorTriage() {
    if (!errorTriage) return null;
    const capped = Array.isArray(errorTriage.capped) ? errorTriage.capped : [];
    const minorSummary = String(errorTriage.minorSummary || "").trim();
    const verdict = String(errorTriage.verdict || "").trim();
    if (!capped.length && !minorSummary && !verdict) return null;
    return (
      <div style={{ marginBottom: 18, background: P.surface, borderRadius: 12, border: `1px solid ${P.border}`, padding: "14px 16px" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: P.text, marginBottom: 10 }}>影响分数的错误</div>
        {capped.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {capped.map((item, i) => (
              <div key={i} style={{ background: P.bg, borderRadius: 10, border: `1px solid ${P.borderSubtle}`, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontStyle: "italic", color: P.text, lineHeight: 1.65 }}>{item.quote || "（未给出原句）"}</div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {item.impedes === true ? (
                      <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: P.roseSoft, color: P.rose, whiteSpace: "nowrap" }}>妨碍理解</span>
                    ) : null}
                    {item.systemic === true ? (
                      <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: P.amberSoft, color: P.amber, whiteSpace: "nowrap" }}>系统性失控</span>
                    ) : null}
                  </div>
                </div>
                {item.issue ? <div style={{ marginTop: 6, fontSize: 12.5, color: P.textSec, lineHeight: 1.7 }}>{item.issue}</div> : null}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: P.textSec, lineHeight: 1.7 }}>没有真正拉低分数的语法错误</div>
        )}
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: P.textSec, lineHeight: 1.6 }}>
            不压分的限时小错：{minorSummary || "无"}
          </summary>
          <div style={{ marginTop: 6, fontSize: 11.5, color: P.textDim, lineHeight: 1.7 }}>
            ETS 官方 5 分样文同样含约十处这类小错，它们不决定分数
          </div>
        </details>
        {verdict ? <div style={{ marginTop: 10, fontSize: 11, color: P.textDim, lineHeight: 1.6 }}>{verdict}</div> : null}
      </div>
    );
  }

  function renderLineByLine() {
    const triage = renderErrorTriage();
    if (!errorTokens.length) return (
      <div>
        {triage}
        <div style={{ padding: "40px", textAlign: "center", color: P.textDim, fontSize: 13, background: P.bg, borderRadius: 12, border: `1px dashed ${P.borderSubtle}` }}>暂无逐句批注数据。</div>
      </div>
    );
    return (
      <div>
        {triage}
        <p style={{ fontSize: 13, color: P.textSec, marginBottom: 16 }}>
          共发现 <b style={{ color: P.text }}>{errorTokens.length}</b> 处表达问题。
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {errorTokens.map((err) => {
            const isActive = activeErrorId === err.id;
            const errIsSpelling = err.level === "red" && String(err.errorType || "").toLowerCase() === "spelling";
            const catColor = err.level === "red" ? (errIsSpelling ? P.purple : P.rose) : err.level === "orange" ? P.amber : P.teal;
            return (
              <button
                key={err.id}
                onClick={() => {
                  const next = isActive ? null : err.id;
                  setActiveErrorId(next);
                  if (!isActive) {
                    const el = document.getElementById(`mark-${err.id}`);
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                  }
                }}
                style={{ width: "100%", textAlign: "left", padding: "14px 16px", borderRadius: 12, border: `1.5px solid ${isActive ? P.amber : P.borderSubtle}`, background: isActive ? P.amberSoft : P.surface, boxShadow: isActive ? `0 0 0 3px ${P.amber}20, ${P.shadowMd}` : P.shadow, transform: isActive ? "scale(1.01)" : "none", transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)", cursor: "pointer" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: `${catColor}15`, color: catColor }}>{err.category}</span>
                  {isActive ? <span style={{ fontSize: 11, fontWeight: 700, color: P.amber }}>正在左侧查看</span> : null}
                </div>
                <div style={{ fontSize: 13, color: P.textDim, textDecoration: "line-through", textDecorationColor: P.rose, marginBottom: 6 }}>{err.text}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: P.primary }}>{err.suggestion || "（暂无建议）"}</div>
                {err.note ? <div style={{ fontSize: 12, color: P.textSec, lineHeight: 1.6, marginTop: 4 }}>{err.note}</div> : null}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // 核心差异分析：有讲评的对比点就用讲评那一版（维度名 / 你的 / 范文 / 差在，
  // 每条都指着具体原句），否则回落到评分报告里的 comparison.points。
  function renderLessonCompare() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {lessonCompare.map((pt, i) => (
          <div key={i} style={{ background: P.surface, borderRadius: 12, border: `1px solid ${P.border}`, padding: "14px 16px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 8 }}>{pt.index ? `${pt.index}. ` : ""}{pt.dim || "对比"}</div>
            {pt.yours ? <div style={{ background: P.bg, borderRadius: 7, padding: "8px 10px", fontSize: 12, marginBottom: 6 }}><b>你的：</b><ProBlur isPro={isPro}>{pt.yours}</ProBlur></div> : null}
            {pt.model ? <div style={{ background: P.primarySoft, borderRadius: 7, padding: "8px 10px", fontSize: 12, marginBottom: 6 }}><b>范文：</b><ProBlur isPro={isPro}>{pt.model}</ProBlur></div> : null}
            {pt.gap ? <div style={{ fontSize: 13, color: P.textSec, lineHeight: 1.65 }}><b>差在：</b><ProBlur isPro={isPro}>{pt.gap}</ProBlur></div> : null}
          </div>
        ))}
      </div>
    );
  }

  function renderSample() {
    const modelEssay = String(comparison.modelEssay || "").trim();
    const points = Array.isArray(comparison.points) ? comparison.points : [];
    const useLessonCompare = lessonCompare.length > 0;
    if (!modelEssay && !points.length && !useLessonCompare) return <div style={{ padding: "40px 0", textAlign: "center", color: P.textDim, fontSize: 13 }}>暂无范文对比数据。</div>;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {modelEssay ? (
          <div style={{ background: P.primarySoft, borderRadius: 16, padding: "20px 22px", border: `1px solid ${P.primary}25` }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: P.primaryDeep, letterSpacing: 0.3, marginBottom: 14 }}>AI 参考范文 · 众多可行写法之一</div>
            {isPro ? (
              <div style={{ fontSize: 14, color: "#052e16", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>{modelEssay}</div>
            ) : (
              <div style={{ fontSize: 14, color: "#052e16", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>
                {modelEssay.slice(0, 80)}
                {modelEssay.length > 80 && <span style={{ filter: "blur(5px)", userSelect: "none", WebkitUserSelect: "none" }}>{modelEssay.slice(80)}</span>}
              </div>
            )}
          </div>
        ) : null}
        {useLessonCompare ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 12 }}>核心差异分析</div>
            {renderLessonCompare()}
          </div>
        ) : points.length > 0 ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 12 }}>核心差异分析</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {points.map((pt, i) => (
                <div key={i} style={{ background: P.surface, borderRadius: 12, border: `1px solid ${P.border}`, padding: "14px 16px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 8 }}>{pt.index ? `${pt.index}. ` : ""}{pt.title}</div>
                  {pt.yours ? <div style={{ background: P.bg, borderRadius: 7, padding: "8px 10px", fontSize: 12, marginBottom: 6 }}><b>你的：</b><ProBlur isPro={isPro}>{pt.yours}</ProBlur></div> : null}
                  {pt.model ? <div style={{ background: P.primarySoft, borderRadius: 7, padding: "8px 10px", fontSize: 12, marginBottom: 6 }}><b>范文：</b><ProBlur isPro={isPro}>{pt.model}</ProBlur></div> : null}
                  <div style={{ fontSize: 13, color: P.textSec, lineHeight: 1.65 }}><b>差异：</b><ProBlur isPro={isPro}>{pt.difference || ""}</ProBlur></div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {!isPro && <UpgradeBanner onClick={() => setShowUpgrade(true)} />}
      </div>
    );
  }

  function renderTokenizedText() {
    if (!tokens.length) {
      return <div style={{ fontSize: 14, lineHeight: 1.85, color: P.text, whiteSpace: "pre-wrap" }}>{userText || "未保存作答文本。"}</div>;
    }
    return (
      <div style={{ fontSize: 14, lineHeight: 1.9, color: P.text, whiteSpace: "pre-wrap" }}>
        {tokens.map((token) => {
          if (token.type === "normal") return <React.Fragment key={token.id}>{token.text}</React.Fragment>;
          const isActive = activeErrorId === token.id;
          const isSpelling = token.level === "red" && String(token.errorType || "").toLowerCase() === "spelling";
            const catColor = token.level === "red" ? (isSpelling ? P.purple : P.rose) : token.level === "orange" ? P.amber : P.teal;
          const catBg = token.level === "red" ? (isSpelling ? P.purpleSoft : P.roseSoft) : token.level === "orange" ? P.amberSoft : P.tealSoft;
          return (
            <span key={token.id} style={{ position: "relative", display: "inline-block" }} data-error-token="true">
              <button
                id={`mark-${token.id}`}
                data-error-token="true"
                onClick={(e) => {
                  e.stopPropagation();
                  const next = isActive ? null : token.id;
                  setActiveErrorId(next);
                  if (!isActive) {
                    setSecondaryTab("linebyline");
                    const btnRect = e.currentTarget.getBoundingClientRect();
                    const panelEl = leftPanelRef.current;
                    if (panelEl) {
                      const panelRect = panelEl.getBoundingClientRect();
                      setTooltipFlip(btnRect.left + 292 > panelRect.right - 8);
                    }
                  }
                }}
                style={{ border: "none", cursor: "pointer", background: isActive ? catBg : `${catColor}18`, color: catColor, borderBottom: `2px solid ${catColor}`, borderRadius: "2px 2px 0 0", padding: "0 2px", margin: "0 1px", font: "inherit", fontSize: 14, lineHeight: "inherit", fontWeight: isActive ? 700 : 400, transition: "all 0.15s" }}
              >
                {token.text}
              </button>
              {isActive ? (
                <span
                  data-error-token="true"
                  style={{ position: "absolute", top: "calc(100% + 6px)", ...(tooltipFlip ? { right: 0 } : { left: 0 }), width: 292, background: P.surface, borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)", border: `1px solid ${P.border}`, zIndex: 50, display: "flex", flexDirection: "column", overflow: "hidden", animation: "wfpTabFade 0.2s ease" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ background: catBg, padding: "8px 12px", borderBottom: `1px solid ${catColor}20`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: catColor, textTransform: "uppercase", letterSpacing: 0.5 }}>{token.category}</span>
                    <button data-error-token="true" onClick={(e) => { e.stopPropagation(); setActiveErrorId(null); }} style={{ background: "none", border: "none", color: P.textDim, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "0 2px" }}>✕</button>
                  </div>
                  <div style={{ padding: "12px 14px" }}>
                    <div style={{ fontSize: 12, color: P.textDim, textDecoration: "line-through", textDecorationColor: P.rose, marginBottom: 6 }}>{token.text}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: P.primary, marginBottom: 10 }}>{token.suggestion || "（暂无建议）"}</div>
                    <div style={{ fontSize: 12, color: P.textSec, lineHeight: 1.65, background: P.bg, padding: "8px 10px", borderRadius: 8, border: `1px solid ${P.borderSubtle}` }}>
                      <b style={{ color: P.text }}>解析：</b>{token.note || "暂无说明"}
                    </div>
                  </div>
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    );
  }

  function renderVocab() {
    return <VocabCEFRPanel text={userText} isPro={isPro} onUpgrade={() => setShowUpgrade(true)} />;
  }

  const tabContent = { macro: renderMacro, linebyline: renderLineByLine, vocab: renderVocab, sample: renderSample };

  const MOBILE_TABS = [
    { id: "text", label: "作文批注" },
    { id: "macro", label: "宏观评价" },
    { id: "linebyline", label: "逐句批注" },
    { id: "vocab", label: "词汇" },
    { id: "sample", label: "范文对比" },
  ];

  /* ── 移动端：全屏 tab 切换 ── */
  if (isMobile) {
    return (
      <>
        <style>{`
          @keyframes wfpTabFade { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes wfpSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        `}</style>
        {showUpgrade && <UpgradeModal userCode={(() => { try { return getSavedCode(); } catch { return null; } })()} currentTier="free" onClose={() => setShowUpgrade(false)} onUpgraded={() => window.location.reload()} />}
        <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: P.bg, fontFamily: FONT }}>
          {/* 头部：分数 + 操作 */}
          <div style={{ flexShrink: 0, padding: "10px 14px", borderBottom: `1px solid ${P.borderSubtle}`, background: P.surface, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 800, color: P.text }}>{taskLabel} · 批改</span>
              {score != null && <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 700, color: score >= 4 ? P.primary : score >= 3 ? P.amber : P.rose }}>{score}/5</span>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {onRetry && <ActionBtn onClick={onRetry}>再练</ActionBtn>}
              {onNext && <ActionBtn onClick={onNext}>下一题</ActionBtn>}
              <ActionBtn onClick={onExit} danger>返回</ActionBtn>
            </div>
          </div>

          {/* Tab 栏 */}
          <div style={{ flexShrink: 0, display: "flex", borderBottom: `1px solid ${P.borderSubtle}`, background: P.surface, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            {MOBILE_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setMobileTab(t.id)}
                style={{
                  flex: "0 0 auto", padding: "10px 14px", border: "none", background: "none",
                  fontSize: 13, fontWeight: mobileTab === t.id ? 700 : 500,
                  color: mobileTab === t.id ? P.primary : P.textDim,
                  borderBottom: mobileTab === t.id ? `2px solid ${P.primary}` : "2px solid transparent",
                  cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab 内容 */}
          <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
            {mobileTab === "text" && (
              <div style={{ padding: "16px 14px" }}>
                <div style={{ background: P.surface, borderRadius: 12, padding: "16px 14px", border: `1px solid ${P.border}`, boxShadow: P.shadow }}>
                  {renderTokenizedText()}
                </div>
              </div>
            )}
            {mobileTab === "macro" && <div style={{ padding: "16px 14px", animation: "wfpTabFade 0.25s ease" }}>{renderMacro()}</div>}
            {mobileTab === "linebyline" && <div style={{ padding: "16px 14px", animation: "wfpTabFade 0.25s ease" }}>{renderLineByLine()}</div>}
            {mobileTab === "vocab" && <div style={{ padding: "16px 14px", animation: "wfpTabFade 0.25s ease" }}>{renderVocab()}</div>}
            {mobileTab === "sample" && <div style={{ padding: "16px 14px", animation: "wfpTabFade 0.25s ease" }}>{renderSample()}</div>}
          </div>
        </div>
      </>
    );
  }

  /* ── 桌面端：原有 45/55 分屏布局 ── */
  return (
    <>
      <style>{`
        @keyframes wfpTabFade { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes wfpSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div data-testid="score-panel" style={{ display: "flex", flexDirection: "column", height: containerHeight || `calc(100vh - ${topBarHeight}px)`, background: P.bg, animation: "wfpSlideIn 0.35s cubic-bezier(0.16,1,0.3,1)", fontFamily: FONT }}>

        {/* Header */}
        <div className="tp-fb-header" style={{ flexShrink: 0, padding: "13px 28px", borderBottom: `1px solid ${P.borderSubtle}`, background: P.surface, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ fontSize: 15, fontWeight: 800, color: P.text }}>{taskLabel} · 批改报告</span>
            {score != null && (
              <span style={{ marginLeft: 12, fontSize: 13, fontWeight: 700, color: score >= 4 ? P.primary : score >= 3 ? P.amber : P.rose }}>得分 {score}/5</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {onRetry && <ActionBtn onClick={onRetry}>再练一遍</ActionBtn>}
            {onNext && <ActionBtn onClick={onNext}>下一题</ActionBtn>}
            <ActionBtn onClick={onExit} danger>返回</ActionBtn>
          </div>
        </div>

        {/* 45/55 split body */}
        <div className="tp-fb-split" style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* Left (45%): annotated text */}
          <div ref={leftPanelRef} className="tp-fb-left" style={{ width: "45%", flexShrink: 0, height: "100%", overflowY: "auto", padding: "24px 22px 24px 28px", borderRight: `1px solid ${P.borderSubtle}` }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: P.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "#34d399", flexShrink: 0 }} />
              Your Response
              <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 400, color: P.textDim, textTransform: "none", letterSpacing: 0 }}>点击高亮处查看批注</span>
            </div>
            <div style={{ background: P.surface, borderRadius: 12, padding: "20px 22px", border: `1px solid ${P.border}`, boxShadow: P.shadow, marginBottom: 24 }}>
              {renderTokenizedText()}
            </div>
            <PromptCollapse type={type} pd={pd} />
          </div>

          {/* Right (55%): tabbed feedback */}
          <div className="tp-fb-right" style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", background: P.surface }}>
            <div style={{ flexShrink: 0, padding: "12px 24px", borderBottom: `1px solid ${P.borderSubtle}`, display: "flex", gap: 6 }}>
              {WRITING_TABS.map((t) => {
                const isA = secondaryTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setSecondaryTab(t.id); setActiveErrorId(null); }}
                    style={{ padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: isA ? 700 : 500, background: isA ? P.text : "transparent", color: isA ? "#fff" : P.textSec, boxShadow: isA ? "0 2px 8px rgba(0,0,0,0.15)" : "none", transition: "all 0.18s" }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div key={secondaryTab} style={{ flex: 1, overflowY: "auto", padding: "22px 28px 24px 22px", animation: "wfpTabFade 0.3s cubic-bezier(0.16,1,0.3,1)" }}>
              {(tabContent[secondaryTab] || tabContent.macro)()}
            </div>
          </div>
        </div>
      </div>
      {showUpgrade && (
        <UpgradeModal
          userCode={getSavedCode()}
          currentTier={getSavedTier()}
          onClose={() => setShowUpgrade(false)}
          onUpgraded={() => window.location.reload()}
        />
      )}
    </>
  );
}
