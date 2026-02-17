"use client";
import React, { useMemo, useState } from "react";
import { C } from "../shared/ui";
import { buildAnnotationSegments, countAnnotations, parseAnnotations } from "../../lib/annotations/parseAnnotations";
import { normalizeReportLanguage, saveReportLanguage, REPORT_LANGUAGE } from "../../lib/reportLanguage";

const warnedParseFallback = new Set();

const I18N = {
  zh: {
    hide: "\u6536\u8d77",
    show: "\u5c55\u5f00",
    empty: "\u6682\u65e0\u53ef\u7528\u5185\u5bb9\u3002",
    scoreBand: "Band",
    goalPrefix: "\u76ee\u6807",
    actionPlan: "\u6539\u8fdb\u5efa\u8bae",
    actionReason: "\u539f\u56e0\uff1a",
    actionNow: "\u73b0\u5728\u5c31\u505a\uff1a",
    annotationTitle: "\u53e5\u5b50\u7ea7\u6279\u6ce8",
    annotationStats: (c) => `${c.red || 0} \u6761\u8bed\u6cd5\u95ee\u9898 | ${c.orange || 0} \u6761\u63aa\u8f9e\u5efa\u8bae | ${c.blue || 0} \u6761\u5347\u7ea7\u5efa\u8bae`,
    noSentenceIssues: "\u672a\u68c0\u6d4b\u5230\u53e5\u5b50\u7ea7\u95ee\u9898",
    fixLabel: "\u4fee\u6539\u5efa\u8bae\uff08\u82f1\u6587\uff09\uff1a",
    noteLabel: "\u95ee\u9898\u8bf4\u660e\uff1a",
    patterns: "\u95ee\u9898\u6a21\u5f0f\u603b\u7ed3",
    comparison: "\u8303\u6587\u5bf9\u6bd4",
    viewModel: "\u67e5\u770b\u5b8c\u6574\u8303\u6587",
    yours: "\u4f60\u7684\u53e5\u5b50\uff1a",
    model: "\u8303\u6587\u53e5\u5b50\uff1a",
    diff: "\u5dee\u5f02\u8bf4\u660e\uff1a",
  },
  en: {
    hide: "Hide",
    show: "Show",
    empty: "No content available.",
    scoreBand: "Band",
    goalPrefix: "Goal",
    actionPlan: "Action Plan",
    actionReason: "Why it matters:",
    actionNow: "Do this now:",
    annotationTitle: "Sentence Annotations",
    annotationStats: (c) => `${c.red || 0} grammar errors | ${c.orange || 0} wording suggestions | ${c.blue || 0} upgrade suggestions`,
    noSentenceIssues: "No sentence-level issues detected",
    fixLabel: "Suggested rewrite (English):",
    noteLabel: "Issue note:",
    patterns: "Pattern Summary",
    comparison: "Model Comparison",
    viewModel: "View full model response",
    yours: "Yours:",
    model: "Model:",
    diff: "Difference:",
  },
};

function Collapse({ title, defaultOpen = false, children, subtitle, ui }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: "1px solid " + C.bdr, borderRadius: 6, overflow: "hidden", background: "#fff" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          textAlign: "left",
          background: "#f8fafc",
          border: "none",
          borderBottom: open ? "1px solid " + C.bdr : "none",
          padding: "12px 14px",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontWeight: 700,
          color: C.t1,
        }}
      >
        <span>
          {title}
          {subtitle ? <span style={{ marginLeft: 8, fontWeight: 500, color: C.t2, fontSize: 12 }}>{subtitle}</span> : null}
        </span>
        <span style={{ color: C.t2, fontSize: 12 }}>{open ? ui.hide : ui.show}</span>
      </button>
      {open ? <div style={{ padding: 14 }}>{children}</div> : null}
    </div>
  );
}

function statusStyle(status) {
  if (status === "OK") return { icon: "OK", color: C.green, bg: "#ecfdf3" };
  if (status === "PARTIAL") return { icon: "PARTIAL", color: C.orange, bg: "#fff7ed" };
  return { icon: "MISSING", color: C.red, bg: "#fef2f2" };
}

function LangToggle({ lang, onChange }) {
  const opts = [
    { value: REPORT_LANGUAGE.ZH, label: "\u4E2D\u6587" },
    { value: REPORT_LANGUAGE.EN, label: "EN" },
  ];
  return (
    <div style={{ display: "inline-flex", gap: 4, background: "#f1f5f9", borderRadius: 999, padding: 2 }}>
      {opts.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            border: "none",
            background: lang === o.value ? "#fff" : "transparent",
            boxShadow: lang === o.value ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
            color: lang === o.value ? C.nav : C.t2,
            borderRadius: 999, padding: "2px 10px", fontSize: 11,
            fontWeight: 700, cursor: "pointer", lineHeight: "20px",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ScoringReport({ result, type, uiLang = "zh" }) {
  const storedLang = (() => { try { const s = localStorage.getItem("toefl-report-language"); return s ? normalizeReportLanguage(s) : null; } catch { return null; } })();
  const defaultLang = storedLang || normalizeReportLanguage(result?.reportLanguage || uiLang);
  const [langOverride, setLangOverride] = useState(defaultLang);
  const lang = langOverride;
  const ui = I18N[lang];
  const [activeNote, setActiveNote] = useState(null);
  if (!result) return null;

  const scoreColor = result.score >= 4 ? C.green : result.score >= 3 ? C.orange : C.red;
  const goals = Array.isArray(result.goals) ? result.goals : [];
  const actions = Array.isArray(result.actions) ? result.actions : [];
  const patterns = useMemo(
    () =>
      (Array.isArray(result.patterns) ? result.patterns : [])
        .filter((p) => p && typeof p.tag === "string")
        .sort((a, b) => Number(b.count || 0) - Number(a.count || 0)),
    [result.patterns]
  );

  const annotationView = useMemo(() => {
    const parsedFromResult = result?.annotationParsed;
    if (parsedFromResult && Array.isArray(parsedFromResult.annotations) && typeof parsedFromResult.plainText === "string") {
      if (parsedFromResult.parseError && parsedFromResult.hasMarkup) {
        const taskId = result?.taskId || result?.type || "unknown-task";
        const sessionId = result?.sessionId || result?.mockSessionId || "unknown-session";
        const warnKey = `${taskId}/${sessionId}`;
        if (!warnedParseFallback.has(warnKey)) {
          warnedParseFallback.add(warnKey);
          console.warn(`[annotations] parse failed for ${taskId}/${sessionId}; fallback to plain text`);
        }
      }
      return {
        plainText: parsedFromResult.plainText,
        annotations: parsedFromResult.annotations,
        segments: buildAnnotationSegments(parsedFromResult),
        counts: countAnnotations(parsedFromResult.annotations),
      };
    }

    const raw = String(result?.annotationRaw || "");
    if (/<\s*n\b/i.test(raw)) {
      const parsed = parseAnnotations(raw);
      if (parsed.parseError) {
        const taskId = result?.taskId || result?.type || "unknown-task";
        const sessionId = result?.sessionId || result?.mockSessionId || "unknown-session";
        const warnKey = `${taskId}/${sessionId}`;
        if (!warnedParseFallback.has(warnKey)) {
          warnedParseFallback.add(warnKey);
          console.warn(`[annotations] parse failed for ${taskId}/${sessionId}; fallback to plain text`);
        }
      }
      return {
        plainText: parsed.plainText,
        annotations: parsed.annotations,
        segments: buildAnnotationSegments(parsed),
        counts: countAnnotations(parsed.annotations),
      };
    }

    const segs = Array.isArray(result?.annotationSegments) ? result.annotationSegments : [];
    const annotations = [];
    let pos = 0;
    segs.forEach((s) => {
      const text = String(s?.text || "");
      if (s?.type === "mark") {
        annotations.push({
          level: s.level,
          message: s.note || "",
          fix: s.fix || "",
          start: pos,
          end: pos + text.length,
        });
      }
      pos += text.length;
    });
    const plainText = segs.map((s) => String(s?.text || "")).join("");
    return {
      plainText,
      annotations,
      segments: segs.length > 0 ? segs : buildAnnotationSegments({ plainText, annotations: [] }),
      counts: countAnnotations(annotations),
    };
  }, [result]);

  const markCounts = annotationView.counts || { red: 0, orange: 0, blue: 0 };
  const annotationTotal = (annotationView.annotations || []).length;
  const comparison = result.comparison || { modelEssay: "", points: [] };
  const comparisonPoints = Array.isArray(comparison.points) ? comparison.points : [];

  return (
    <div data-testid="score-panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -4 }}>
        <LangToggle lang={lang} onChange={(v) => { setLangOverride(v); saveReportLanguage(v); }} />
      </div>
      <div style={{ background: C.nav, color: "#fff", borderRadius: 6, padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 38, fontWeight: 800 }}>{result.score}</span>
            <span style={{ opacity: 0.8 }}>/ 5</span>
          </div>
          <span style={{ background: scoreColor, borderRadius: 14, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>
            {ui.scoreBand} {result.band ?? "-"}
          </span>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>{result.summary || ui.empty}</div>
        {type === "email" ? (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {goals.length > 0 ? (
              goals.map((g, i) => {
                const s = statusStyle(g.status);
                return (
                  <div key={i} style={{ background: s.bg, color: "#111827", borderRadius: 4, padding: "8px 10px", fontSize: 13 }}>
                    <b style={{ color: s.color, marginRight: 8 }}>{s.icon}</b>
                    {ui.goalPrefix} {g.index}: {g.reason || ui.empty}
                  </div>
                );
              })
            ) : (
              <div style={{ fontSize: 13, opacity: 0.85 }}>{ui.empty}</div>
            )}
          </div>
        ) : null}
      </div>

      <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>{ui.actionPlan}</div>
        {actions.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {actions.map((a, i) => (
              <div key={i} style={{ border: "1px solid " + C.bdr, borderLeft: "4px solid " + (i === 0 ? C.red : C.orange), borderRadius: 4, padding: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{a.title || `Action ${i + 1}`}</div>
                <div style={{ fontSize: 13, color: C.t1, marginBottom: 6 }}>
                  <b>{ui.actionReason}</b> {a.importance || ui.empty}
                </div>
                <div style={{ fontSize: 13, background: "#f8fafc", borderRadius: 4, padding: "8px 10px" }}>
                  <b>{ui.actionNow}</b> {a.action || ui.empty}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: C.t2 }}>{ui.empty}</div>
        )}
      </div>

      <Collapse
        title={ui.annotationTitle}
        subtitle={annotationTotal > 0 ? ui.annotationStats(markCounts) : ui.noSentenceIssues}
        ui={ui}
      >
        {annotationTotal > 0 && annotationView.segments && annotationView.segments.length > 0 ? (
          <div style={{ fontSize: 14, lineHeight: 1.9, whiteSpace: "pre-wrap" }}>
            {annotationView.segments.map((seg, idx) => {
              if (seg.type === "text") return <span key={idx}>{seg.text}</span>;
              const map = {
                red: { bg: "#fee2e2", bd: "#fca5a5" },
                orange: { bg: "#ffedd5", bd: "#fdba74" },
                blue: { bg: "#dbeafe", bd: "#93c5fd" },
              }[seg.level] || { bg: "#eef2ff", bd: "#c7d2fe" };
              return (
                <button
                  key={idx}
                  onClick={() => setActiveNote(activeNote === idx ? null : idx)}
                  style={{
                    background: map.bg,
                    border: "1px solid " + map.bd,
                    borderRadius: 4,
                    padding: "1px 4px",
                    cursor: "pointer",
                    fontSize: "inherit",
                  }}
                  title={seg.fix || ""}
                >
                  {seg.text}
                </button>
              );
            })}
            {activeNote !== null && (annotationView.segments[activeNote] || {}).type === "mark" ? (
              <div style={{ marginTop: 12, border: "1px solid " + C.bdr, borderRadius: 6, padding: 10, background: "#fff" }}>
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  <b>{ui.fixLabel}</b> {(annotationView.segments[activeNote] || {}).fix || ui.empty}
                </div>
                <div style={{ fontSize: 13 }}>
                  <b>{ui.noteLabel}</b> {(annotationView.segments[activeNote] || {}).note || ui.empty}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: C.t2 }}>{ui.noSentenceIssues}</div>
        )}
      </Collapse>

      <Collapse title={ui.patterns} ui={ui}>
        {patterns.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {patterns.map((p, i) => (
              <div key={i} style={{ border: "1px solid " + C.bdr, borderRadius: 4, padding: "8px 10px", fontSize: 13 }}>
                <b style={{ color: C.blue }}>{p.tag}</b>
                <span style={{ marginLeft: 8, color: C.t2 }}>x{Number(p.count || 0)}</span>
                <div style={{ marginTop: 4 }}>{p.summary || ui.empty}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: C.t2 }}>{ui.empty}</div>
        )}
      </Collapse>

      <Collapse title={ui.comparison} ui={ui}>
        <details style={{ marginBottom: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>{ui.viewModel}</summary>
          <div style={{ marginTop: 8, whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.8 }}>
            {comparison.modelEssay || ui.empty}
          </div>
        </details>
        {comparisonPoints.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {comparisonPoints.map((p, i) => (
              <div key={i} style={{ border: "1px solid " + C.bdr, borderRadius: 4, padding: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{p.title || `Comparison ${i + 1}`}</div>
                <div style={{ fontSize: 13, marginBottom: 4 }}>
                  <b>{ui.yours}</b> {p.yours || ui.empty}
                </div>
                <div style={{ fontSize: 13, marginBottom: 4 }}>
                  <b>{ui.model}</b> {p.model || ui.empty}
                </div>
                <div style={{ fontSize: 13 }}>
                  <b>{ui.diff}</b> {p.difference || ui.empty}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: C.t2 }}>{ui.empty}</div>
        )}
      </Collapse>
    </div>
  );
}


