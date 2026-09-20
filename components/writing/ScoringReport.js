"use client";
import React, { useMemo, useState } from "react";
import { C, DisclosureSection, FONT } from "../shared/ui";
import { getSavedCode, getSavedTier } from "../../lib/AuthContext";
import UpgradeModal from "../shared/UpgradeModal";
import VocabCEFRPanel, { getVocabPreview } from "./VocabCEFRPanel";

function GoalBadge({ status }) {
  const map = {
    OK: { icon: "已达成", color: "#16a34a", bg: "#ecfdf3" },
    PARTIAL: { icon: "部分达成", color: "#ea580c", bg: "#fff7ed" },
    MISSING: { icon: "未覆盖", color: "#dc2626", bg: "#fef2f2" },
  };
  const ui = map[String(status || "").toUpperCase()] || map.PARTIAL;
  return (
    <span style={{ minWidth: 82, display: "inline-flex", justifyContent: "center", padding: "2px 8px", borderRadius: 999, background: ui.bg, color: ui.color, fontSize: 11, fontWeight: 700 }}>
      {ui.icon}
    </span>
  );
}

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

function levelStyles(level) {
  if (level === "red") return { bg: "#fee2e2", color: "#991b1b" };
  if (level === "orange") return { bg: "#ffedd5", color: "#9a3412" };
  return { bg: "#dbeafe", color: "#1e3a8a" };
}

function PatternTag({ tag }) {
  return (
    <span style={{ display: "inline-block", border: "1px solid #cbd5e1", background: "#f8fafc", borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 700, color: "#334155" }}>
      {tag || "未分类"}
    </span>
  );
}

function ProBlur({ isPro, children }) {
  if (isPro) return <>{children}</>;
  return <span style={{ filter: "blur(5px)", userSelect: "none", WebkitUserSelect: "none" }}>{children}</span>;
}

function UpgradeBannerCompact({ onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        padding: "8px 14px", marginTop: 10,
        background: "linear-gradient(135deg, #ecfdf5, #ecfeff)",
        border: "1px solid rgba(13,150,104,0.19)", borderRadius: 8,
        cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#087355",
      }}
    >
      <span>{"\uD83D\uDD12"}</span>
      <span>升级 Pro 解锁完整报告</span>
      <span style={{ padding: "3px 10px", borderRadius: 6, background: "linear-gradient(135deg, #087355, #0891B2)", color: "#fff", fontSize: 10, fontWeight: 700 }}>升级</span>
    </div>
  );
}

export function ScoringReport({ result, type }) {
  const [activeMark, setActiveMark] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const report = result || {};

  const isPro = (() => {
    try { const t = getSavedTier(); return t === "pro" || t === "legacy"; }
    catch { return false; }
  })();

  const score = Number.isFinite(Number(report.score)) ? Number(report.score) : 0;
  const band = report.band != null ? String(report.band) : null;
  const summary = String(report.summary || "").trim();
  const goals = Array.isArray(report.goals) ? report.goals : [];
  const actions = (Array.isArray(report.actions) ? report.actions : []).slice(0, 2);
  const patterns = Array.isArray(report.patterns) ? report.patterns : [];
  const counts = report.annotationCounts || { red: 0, orange: 0, blue: 0, spelling: 0 };
  const marks = Array.isArray(report.annotationSegments) ? report.annotationSegments : [];
  const comparison = report.comparison || { modelEssay: "", points: [], raw: "" };
  const essayPlainText = useMemo(() => {
    if (report.userText) return report.userText;
    if (marks.length > 0) return marks.map((s) => s.text || "").join("");
    return report.annotationRaw || "";
  }, [report.userText, marks, report.annotationRaw]);
  const sectionStates = report.sectionStates || {};
  const dims = report?.rubric?.dimensions || null;
  const errorTriage = report?.errorTriage || null;
  const triageCapped = Array.isArray(errorTriage?.capped) ? errorTriage.capped : [];
  const triageMinor = String(errorTriage?.minorSummary || "").trim();
  const triageVerdict = String(errorTriage?.verdict || "").trim();
  const showTriage = Boolean(errorTriage) && (triageCapped.length > 0 || triageMinor || triageVerdict);
  // 讲评(lesson)：评分之后的第二次调用产物。模考结果/历史行只做只读展示，
  // 没有 lesson 的旧记录一整块都不渲染。
  const lesson = report.lesson && typeof report.lesson === "object" ? report.lesson : null;
  const lessonFocus = lesson?.focus || null;
  const lessonNext = lesson?.next || null;
  const lessonChecks = Array.isArray(lessonNext?.checks) ? lessonNext.checks : [];
  const showLesson = Boolean(lessonFocus && (lessonFocus.strategy || lessonFocus.rewrite));

  const patternRows = useMemo(
    () =>
      [...patterns].sort((a, b) => Number(b?.count || 0) - Number(a?.count || 0)).slice(0, 3),
    [patterns]
  );

  if (!result) return null;

  return (
    <div data-testid="score-panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ background: C.nav, color: "#fff", borderRadius: 8, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 38, fontWeight: 800 }}>{score}</span>
            <span style={{ opacity: 0.85 }}>/ 5</span>
          </div>
          <span style={{ background: "rgba(255,255,255,0.18)", borderRadius: 14, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{band ?? "-"}</span>
        </div>
        <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.7 }}>{summary || "总评暂缺。"}</div>
        {dims ? (
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {DIM_LABELS.map(({ key, label }) => {
              const d = dims[key] || {};
              const reason = String(d.reason || "").trim();
              return (
                <div key={key} style={{ minWidth: 0, background: "rgba(255,255,255,0.1)", borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.75 }}>{label}</span>
                    <span style={{ fontSize: 15, fontWeight: 800 }}>{fmtDimScore(d.score)}</span>
                  </div>
                  {reason ? <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.55, opacity: 0.85 }}>{reason}</div> : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {type === "email" && (
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {goals.length > 0 ? (
              goals.map((g) => (
                <div key={g.index} style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, alignItems: "start", background: "rgba(255,255,255,0.1)", borderRadius: 6, padding: "8px 10px" }}>
                  <GoalBadge status={g.status} />
                  <div style={{ fontSize: 13, lineHeight: 1.6 }}>目标{g.index}：{g.reason || "未提供判断依据"}</div>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 13, opacity: 0.9 }}>目标检查暂时无法加载</div>
            )}
          </div>
        )}
      </div>

      {showLesson ? (
        <DisclosureSection title="本课只讲一件事" defaultOpen preview={lessonFocus.strategy || ""} contentStyle={{ padding: 14 }}>
          <div style={{ display: "grid", gap: 8 }}>
            {lessonFocus.strategy ? <div style={{ fontSize: 14, fontWeight: 700, color: C.t1, lineHeight: 1.6 }}>{lessonFocus.strategy}</div> : null}
            {lessonFocus.evidence ? <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.7 }}><b>证据：</b>{lessonFocus.evidence}</div> : null}
            {lessonFocus.missing ? <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.7 }}><b>缺的是：</b>{lessonFocus.missing}</div> : null}
            {lessonFocus.rewrite ? (
              <div style={{ background: "#ecfdf5", border: "1px solid rgba(13,150,104,0.19)", borderRadius: 6, padding: "10px 12px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#087355", marginBottom: 6 }}>示范改写</div>
                <div style={{ fontSize: 13, color: "#052e16", lineHeight: 1.85, whiteSpace: "pre-wrap" }}>{lessonFocus.rewrite}</div>
              </div>
            ) : null}
            {lessonFocus.transfer ? <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.7 }}><b>迁移：</b>{lessonFocus.transfer}</div> : null}
            {lessonNext?.task ? <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.7, background: "#f8fafc", borderRadius: 6, padding: "8px 10px" }}><b>任务：</b>{lessonNext.task}</div> : null}
            {lessonChecks.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: C.t2, lineHeight: 1.8 }}>
                {lessonChecks.map((check, idx) => <li key={idx}>{check}</li>)}
              </ul>
            ) : null}
          </div>
        </DisclosureSection>
      ) : null}

      <DisclosureSection title="薄弱点修改建议" defaultOpen preview={actions.length > 0 ? `${actions.length} 个重点` : "暂无"} contentStyle={{ padding: 14 }}>
        {sectionStates.ACTION && !sectionStates.ACTION.ok ? (
          <div style={{ color: C.red }}>此部分暂时无法加载</div>
        ) : actions.length === 0 ? (
          <div style={{ color: C.t2 }}>暂无行动卡</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {actions.map((a, idx) => (
              <div key={idx} style={{ border: "1px solid #e5e7eb", borderLeft: `4px solid ${idx === 0 ? "#dc2626" : "#f97316"}`, borderRadius: 6, padding: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.t1, marginBottom: 6 }}>{a.title || `短板${idx + 1}`}</div>
                <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.7, marginBottom: 8 }}><b>为什么重要：</b>{a.importance || "未提供"}</div>
                <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.7, background: "#f8fafc", borderRadius: 6, padding: "8px 10px" }}><b>现在可做的：</b>{a.action || "未提供"}</div>
              </div>
            ))}
          </div>
        )}
      </DisclosureSection>

      {showTriage ? (
        <DisclosureSection
          title="影响分数的错误"
          defaultOpen
          preview={triageCapped.length > 0 ? `${triageCapped.length} 条` : "无"}
          contentStyle={{ padding: 14 }}
        >
          {triageCapped.length > 0 ? (
            <div style={{ display: "grid", gap: 8 }}>
              {triageCapped.map((item, idx) => (
                <div key={idx} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontStyle: "italic", color: C.t1, lineHeight: 1.6 }}>{item.quote || "（未给出原句）"}</div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {item.impedes === true ? (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "#fef2f2", color: C.red, whiteSpace: "nowrap" }}>妨碍理解</span>
                      ) : null}
                      {item.systemic === true ? (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: C.softAmber, color: C.orange, whiteSpace: "nowrap" }}>系统性失控</span>
                      ) : null}
                    </div>
                  </div>
                  {item.issue ? <div style={{ marginTop: 6, fontSize: 13, color: C.t2, lineHeight: 1.7 }}>{item.issue}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.7 }}>没有真正拉低分数的语法错误</div>
          )}
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: C.t2, lineHeight: 1.6 }}>
              不压分的限时小错：{triageMinor || "无"}
            </summary>
            <div style={{ marginTop: 6, fontSize: 11.5, color: C.t3, lineHeight: 1.7 }}>
              ETS 官方 5 分样文同样含约十处这类小错，它们不决定分数
            </div>
          </details>
          {triageVerdict ? <div style={{ marginTop: 10, fontSize: 11, color: C.t3, lineHeight: 1.6 }}>{triageVerdict}</div> : null}
        </DisclosureSection>
      ) : null}

      <DisclosureSection title="逐句批注" preview={(() => {
        const spelling = marks.filter((m) => m.type === "mark" && m.level === "red" && String(m.errorType || "").toLowerCase() === "spelling").length;
        const grammar = counts.red - spelling;
        const parts = [];
        if (grammar > 0) parts.push(`${grammar} 个语法错误`);
        if (spelling > 0) parts.push(`${spelling} 个拼写错误`);
        if (counts.orange > 0) parts.push(`${counts.orange} 个表达建议`);
        if (counts.blue > 0) parts.push(`${counts.blue} 个拔高建议`);
        return parts.length > 0 ? parts.join(" · ") : "无批注";
      })()} contentStyle={{ padding: 14 }}>
        {sectionStates.ANNOTATION && !sectionStates.ANNOTATION.ok ? (
          <div style={{ color: C.red }}>此部分暂时无法加载</div>
        ) : marks.length === 0 ? (
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8, color: C.t1 }}>{result.annotationRaw || "暂无逐句批注"}</div>
        ) : (
          <div>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.9, color: C.t1 }}>
              {marks.map((seg, idx) => {
                if (seg.type !== "mark") return <span key={idx}>{seg.text}</span>;
                const style = levelStyles(seg.level);
                const isActive = activeMark === idx;
                return (
                  <button
                    key={idx}
                    onClick={() => setActiveMark(isActive ? null : idx)}
                    style={{
                      border: "none",
                      cursor: "pointer",
                      padding: "0 2px",
                      margin: 0,
                      background: isActive ? style.color : style.bg,
                      color: isActive ? "#fff" : style.color,
                      borderRadius: 3,
                      font: "inherit",
                      outline: isActive ? `2px solid ${style.color}` : "none",
                      outlineOffset: 1,
                    }}
                  >
                    {seg.text}
                  </button>
                );
              })}
            </div>
            {Number.isInteger(activeMark) && marks[activeMark]?.type === "mark" ? (
              <div style={{ marginTop: 12, border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff", padding: "10px 12px" }}>
                <div style={{ fontSize: 12, color: C.nav, fontWeight: 700, marginBottom: 4 }}>修改建议（中文）</div>
                <div style={{ fontSize: 13, marginBottom: 8 }}>{marks[activeMark].fix || "暂无"}</div>
                <div style={{ fontSize: 12, color: C.nav, fontWeight: 700, marginBottom: 4 }}>问题说明</div>
                <div style={{ fontSize: 13, color: C.t2 }}>{marks[activeMark].note || "暂无"}</div>
              </div>
            ) : null}
          </div>
        )}
      </DisclosureSection>

      <DisclosureSection title="模式总结" preview={patternRows.length > 0 ? `${patternRows.length} 个规律` : "暂无"} contentStyle={{ padding: 14 }}>
        {sectionStates.PATTERNS && !sectionStates.PATTERNS.ok ? (
          <div style={{ color: C.red }}>此部分暂时无法加载</div>
        ) : patternRows.length === 0 ? (
          <div style={{ color: C.t2 }}>暂无模式总结</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {patternRows.map((p, idx) => (
              <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, border: "1px solid #e5e7eb", borderRadius: 6, padding: 10 }}>
                <div>
                  <PatternTag tag={p.tag} />
                  <div style={{ marginTop: 6, fontSize: 13, color: C.t2 }}>{p.summary || ""}</div>
                </div>
                <div style={{ alignSelf: "start", fontSize: 12, color: C.t2 }}>出现 {Number(p.count || 0)} 次</div>
              </div>
            ))}
          </div>
        )}
      </DisclosureSection>

      <DisclosureSection title="词汇等级分析" preview={getVocabPreview(essayPlainText)} contentStyle={{ padding: 14 }}>
        <VocabCEFRPanel text={essayPlainText} isPro={isPro} onUpgrade={() => setShowUpgrade(true)} />
      </DisclosureSection>

      <DisclosureSection title="范文对比" preview={Array.isArray(comparison.points) ? `${comparison.points.length} 个对比点` : "暂无"} contentStyle={{ padding: 14 }}>
        {sectionStates.COMPARISON && !sectionStates.COMPARISON.ok ? (
          <div style={{ color: C.red }}>此部分暂时无法加载</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 700, color: C.nav }}>查看 AI 参考范文</summary>
              <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: 10, fontFamily: "inherit", fontSize: 13, lineHeight: 1.8 }}>
                {isPro ? (comparison.modelEssay || "暂无范文") : (() => {
                  const text = comparison.modelEssay || "暂无范文";
                  if (text.length <= 80) return text;
                  return <>{text.slice(0, 80)}<span style={{ filter: "blur(5px)", userSelect: "none", WebkitUserSelect: "none" }}>{text.slice(80)}</span></>;
                })()}
              </pre>
            </details>

            {Array.isArray(comparison.points) && comparison.points.length > 0 ? (
              comparison.points.map((p) => (
                <div key={p.index} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>{p.index}. {p.title}</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ background: "#f8fafc", borderRadius: 6, padding: "8px 10px", fontSize: 13 }}><b>你的：</b><ProBlur isPro={isPro}>{p.yours || ""}</ProBlur></div>
                    <div style={{ background: "#ecfeff", borderRadius: 6, padding: "8px 10px", fontSize: 13 }}><b>范文：</b><ProBlur isPro={isPro}>{p.model || ""}</ProBlur></div>
                    <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.7 }}><b>差异：</b><ProBlur isPro={isPro}>{p.difference || ""}</ProBlur></div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ color: C.t2 }}>暂无可展示的对比点</div>
            )}
            {!isPro && <UpgradeBannerCompact onClick={() => setShowUpgrade(true)} />}
          </div>
        )}
      </DisclosureSection>
      {showUpgrade && (
        <UpgradeModal
          userCode={getSavedCode()}
          currentTier={getSavedTier()}
          onClose={() => setShowUpgrade(false)}
          onUpgraded={() => window.location.reload()}
        />
      )}
    </div>
  );
}
