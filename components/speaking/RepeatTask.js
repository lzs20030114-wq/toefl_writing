"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { C, FONT, Btn, TopBar, PageShell, SurfaceCard } from "../shared/ui";
import { VoiceRecorder } from "./VoiceRecorder";
import { createSpeechRecognizer, isSpeechRecognitionSupported } from "../../lib/speakingEval/speechRecognition";
import { scoreRepeat } from "../../lib/speakingEval/repeatScorer";

const SPK = { color: "#F59E0B", soft: "#FFFBEB" };

/**
 * Listen and Repeat — Task 1 of TOEFL 2026 Speaking.
 *
 * Flow per sentence:
 *   1. Show "Listen" phase — play TTS
 *   2. User records their repetition
 *   3. User can replay both original and their recording
 *   4. "Next Sentence" advances
 *   5. After 7 sentences: summary with replay for each
 *
 * Props:
 *   items       — array of { id, sentence, difficulty } (7 items)
 *   onComplete  — called with session summary
 *   onExit      — back navigation
 *   isPractice  — if true, show elapsed instead of countdown
 */
export function RepeatTask({ items, onComplete, onExit, isPractice = false }) {
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState("listen"); // listen | record | review
  const [recordings, setRecordings] = useState([]); // blobUrl per index
  const [finished, setFinished] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [ttsSupported, setTtsSupported] = useState(true);
  const [transcripts, setTranscripts] = useState([]); // STT transcript per index
  const [scores, setScores] = useState([]); // scoreRepeat result per index
  const [liveTranscript, setLiveTranscript] = useState(""); // current interim transcript
  const [sttSupported, setSttSupported] = useState(true);

  const elapsedRef = useRef(null);
  const utteranceRef = useRef(null);
  const recognizerRef = useRef(null);

  const total = items.length;
  const sentence = items[current];

  // Elapsed timer
  useEffect(() => {
    if (finished) {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
      return;
    }
    elapsedRef.current = setInterval(() => setElapsed(p => p + 1), 1000);
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [finished]);

  // Check TTS support
  useEffect(() => {
    if (typeof window === "undefined") return;
    setTtsSupported("speechSynthesis" in window);
  }, []);

  // Check STT support
  useEffect(() => {
    setSttSupported(isSpeechRecognitionSupported());
  }, []);

  const playSentence = useCallback(() => {
    if (!ttsSupported || !sentence) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(sentence.sentence);
    utt.lang = "en-US";
    utt.rate = 0.9;
    utt.pitch = 1;

    // Try to pick an English voice
    const voices = window.speechSynthesis.getVoices();
    const enVoice = voices.find(v => v.lang.startsWith("en-") && v.name.includes("Female"))
      || voices.find(v => v.lang.startsWith("en-"));
    if (enVoice) utt.voice = enVoice;

    utt.onstart = () => setTtsPlaying(true);
    utt.onend = () => { setTtsPlaying(false); setPhase("record"); };
    utt.onerror = () => { setTtsPlaying(false); setPhase("record"); };

    utteranceRef.current = utt;
    window.speechSynthesis.speak(utt);
  }, [ttsSupported, sentence]);

  // Auto-play on new sentence
  useEffect(() => {
    if (!finished && phase === "listen" && sentence) {
      // Small delay so the UI renders first
      const t = setTimeout(playSentence, 500);
      return () => clearTimeout(t);
    }
  }, [current, phase, finished]);

  // Start STT when recording begins
  const startSTT = useCallback(() => {
    if (!sttSupported) return;
    setLiveTranscript("");
    // Stop any existing recognizer
    if (recognizerRef.current) {
      try { recognizerRef.current.stop(); } catch {}
    }
    recognizerRef.current = createSpeechRecognizer({
      lang: "en-US",
      onResult: (transcript, isFinal) => {
        setLiveTranscript(transcript);
        if (isFinal) {
          setTranscripts(prev => {
            const next = [...prev];
            next[current] = transcript;
            return next;
          });
        }
      },
      onEnd: (finalTranscript) => {
        // Store whatever we got
        if (finalTranscript) {
          setTranscripts(prev => {
            const next = [...prev];
            next[current] = finalTranscript;
            return next;
          });
        }
      },
      onError: () => {
        // Non-fatal — silently ignore STT errors
      },
    });
    recognizerRef.current.start();
  }, [sttSupported, current]);

  // Stop STT
  const stopSTT = useCallback(() => {
    if (recognizerRef.current) {
      try { recognizerRef.current.stop(); } catch {}
    }
  }, []);

  const handleRecordingComplete = useCallback((blobUrl) => {
    // Stop STT recognition
    stopSTT();
    setRecordings(prev => {
      const next = [...prev];
      next[current] = blobUrl;
      return next;
    });
    // Score using whatever transcript we have (from liveTranscript or transcripts state)
    // We use a small delay to let the final STT result arrive
    setTimeout(() => {
      setTranscripts(prev => {
        const transcript = prev[current] || liveTranscript || "";
        if (transcript && sentence) {
          const result = scoreRepeat(sentence.sentence, transcript);
          setScores(s => {
            const next = [...s];
            next[current] = result;
            return next;
          });
        }
        // Ensure transcript is stored
        if (!prev[current] && liveTranscript) {
          const next = [...prev];
          next[current] = liveTranscript;
          return next;
        }
        return prev;
      });
    }, 300);
    setPhase("review");
  }, [current, stopSTT, liveTranscript, sentence]);

  const handleNext = useCallback(() => {
    setLiveTranscript("");
    if (current < total - 1) {
      setCurrent(current + 1);
      setPhase("listen");
    } else {
      // Finished all sentences
      setFinished(true);
      if (onComplete) {
        const scoredItems = items.map((item, i) => ({
          id: item.id,
          sentence: item.sentence,
          difficulty: item.difficulty,
          recorded: !!recordings[i],
          transcript: transcripts[i] || null,
          score: scores[i] || null,
        }));
        const validScores = scoredItems.filter(s => s.score);
        const avgScore = validScores.length
          ? Math.round((validScores.reduce((sum, s) => sum + s.score.score, 0) / validScores.length) * 2) / 2
          : null;
        onComplete({
          type: "speaking-repeat",
          total,
          attempted: recordings.filter(Boolean).length + (recordings[current] ? 0 : 1),
          elapsed,
          averageScore: avgScore,
          items: scoredItems,
        });
      }
    }
  }, [current, total, recordings, elapsed, items, onComplete, transcripts, scores]);

  const handleSkip = useCallback(() => {
    handleNext();
  }, [handleNext]);

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const difficultyBadge = (diff) => {
    const map = {
      easy: { bg: "#DCFCE7", color: "#166534", label: "Easy" },
      medium: { bg: SPK.soft, color: "#92400E", label: "Medium" },
      hard: { bg: "#FEE2E2", color: "#991B1B", label: "Hard" },
    };
    const d = map[diff] || map.easy;
    return (
      <span style={{
        fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
        background: d.bg, color: d.color,
      }}>{d.label}</span>
    );
  };

  // ── Summary screen ──
  if (finished) {
    const attempted = recordings.filter(Boolean).length;
    const validScores = scores.filter(Boolean);
    const avgAccuracy = validScores.length
      ? Math.round(validScores.reduce((sum, s) => sum + s.accuracy, 0) / validScores.length)
      : null;
    const avgScore = validScores.length
      ? Math.round((validScores.reduce((sum, s) => sum + s.score, 0) / validScores.length) * 2) / 2
      : null;
    const accuracyColor = (acc) => acc >= 80 ? "#16A34A" : acc >= 60 ? "#D97706" : "#DC2626";

    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        <TopBar title="Listen & Repeat" section="Speaking | Task 1" onExit={onExit} />
        <PageShell narrow>
          {/* Score banner */}
          <SurfaceCard style={{ padding: "28px 24px", marginBottom: 20, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🎤</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.t1, marginBottom: 4 }}>Session Complete</div>
            <div style={{ fontSize: 14, color: C.t2, marginBottom: 16 }}>
              Recorded {attempted} of {total} sentences in {formatTime(elapsed)}
            </div>
            <div style={{
              display: "inline-flex", gap: 24, background: SPK.soft, padding: "12px 24px",
              borderRadius: 12, border: "1px solid #FDE68A", flexWrap: "wrap", justifyContent: "center",
            }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: SPK.color }}>{attempted}</div>
                <div style={{ fontSize: 11, color: C.t3 }}>Recorded</div>
              </div>
              <div style={{ width: 1, background: "#FDE68A" }} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: C.t1 }}>{total}</div>
                <div style={{ fontSize: 11, color: C.t3 }}>Total</div>
              </div>
              {avgAccuracy != null && (
                <>
                  <div style={{ width: 1, background: "#FDE68A" }} />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: accuracyColor(avgAccuracy) }}>{avgAccuracy}%</div>
                    <div style={{ fontSize: 11, color: C.t3 }}>Avg Accuracy</div>
                  </div>
                </>
              )}
              {avgScore != null && (
                <>
                  <div style={{ width: 1, background: "#FDE68A" }} />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: SPK.color }}>{avgScore}</div>
                    <div style={{ fontSize: 11, color: C.t3 }}>Score /5</div>
                  </div>
                </>
              )}
            </div>
          </SurfaceCard>

          {/* Sentence list with replay + scores */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((item, i) => {
              const sc = scores[i];
              return (
                <SurfaceCard key={item.id} style={{ padding: "16px 20px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                      background: recordings[i] ? "#DCFCE7" : "#F3F4F6",
                      color: recordings[i] ? "#166534" : C.t3,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 700,
                    }}>
                      {i + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Word-level highlight if we have a score */}
                      {sc ? (
                        <WordHighlight
                          originalSentence={item.sentence}
                          matchedWords={sc.matchedWords}
                          missedWords={sc.missedWords}
                          extraWords={sc.extraWords}
                        />
                      ) : (
                        <div style={{ fontSize: 14, color: C.t1, lineHeight: 1.6, marginBottom: 8 }}>
                          {item.sentence}
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {difficultyBadge(item.difficulty)}
                        {sc && (
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                            background: sc.accuracy >= 80 ? "#DCFCE7" : sc.accuracy >= 60 ? SPK.soft : "#FEE2E2",
                            color: accuracyColor(sc.accuracy),
                          }}>
                            {sc.accuracy}% Accuracy
                          </span>
                        )}
                        <ReplayButton label="Original" onPlay={() => {
                          window.speechSynthesis.cancel();
                          const u = new SpeechSynthesisUtterance(item.sentence);
                          u.lang = "en-US"; u.rate = 0.9;
                          window.speechSynthesis.speak(u);
                        }} />
                        {recordings[i] && (
                          <ReplayButton label="My Recording" blobUrl={recordings[i]} />
                        )}
                      </div>
                    </div>
                  </div>
                </SurfaceCard>
              );
            })}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 24 }}>
            <Btn variant="secondary" onClick={onExit}>Back to Home</Btn>
          </div>
        </PageShell>
      </div>
    );
  }

  // ── Active task screen ──
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar
        title="Listen & Repeat"
        section="Speaking | Task 1"
        qInfo={`${current + 1} / ${total}`}
        elapsedTime={elapsed}
        onExit={onExit}
      />
      <PageShell narrow>
        {/* Progress bar */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.t1 }}>
              Sentence {current + 1} of {total}
            </span>
            {difficultyBadge(sentence.difficulty)}
          </div>
          <div style={{ height: 6, background: "#E5E7EB", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 3,
              background: `linear-gradient(90deg, ${SPK.color}, #F97316)`,
              width: `${((current + 1) / total) * 100}%`,
              transition: "width 300ms ease",
            }} />
          </div>
        </div>

        {/* Main card */}
        <SurfaceCard style={{ padding: "32px 28px", textAlign: "center" }}>
          {/* Phase: Listen */}
          {phase === "listen" && (
            <div>
              <div style={{
                width: 80, height: 80, borderRadius: "50%", margin: "0 auto 20px",
                background: SPK.soft, border: "2px solid #FDE68A",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 36 }}>{ttsPlaying ? "🔊" : "👂"}</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.t1, marginBottom: 8 }}>
                {ttsPlaying ? "Listen carefully..." : "Get ready to listen"}
              </div>
              <div style={{ fontSize: 13, color: C.t3, marginBottom: 20 }}>
                The sentence will play automatically. Listen and prepare to repeat.
              </div>
              {!ttsPlaying && (
                <Btn onClick={playSentence} style={{ background: SPK.color, borderColor: SPK.color }}>
                  Play Again
                </Btn>
              )}
              {!ttsSupported && (
                <div style={{
                  marginTop: 16, padding: "12px 16px", background: SPK.soft,
                  borderRadius: 10, border: "1px solid #FDE68A",
                }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>
                    TTS not available
                  </div>
                  <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.6 }}>
                    {sentence.sentence}
                  </div>
                  <Btn
                    onClick={() => setPhase("record")}
                    style={{ marginTop: 12, background: SPK.color, borderColor: SPK.color }}
                  >
                    Continue to Record
                  </Btn>
                </div>
              )}
            </div>
          )}

          {/* Phase: Record */}
          {phase === "record" && (
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 4 }}>
                Your Turn
              </div>
              <div style={{ fontSize: 13, color: C.t3, marginBottom: 24 }}>
                Repeat the sentence you just heard
              </div>
              <VoiceRecorder
                onRecordingComplete={handleRecordingComplete}
                onRecordingStart={startSTT}
                maxDuration={30}
              />
              {/* Live transcript preview */}
              {sttSupported && liveTranscript && (
                <div style={{
                  marginTop: 16, padding: "10px 14px", background: "#F9FAFB",
                  border: "1px solid " + C.bdr, borderRadius: 10,
                  fontSize: 13, color: C.t2, lineHeight: 1.6, fontStyle: "italic",
                }}>
                  {liveTranscript}
                </div>
              )}
              {!sttSupported && (
                <div style={{
                  marginTop: 12, fontSize: 11, color: C.t3, padding: "6px 10px",
                  background: "#FEF3C7", borderRadius: 8,
                }}>
                  浏览器不支持语音识别，无法自动评分
                </div>
              )}
              <div style={{ marginTop: 20 }}>
                <button
                  onClick={() => playSentence()}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: 13, color: SPK.color, fontWeight: 600, fontFamily: FONT,
                    textDecoration: "underline",
                  }}
                >
                  Replay original sentence
                </button>
              </div>
            </div>
          )}

          {/* Phase: Review */}
          {phase === "review" && (
            <div>
              <div style={{
                width: 56, height: 56, borderRadius: "50%", margin: "0 auto 16px",
                background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 26 }}>✓</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 16 }}>
                Well done!
              </div>

              <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 24 }}>
                <ReplayButton label="Original" onPlay={() => {
                  window.speechSynthesis.cancel();
                  const u = new SpeechSynthesisUtterance(sentence.sentence);
                  u.lang = "en-US"; u.rate = 0.9;
                  window.speechSynthesis.speak(u);
                }} />
                {recordings[current] && (
                  <ReplayButton label="My Recording" blobUrl={recordings[current]} />
                )}
              </div>

              {/* Accuracy score display */}
              {scores[current] && (
                <AccuracyCard score={scores[current]} originalSentence={sentence.sentence} />
              )}

              {/* Show sentence text for self-check (when no STT score) */}
              {!scores[current] && isPractice && (
                <div style={{
                  background: "#F9FAFB", border: "1px solid " + C.bdr, borderRadius: 10,
                  padding: "12px 16px", marginBottom: 20, fontSize: 14, color: C.t1, lineHeight: 1.6,
                }}>
                  {sentence.sentence}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
                <Btn variant="secondary" onClick={() => { setLiveTranscript(""); setPhase("record"); }}>
                  Re-record
                </Btn>
                <Btn onClick={handleNext} style={{ background: SPK.color, borderColor: SPK.color }}>
                  {current < total - 1 ? "Next Sentence" : "Finish"}
                </Btn>
              </div>
            </div>
          )}
        </SurfaceCard>

        {/* Skip button */}
        {!finished && phase !== "review" && (
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <button
              onClick={handleSkip}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 13, color: C.t3, fontFamily: FONT,
              }}
            >
              Skip this sentence
            </button>
          </div>
        )}
      </PageShell>
    </div>
  );
}

/** Accuracy score card shown during review phase. */
function AccuracyCard({ score, originalSentence }) {
  if (!score) return null;
  const { accuracy, matchedWords, missedWords, extraWords } = score;
  const color = accuracy >= 80 ? "#16A34A" : accuracy >= 60 ? "#D97706" : "#DC2626";
  const bg = accuracy >= 80 ? "#DCFCE7" : accuracy >= 60 ? "#FFFBEB" : "#FEE2E2";

  return (
    <div style={{
      background: "#F9FAFB", border: "1px solid " + C.bdr, borderRadius: 12,
      padding: "16px 20px", marginBottom: 20, textAlign: "left",
    }}>
      {/* Accuracy bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.t1 }}>Accuracy</span>
        <span style={{
          fontSize: 18, fontWeight: 800, color,
          padding: "2px 12px", borderRadius: 999, background: bg,
        }}>
          {accuracy}%
        </span>
      </div>
      <div style={{ height: 6, background: "#E5E7EB", borderRadius: 3, overflow: "hidden", marginBottom: 16 }}>
        <div style={{
          height: "100%", borderRadius: 3, background: color,
          width: `${accuracy}%`, transition: "width 500ms ease",
        }} />
      </div>

      {/* Word-level display */}
      <WordHighlight
        originalSentence={originalSentence}
        matchedWords={matchedWords}
        missedWords={missedWords}
        extraWords={extraWords}
      />

      {/* Extra words */}
      {extraWords.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: C.t3 }}>
          Extra words: {extraWords.map((w, i) => (
            <span key={i} style={{
              display: "inline-block", margin: "2px 3px", padding: "1px 6px",
              background: "#F3F4F6", borderRadius: 4, color: C.t3,
            }}>{w}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Renders original sentence with matched (green) and missed (red strikethrough) words. */
function WordHighlight({ originalSentence, matchedWords, missedWords }) {
  // Rebuild original sentence word-by-word with styling
  const origWords = String(originalSentence || "").split(/\s+/).filter(Boolean);
  const normalizeWord = (w) => w.toLowerCase().replace(/[^\w]/g, "");

  // Track which matched/missed words we've consumed (for duplicates)
  const matchedPool = [...matchedWords];
  const missedPool = [...missedWords];

  const styled = origWords.map((word, idx) => {
    const norm = normalizeWord(word);
    const matchIdx = matchedPool.indexOf(norm);
    if (matchIdx !== -1) {
      matchedPool.splice(matchIdx, 1);
      return (
        <span key={idx} style={{ color: "#16A34A", fontWeight: 600 }}>
          {word}{" "}
        </span>
      );
    }
    const missIdx = missedPool.indexOf(norm);
    if (missIdx !== -1) {
      missedPool.splice(missIdx, 1);
      return (
        <span key={idx} style={{
          color: "#DC2626", textDecoration: "line-through",
          textDecorationColor: "#DC2626",
        }}>
          {word}{" "}
        </span>
      );
    }
    // Fallback: treat as missed if not matched
    return (
      <span key={idx} style={{
        color: "#DC2626", textDecoration: "line-through",
        textDecorationColor: "#DC2626",
      }}>
        {word}{" "}
      </span>
    );
  });

  return (
    <div style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 4 }}>
      {styled}
    </div>
  );
}

/** Small replay button used in review and summary. */
function ReplayButton({ label, blobUrl, onPlay }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    if (onPlay) { onPlay(); return; }
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setPlaying(true);
    }
  };

  return (
    <>
      {blobUrl && (
        <audio ref={audioRef} src={blobUrl} onEnded={() => setPlaying(false)} style={{ display: "none" }} />
      )}
      <button
        onClick={toggle}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "5px 12px", borderRadius: 999,
          background: playing ? SPK.soft : "#F3F4F6",
          border: "1px solid " + (playing ? "#FDE68A" : C.bdr),
          cursor: "pointer", fontSize: 12, fontWeight: 600,
          color: playing ? "#92400E" : C.t2, fontFamily: FONT,
        }}
      >
        {playing ? "⏸" : "▶"} {label}
      </button>
    </>
  );
}
