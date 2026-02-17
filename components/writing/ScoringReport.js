"use client";
import React, { useMemo, useState } from "react";
import { C } from "../shared/ui";
import { buildAnnotationSegments, countAnnotations, parseAnnotations } from "../../lib/annotations/parseAnnotations";

const warnedParseFallback = new Set();

function Collapse({ title, defaultOpen = false, children, subtitle }) {
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
        <span style={{ color: C.t2, fontSize: 12 }}>{open ? "Hide" : "Show"}</span>
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

export function ScoringReport({ result, type }) {
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
        const start = pos;
        const end = pos + text.length;
        annotations.push({
          level: s.level,
          message: s.note || "",
          fix: s.fix || "",
          start,
          end,
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
  const comparison = result.comparison || { modelEssay: "", points: [] };
  const comparisonPoints = Array.isArray(comparison.points) ? comparison.points : [];

  return (
    <div data-testid="score-panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ background: C.nav, color: "#fff", borderRadius: 6, padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 38, fontWeight: 800 }}>{result.score}</span>
            <span style={{ opacity: 0.8 }}>/ 5</span>
          </div>
          <span style={{ background: scoreColor, borderRadius: 14, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>
            Band {result.band ?? "-"}
          </span>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>{result.summary || "This section is unavailable."}</div>
        {type === "email" ? (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {goals.length > 0 ? (
              goals.map((g, i) => {
                const s = statusStyle(g.status);
                return (
                  <div key={i} style={{ background: s.bg, color: "#111827", borderRadius: 4, padding: "8px 10px", fontSize: 13 }}>
                    <b style={{ color: s.color, marginRight: 8 }}>{s.icon}</b>
                    Goal {g.index}: {g.reason || "No explanation provided."}
                  </div>
                );
              })
            ) : (
              <div style={{ fontSize: 13, opacity: 0.85 }}>This section is unavailable.</div>
            )}
          </div>
        ) : null}
      </div>

      <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Action Plan</div>
        {actions.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {actions.map((a, i) => (
              <div key={i} style={{ border: "1px solid " + C.bdr, borderLeft: "4px solid " + (i === 0 ? C.red : C.orange), borderRadius: 4, padding: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{a.title || `Action ${i + 1}`}</div>
                <div style={{ fontSize: 13, color: C.t1, marginBottom: 6 }}>
                  <b>Why it matters:</b> {a.importance || "This section is unavailable."}
                </div>
                <div style={{ fontSize: 13, background: "#f8fafc", borderRadius: 4, padding: "8px 10px" }}>
                  <b>Do this now:</b> {a.action || "This section is unavailable."}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: C.t2 }}>This section is unavailable.</div>
        )}
      </div>

      <Collapse
        title="Sentence Annotations"
        subtitle={`${markCounts.red || 0} grammar errors | ${markCounts.orange || 0} wording suggestions | ${markCounts.blue || 0} upgrade suggestions`}
      >
        {annotationView.segments && annotationView.segments.length > 0 ? (
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
                  <b>Suggested rewrite:</b> {(annotationView.segments[activeNote] || {}).fix || "This section is unavailable."}
                </div>
                <div style={{ fontSize: 13 }}>
                  <b>Issue note:</b> {(annotationView.segments[activeNote] || {}).note || "This section is unavailable."}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: C.t2 }}>{annotationView.plainText || "This section is unavailable."}</div>
        )}
      </Collapse>

      <Collapse title="Pattern Summary">
        {patterns.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {patterns.map((p, i) => (
              <div key={i} style={{ border: "1px solid " + C.bdr, borderRadius: 4, padding: "8px 10px", fontSize: 13 }}>
                <b style={{ color: C.blue }}>{p.tag}</b>
                <span style={{ marginLeft: 8, color: C.t2 }}>x{Number(p.count || 0)}</span>
                <div style={{ marginTop: 4 }}>{p.summary || "This section is unavailable."}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: C.t2 }}>This section is unavailable.</div>
        )}
      </Collapse>

      <Collapse title="Model Comparison">
        <details style={{ marginBottom: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>View full model response</summary>
          <div style={{ marginTop: 8, whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.8 }}>
            {comparison.modelEssay || "This section is unavailable."}
          </div>
        </details>
        {comparisonPoints.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {comparisonPoints.map((p, i) => (
              <div key={i} style={{ border: "1px solid " + C.bdr, borderRadius: 4, padding: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{p.title || `Comparison ${i + 1}`}</div>
                <div style={{ fontSize: 13, marginBottom: 4 }}>
                  <b>Yours:</b> {p.yours || "This section is unavailable."}
                </div>
                <div style={{ fontSize: 13, marginBottom: 4 }}>
                  <b>Model:</b> {p.model || "This section is unavailable."}
                </div>
                <div style={{ fontSize: 13 }}>
                  <b>Difference:</b> {p.difference || "This section is unavailable."}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: C.t2 }}>This section is unavailable.</div>
        )}
      </Collapse>
    </div>
  );
}
