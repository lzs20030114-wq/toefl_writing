"use client";
import React, { useMemo, useState } from "react";
import { FONT } from "../shared/ui";
import { analyzeVocabulary, LEVELS } from "../../lib/vocabulary/cefrAnalyzer";

/* ── CEFR level colors ── */
const LEVEL_COLORS = {
  A1: { main: "#94a3b8", bg: "#f1f5f9", label: "A1 入门" },
  A2: { main: "#60a5fa", bg: "#eff6ff", label: "A2 基础" },
  B1: { main: "#34d399", bg: "#ecfdf5", label: "B1 中级" },
  B2: { main: "#fbbf24", bg: "#fffbeb", label: "B2 中高级" },
  C1: { main: "#f97316", bg: "#fff7ed", label: "C1 高级" },
  C2: { main: "#ef4444", bg: "#fef2f2", label: "C2 精通" },
};

/* ── SVG Pie Chart ── */
function PieChart({ distribution, size = 140 }) {
  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const segments = [];
  let startAngle = -90;

  for (const level of LEVELS) {
    const pct = distribution[level] || 0;
    if (pct === 0) continue;
    const angle = (pct / 100) * 360;
    const endAngle = startAngle + angle;
    const largeArc = angle > 180 ? 1 : 0;
    const rad = (deg) => (deg * Math.PI) / 180;
    const x1 = cx + r * Math.cos(rad(startAngle));
    const y1 = cy + r * Math.sin(rad(startAngle));
    const x2 = cx + r * Math.cos(rad(endAngle));
    const y2 = cy + r * Math.sin(rad(endAngle));
    segments.push(
      <path
        key={level}
        d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`}
        fill={LEVEL_COLORS[level].main}
        stroke="#fff"
        strokeWidth={1.5}
      />
    );
    startAngle = endAngle;
  }

  // fallback if all zero
  if (segments.length === 0) {
    segments.push(<circle key="empty" cx={cx} cy={cy} r={r} fill="#e5e7eb" />);
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      {segments}
    </svg>
  );
}

/* ── Legend table ── */
function LegendTable({ distribution, counts }) {
  return (
    <div style={{ display: "grid", gap: 4, fontSize: 12, fontFamily: FONT }}>
      {LEVELS.map((l) => {
        const pct = distribution[l] || 0;
        const cnt = counts[l] || 0;
        if (pct === 0 && cnt === 0) return null;
        return (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: LEVEL_COLORS[l].main, flexShrink: 0 }} />
            <span style={{ fontWeight: 700, minWidth: 70, color: "#334155" }}>{LEVEL_COLORS[l].label}</span>
            <span style={{ color: "#64748b" }}>{pct}%</span>
            <span style={{ color: "#94a3b8", fontSize: 11 }}>({cnt}词)</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Colored essay text ── */
function ColoredText({ words, text }) {
  const [hovIdx, setHovIdx] = useState(null);

  // build segments: interleave non-word text with colored words
  const segments = [];
  let lastEnd = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.index > lastEnd) {
      segments.push({ type: "gap", text: text.slice(lastEnd, w.index) });
    }
    segments.push({ type: "word", ...w, i });
    lastEnd = w.index + w.word.length;
  }
  if (lastEnd < text.length) {
    segments.push({ type: "gap", text: text.slice(lastEnd) });
  }

  return (
    <div style={{ lineHeight: 2, fontSize: 14, fontFamily: FONT, whiteSpace: "pre-wrap", position: "relative" }}>
      {segments.map((seg, idx) => {
        if (seg.type === "gap") return <span key={idx}>{seg.text}</span>;
        const lc = LEVEL_COLORS[seg.level];
        const isFn = seg.level === "fn" || seg.level === "other";
        const isHov = hovIdx === seg.i;
        return (
          <span
            key={idx}
            onMouseEnter={() => setHovIdx(seg.i)}
            onMouseLeave={() => setHovIdx(null)}
            style={{
              position: "relative",
              background: isFn ? "transparent" : isHov ? lc?.main + "30" : lc?.bg || "transparent",
              borderRadius: 3,
              padding: "0 1px",
              cursor: isFn ? "default" : "pointer",
              borderBottom: isFn ? "none" : `2px solid ${lc?.main || "transparent"}`,
              transition: "background 0.15s",
            }}
          >
            {seg.word}
            {isHov && !isFn && lc && (
              <span
                style={{
                  position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)",
                  background: "#1e293b", color: "#fff", fontSize: 11, fontWeight: 700,
                  padding: "3px 8px", borderRadius: 4, whiteSpace: "nowrap", zIndex: 10,
                  pointerEvents: "none",
                }}
              >
                {seg.level}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/* ── Upgrade suggestion cards ── */
function UpgradeCards({ suggestions }) {
  if (!suggestions || suggestions.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>
        词汇升级建议
      </div>
      {suggestions.map((s, idx) => (
        <div
          key={idx}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 12px",
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <span style={{
            background: LEVEL_COLORS[s.level]?.bg || "#f1f5f9",
            color: LEVEL_COLORS[s.level]?.main || "#94a3b8",
            padding: "2px 8px", borderRadius: 4, fontWeight: 700, fontSize: 12,
          }}>
            {s.original}
            <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 3 }}>{s.level}</span>
          </span>
          <span style={{ color: "#94a3b8", fontSize: 16 }}>{"\u2192"}</span>
          <span style={{
            background: LEVEL_COLORS[s.upgradeLevel]?.bg || "#fff7ed",
            color: LEVEL_COLORS[s.upgradeLevel]?.main || "#f97316",
            padding: "2px 8px", borderRadius: 4, fontWeight: 700, fontSize: 12,
          }}>
            {s.upgrade}
            <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 3 }}>{s.upgradeLevel}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Upgrade banner (matches project style) ── */
function VocabUpgradeBanner({ onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        padding: "10px 14px", marginTop: 12,
        background: "linear-gradient(135deg, #ecfdf5, #ecfeff)",
        border: "1px solid rgba(13,150,104,0.19)", borderRadius: 10,
        cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#087355",
      }}
    >
      <span>{"\uD83D\uDD12"}</span>
      <span>升级 Pro 解锁完整词汇分析</span>
      <span style={{ padding: "4px 12px", borderRadius: 6, background: "linear-gradient(135deg, #087355, #0891B2)", color: "#fff", fontSize: 11, fontWeight: 700 }}>升级</span>
    </div>
  );
}

/* ── Main panel ── */
export default function VocabCEFRPanel({ text, isPro = true, onUpgrade }) {
  const analysis = useMemo(() => analyzeVocabulary(text), [text]);

  if (!text || analysis.totalCounted === 0) {
    return <div style={{ color: "#94a3b8", fontSize: 13, padding: 12 }}>未检测到可分析的英文词汇。</div>;
  }

  const blurStyle = !isPro ? { filter: "blur(5px)", userSelect: "none", WebkitUserSelect: "none", pointerEvents: "none" } : {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: FONT }}>
      {/* Section 1: Pie chart + legend — always visible as teaser */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 10 }}>
          词汇等级分布
          <span style={{ fontWeight: 400, color: "#94a3b8", marginLeft: 8, fontSize: 12 }}>
            共 {analysis.totalCounted} 个实义词
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <PieChart distribution={analysis.distribution} />
          <LegendTable distribution={analysis.distribution} counts={analysis.counts} />
        </div>
        <div style={{ marginTop: 10, fontSize: 13, color: "#64748b", lineHeight: 1.6, background: "#f8fafc", borderRadius: 8, padding: "8px 12px" }}>
          {analysis.summary}
        </div>
      </div>

      {/* Section 2: Colored text — blurred for free users */}
      <div style={blurStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 8 }}>
          词汇标注（悬停查看等级）
        </div>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, background: "#fff", maxHeight: 300, overflowY: "auto" }}>
          <ColoredText words={analysis.words} text={text} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
          {LEVELS.map((l) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: LEVEL_COLORS[l].main }} />
              {l}
            </span>
          ))}
          <span style={{ fontSize: 11, color: "#94a3b8" }}>| 无色 = 功能词/未收录</span>
        </div>
      </div>

      {/* Section 3: Upgrade suggestions — blurred for free users */}
      <div style={blurStyle}>
        <UpgradeCards suggestions={analysis.upgradeSuggestions} />
      </div>

      {/* Upgrade banner for free users */}
      {!isPro && onUpgrade && <VocabUpgradeBanner onClick={onUpgrade} />}
    </div>
  );
}

/** Get preview string for DisclosureSection */
export function getVocabPreview(text) {
  if (!text) return "暂无";
  const a = analyzeVocabulary(text);
  if (a.totalCounted === 0) return "暂无";
  const basic = (a.distribution.A1 || 0) + (a.distribution.A2 || 0);
  const adv = (a.distribution.B2 || 0) + (a.distribution.C1 || 0) + (a.distribution.C2 || 0);
  return `基础词 ${basic}% \u00B7 B2+ ${adv}%`;
}
