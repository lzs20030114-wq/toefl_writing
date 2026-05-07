"use client";

import { useState, useRef, useCallback } from "react";
import { C, FONT, Btn, TopBar, SurfaceCard, PageShell } from "../shared/ui";
import { AudioPlayer } from "./AudioPlayer";
import { buildDraftKey, loadDraft, clearDraft, useDraftPersist } from "../../lib/draftPersist";

const ACCENT = { color: "#8B5CF6", soft: "#F3E8FF" };
const KEYS = ["A", "B", "C", "D"];

/**
 * Generic Listening MCQ Task — used for LA (Announcement), LC (Conversation), LAT (Academic Talk).
 *
 * Data shape expected:
 *   item.audio_url — URL to audio file (optional, falls back to TTS of transcript)
 *   item.transcript OR item.announcement OR item.lecture — text for TTS fallback
 *   item.questions[] — array of { stem, options: {A,B,C,D}, answer, type, explanation }
 *
 * Flow: listen to audio → answer questions one by one → results
 */
export function ListeningMCQTask({ item, onComplete, onExit, isPractice = false, title = "Listening", section = "Listening" }) {
  const questions = item?.questions || [];
  const totalQ = questions.length;

  // Get the text for TTS fallback
  const transcript = item?.transcript || item?.announcement || item?.lecture || "";
  // For conversations, join turns
  const ttsText = item?.conversation
    ? item.conversation.map(t => `${t.speaker}: ${t.text}`).join(". ")
    : transcript;

  // Restore in-progress selections from localStorage when re-opening the same item.
  const draftKey = buildDraftKey("listening-mcq", item?.id || "");
  const draftRestored = loadDraft(draftKey);
  const initialSelections = (() => {
    if (Array.isArray(draftRestored?.selections) && draftRestored.selections.length === totalQ) {
      return draftRestored.selections;
    }
    return Array(totalQ).fill(null);
  })();
  // If user already started answering, skip the listen phase on resume.
  const hasAnyAnswer = initialSelections.some((s) => s !== null);

  const [phase, setPhase] = useState(hasAnyAnswer ? "answer" : "listen"); // listen | answer | results
  const [currentQ, setCurrentQ] = useState(() => {
    const idx = Number(draftRestored?.currentQ);
    if (Number.isInteger(idx) && idx >= 0 && idx < totalQ) return idx;
    return 0;
  });
  const [selections, setSelections] = useState(initialSelections);
  const [submitted, setSubmitted] = useState(false);
  const [hover, setHover] = useState(null);

  const resultsRef = useRef(null);

  useDraftPersist(draftKey, { selections, currentQ }, { enabled: !submitted });

  const handleAudioEnded = useCallback(() => {
    // Auto-advance to answer phase after audio ends
    if (phase === "listen") setPhase("answer");
  }, [phase]);

  const handleSelect = (key) => {
    if (submitted) return;
    const next = [...selections];
    next[currentQ] = key;
    setSelections(next);
  };

  const handleSubmit = () => {
    setSubmitted(true);
    clearDraft(draftKey);
    // Compute results
    const results = questions.map((q, i) => ({
      qIndex: i,
      selected: selections[i],
      correct: q.answer,
      isCorrect: selections[i] === q.answer,
    }));
    resultsRef.current = results;
  };

  const handleNext = () => {
    if (currentQ < totalQ - 1) {
      setCurrentQ(currentQ + 1);
    }
  };

  const handlePrev = () => {
    if (currentQ > 0) {
      setCurrentQ(currentQ - 1);
    }
  };

  const handleFinish = () => {
    const results = resultsRef.current || [];
    const correct = results.filter(r => r.isCorrect).length;
    if (typeof onComplete === "function") {
      onComplete({ correct, total: totalQ, results });
    }
  };

  if (!item || totalQ === 0) {
    return (
      <PageShell>
        <div style={{ textAlign: "center", padding: "80px 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎧</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>No questions available</div>
          <div style={{ marginTop: 20 }}>
            <Btn onClick={onExit} variant="secondary">返回</Btn>
          </div>
        </div>
      </PageShell>
    );
  }

  const q = questions[currentQ];
  const allAnswered = selections.every(s => s !== null);

  // ── LISTEN PHASE ──
  if (phase === "listen") {
    return (
      <PageShell narrow>
        <TopBar title={title} section={section} onExit={onExit} />
        <SurfaceCard style={{ padding: "40px 24px", textAlign: "center", marginTop: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.t1, marginBottom: 24 }}>
            Listen carefully
          </div>
          <AudioPlayer
            src={item.audio_url || null}
            text={ttsText}
            onEnded={handleAudioEnded}
            maxReplays={isPractice ? 99 : 2}
            isPractice={isPractice}
          />
          <div style={{ marginTop: 24 }}>
            <Btn onClick={() => setPhase("answer")} variant="secondary">
              I'm ready to answer
            </Btn>
          </div>
        </SurfaceCard>
      </PageShell>
    );
  }

  // ── RESULTS PHASE ──
  if (phase === "results" || submitted) {
    const results = resultsRef.current || [];
    const correct = results.filter(r => r.isCorrect).length;

    return (
      <PageShell narrow>
        <TopBar title={title} section={section} onExit={onExit} />
        <SurfaceCard style={{ padding: "24px", marginTop: 20 }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: ACCENT.color, textTransform: "uppercase", marginBottom: 4 }}>Result</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: C.t1 }}>{correct}/{totalQ}</div>
          </div>

          {questions.map((q, i) => {
            const r = results[i];
            return (
              <div key={i} style={{ marginBottom: 20, padding: "16px", background: r?.isCorrect ? "#F0FDF4" : "#FEF2F2", borderRadius: 10, border: `1px solid ${r?.isCorrect ? "#BBF7D0" : "#FECACA"}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.t1, marginBottom: 8 }}>
                  Q{i + 1}: {q.stem}
                </div>
                {KEYS.map(k => {
                  const isCorrect = k === q.answer;
                  const isSelected = k === r?.selected;
                  let bg = "#fff";
                  let border = "#E5E7EB";
                  let color = C.t1;
                  if (isCorrect) { bg = "#D1FAE5"; border = "#059669"; color = "#065F46"; }
                  else if (isSelected && !isCorrect) { bg = "#FEE2E2"; border = "#DC2626"; color = "#991B1B"; }

                  return (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 4, background: bg, border: `1px solid ${border}`, borderRadius: 6, fontSize: 13, color }}>
                      <span style={{ fontWeight: 700, minWidth: 20 }}>{k}.</span>
                      <span>{q.options[k]}</span>
                      {isCorrect && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700 }}>✓</span>}
                      {isSelected && !isCorrect && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700 }}>✗</span>}
                    </div>
                  );
                })}
                {q.explanation && (
                  <div style={{ marginTop: 8, fontSize: 12, color: C.t2, lineHeight: 1.5, padding: "8px 10px", background: "#FFFBEB", borderRadius: 6, border: "1px solid #FDE68A" }}>
                    <strong>Explanation:</strong> {q.explanation}
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
            <Btn onClick={onExit} variant="secondary">退出</Btn>
            <Btn onClick={handleFinish}>完成</Btn>
          </div>
        </SurfaceCard>
      </PageShell>
    );
  }

  // ── ANSWER PHASE ──
  return (
    <PageShell narrow>
      <TopBar
        title={title}
        section={section}
        onExit={onExit}
        qInfo={`Q ${currentQ + 1}/${totalQ}`}
      />

      {/* Replay audio button */}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 16, marginBottom: 8 }}>
        <Btn onClick={() => setPhase("listen")} variant="secondary" style={{ fontSize: 12, padding: "6px 14px" }}>
          🔊 Replay audio
        </Btn>
      </div>

      <SurfaceCard style={{ padding: "24px", marginTop: 8 }}>
        {/* Question */}
        <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 16, lineHeight: 1.5 }}>
          Q{currentQ + 1}. {q.stem}
        </div>

        {/* Options */}
        {KEYS.map(k => {
          if (!q.options[k]) return null;
          const isSelected = selections[currentQ] === k;
          let bg = "#FAFAFA";
          let border = "#E5E7EB";
          let color = C.t1;

          if (isSelected) {
            bg = ACCENT.soft;
            border = ACCENT.color;
            color = ACCENT.color;
          }

          return (
            <button
              key={k}
              onClick={() => handleSelect(k)}
              onMouseEnter={() => setHover(k)}
              onMouseLeave={() => setHover(null)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "12px 14px", marginBottom: 8, background: bg,
                border: `1.5px solid ${border}`, borderRadius: 10, cursor: "pointer",
                color, fontSize: 14, fontFamily: FONT, textAlign: "left",
                transition: "all 0.12s",
                transform: hover === k ? "translateY(-1px)" : "none",
                boxShadow: hover === k ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
              }}
            >
              <span style={{
                width: 28, height: 28, borderRadius: "50%", display: "flex",
                alignItems: "center", justifyContent: "center", fontWeight: 800,
                fontSize: 13, flexShrink: 0,
                background: isSelected ? ACCENT.color : "#F3F4F6",
                color: isSelected ? "#fff" : C.t2,
              }}>
                {k}
              </span>
              <span style={{ flex: 1 }}>{q.options[k]}</span>
            </button>
          );
        })}

        {/* Navigation */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
          <Btn onClick={handlePrev} variant="secondary" disabled={currentQ === 0}>上一题</Btn>
          {currentQ < totalQ - 1 ? (
            <Btn onClick={handleNext} disabled={selections[currentQ] === null}>下一题</Btn>
          ) : (
            <Btn onClick={() => { handleSubmit(); setPhase("results"); }} disabled={!allAnswered}>提交</Btn>
          )}
        </div>

        {/* Progress dots */}
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 16 }}>
          {questions.map((_, i) => {
            const isActive = i === currentQ;
            const isAnswered = selections[i] !== null;
            let bg = "#E5E7EB";
            if (isActive) bg = ACCENT.color;
            else if (isAnswered) bg = ACCENT.soft;

            return (
              <button
                key={i}
                onClick={() => setCurrentQ(i)}
                style={{
                  width: 28, height: 28, borderRadius: "50%", border: "none",
                  background: bg, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  color: isActive ? "#fff" : isAnswered ? ACCENT.color : C.t3,
                  transition: "all 0.15s",
                }}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </SurfaceCard>
    </PageShell>
  );
}
