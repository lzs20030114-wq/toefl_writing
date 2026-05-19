"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { C, FONT, Btn, TopBar, PageShell, SurfaceCard } from "../shared/ui";
import { VoiceRecorder } from "./VoiceRecorder";
import { transcribeWithServer } from "../../lib/speakingEval/serverStt";
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
  // Per-question STT lifecycle: null (not yet) | "processing" | "done" | "failed"
  // The transcribe upload is fire-and-forget so the user can advance to the
  // next sentence while earlier ones are still being recognized server-side.
  const [transcriptStatus, setTranscriptStatus] = useState([]);
  const [transcriptError, setTranscriptError] = useState([]); // error message per index, only when status="failed"
  // Sticky flag: once the API returns NOT_PRO we stop attempting more uploads
  // this session and switch the UI to the Pro upsell.
  const [notPro, setNotPro] = useState(false);

  const elapsedRef = useRef(null);
  const utteranceRef = useRef(null);

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

  // (STT runs server-side now; no browser capability check needed.)

  const playSentence = useCallback(() => {
    if (!ttsSupported || !sentence) return;

    // Safari's getVoices() returns [] on first synchronous call and populates
    // after a `voiceschanged` event. If we don't wait, voice selection falls
    // back to the system default (often Chinese on macOS-CN) and English
    // sentences come out garbled. Wait up to ~600ms for voices, then proceed
    // with whatever we have (system will use a default voice if none picked).
    function speakWithVoices(voices) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(sentence.sentence);
      utt.lang = "en-US";
      utt.rate = 0.9;
      utt.pitch = 1;

      // Prefer high-quality English voices: Samantha (macOS), Microsoft Aria
      // (Windows), Google US English (Chrome). Otherwise any en-* voice.
      const PREFERRED = ["Samantha", "Aria", "Google US English", "Alex", "Karen"];
      let enVoice = null;
      for (const name of PREFERRED) {
        enVoice = voices.find((v) => v.lang.startsWith("en-") && v.name.includes(name));
        if (enVoice) break;
      }
      if (!enVoice) {
        enVoice = voices.find((v) => v.lang.startsWith("en-") && /female/i.test(v.name))
          || voices.find((v) => v.lang.startsWith("en-"));
      }
      if (enVoice) utt.voice = enVoice;

      utt.onstart = () => setTtsPlaying(true);
      utt.onend = () => { setTtsPlaying(false); setPhase("record"); };
      utt.onerror = () => { setTtsPlaying(false); setPhase("record"); };

      utteranceRef.current = utt;
      window.speechSynthesis.speak(utt);
    }

    const synth = window.speechSynthesis;
    const initial = synth.getVoices();
    if (initial && initial.length > 0) {
      speakWithVoices(initial);
      return;
    }
    // Safari: subscribe to voiceschanged, with a hard 600ms timeout fallback.
    let fired = false;
    const onVoicesChanged = () => {
      if (fired) return;
      fired = true;
      synth.removeEventListener("voiceschanged", onVoicesChanged);
      speakWithVoices(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", onVoicesChanged);
    setTimeout(() => {
      if (fired) return;
      fired = true;
      synth.removeEventListener("voiceschanged", onVoicesChanged);
      speakWithVoices(synth.getVoices());
    }, 600);
  }, [ttsSupported, sentence]);

  // Auto-play on new sentence
  useEffect(() => {
    if (!finished && phase === "listen" && sentence) {
      // Small delay so the UI renders first
      const t = setTimeout(playSentence, 500);
      return () => clearTimeout(t);
    }
  }, [current, phase, finished]);

  // Capture the recording and kick off server-side transcription. We don't
  // block the UI on the upload — the user is free to replay/re-record/advance
  // while the transcript backfills asynchronously into the right slot.
  const handleRecordingComplete = useCallback((blobUrl, blob) => {
    const idx = current;
    const sentenceText = sentence?.sentence || "";
    const questionId = sentence?.id || "";

    setRecordings(prev => {
      const next = [...prev];
      next[idx] = blobUrl;
      return next;
    });
    setPhase("review");

    // Skip the upload if we've already seen NOT_PRO once this session.
    if (notPro || !blob) {
      setTranscriptStatus(prev => {
        const next = [...prev];
        next[idx] = "failed";
        return next;
      });
      setTranscriptError(prev => {
        const next = [...prev];
        next[idx] = notPro ? "PRO_GATE" : "EMPTY_AUDIO";
        return next;
      });
      return;
    }

    setTranscriptStatus(prev => {
      const next = [...prev];
      next[idx] = "processing";
      return next;
    });

    // Fire-and-forget; result lands by index so reordering doesn't matter.
    (async () => {
      const result = await transcribeWithServer(blob, {
        taskType: "repeat",
        questionId,
        durationMs: typeof blob.size === "number" ? null : null, // duration not tracked here
      });
      if (result.ok) {
        const transcript = result.transcript || "";
        setTranscripts(prev => {
          const next = [...prev];
          next[idx] = transcript;
          return next;
        });
        if (transcript && sentenceText) {
          const scored = scoreRepeat(sentenceText, transcript);
          setScores(prev => {
            const next = [...prev];
            next[idx] = scored;
            return next;
          });
        }
        setTranscriptStatus(prev => {
          const next = [...prev];
          next[idx] = "done";
          return next;
        });
      } else {
        if (result.code === "NOT_PRO") setNotPro(true);
        setTranscriptStatus(prev => {
          const next = [...prev];
          next[idx] = "failed";
          return next;
        });
        setTranscriptError(prev => {
          const next = [...prev];
          next[idx] = result.code || "ERROR";
          return next;
        });
      }
    })();
  }, [current, sentence, notPro]);

  const handleNext = useCallback(() => {
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
                maxDuration={30}
              />
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

              {/* Accuracy score display (when transcript came back) */}
              {scores[current] && (
                <AccuracyCard score={scores[current]} originalSentence={sentence.sentence} />
              )}

              {/* Server STT is still working on this recording */}
              {!scores[current] && transcriptStatus[current] === "processing" && (
                <div style={{
                  marginBottom: 20, padding: "10px 14px",
                  background: "#F9FAFB", border: "1px solid " + C.bdr, borderRadius: 10,
                  fontSize: 13, color: C.t2, textAlign: "center",
                }}>
                  <span style={{ display: "inline-block", marginRight: 8 }}>⏳</span>
                  正在识别你的录音…（你可以继续下一题，识别完会自动填上分数）
                </div>
              )}

              {/* Pro upsell — server returned NOT_PRO */}
              {!scores[current] && transcriptStatus[current] === "failed" && transcriptError[current] === "NOT_PRO" && (
                <div style={{
                  marginBottom: 20, padding: "12px 16px",
                  background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10,
                  fontSize: 13, color: "#92400E", lineHeight: 1.6,
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>🔒 语音识别为 Pro 专属</div>
                  录音已保存，可对照原句自查。升级 Pro 后可解锁自动识别和发音评分。
                </div>
              )}

              {/* Other failure — let the user know it's a transient problem */}
              {!scores[current] && transcriptStatus[current] === "failed" && transcriptError[current] !== "NOT_PRO" && (
                <div style={{
                  marginBottom: 20, padding: "10px 14px",
                  background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10,
                  fontSize: 12, color: "#991B1B", lineHeight: 1.6,
                }}>
                  识别失败：{transcriptError[current] || "未知错误"}。录音已保存，可重录或继续下一题。
                </div>
              )}

              {/* Practice mode: always show the reference sentence so users can self-check */}
              {isPractice && (
                <div style={{
                  background: "#F9FAFB", border: "1px solid " + C.bdr, borderRadius: 10,
                  padding: "12px 16px", marginBottom: 20, fontSize: 14, color: C.t1, lineHeight: 1.6,
                }}>
                  {sentence.sentence}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
                <Btn variant="secondary" onClick={() => setPhase("record")}>
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
