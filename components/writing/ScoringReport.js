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
  if (!result) return null;

  const isPro = (() => {
    try { const t = getSavedTier(); return t === "pro" || t === "legacy"; }
    catch { return false; }
  })();

  const score = Number.isFinite(Number(result.score)) ? Number(result.score) : 0;
  const band = result.band != null ? String(result.band) : null;
  const summary = String(result.summary || "").trim();
  const goals = Array.isArray(result.goals) ? result.goals : [];
  const actions = (Array.isArray(result.actions) ? result.actions : []).slice(0, 2);
  const patterns = Array.isArray(result.patterns) ? result.patterns : [];
  const counts = result.annotationCounts || { red: 0, orange: 0, blue: 0, spelling: 0 };
  const marks = Array.isArray(result.annotationSegments) ? result.annotationSegments : [];
  const comparison = result.comparison || { modelEssay: "", points: [], raw: "" };
  const essayPlainText = useMemo(() => {
    if (result.userText) return result.userText;
    if (marks.length > 0) return marks.map((s) => s.text || "").join("");
    return result.annotationRaw || "";
  }, [result.userText, marks, result.annotationRaw]);
  const sectionStates = result.sectionStates || {};

  const patternRows = useMemo(
    () =>
      [...patterns].sort((a, b) => Number(b?.count || 0) - Number(a?.count || 0)).slice(0, 3),
    [patterns]
  );

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
              <summary style={{ cursor: "pointer", fontWeight: 700, color: C.nav }}>查看完整范文</summary>
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
