"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { C, FONT, Btn, TopBar, PageShell, SurfaceCard } from "../shared/ui";
import { VoiceRecorder } from "./VoiceRecorder";
import { createSpeechRecognizer, isSpeechRecognitionSupported } from "../../lib/speakingEval/speechRecognition";
import { scoreInterview } from "../../lib/speakingEval/interviewScorer";

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
  const [transcripts, setTranscripts] = useState([]); // STT transcript per index
  const [liveTranscript, setLiveTranscript] = useState("");
  const [sttSupported, setSttSupported] = useState(true);
  const [aiScores, setAiScores] = useState([]); // AI score result per index
  const [scoring, setScoring] = useState(false); // scoring in progress
  const [scoringError, setScoringError] = useState(null);
  const [expandedQ, setExpandedQ] = useState(null); // expanded question in summary

  const timerRef = useRef(null);
  const totalTimerRef = useRef(null);
  const recorderStopRef = useRef(null);
  const recognizerRef = useRef(null);

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

  // Check STT support
  useEffect(() => {
    setSttSupported(isSpeechRecognitionSupported());
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

  // Start STT when recording begins
  const startSTT = useCallback(() => {
    if (!sttSupported) return;
    setLiveTranscript("");
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
        if (finalTranscript) {
          setTranscripts(prev => {
            const next = [...prev];
            next[current] = finalTranscript;
            return next;
          });
        }
      },
      onError: () => {},
    });
    recognizerRef.current.start();
  }, [sttSupported, current]);

  const stopSTT = useCallback(() => {
    if (recognizerRef.current) {
      try { recognizerRef.current.stop(); } catch {}
    }
  }, []);

  // Run AI scoring asynchronously
  const runScoring = useCallback(async (questionIdx) => {
    setScoring(true);
    setScoringError(null);
    try {
      // Wait a beat for final STT to arrive
      await new Promise(r => setTimeout(r, 500));
      const transcript = transcripts[questionIdx] || liveTranscript || "";
      const q = items[questionIdx];
      if (!transcript) {
        setScoringError("未检测到语音内容，跳过评分");
        setScoring(false);
        return;
      }
      // Store transcript if not yet saved
      setTranscripts(prev => {
        if (!prev[questionIdx]) {
          const next = [...prev];
          next[questionIdx] = transcript;
          return next;
        }
        return prev;
      });
      const result = await scoreInterview({
        question: q.question,
        transcript,
      });
      setAiScores(prev => {
        const next = [...prev];
        next[questionIdx] = result;
        return next;
      });
    } catch (err) {
      setScoringError("评分失败: " + (err.message || "未知错误"));
    }
    setScoring(false);
  }, [transcripts, liveTranscript, items]);

  const handleRecordingComplete = useCallback((blobUrl) => {
    if (timerRef.current) clearInterval(timerRef.current);
    stopSTT();
    setRecordings(prev => {
      const next = [...prev];
      next[current] = blobUrl;
      return next;
    });
    setPhase("review");
    setAutoRecordReady(false);
    // Trigger AI scoring async
    runScoring(current);
  }, [current, stopSTT, runScoring]);

  const handleNext = useCallback(() => {
    setLiveTranscript("");
    setScoringError(null);
    if (current < total - 1) {
      setCurrent(current + 1);
      setPhase("prep");
      setAutoRecordReady(false);
    } else {
      setFinished(true);
      if (onComplete) {
        const scoredItems = items.map((item, i) => ({
          id: item.id,
          question: item.question,
          category: item.category,
          difficulty: item.difficulty,
          recorded: !!recordings[i],
          transcript: transcripts[i] || null,
          aiScore: aiScores[i] || null,
        }));
        const validScores = scoredItems.filter(s => s.aiScore && !s.aiScore.error);
        const avgScore = validScores.length
          ? Math.round((validScores.reduce((sum, s) => sum + s.aiScore.score, 0) / validScores.length) * 2) / 2
          : null;
        onComplete({
          type: "speaking-interview",
          total,
          attempted: recordings.filter(Boolean).length + (recordings[current] ? 0 : 1),
          totalElapsed,
          averageScore: avgScore,
          items: scoredItems,
        });
      }
    }
  }, [current, total, recordings, totalElapsed, items, onComplete, transcripts, aiScores]);

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
    const validScores = aiScores.filter(s => s && !s.error);
    const avgScore = validScores.length
      ? Math.round((validScores.reduce((sum, s) => sum + s.score, 0) / validScores.length) * 2) / 2
      : null;
    const scoreColor = (s) => s >= 4 ? "#16A34A" : s >= 3 ? "#D97706" : "#DC2626";

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
              borderRadius: 12, border: "1px solid #FDE68A", flexWrap: "wrap", justifyContent: "center",
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
              {avgScore != null && (
                <>
                  <div style={{ width: 1, background: "#FDE68A" }} />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: scoreColor(avgScore) }}>{avgScore}</div>
                    <div style={{ fontSize: 11, color: C.t3 }}>Avg Score /5</div>
                  </div>
                </>
              )}
            </div>

            {/* Dimension averages */}
            {validScores.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <DimensionAverageBars scores={validScores} />
              </div>
            )}
          </SurfaceCard>

          {/* Per-question breakdown */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((item, i) => {
              const sc = aiScores[i];
              const isExpanded = expandedQ === i;
              return (
                <SurfaceCard key={item.id} style={{ padding: "16px 20px" }}>
                  <div
                    style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: sc ? "pointer" : "default" }}
                    onClick={() => sc && setExpandedQ(isExpanded ? null : i)}
                  >
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
                        {sc && !sc.error && (
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                            background: sc.score >= 4 ? "#DCFCE7" : sc.score >= 3 ? SPK.soft : "#FEE2E2",
                            color: scoreColor(sc.score),
                          }}>
                            {sc.score}/5
                          </span>
                        )}
                        {sc && (
                          <span style={{ marginLeft: "auto", fontSize: 11, color: C.t3 }}>
                            {isExpanded ? "▼" : "▶"}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 14, color: C.t1, lineHeight: 1.6, marginBottom: 8 }}>
                        {item.question}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {recordings[i] && (
                          <SummaryReplayButton blobUrl={recordings[i]} />
                        )}
                        {!recordings[i] && (
                          <span style={{ fontSize: 12, color: C.t3, fontStyle: "italic" }}>Skipped</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && sc && !sc.error && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid " + C.bdr }}>
                      <DimensionScoreCard score={sc} compact />
                      {transcripts[i] && (
                        <div style={{
                          marginTop: 10, padding: "8px 12px", background: "#F9FAFB",
                          border: "1px solid " + C.bdr, borderRadius: 8,
                          fontSize: 12, color: C.t2, lineHeight: 1.6,
                          maxHeight: 80, overflowY: "auto",
                        }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: C.t3 }}>Transcript: </span>
                          {transcripts[i]}
                        </div>
                      )}
                    </div>
                  )}
                </SurfaceCard>
              );
            })}
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
                onRecordingStart={startSTT}
                maxDuration={ANSWER_DURATION}
                autoStart={autoRecordReady}
              />

              {/* Live transcript */}
              {sttSupported && liveTranscript && (
                <div style={{
                  marginTop: 14, padding: "10px 14px", background: "#F9FAFB",
                  border: "1px solid " + C.bdr, borderRadius: 10,
                  fontSize: 13, color: C.t2, lineHeight: 1.6, fontStyle: "italic",
                  textAlign: "left", maxHeight: 80, overflowY: "auto",
                }}>
                  {liveTranscript}
                </div>
              )}

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
            <div>
              {/* Scoring state */}
              {scoring && (
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: "50%", margin: "0 auto 16px",
                    background: SPK.soft, border: "2px solid #FDE68A",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <span style={{ fontSize: 24, animation: "spk-timer-pulse 1s ease-in-out infinite" }}>AI</span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 4 }}>
                    评分中...
                  </div>
                  <div style={{ fontSize: 12, color: C.t3 }}>
                    AI 正在分析您的回答
                  </div>
                </div>
              )}

              {/* Score results (or just done-check if no score yet) */}
              {!scoring && (
                <div style={{ textAlign: "center" }}>
                  {aiScores[current] && !aiScores[current].error ? (
                    <DimensionScoreCard score={aiScores[current]} />
                  ) : (
                    <div>
                      <div style={{
                        width: 56, height: 56, borderRadius: "50%", margin: "0 auto 16px",
                        background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <span style={{ fontSize: 26 }}>✓</span>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 8 }}>
                        Answer recorded
                      </div>
                      {scoringError && (
                        <div style={{
                          padding: "8px 14px", background: "#FEF2F2", border: "1px solid #FECACA",
                          borderRadius: 10, fontSize: 12, color: "#991B1B", marginBottom: 12,
                        }}>
                          {scoringError}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Transcript */}
                  {(transcripts[current] || liveTranscript) && (
                    <div style={{
                      marginTop: 12, padding: "10px 14px", background: "#F9FAFB",
                      border: "1px solid " + C.bdr, borderRadius: 10,
                      fontSize: 13, color: C.t2, lineHeight: 1.6, textAlign: "left",
                      maxHeight: 100, overflowY: "auto",
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.t3, textTransform: "uppercase", marginBottom: 4 }}>Transcript</div>
                      {transcripts[current] || liveTranscript}
                    </div>
                  )}

                  {recordings[current] && (
                    <div style={{ marginTop: 16, marginBottom: 16 }}>
                      <SummaryReplayButton blobUrl={recordings[current]} />
                    </div>
                  )}
                  <Btn onClick={handleNext} style={{ background: SPK.color, borderColor: SPK.color }}>
                    {current < total - 1 ? "Next Question" : "Finish Interview"}
                  </Btn>
                </div>
              )}
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

/** Dimension labels mapping. */
const DIM_LABELS = {
  fluency: { label: "流利度", en: "Fluency" },
  intelligibility: { label: "可理解度", en: "Intelligibility" },
  language: { label: "语言使用", en: "Language" },
  organization: { label: "组织结构", en: "Organization" },
};

const DIM_COLORS = {
  fluency: "#F59E0B",
  intelligibility: "#0891B2",
  language: "#7C3AED",
  organization: "#16A34A",
};

/** Renders 4-dimension score bars and feedback for a single question. */
function DimensionScoreCard({ score, compact = false }) {
  if (!score || score.error) return null;
  const { dimensions, summary, suggestions } = score;
  const overallScore = score.score;
  const scoreColor = overallScore >= 4 ? "#16A34A" : overallScore >= 3 ? "#D97706" : "#DC2626";

  return (
    <div style={{ textAlign: "left" }}>
      {/* Overall score */}
      {!compact && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
          marginBottom: 16, padding: "12px 0",
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            background: `${scoreColor}15`, border: `2px solid ${scoreColor}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, fontWeight: 800, color: scoreColor,
          }}>
            {overallScore}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.t1 }}>AI Score</div>
            <div style={{ fontSize: 12, color: C.t3 }}>/5</div>
          </div>
        </div>
      )}

      {/* Dimension bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 10 }}>
        {Object.entries(DIM_LABELS).map(([key, { label, en }]) => {
          const dim = dimensions?.[key];
          if (!dim) return null;
          const pct = (dim.score / 5) * 100;
          const color = DIM_COLORS[key];
          return (
            <div key={key}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                <span style={{ fontSize: compact ? 11 : 12, fontWeight: 700, color: C.t1 }}>
                  {label} <span style={{ color: C.t3, fontWeight: 400 }}>{en}</span>
                </span>
                <span style={{ fontSize: compact ? 12 : 13, fontWeight: 800, color }}>{dim.score}</span>
              </div>
              <div style={{ height: compact ? 4 : 6, background: "#E5E7EB", borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 3, background: color,
                  width: `${pct}%`, transition: "width 500ms ease",
                }} />
              </div>
              {!compact && dim.feedback && (
                <div style={{ fontSize: 12, color: C.t2, lineHeight: 1.5, marginTop: 4 }}>
                  {dim.feedback}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary and suggestions */}
      {!compact && summary && (
        <div style={{
          marginTop: 14, padding: "10px 14px", background: "#F9FAFB",
          border: "1px solid " + C.bdr, borderRadius: 10,
          fontSize: 13, color: C.t1, lineHeight: 1.7,
        }}>
          {summary}
        </div>
      )}
      {!compact && suggestions && suggestions.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.t3, textTransform: "uppercase", marginBottom: 6 }}>
            改进建议
          </div>
          {suggestions.map((s, i) => (
            <div key={i} style={{
              display: "flex", gap: 8, marginBottom: 4,
              fontSize: 12, color: C.t2, lineHeight: 1.5,
            }}>
              <span style={{ color: SPK.color, fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Dimension average bars for the summary banner. */
function DimensionAverageBars({ scores }) {
  if (!scores.length) return null;
  const dims = Object.keys(DIM_LABELS);
  const avgs = {};
  dims.forEach(key => {
    const vals = scores.map(s => s.dimensions?.[key]?.score).filter(v => v != null);
    avgs[key] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 2) / 2 : 0;
  });

  return (
    <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
      {dims.map(key => (
        <div key={key} style={{ textAlign: "center", minWidth: 60 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: DIM_COLORS[key] }}>{avgs[key]}</div>
          <div style={{ fontSize: 10, color: C.t3, fontWeight: 600 }}>{DIM_LABELS[key].label}</div>
        </div>
      ))}
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
