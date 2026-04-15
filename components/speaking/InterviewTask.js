"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { C, FONT, Btn, TopBar, PageShell, SurfaceCard } from "../shared/ui";
import { VoiceRecorder } from "./VoiceRecorder";

const SPK = { color: "#F59E0B", soft: "#FFFBEB" };

const ANSWER_DURATION = 45; // seconds per question

/**
 * Take an Interview — Task 2 of TOEFL 2026 Speaking.
 *
 * Flow per question:
 *   1. Show question text + play TTS
 *   2. 45-second countdown timer, auto-record starts
 *   3. Auto-stop when timer hits 0 (or user stops early)
 *   4. After 4 questions: summary with replay for each
 *
 * Props:
 *   items       — array of { id, question, category, difficulty } (4 items)
 *   onComplete  — called with session summary
 *   onExit      — back navigation
 *   isPractice  — if true, no auto-advance
 */
export function InterviewTask({ items, onComplete, onExit, isPractice = false }) {
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState("prep"); // prep | answer | review
  const [recordings, setRecordings] = useState([]); // blobUrl per index
  const [finished, setFinished] = useState(false);
  const [timeLeft, setTimeLeft] = useState(ANSWER_DURATION);
  const [totalElapsed, setTotalElapsed] = useState(0);
  const [ttsSupported, setTtsSupported] = useState(true);
  const [autoRecordReady, setAutoRecordReady] = useState(false);

  const timerRef = useRef(null);
  const totalTimerRef = useRef(null);
  const recorderStopRef = useRef(null);

  const total = items.length;
  const question = items[current];

  // Global elapsed
  useEffect(() => {
    if (finished) { if (totalTimerRef.current) clearInterval(totalTimerRef.current); return; }
    totalTimerRef.current = setInterval(() => setTotalElapsed(p => p + 1), 1000);
    return () => { if (totalTimerRef.current) clearInterval(totalTimerRef.current); };
  }, [finished]);

  // Check TTS support
  useEffect(() => {
    if (typeof window === "undefined") return;
    setTtsSupported("speechSynthesis" in window);
  }, []);

  // Countdown timer for answer phase
  useEffect(() => {
    if (phase !== "answer") {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    setTimeLeft(ANSWER_DURATION);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          // Auto stop recording
          if (recorderStopRef.current) recorderStopRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, current]);

  const playQuestion = useCallback(() => {
    if (!ttsSupported || !question) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(question.question);
    utt.lang = "en-US";
    utt.rate = 0.85;
    const voices = window.speechSynthesis.getVoices();
    const enVoice = voices.find(v => v.lang.startsWith("en-"));
    if (enVoice) utt.voice = enVoice;

    utt.onend = () => {
      // After TTS finishes, go to answer phase
      setAutoRecordReady(true);
      setPhase("answer");
    };
    utt.onerror = () => {
      setAutoRecordReady(true);
      setPhase("answer");
    };
    window.speechSynthesis.speak(utt);
  }, [ttsSupported, question]);

  // Auto-play question on prep phase
  useEffect(() => {
    if (phase === "prep" && question && !finished) {
      const t = setTimeout(playQuestion, 600);
      return () => clearTimeout(t);
    }
  }, [current, phase, finished]);

  const handleRecordingComplete = useCallback((blobUrl) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRecordings(prev => {
      const next = [...prev];
      next[current] = blobUrl;
      return next;
    });
    setPhase("review");
    setAutoRecordReady(false);
  }, [current]);

  // Provide stop function to timer
  const handleRecorderMount = useCallback((stopFn) => {
    recorderStopRef.current = stopFn;
  }, []);

  const handleNext = useCallback(() => {
    if (current < total - 1) {
      setCurrent(current + 1);
      setPhase("prep");
      setAutoRecordReady(false);
    } else {
      setFinished(true);
      if (onComplete) {
        onComplete({
          type: "speaking-interview",
          total,
          attempted: recordings.filter(Boolean).length + (recordings[current] ? 0 : 1),
          totalElapsed,
          items: items.map((item, i) => ({
            id: item.id,
            question: item.question,
            category: item.category,
            difficulty: item.difficulty,
            recorded: !!recordings[i],
          })),
        });
      }
    }
  }, [current, total, recordings, totalElapsed, items, onComplete]);

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const categoryBadge = (cat) => {
    const map = {
      personal: { bg: "#EDE9FE", color: "#5B21B6", label: "Personal" },
      campus: { bg: "#DBEAFE", color: "#1E40AF", label: "Campus" },
      academic: { bg: "#DCFCE7", color: "#166534", label: "Academic" },
      opinion: { bg: SPK.soft, color: "#92400E", label: "Opinion" },
    };
    const c = map[cat] || { bg: "#F3F4F6", color: C.t2, label: cat || "General" };
    return (
      <span style={{
        fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
        background: c.bg, color: c.color,
      }}>{c.label}</span>
    );
  };

  const diffBadge = (diff) => {
    const map = {
      easy: { bg: "#DCFCE7", color: "#166534" },
      medium: { bg: SPK.soft, color: "#92400E" },
      hard: { bg: "#FEE2E2", color: "#991B1B" },
      challenging: { bg: "#FEE2E2", color: "#991B1B" },
    };
    const d = map[diff] || map.easy;
    return (
      <span style={{
        fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
        background: d.bg, color: d.color,
      }}>Q{current + 1}</span>
    );
  };

  const timerCSS = `
    @keyframes spk-timer-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.3); }
      50% { box-shadow: 0 0 0 8px rgba(220,38,38,0); }
    }
  `;

  // ── Summary screen ──
  if (finished) {
    const attempted = recordings.filter(Boolean).length;
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        <TopBar title="Interview" section="Speaking | Task 2" onExit={onExit} />
        <PageShell narrow>
          <SurfaceCard style={{ padding: "28px 24px", marginBottom: 20, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🎙️</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.t1, marginBottom: 4 }}>Interview Complete</div>
            <div style={{ fontSize: 14, color: C.t2, marginBottom: 16 }}>
              Answered {attempted} of {total} questions in {formatTime(totalElapsed)}
            </div>
            <div style={{
              display: "inline-flex", gap: 24, background: SPK.soft, padding: "12px 24px",
              borderRadius: 12, border: "1px solid #FDE68A",
            }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: SPK.color }}>{attempted}</div>
                <div style={{ fontSize: 11, color: C.t3 }}>Answered</div>
              </div>
              <div style={{ width: 1, background: "#FDE68A" }} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: C.t1 }}>{total}</div>
                <div style={{ fontSize: 11, color: C.t3 }}>Questions</div>
              </div>
            </div>
          </SurfaceCard>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((item, i) => (
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
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      {categoryBadge(item.category)}
                    </div>
                    <div style={{ fontSize: 14, color: C.t1, lineHeight: 1.6, marginBottom: 8 }}>
                      {item.question}
                    </div>
                    {recordings[i] && (
                      <SummaryReplayButton blobUrl={recordings[i]} />
                    )}
                    {!recordings[i] && (
                      <span style={{ fontSize: 12, color: C.t3, fontStyle: "italic" }}>Skipped</span>
                    )}
                  </div>
                </div>
              </SurfaceCard>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 24 }}>
            <Btn variant="secondary" onClick={onExit}>Back to Home</Btn>
          </div>
        </PageShell>
      </div>
    );
  }

  // ── Active question screen ──
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <style>{timerCSS}</style>
      <TopBar
        title="Interview"
        section="Speaking | Task 2"
        qInfo={`Q${current + 1} / ${total}`}
        elapsedTime={totalElapsed}
        onExit={onExit}
      />
      <PageShell narrow>
        {/* Progress dots */}
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 24 }}>
          {items.map((_, i) => (
            <div key={i} style={{
              width: i === current ? 32 : 10, height: 10, borderRadius: 5,
              background: i < current ? "#DCFCE7"
                : i === current ? SPK.color
                : "#E5E7EB",
              transition: "all 300ms ease",
            }} />
          ))}
        </div>

        <SurfaceCard style={{ padding: "32px 28px" }}>
          {/* Question header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {diffBadge(question.difficulty)}
              {categoryBadge(question.category)}
            </div>
            {phase === "answer" && (
              <div style={{
                padding: "8px 16px", borderRadius: 999,
                background: timeLeft <= 10 ? "#FEE2E2" : SPK.soft,
                border: "1px solid " + (timeLeft <= 10 ? "#FECACA" : "#FDE68A"),
                fontFamily: "Consolas, monospace", fontSize: 20, fontWeight: 800,
                color: timeLeft <= 10 ? C.red : "#92400E",
                animation: timeLeft <= 10 ? "spk-timer-pulse 1s ease-in-out infinite" : "none",
                minWidth: 70, textAlign: "center",
              }}>
                {formatTime(timeLeft)}
              </div>
            )}
          </div>

          {/* Question text */}
          <div style={{
            fontSize: 18, fontWeight: 700, color: C.t1, lineHeight: 1.7,
            marginBottom: 28, textAlign: "center", padding: "0 12px",
          }}>
            {question.question}
          </div>

          {/* Phase: Prep */}
          {phase === "prep" && (
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 64, height: 64, borderRadius: "50%", margin: "0 auto 16px",
                background: SPK.soft, border: "2px solid #FDE68A",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 28 }}>🔊</span>
              </div>
              <div style={{ fontSize: 14, color: C.t3 }}>
                Listening to the question... Recording starts after.
              </div>
              {!ttsSupported && (
                <Btn
                  onClick={() => { setAutoRecordReady(true); setPhase("answer"); }}
                  style={{ marginTop: 16, background: SPK.color, borderColor: SPK.color }}
                >
                  Start Recording
                </Btn>
              )}
            </div>
          )}

          {/* Phase: Answer — auto-recording */}
          {phase === "answer" && (
            <div style={{ textAlign: "center" }}>
              <VoiceRecorder
                onRecordingComplete={handleRecordingComplete}
                maxDuration={ANSWER_DURATION}
                autoStart={autoRecordReady}
              />

              {/* Timer bar */}
              <div style={{
                marginTop: 20, height: 4, background: "#E5E7EB", borderRadius: 2,
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%", borderRadius: 2,
                  background: timeLeft <= 10
                    ? `linear-gradient(90deg, ${C.red}, #EF4444)`
                    : `linear-gradient(90deg, ${SPK.color}, #F97316)`,
                  width: `${(timeLeft / ANSWER_DURATION) * 100}%`,
                  transition: "width 1s linear, background 300ms ease",
                }} />
              </div>
            </div>
          )}

          {/* Phase: Review */}
          {phase === "review" && (
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%", margin: "0 auto 16px",
                background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 26 }}>✓</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 16 }}>
                Answer recorded
              </div>
              {recordings[current] && (
                <div style={{ marginBottom: 20 }}>
                  <SummaryReplayButton blobUrl={recordings[current]} />
                </div>
              )}
              <Btn onClick={handleNext} style={{ background: SPK.color, borderColor: SPK.color }}>
                {current < total - 1 ? "Next Question" : "Finish Interview"}
              </Btn>
            </div>
          )}
        </SurfaceCard>

        {/* Skip option */}
        {phase !== "review" && (
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <button
              onClick={handleNext}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 13, color: C.t3, fontFamily: FONT,
              }}
            >
              Skip this question
            </button>
          </div>
        )}
      </PageShell>
    </div>
  );
}

/** Replay button for summary screen. */
function SummaryReplayButton({ blobUrl }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
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
      <audio ref={audioRef} src={blobUrl} onEnded={() => setPlaying(false)} style={{ display: "none" }} />
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
        {playing ? "⏸ Playing..." : "▶ Play Recording"}
      </button>
    </>
  );
}
