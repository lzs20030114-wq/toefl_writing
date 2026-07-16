"use client";

import React, { useState } from "react";
import { AudioPlayer } from "../listening/AudioPlayer";
import { NEUTRAL } from "../shared/ui";

// Shared speaking task-detail renderers (Repeat / Interview) + helpers, split out
// of SpeakingProgressView so both the practice list and the mock diagnostic report
// (SpeakingMockDetail) render per-question detail identically. Behavior unchanged.

const ACCENT = { color: "#F59E0B", soft: "#FFFBEB" };
const P = { ...NEUTRAL };

// -- Repeat Detail --

export function RepeatDetail({ session }) {
  const items = session.details?.items || [];
  const elapsed = session.details?.elapsed || 0;
  const attempted = session.details?.attempted || 0;
  const total = session.details?.total || items.length;

  if (items.length === 0) {
    return <div style={{ fontSize: 12, color: P.textDim, fontStyle: "italic" }}>暂无详细练习数据</div>;
  }

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Summary bar */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: P.textSec, marginBottom: 4 }}>
        <span>录制 {attempted}/{total} 句</span>
        {elapsed > 0 && <span>用时 {formatTime(elapsed)}</span>}
      </div>

      {items.map((item, i) => {
        const score = item.score;
        const accuracy = score?.accuracy;
        const accColor = accuracy != null ? (accuracy >= 80 ? "#059669" : accuracy >= 60 ? "#D97706" : "#DC2626") : P.textDim;

        return (
          <div key={i} style={{
            padding: "10px 12px", borderRadius: 10,
            background: accuracy != null ? (accuracy >= 80 ? "#F0FDF4" : accuracy >= 60 ? "#FFFBEB" : "#FEF2F2") : "#F9FAFB",
            border: `1px solid ${accuracy != null ? (accuracy >= 80 ? "#BBF7D0" : accuracy >= 60 ? "#FDE68A" : "#FECACA") : P.borderSubtle}`,
          }}>
            {/* Sentence number + text */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
              <span style={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                background: item.recorded ? `${ACCENT.color}15` : "#F3F4F6",
                color: item.recorded ? ACCENT.color : P.textDim,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700,
              }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Word-level highlight if score available */}
                {score && score.matchedWords && score.missedWords ? (
                  <WordHighlight
                    originalSentence={item.sentence}
                    matchedWords={score.matchedWords}
                    missedWords={score.missedWords}
                  />
                ) : (
                  <div style={{ fontSize: 13, color: P.text, lineHeight: 1.6 }}>
                    {item.sentence || "（句子内容不可用）"}
                  </div>
                )}
                {/* Replay the target sentence (TTS) for 精听 / 复述对照 */}
                {item.sentence && (
                  <div style={{ marginTop: 6 }}>
                    <AudioPlayer compact text={item.sentence} isPractice />
                  </div>
                )}
              </div>
            </div>

            {/* Accuracy bar */}
            {accuracy != null && (
              <div style={{ marginLeft: 30 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <div style={{ flex: 1, height: 4, background: "#E5E7EB", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 2, background: accColor, width: `${accuracy}%`, transition: "width 0.5s" }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 750, color: accColor, minWidth: 40, textAlign: "right" }}>{accuracy}%</span>
                </div>
              </div>
            )}

            {/* Extra words if any */}
            {score?.extraWords && score.extraWords.length > 0 && (
              <div style={{ marginLeft: 30, marginTop: 4, fontSize: 11, color: P.textDim }}>
                多余词: {score.extraWords.map((w, j) => (
                  <span key={j} style={{ display: "inline-block", margin: "1px 3px", padding: "1px 5px", background: "#F3F4F6", borderRadius: 4 }}>{w}</span>
                ))}
              </div>
            )}

            {/* Transcript if no score but transcript exists */}
            {!score && item.transcript && (
              <div style={{ marginLeft: 30, marginTop: 4, padding: "6px 10px", background: "#F9FAFB", border: `1px solid ${P.borderSubtle}`, borderRadius: 6, fontSize: 12, color: P.textSec, fontStyle: "italic", lineHeight: 1.5 }}>
                {item.transcript}
              </div>
            )}

            {/* Not recorded indicator */}
            {!item.recorded && (
              <div style={{ marginLeft: 30, fontSize: 11, color: P.textDim, fontStyle: "italic" }}>未录制</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// -- Word Highlight (reused from RepeatTask pattern) --

export function WordHighlight({ originalSentence, matchedWords, missedWords }) {
  const origWords = String(originalSentence || "").split(/\s+/).filter(Boolean);
  const normalizeWord = (w) => w.toLowerCase().replace(/[^\w]/g, "");

  const matchedPool = [...(matchedWords || [])];
  const missedPool = [...(missedWords || [])];

  const styled = origWords.map((word, idx) => {
    const norm = normalizeWord(word);
    const matchIdx = matchedPool.indexOf(norm);
    if (matchIdx !== -1) {
      matchedPool.splice(matchIdx, 1);
      return <span key={idx} style={{ color: "#16A34A", fontWeight: 600 }}>{word} </span>;
    }
    const missIdx = missedPool.indexOf(norm);
    if (missIdx !== -1) {
      missedPool.splice(missIdx, 1);
      return <span key={idx} style={{ color: "#DC2626", textDecoration: "line-through", textDecorationColor: "#DC2626" }}>{word} </span>;
    }
    return <span key={idx} style={{ color: "#DC2626", textDecoration: "line-through", textDecorationColor: "#DC2626" }}>{word} </span>;
  });

  return <div style={{ fontSize: 13, lineHeight: 1.8 }}>{styled}</div>;
}

// -- Interview Detail --

export const DIM_LABELS = {
  fluency: { label: "流利度", en: "Fluency" },
  intelligibility: { label: "可理解度", en: "Intelligibility" },
  language: { label: "语言使用", en: "Language" },
  organization: { label: "组织结构", en: "Organization" },
};

export const DIM_COLORS = {
  fluency: "#F59E0B",
  intelligibility: "#0891B2",
  language: "#7C3AED",
  organization: "#16A34A",
};

export function InterviewDetail({ session }) {
  const items = session.details?.items || [];
  const elapsed = session.details?.totalElapsed || session.details?.elapsed || 0;
  const attempted = session.details?.attempted || 0;
  const total = session.details?.total || items.length;
  const [expandedQ, setExpandedQ] = useState(null);

  if (items.length === 0) {
    return <div style={{ fontSize: 12, color: P.textDim, fontStyle: "italic" }}>暂无详细练习数据</div>;
  }

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Summary bar */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: P.textSec, marginBottom: 4 }}>
        <span>回答 {attempted}/{total} 题</span>
        {elapsed > 0 && <span>用时 {formatTime(elapsed)}</span>}
      </div>

      {items.map((item, i) => {
        const sc = item.aiScore;
        const hasScore = sc && !sc.error;
        const scoreColor = hasScore ? (sc.score >= 4 ? "#059669" : sc.score >= 3 ? "#D97706" : "#DC2626") : P.textDim;
        const isExpanded = expandedQ === i;

        return (
          <div key={i} style={{
            padding: "10px 12px", borderRadius: 10,
            background: hasScore ? (sc.score >= 4 ? "#F0FDF4" : sc.score >= 3 ? "#FFFBEB" : "#FEF2F2") : "#F9FAFB",
            border: `1px solid ${hasScore ? (sc.score >= 4 ? "#BBF7D0" : sc.score >= 3 ? "#FDE68A" : "#FECACA") : P.borderSubtle}`,
            cursor: "pointer",
          }}
            onClick={() => setExpandedQ(isExpanded ? null : i)}
          >
            {/* Question header */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                background: item.recorded ? "#EF444415" : "#F3F4F6",
                color: item.recorded ? "#EF4444" : P.textDim,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700,
              }}>Q{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: P.text, lineHeight: 1.6, fontWeight: 500 }}>
                  {item.question || "（问题内容不可用）"}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  {item.category && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "#EDE9FE", color: "#5B21B6" }}>{item.category}</span>
                  )}
                  {hasScore && (
                    <span style={{ fontSize: 11, fontWeight: 750, color: scoreColor, background: `${scoreColor}0C`, padding: "2px 8px", borderRadius: 6 }}>{sc.score}/5</span>
                  )}
                  {!item.recorded && (
                    <span style={{ fontSize: 10, color: P.textDim, fontStyle: "italic" }}>已跳过</span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 10, color: P.textDim }}>{isExpanded ? "▼" : "▶"}</span>
                </div>
              </div>
            </div>

            {/* Expanded: dimension bars + transcript + feedback */}
            {isExpanded && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${P.borderSubtle}` }}
                onClick={e => e.stopPropagation()}>
                {/* Replay the interview question (TTS) for review */}
                {item.question && (
                  <div style={{ marginBottom: 10 }}>
                    <AudioPlayer compact text={item.question} isPractice />
                  </div>
                )}
                {/* Dimension bars */}
                {hasScore && sc.dimensions && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                    {Object.entries(DIM_LABELS).map(([key, { label, en }]) => {
                      const dim = sc.dimensions[key];
                      if (!dim) return null;
                      const pct = (dim.score / 5) * 100;
                      const dimColor = DIM_COLORS[key];
                      return (
                        <div key={key}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: P.text }}>
                              {label} <span style={{ color: P.textDim, fontWeight: 400 }}>{en}</span>
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 800, color: dimColor }}>{dim.score}</span>
                          </div>
                          <div style={{ height: 4, background: "#E5E7EB", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: 2, background: dimColor, width: `${pct}%`, transition: "width 0.5s" }} />
                          </div>
                          {dim.feedback && (
                            <div style={{ fontSize: 11, color: P.textSec, lineHeight: 1.4, marginTop: 2 }}>{dim.feedback}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* AI summary */}
                {hasScore && sc.summary && (
                  <div style={{ padding: "8px 10px", background: "#F9FAFB", border: `1px solid ${P.borderSubtle}`, borderRadius: 8, fontSize: 12, color: P.text, lineHeight: 1.6, marginBottom: 8 }}>
                    {sc.summary}
                  </div>
                )}

                {/* Suggestions */}
                {hasScore && sc.suggestions && sc.suggestions.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: P.textDim, textTransform: "uppercase", marginBottom: 4 }}>改进建议</div>
                    {sc.suggestions.map((sug, j) => (
                      <div key={j} style={{ display: "flex", gap: 6, marginBottom: 3, fontSize: 11, color: P.textSec, lineHeight: 1.4 }}>
                        <span style={{ color: ACCENT.color, fontWeight: 700, flexShrink: 0 }}>{j + 1}.</span>
                        <span>{sug}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Transcript */}
                {item.transcript && (
                  <div style={{ padding: "8px 10px", background: "#F9FAFB", border: `1px solid ${P.borderSubtle}`, borderRadius: 8, fontSize: 12, color: P.textSec, lineHeight: 1.5, fontStyle: "italic", maxHeight: 100, overflowY: "auto" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: P.textDim, fontStyle: "normal" }}>Transcript: </span>
                    {item.transcript}
                  </div>
                )}

                {/* No data fallback */}
                {!hasScore && !item.transcript && item.recorded && (
                  <div style={{ fontSize: 12, color: P.textDim, fontStyle: "italic" }}>评分数据不可用</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
