"use client";
import React, { useState, useEffect, useRef } from "react";
import { FONT } from "../shared/ui";
import { getSavedCode, getSavedTier } from "../../lib/AuthContext";
import UpgradeModal from "../shared/UpgradeModal";

const P = {
  bg: "#f4f7f5", surface: "#ffffff", border: "#dde5df", borderSubtle: "#ebf0ed",
  text: "#1a2420", textSec: "#5a6b62", textDim: "#94a39a",
  primary: "#0d9668", primaryDeep: "#087355", primarySoft: "#ecfdf5",
  teal: "#0891B2", tealSoft: "#ecfeff",
  amber: "#d97706", amberSoft: "#fffbeb",
  rose: "#E11D48", roseSoft: "#fff1f2",
  purple: "#7c3aed", purpleSoft: "#f5f3ff",
  shadow: "0 1px 3px rgba(10,40,25,0.04), 0 1px 2px rgba(10,40,25,0.02)",
  shadowMd: "0 4px 14px rgba(10,40,25,0.06), 0 1px 3px rgba(10,40,25,0.03)",
};

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

export function WritingFeedbackPanel({ fb, type, pd, userText, onNext, onRetry, onExit, topBarHeight = 56, containerHeight }) {
  const [secondaryTab, setSecondaryTab] = useState("macro");
  const [activeErrorId, setActiveErrorId] = useState(null);
  const [tooltipFlip, setTooltipFlip] = useState(false);
  const leftPanelRef = useRef(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

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
  const summary = String(fb?.summary || "").trim();
  const goals = Array.isArray(fb?.goals) ? fb.goals : [];
  const actions = Array.isArray(fb?.actions) ? fb.actions : [];
  const patterns = Array.isArray(fb?.patterns) ? fb.patterns : [];
  const marks = Array.isArray(fb?.annotationSegments) ? fb.annotationSegments : [];
  const comparison = fb?.comparison || { modelEssay: "", points: [] };

  const tokens = segmentsToTokens(marks);
  const errorTokens = tokens.filter((t) => t.type === "error");

  const WRITING_TABS = [
    { id: "macro", label: "宏观评价与建议" },
    { id: "linebyline", label: "逐句批注大纲" },
    { id: "sample", label: "范文对比分析" },
  ];

  const taskLabel = type === "email" ? "邮件写作" : "学术讨论";

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
            {band ? <span style={{ padding: "3px 10px", background: "rgba(52,211,153,0.15)", color: "#34d399", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{band}</span> : null}
          </div>
          {summary ? <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.75, margin: 0, marginBottom: goals.length ? 18 : 0 }}>{summary}</p> : null}
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

        {actions.length > 0 ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 12 }}>结构与语域优化建议</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {actions.map((a, i) => (
                <div key={i} style={{ background: P.surface, borderRadius: 12, border: `1px solid ${P.borderSubtle}`, borderLeft: `4px solid ${i === 0 ? P.rose : P.amber}`, padding: "14px 16px" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: P.text, marginBottom: 10 }}>{a.title || `短板 ${i + 1}`}</div>
                  <div style={{ fontSize: 13, color: P.textSec, lineHeight: 1.7, marginBottom: 8 }}>
                    <b style={{ color: P.text, background: P.roseSoft, padding: "0 3px", borderRadius: 3 }}>为什么重要：</b> <ProBlur isPro={isPro}>{a.importance || "未提供"}</ProBlur>
                  </div>
                  <div style={{ fontSize: 13, color: P.textSec, lineHeight: 1.7 }}>
                    <b style={{ color: P.primaryDeep, background: P.primarySoft, padding: "0 3px", borderRadius: 3 }}>现在可做的：</b> <ProBlur isPro={isPro}>{a.action || "未提供"}</ProBlur>
                  </div>
                </div>
              ))}
            </div>
          </div>
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
                  <div style={{ fontSize: 12, color: P.textSec, lineHeight: 1.6 }}><ProBlur isPro={isPro}>{p.summary || ""}</ProBlur></div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {!isPro && <UpgradeBanner onClick={() => setShowUpgrade(true)} />}
      </div>
    );
  }

  function renderLineByLine() {
    if (!errorTokens.length) return (
      <div style={{ padding: "40px", textAlign: "center", color: P.textDim, fontSize: 13, background: P.bg, borderRadius: 12, border: `1px dashed ${P.borderSubtle}` }}>暂无逐句批注数据。</div>
    );
    return (
      <div>
        <p style={{ fontSize: 13, color: P.textSec, marginBottom: 16 }}>
          共发现 <b style={{ color: P.text }}>{errorTokens.length}</b> 处表达问题。{!isPro && <span style={{ color: P.amber, fontWeight: 700 }}>升级 Pro 查看修改建议与详细解析。</span>}
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
                <div style={{ fontSize: 13, fontWeight: 700, color: P.primary }}><ProBlur isPro={isPro}>{err.suggestion || "（暂无建议）"}</ProBlur></div>
                {err.note ? <div style={{ fontSize: 12, color: P.textSec, lineHeight: 1.6, marginTop: 4 }}><ProBlur isPro={isPro}>{err.note}</ProBlur></div> : null}
              </button>
            );
          })}
        </div>
        {!isPro && <UpgradeBanner onClick={() => setShowUpgrade(true)} />}
      </div>
    );
  }

  function renderSample() {
    const modelEssay = String(comparison.modelEssay || "").trim();
    const points = Array.isArray(comparison.points) ? comparison.points : [];
    if (!modelEssay && !points.length) return <div style={{ padding: "40px 0", textAlign: "center", color: P.textDim, fontSize: 13 }}>暂无范文对比数据。</div>;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {modelEssay ? (
          <div style={{ background: P.primarySoft, borderRadius: 16, padding: "20px 22px", border: `1px solid ${P.primary}25` }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: P.primaryDeep, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 14 }}>Official Band 5.0 Sample</div>
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
        {points.length > 0 ? (
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
                    <div style={{ fontSize: 13, fontWeight: 700, color: P.primary, marginBottom: 10 }}><ProBlur isPro={isPro}>{token.suggestion || "（暂无建议）"}</ProBlur></div>
                    <div style={{ fontSize: 12, color: P.textSec, lineHeight: 1.65, background: P.bg, padding: "8px 10px", borderRadius: 8, border: `1px solid ${P.borderSubtle}` }}>
                      <b style={{ color: P.text }}>解析：</b><ProBlur isPro={isPro}>{token.note || "暂无说明"}</ProBlur>
                    </div>
                    {!isPro && (
                      <div
                        onClick={(e) => { e.stopPropagation(); setShowUpgrade(true); }}
                        style={{ marginTop: 8, fontSize: 11, color: P.primary, cursor: "pointer", textAlign: "center", fontWeight: 700 }}
                      >
                        {"\uD83D\uDD12"} 升级 Pro 查看修改建议
                      </div>
                    )}
                  </div>
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    );
  }

  const tabContent = { macro: renderMacro, linebyline: renderLineByLine, sample: renderSample };

  return (
    <>
      <style>{`
        @keyframes wfpTabFade { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes wfpSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div style={{ display: "flex", flexDirection: "column", height: containerHeight || `calc(100vh - ${topBarHeight}px)`, background: P.bg, animation: "wfpSlideIn 0.35s cubic-bezier(0.16,1,0.3,1)", fontFamily: FONT }}>

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
