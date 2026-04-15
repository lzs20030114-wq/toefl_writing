"use client";

import { useState, useCallback, useRef } from "react";
import { C, FONT, Btn, TopBar, SurfaceCard, PageShell } from "../shared/ui";
import { AudioPlayer } from "./AudioPlayer";

const ACCENT = { color: "#8B5CF6", soft: "#F3E8FF" };
const OPTION_KEYS = ["A", "B", "C", "D"];

/**
 * LCR Task — Listen and Choose a Response
 *
 * Props:
 *  - item: single LCR item (for non-batch)
 *  - batchItems: array of LCR items (for batch mode, 10-question sets)
 *  - currentIndex: starting index in batch (default 0)
 *  - onComplete: ({ correct, total, results }) => void
 *  - onExit: () => void
 *  - isPractice: boolean
 */
export function LCRTask({ item, batchItems, currentIndex = 0, onComplete, onExit, isPractice = false }) {
  const items = batchItems || (item ? [item] : []);
  const isBatch = items.length > 1;

  const [qIndex, setQIndex] = useState(currentIndex);
  const [phase, setPhase] = useState("listen"); // "listen" | "choose" | "result"
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState([]); // { itemId, selected, correct, isCorrect }
  const [finished, setFinished] = useState(false);
  const [hoverOption, setHoverOption] = useState(null);
  const [hoverBtn, setHoverBtn] = useState(null);

  const audioPlayedRef = useRef(false);

  const currentItem = items[qIndex] || items[0];
  if (!currentItem) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, background: C.bg }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎧</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No questions available</div>
          <Btn onClick={onExit} variant="secondary">Back to Home</Btn>
        </div>
      </div>
    );
  }

  const handleAudioEnded = useCallback(() => {
    audioPlayedRef.current = true;
    // Auto-advance to choose phase after audio ends
    setPhase("choose");
  }, []);

  const handleReady = useCallback(() => {
    // Manual skip to choose phase (for users who don't want to wait)
    setPhase("choose");
  }, []);

  const handleSelect = useCallback((key) => {
    if (phase !== "choose") return;
    setSelected(key);
  }, [phase]);

  const handleSubmit = useCallback(() => {
    if (!selected || phase !== "choose") return;
    setPhase("result");
  }, [selected, phase]);

  const handleNext = useCallback(() => {
    const isCorrect = selected === currentItem.answer;
    const newResult = {
      itemId: currentItem.id,
      selected,
      correct: currentItem.answer,
      isCorrect,
    };
    const updatedResults = [...results, newResult];
    setResults(updatedResults);

    const nextIndex = qIndex + 1;
    if (nextIndex < items.length) {
      // Move to next question
      setQIndex(nextIndex);
      setPhase("listen");
      setSelected(null);
      setHoverOption(null);
      audioPlayedRef.current = false;
    } else {
      // All done
      setFinished(true);
      const correctCount = updatedResults.filter((r) => r.isCorrect).length;
      if (onComplete) {
        onComplete({
          correct: correctCount,
          total: updatedResults.length,
          results: updatedResults,
        });
      }
    }
  }, [selected, currentItem, results, qIndex, items.length, onComplete]);

  // ── Finished summary screen ──
  if (finished) {
    const correctCount = results.filter((r) => r.isCorrect).length;
    const pct = results.length > 0 ? Math.round((correctCount / results.length) * 100) : 0;
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        <TopBar
          title="Results"
          section="Listening | LCR"
          onExit={onExit}
        />
        <PageShell narrow>
          <SurfaceCard style={{ padding: "36px 32px", textAlign: "center", marginTop: 24 }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>
              {pct >= 80 ? "🎉" : pct >= 60 ? "👍" : "💪"}
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: C.t1, marginBottom: 4 }}>
              {correctCount} / {results.length}
            </div>
            <div style={{ fontSize: 14, color: C.t2, marginBottom: 24 }}>
              {pct}% correct
            </div>

            {/* Result list */}
            <div style={{ textAlign: "left", maxWidth: 560, margin: "0 auto" }}>
              {results.map((r, i) => {
                const itm = items[i];
                return (
                  <div
                    key={r.itemId}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      padding: "12px 0",
                      borderBottom: i < results.length - 1 ? `1px solid ${C.bdrSubtle}` : "none",
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: r.isCorrect ? "#D1FAE5" : "#FEE2E2",
                        color: r.isCorrect ? "#059669" : "#DC2626",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                        fontWeight: 700,
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      {r.isCorrect ? "\u2713" : "\u2717"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: C.t1, fontWeight: 600, marginBottom: 4 }}>
                        Q{i + 1}: {itm?.speaker?.length > 80 ? itm.speaker.slice(0, 77) + "..." : itm?.speaker}
                      </div>
                      <div style={{ fontSize: 12, color: C.t2 }}>
                        Your answer: <strong style={{ color: r.isCorrect ? "#059669" : "#DC2626" }}>{r.selected}</strong>
                        {!r.isCorrect && (
                          <span> — Correct: <strong style={{ color: "#059669" }}>{r.correct}</strong></span>
                        )}
                      </div>
                      {itm?.explanation && !r.isCorrect && (
                        <div style={{ fontSize: 12, color: C.t3, marginTop: 4, lineHeight: 1.5 }}>
                          {itm.explanation}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 28 }}>
              <Btn onClick={onExit} variant="secondary">Exit</Btn>
              <Btn onClick={() => {
                // Reset for new round
                setQIndex(0);
                setPhase("listen");
                setSelected(null);
                setResults([]);
                setFinished(false);
                setHoverOption(null);
                audioPlayedRef.current = false;
              }} style={{ background: ACCENT.color, borderColor: ACCENT.color }}>
                Try Again
              </Btn>
            </div>
          </SurfaceCard>
        </PageShell>
      </div>
    );
  }

  // ── Active question screen ──
  const isCorrect = phase === "result" && selected === currentItem.answer;
  const isWrong = phase === "result" && selected !== currentItem.answer;

  function optionStyle(key) {
    const isSelected = selected === key;
    const isAnswer = currentItem.answer === key;

    let bg = "#fff";
    let border = C.bdr;
    let color = C.t1;
    let fontWeight = 500;

    if (phase === "result") {
      if (isAnswer) {
        bg = "#D1FAE5";
        border = "#059669";
        color = "#065F46";
        fontWeight = 700;
      } else if (isSelected && !isAnswer) {
        bg = "#FEE2E2";
        border = "#DC2626";
        color = "#991B1B";
        fontWeight = 700;
      }
    } else if (isSelected) {
      bg = ACCENT.soft;
      border = ACCENT.color;
      color = "#5B21B6";
      fontWeight = 700;
    } else if (hoverOption === key) {
      bg = "#FAFAFA";
      border = "#C4B5FD";
    }

    return {
      width: "100%",
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "14px 18px",
      borderRadius: 12,
      border: `2px solid ${border}`,
      background: bg,
      color,
      fontWeight,
      fontSize: 15,
      fontFamily: FONT,
      cursor: phase === "choose" ? "pointer" : "default",
      transition: "all 0.15s ease",
      textAlign: "left",
      lineHeight: 1.5,
    };
  }

  function badgeStyle(key) {
    const isSelected = selected === key;
    const isAnswer = currentItem.answer === key;

    let bg = "#F3F4F6";
    let color = C.t2;

    if (phase === "result") {
      if (isAnswer) {
        bg = "#059669";
        color = "#fff";
      } else if (isSelected && !isAnswer) {
        bg = "#DC2626";
        color = "#fff";
      }
    } else if (isSelected) {
      bg = ACCENT.color;
      color = "#fff";
    }

    return {
      width: 30,
      height: 30,
      borderRadius: 8,
      background: bg,
      color,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 14,
      fontWeight: 800,
      flexShrink: 0,
      transition: "all 0.15s ease",
    };
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar
        title="Listen and Choose a Response"
        section="Listening | LCR"
        qInfo={isBatch ? `${qIndex + 1} / ${items.length}` : undefined}
        onExit={onExit}
      />

      <PageShell narrow>
        {/* Situation context */}
        {currentItem.situation && (
          <div
            style={{
              marginTop: 20,
              marginBottom: 4,
              padding: "10px 16px",
              background: ACCENT.soft,
              borderRadius: 10,
              fontSize: 13,
              color: "#5B21B6",
              lineHeight: 1.5,
              border: `1px solid #E9D5FF`,
            }}
          >
            <strong>Situation:</strong> {currentItem.situation}
          </div>
        )}

        {/* Main card */}
        <SurfaceCard style={{ padding: "32px 28px", marginTop: 16 }}>
          {/* Listen phase */}
          {phase === "listen" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: ACCENT.color, marginBottom: 4, letterSpacing: 0.3 }}>
                STEP 1
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: C.t1, marginBottom: 24 }}>
                Listen to the speaker
              </div>

              <AudioPlayer
                src={currentItem.audio_url || null}
                text={currentItem.speaker}
                onEnded={handleAudioEnded}
                maxReplays={2}
                isPractice={isPractice}
              />

              <div style={{ marginTop: 24 }}>
                <button
                  onClick={handleReady}
                  onMouseEnter={() => setHoverBtn("ready")}
                  onMouseLeave={() => setHoverBtn(null)}
                  style={{
                    padding: "10px 28px",
                    borderRadius: 10,
                    border: `1px solid ${C.bdr}`,
                    background: hoverBtn === "ready" ? "#F9FAFB" : "#fff",
                    color: C.t2,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: FONT,
                    transition: "all 0.15s ease",
                  }}
                >
                  I'm ready — show options
                </button>
              </div>
            </div>
          )}

          {/* Choose / Result phase */}
          {(phase === "choose" || phase === "result") && (
            <div>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: ACCENT.color, marginBottom: 4, letterSpacing: 0.3 }}>
                  {phase === "result" ? "RESULT" : "STEP 2"}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: C.t1 }}>
                  {phase === "result" ? (isCorrect ? "Correct!" : "Not quite") : "Choose the best response"}
                </div>
              </div>

              {/* Options */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 600, margin: "0 auto" }}>
                {OPTION_KEYS.map((key) => {
                  const text = currentItem.options?.[key];
                  if (!text) return null;
                  return (
                    <button
                      key={key}
                      onClick={() => handleSelect(key)}
                      onMouseEnter={() => phase === "choose" && setHoverOption(key)}
                      onMouseLeave={() => setHoverOption(null)}
                      disabled={phase === "result"}
                      style={optionStyle(key)}
                    >
                      <div style={badgeStyle(key)}>{key}</div>
                      <span>{text}</span>
                    </button>
                  );
                })}
              </div>

              {/* Explanation (result phase) */}
              {phase === "result" && currentItem.explanation && (
                <div
                  style={{
                    marginTop: 20,
                    padding: "14px 18px",
                    background: isCorrect ? "#F0FDF4" : "#FFF7ED",
                    border: `1px solid ${isCorrect ? "#BBF7D0" : "#FED7AA"}`,
                    borderRadius: 12,
                    fontSize: 13,
                    color: isCorrect ? "#166534" : "#9A3412",
                    lineHeight: 1.6,
                    maxWidth: 600,
                    margin: "20px auto 0",
                  }}
                >
                  <strong>Explanation:</strong> {currentItem.explanation}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 24 }}>
                {phase === "choose" && (
                  <Btn
                    onClick={handleSubmit}
                    disabled={!selected}
                    style={{
                      background: selected ? ACCENT.color : undefined,
                      borderColor: selected ? ACCENT.color : undefined,
                      padding: "12px 32px",
                      fontSize: 15,
                    }}
                  >
                    Submit
                  </Btn>
                )}

                {phase === "result" && (
                  <>
                    <Btn onClick={onExit} variant="secondary">
                      Exit
                    </Btn>
                    <Btn
                      onClick={handleNext}
                      style={{
                        background: ACCENT.color,
                        borderColor: ACCENT.color,
                        padding: "12px 32px",
                        fontSize: 15,
                      }}
                    >
                      {qIndex + 1 < items.length ? "Next Question" : "See Results"}
                    </Btn>
                  </>
                )}
              </div>
            </div>
          )}
        </SurfaceCard>

        {/* Progress dots for batch mode */}
        {isBatch && (
          <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 20 }}>
            {items.map((_, i) => {
              const done = i < results.length;
              const current = i === qIndex;
              const result = results[i];
              let bg = C.bdr;
              if (done && result?.isCorrect) bg = "#059669";
              else if (done && !result?.isCorrect) bg = "#DC2626";
              else if (current) bg = ACCENT.color;

              return (
                <div
                  key={i}
                  style={{
                    width: current ? 24 : 8,
                    height: 8,
                    borderRadius: 4,
                    background: bg,
                    transition: "all 0.2s ease",
                  }}
                />
              );
            })}
          </div>
        )}
      </PageShell>
    </div>
  );
}
