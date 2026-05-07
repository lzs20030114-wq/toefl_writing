"use client";

import { useState, useCallback, useRef } from "react";
import { C, FONT, Btn, TopBar, SurfaceCard, PageShell } from "../shared/ui";
import { AudioPlayer } from "./AudioPlayer";
import { buildDraftKey, loadDraft, clearDraft, useDraftPersist } from "../../lib/draftPersist";

const ACCENT = { color: "#8B5CF6", soft: "#F3E8FF" };
const OPTION_KEYS = ["A", "B", "C", "D"];

/**
 * LCR Task — Listen and Choose a Response
 *
 * Flow: listen → choose → (next question) → ... → results page
 * All answers submitted at once after the last question.
 */
export function LCRTask({ item, batchItems, currentIndex = 0, onComplete, onExit, isPractice = false }) {
  const items = batchItems || (item ? [item] : []);
  const isBatch = items.length > 1;

  // Scope drafts by the joined ids of the batch — same set of items reopened
  // resumes; a different randomized batch starts fresh.
  const batchScope = items.map((it) => it?.id || "?").join("|");
  const draftKey = buildDraftKey("lcr", batchScope);
  const draftRestored = loadDraft(draftKey);

  const [qIndex, setQIndex] = useState(() => {
    const idx = Number(draftRestored?.qIndex);
    if (Number.isInteger(idx) && idx >= 0 && idx < items.length) return idx;
    return currentIndex;
  });
  const [phase, setPhase] = useState("listen"); // "listen" | "choose"
  const [selected, setSelected] = useState(null);
  const [answers, setAnswers] = useState(() => {
    return Array.isArray(draftRestored?.answers) ? draftRestored.answers : [];
  }); // collected answers: { itemId, selected }
  const [finished, setFinished] = useState(false);
  const [hoverOption, setHoverOption] = useState(null);
  const [hoverBtn, setHoverBtn] = useState(null);
  const [reviewIndex, setReviewIndex] = useState(null); // for reviewing individual questions in results

  const audioPlayedRef = useRef(false);

  // Autosave answers + qIndex for in-progress batches.
  useDraftPersist(draftKey, { answers, qIndex }, { enabled: !finished });

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
    setPhase("choose");
  }, []);

  const handleReady = useCallback(() => {
    setPhase("choose");
  }, []);

  const handleSelect = useCallback((key) => {
    if (phase !== "choose") return;
    setSelected(key);
  }, [phase]);

  const handleSubmit = useCallback(() => {
    if (!selected || phase !== "choose") return;

    const newAnswer = { itemId: currentItem.id, selected };
    const updatedAnswers = [...answers, newAnswer];
    setAnswers(updatedAnswers);

    const nextIndex = qIndex + 1;
    if (nextIndex < items.length) {
      // Move to next question — no result shown
      setQIndex(nextIndex);
      setPhase("listen");
      setSelected(null);
      setHoverOption(null);
      audioPlayedRef.current = false;
    } else {
      // All done — compute results and show summary
      setFinished(true);
      clearDraft(draftKey);
      const results = updatedAnswers.map((a, i) => ({
        itemId: a.itemId,
        selected: a.selected,
        correct: items[i].answer,
        isCorrect: a.selected === items[i].answer,
      }));
      const correctCount = results.filter((r) => r.isCorrect).length;
      if (onComplete) {
        onComplete({ correct: correctCount, total: results.length, results });
      }
    }
  }, [selected, phase, currentItem, answers, qIndex, items, onComplete, draftKey]);

  // ── Results page ──
  if (finished) {
    const results = answers.map((a, i) => ({
      itemId: a.itemId,
      selected: a.selected,
      correct: items[i].answer,
      isCorrect: a.selected === items[i].answer,
    }));
    const correctCount = results.filter((r) => r.isCorrect).length;
    const pct = results.length > 0 ? Math.round((correctCount / results.length) * 100) : 0;
    const reviewItem = reviewIndex !== null ? items[reviewIndex] : null;
    const reviewResult = reviewIndex !== null ? results[reviewIndex] : null;

    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        <TopBar title="Results" section="Listening | Choose a Response" onExit={onExit} />
        <PageShell narrow>
          {/* Score card */}
          <SurfaceCard style={{ padding: "32px 28px", textAlign: "center", marginTop: 24 }}>
            <div style={{ fontSize: 56, marginBottom: 8 }}>
              {pct >= 80 ? "🎉" : pct >= 60 ? "👍" : "💪"}
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: C.t1 }}>
              {correctCount} / {results.length}
            </div>
            <div style={{ fontSize: 15, color: C.t2, marginTop: 4, marginBottom: 8 }}>
              {pct}% correct
            </div>
            <div style={{
              display: "inline-block", padding: "4px 16px", borderRadius: 999, fontSize: 13, fontWeight: 700,
              background: pct >= 80 ? "#D1FAE5" : pct >= 60 ? "#FEF3C7" : "#FEE2E2",
              color: pct >= 80 ? "#059669" : pct >= 60 ? "#D97706" : "#DC2626",
            }}>
              {pct >= 80 ? "Excellent" : pct >= 60 ? "Good" : "Keep Practicing"}
            </div>
          </SurfaceCard>

          {/* Question list */}
          <div style={{ marginTop: 20 }}>
            {results.map((r, i) => {
              const itm = items[i];
              const isOpen = reviewIndex === i;
              return (
                <SurfaceCard
                  key={r.itemId}
                  style={{ marginBottom: 10, overflow: "hidden", cursor: "pointer", border: isOpen ? `2px solid ${ACCENT.color}` : undefined }}
                >
                  {/* Summary row — always visible */}
                  <button
                    onClick={() => setReviewIndex(isOpen ? null : i)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 12,
                      padding: "14px 18px", background: "transparent", border: "none",
                      cursor: "pointer", fontFamily: FONT, textAlign: "left",
                    }}
                  >
                    {/* Status icon */}
                    <div style={{
                      width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                      background: r.isCorrect ? "#D1FAE5" : "#FEE2E2",
                      color: r.isCorrect ? "#059669" : "#DC2626",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 15, fontWeight: 700,
                    }}>
                      {r.isCorrect ? "\u2713" : "\u2717"}
                    </div>

                    {/* Question preview */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.t1, marginBottom: 2 }}>
                        Q{i + 1}
                      </div>
                      <div style={{ fontSize: 12, color: C.t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {itm?.speaker?.length > 60 ? itm.speaker.slice(0, 57) + "..." : itm?.speaker}
                      </div>
                    </div>

                    {/* Answer badges */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <span style={{
                        fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 6,
                        background: r.isCorrect ? "#D1FAE5" : "#FEE2E2",
                        color: r.isCorrect ? "#059669" : "#DC2626",
                      }}>
                        {r.selected}
                      </span>
                      {!r.isCorrect && (
                        <span style={{
                          fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 6,
                          background: "#D1FAE5", color: "#059669",
                        }}>
                          {r.correct}
                        </span>
                      )}
                    </div>

                    {/* Chevron */}
                    <span style={{
                      fontSize: 12, color: C.t3, transition: "transform 0.2s",
                      transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                    }}>v</span>
                  </button>

                  {/* Expanded detail — options + explanation */}
                  {isOpen && reviewItem && (
                    <div style={{ borderTop: `1px solid ${C.bdrSubtle}`, padding: "16px 18px", background: C.bg }}>
                      {/* Speaker text */}
                      <div style={{
                        padding: "10px 14px", borderRadius: 8, marginBottom: 14,
                        background: ACCENT.soft, border: `1px solid #E9D5FF`,
                        fontSize: 13, color: "#5B21B6", lineHeight: 1.6, fontStyle: "italic",
                      }}>
                        "{reviewItem.speaker}"
                      </div>

                      {/* All 4 options with correct/wrong highlighting */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {OPTION_KEYS.map(key => {
                          const text = reviewItem.options?.[key];
                          if (!text) return null;
                          const isCorrectOpt = key === reviewItem.answer;
                          const isUserPick = key === reviewResult.selected;
                          const isWrongPick = isUserPick && !isCorrectOpt;

                          let bg = "#fff", border = C.bdr, color = C.t1;
                          if (isCorrectOpt) { bg = "#D1FAE5"; border = "#059669"; color = "#065F46"; }
                          else if (isWrongPick) { bg = "#FEE2E2"; border = "#DC2626"; color = "#991B1B"; }

                          return (
                            <div key={key} style={{
                              display: "flex", alignItems: "center", gap: 12,
                              padding: "10px 14px", borderRadius: 10,
                              border: `1.5px solid ${border}`, background: bg,
                              fontSize: 14, color, lineHeight: 1.5,
                            }}>
                              <div style={{
                                width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                                background: isCorrectOpt ? "#059669" : isWrongPick ? "#DC2626" : "#F3F4F6",
                                color: isCorrectOpt || isWrongPick ? "#fff" : C.t2,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 12, fontWeight: 800,
                              }}>
                                {isCorrectOpt ? "\u2713" : isWrongPick ? "\u2717" : key}
                              </div>
                              <span style={{ fontWeight: isCorrectOpt || isWrongPick ? 600 : 400 }}>{text}</span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Explanation */}
                      {reviewItem.explanation && (
                        <div style={{
                          marginTop: 12, padding: "12px 14px", borderRadius: 10,
                          background: reviewResult.isCorrect ? "#F0FDF4" : "#FFF7ED",
                          border: `1px solid ${reviewResult.isCorrect ? "#BBF7D0" : "#FED7AA"}`,
                          fontSize: 13, color: reviewResult.isCorrect ? "#166534" : "#9A3412",
                          lineHeight: 1.6,
                        }}>
                          <strong>{reviewResult.isCorrect ? "Correct!" : "Explanation:"}</strong> {reviewItem.explanation}
                        </div>
                      )}
                    </div>
                  )}
                </SurfaceCard>
              );
            })}
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24, marginBottom: 40 }}>
            <Btn onClick={onExit} variant="secondary">Exit</Btn>
            <Btn onClick={() => {
              setQIndex(0);
              setPhase("listen");
              setSelected(null);
              setAnswers([]);
              setFinished(false);
              setReviewIndex(null);
              setHoverOption(null);
              audioPlayedRef.current = false;
            }} style={{ background: ACCENT.color, borderColor: ACCENT.color }}>
              Try Again
            </Btn>
          </div>
        </PageShell>
      </div>
    );
  }

  // ── Active question screen ──
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
          <div style={{
            marginTop: 20, marginBottom: 4, padding: "10px 16px",
            background: ACCENT.soft, borderRadius: 10,
            fontSize: 13, color: "#5B21B6", lineHeight: 1.5,
            border: `1px solid #E9D5FF`,
          }}>
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
                    padding: "10px 28px", borderRadius: 10,
                    border: `1px solid ${C.bdr}`,
                    background: hoverBtn === "ready" ? "#F9FAFB" : "#fff",
                    color: C.t2, fontSize: 13, fontWeight: 600,
                    cursor: "pointer", fontFamily: FONT,
                    transition: "all 0.15s ease",
                  }}
                >
                  I'm ready — show options
                </button>
              </div>
            </div>
          )}

          {/* Choose phase — no immediate result */}
          {phase === "choose" && (
            <div>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: ACCENT.color, marginBottom: 4, letterSpacing: 0.3 }}>
                  STEP 2
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: C.t1 }}>
                  Choose the best response
                </div>
              </div>

              {/* Options */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 600, margin: "0 auto" }}>
                {OPTION_KEYS.map((key) => {
                  const text = currentItem.options?.[key];
                  if (!text) return null;
                  const isSelected = selected === key;
                  const isHover = hoverOption === key;

                  let bg = "#fff", border = C.bdr, color = C.t1, fw = 500;
                  if (isSelected) { bg = ACCENT.soft; border = ACCENT.color; color = "#5B21B6"; fw = 700; }
                  else if (isHover) { bg = "#FAFAFA"; border = "#C4B5FD"; }

                  return (
                    <button
                      key={key}
                      onClick={() => handleSelect(key)}
                      onMouseEnter={() => setHoverOption(key)}
                      onMouseLeave={() => setHoverOption(null)}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 14,
                        padding: "14px 18px", borderRadius: 12,
                        border: `2px solid ${border}`, background: bg,
                        color, fontWeight: fw, fontSize: 15, fontFamily: FONT,
                        cursor: "pointer", transition: "all 0.15s ease",
                        textAlign: "left", lineHeight: 1.5,
                      }}
                    >
                      <div style={{
                        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                        background: isSelected ? ACCENT.color : "#F3F4F6",
                        color: isSelected ? "#fff" : C.t2,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14, fontWeight: 800, transition: "all 0.15s ease",
                      }}>{key}</div>
                      <span>{text}</span>
                    </button>
                  );
                })}
              </div>

              {/* Submit button */}
              <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
                <Btn
                  onClick={handleSubmit}
                  disabled={!selected}
                  style={{
                    background: selected ? ACCENT.color : undefined,
                    borderColor: selected ? ACCENT.color : undefined,
                    padding: "12px 32px", fontSize: 15,
                  }}
                >
                  {qIndex + 1 < items.length ? "Next" : "Submit All"}
                </Btn>
              </div>
            </div>
          )}
        </SurfaceCard>

        {/* Progress dots for batch mode */}
        {isBatch && (
          <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 20 }}>
            {items.map((_, i) => {
              const done = i < answers.length;
              const current = i === qIndex;
              let bg = C.bdr;
              if (done) bg = ACCENT.color;
              else if (current) bg = ACCENT.color;

              return (
                <div
                  key={i}
                  style={{
                    width: current ? 24 : 8,
                    height: 8,
                    borderRadius: 4,
                    background: bg,
                    opacity: done ? 0.5 : 1,
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
