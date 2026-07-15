"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { C, FONT, Btn, TopBar, PageShell, SurfaceCard } from "../shared/ui";
import { VoiceRecorder } from "./VoiceRecorder";
import { SpeechConsentModal } from "./SpeechConsentModal";
import { transcribeWithServer } from "../../lib/speakingEval/serverStt";
import { scoreRepeat } from "../../lib/speakingEval/repeatScorer";
import { sameOriginAudio } from "../../lib/listening/audioSrc";
import { useExamAudio } from "../shared/ExamAudioProvider";
import { trackAudioEvent } from "../../lib/analytics/audio";

const SPK = { color: "#F59E0B", soft: "#FFFBEB" };

// Shared single playback slot for the "Original" replays on the review / summary
// screens. Prefer the pre-rendered MP3 (served through our same-origin /api/audio
// proxy so it loads where supabase.co is blocked AND where the device has no
// English speech engine); fall back to the Web Speech API only when there's no
// clip or it fails. Module-level so tapping one replay stops any other sounding.
let currentOriginalAudio = null;
function playOriginalSentence(sentence) {
  if (!sentence) return;
  if (currentOriginalAudio) { try { currentOriginalAudio.pause(); } catch {} currentOriginalAudio = null; }
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();

  const speakTTS = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(sentence.sentence);
    u.lang = "en-US";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  };

  const src = sameOriginAudio(sentence.audio_url);
  if (!src) { speakTTS(); return; }
  const audio = new Audio(src);
  currentOriginalAudio = audio;
  audio.onended = () => { if (currentOriginalAudio === audio) currentOriginalAudio = null; };
  audio.onerror = () => { if (currentOriginalAudio === audio) { currentOriginalAudio = null; speakTTS(); } };
  const pr = audio.play();
  if (pr && typeof pr.catch === "function") pr.catch(() => {});
}

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
  // Exam-controller mode (mock exam only): the SpeakingExamShell mounts an
  // ExamAudioProvider, so sentence clips play through the shared persistent
  // element unlocked in the start-exam gesture. Null on the practice page —
  // every legacy code path below is untouched there.
  const examAudio = useExamAudio();
  const examController = examAudio ? examAudio.controller : null;
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
  // When the user hits Finish on the last sentence while earlier ones are
  // still being transcribed, we hold the onComplete call in a "submitting"
  // state and fire it once everything has settled. Otherwise the parent
  // (mock exam shell) gets a score summary missing the trailing items.
  // submitWaitSeconds counts down a hard cap (45s) so the user never
  // gets permanently stuck if OpenAI hangs.
  const [submitting, setSubmitting] = useState(false);
  const [submitWaitSeconds, setSubmitWaitSeconds] = useState(0);

  // PIPL: if the route returns NEEDS_CONSENT, queue the audio blob here so we
  // can replay the upload once the user grants consent in the modal. Cleared
  // when the modal is dismissed.
  const [needsConsent, setNeedsConsent] = useState(false);
  const pendingConsentJobsRef = useRef([]);
  // Show the v2 re-consent prompt at most once per session for legacy v1
  // consenters (their transcription still works; this only upgrades disclosure).
  const consentRePromptedRef = useRef(false);

  const elapsedRef = useRef(null);
  const utteranceRef = useRef(null);
  // Current pre-rendered MP3 <Audio> instance (preferred over Web Speech). Held
  // so we can stop it when replaying, advancing, or unmounting.
  const audioElRef = useRef(null);
  // Exam-controller mode: exposes playSentence's Web Speech fallback to the
  // controller subscription (a media error must rescue via TTS there too).
  const playViaTTSRef = useRef(null);
  // AbortController per question index — used to cancel an in-flight
  // transcribe when the user clicks Re-record (otherwise we pay for a
  // transcript they're about to discard).
  const transcribeAbortRef = useRef([]);

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

  // Stop any in-flight MP3 / utterance (incl. an "Original" replay) on unmount.
  useEffect(() => {
    return () => {
      if (audioElRef.current) { try { audioElRef.current.pause(); } catch {} audioElRef.current = null; }
      if (currentOriginalAudio) { try { currentOriginalAudio.pause(); } catch {} currentOriginalAudio = null; }
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  // (STT runs server-side now; no browser capability check needed.)

  // Exam-controller mode: mirror the per-instance audio.onplay/onended/onerror
  // semantics onto the shared element's events. `blocked` deliberately does
  // NOT advance — the Play Again button stays usable (same as the legacy
  // blocked-autoplay path) and the Provider overlay owns recovery.
  useEffect(() => {
    if (!examController) return undefined;
    const unsub = examController.subscribe((event) => {
      const meta = event.meta || {};
      if (meta.section !== "speaking" || meta.taskType !== "repeat") return;
      if (event.type === "playing") {
        setTtsPlaying(true);
      } else if (event.type === "ended") {
        // advance(): listen phase → record. A record-phase replay lands here
        // too — setPhase("record") is then a no-op.
        setTtsPlaying(false);
        setPhase("record");
      } else if (event.type === "error") {
        // Unreachable clip / decode error → rescue with Web Speech so the
        // listen phase still completes instead of dead-ending.
        setTtsPlaying(false);
        trackAudioEvent("tts_fallback", {
          section: "speaking", taskType: "repeat",
          itemId: meta.itemId, audioPath: event.src || null,
          errorName: event.errorName || null,
        });
        if (playViaTTSRef.current) playViaTTSRef.current();
      } else if (event.type === "blocked") {
        setTtsPlaying(false);
      }
    });
    return unsub;
  }, [examController]);

  // Play the current sentence. Prefer the pre-rendered MP3 (a real TTS voice,
  // served through our same-origin /api/audio proxy) — it loads where supabase.co
  // is blocked AND where the device has no English speech engine, which covers
  // most mainland mobile browsers / WeChat WebView. Only fall back to the Web
  // Speech API when there's no clip or the MP3 fails to load.
  const playSentence = useCallback(() => {
    if (!sentence) return;

    // Stop anything currently sounding (a previous MP3 or a queued utterance).
    if (audioElRef.current) { try { audioElRef.current.pause(); } catch {} audioElRef.current = null; }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();

    const advance = () => { setTtsPlaying(false); setPhase("record"); };

    // Web Speech fallback. Safari's getVoices() returns [] on the first
    // synchronous call and populates after a `voiceschanged` event; if we don't
    // wait, voice selection falls back to the system default (often Chinese on
    // macOS-CN) and English comes out garbled. Wait up to ~600ms for voices.
    function playViaTTS() {
      if (!ttsSupported) return; // no speech engine and no MP3 → UI shows the text box
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
        utt.onend = advance;
        utt.onerror = advance;

        utteranceRef.current = utt;
        window.speechSynthesis.speak(utt);
      }

      const synth = window.speechSynthesis;
      const initial = synth.getVoices();
      if (initial && initial.length > 0) { speakWithVoices(initial); return; }
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
    }

    const src = sameOriginAudio(sentence.audio_url);
    // Exam-controller mode: play on the shared unlocked element instead of a
    // fresh Audio() (which iOS would block outside a gesture). Ended/error/
    // blocked handling lives in the controller subscription above.
    if (examController && src) {
      playViaTTSRef.current = playViaTTS;
      examController.play(src, { section: "speaking", taskType: "repeat", itemId: sentence.id });
      return;
    }
    if (src) {
      const audio = new Audio(src);
      audioElRef.current = audio;
      audio.onplay = () => setTtsPlaying(true);
      audio.onended = () => {
        if (audioElRef.current !== audio) return;
        audioElRef.current = null;
        advance();
      };
      // Unreachable clip / decode error → rescue with Web Speech so the listen
      // phase still completes instead of dead-ending.
      audio.onerror = () => {
        if (audioElRef.current !== audio) return;
        audioElRef.current = null;
        playViaTTS();
      };
      const pr = audio.play();
      if (pr && typeof pr.catch === "function") {
        // Autoplay blocked (needs a user gesture). Don't advance or rescue —
        // leave the play button enabled so a tap (a fresh gesture) replays it.
        pr.catch(() => { if (audioElRef.current === audio) setTtsPlaying(false); });
      }
      return;
    }
    playViaTTS();
  }, [ttsSupported, sentence, examController]);

  // Auto-play on new sentence
  useEffect(() => {
    if (!finished && phase === "listen" && sentence) {
      // Exam-controller mode: handleNext already started this sentence inside
      // the click's gesture stack — don't double-play it from the timer.
      if (examController) {
        const src = sameOriginAudio(sentence.audio_url);
        const st = examController.getState();
        if (src && examController.getCurrentSrc() === src && (st === "loading" || st === "playing")) return;
      }
      // Small delay so the UI renders first
      const t = setTimeout(playSentence, 500);
      return () => clearTimeout(t);
    }
  }, [current, phase, finished]);

  // Upload a single blob to the STT endpoint and reflect the result into the
  // per-question state. Pulled out of handleRecordingComplete so we can also
  // call it from the consent-modal retry path.
  const runTranscribeJob = useCallback(({ idx, blob, sentenceText, questionId, durationMs }) => {
    setTranscriptStatus(prev => {
      const next = [...prev];
      next[idx] = "processing";
      return next;
    });
    setTranscriptError(prev => {
      const next = [...prev];
      next[idx] = null;
      return next;
    });

    const controller = new AbortController();
    transcribeAbortRef.current[idx] = controller;
    (async () => {
      const result = await transcribeWithServer(blob, {
        taskType: "repeat",
        questionId,
        durationMs,
        signal: controller.signal,
      });
      // Stale-response guard: if a newer take superseded this controller,
      // drop the result.
      if (transcribeAbortRef.current[idx] !== controller) return;
      transcribeAbortRef.current[idx] = null;
      if (result.code === "ABORTED") return;

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
        // Legacy v1 consenters: re-prompt onto the v2 disclosure once. Transcription
        // already succeeded, so this never blocks — granting just enables retention.
        if (result.consentVersion != null && result.consentVersion !== 2 && !consentRePromptedRef.current) {
          consentRePromptedRef.current = true;
          setNeedsConsent(true);
        }
        return;
      }

      // Failure paths with code-specific UI hints.
      if (result.code === "NOT_PRO") setNotPro(true);
      if (result.code === "NEEDS_CONSENT") {
        // Stash the blob so we can retry after the user grants consent in the modal.
        pendingConsentJobsRef.current.push({ idx, blob, sentenceText, questionId });
        setNeedsConsent(true);
      }
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
    })();
  }, []);

  // Capture the recording and kick off server-side transcription. We don't
  // block the UI on the upload — the user is free to replay/re-record/advance
  // while the transcript backfills asynchronously into the right slot.
  const handleRecordingComplete = useCallback((blobUrl, blob, durationMs) => {
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

    runTranscribeJob({ idx, blob, sentenceText, questionId, durationMs });
  }, [current, sentence, notPro, runTranscribeJob]);

  // Replay queued uploads after the user grants consent in the modal.
  const handleConsentGranted = useCallback(() => {
    const jobs = pendingConsentJobsRef.current;
    pendingConsentJobsRef.current = [];
    setNeedsConsent(false);
    for (const job of jobs) runTranscribeJob(job);
  }, [runTranscribeJob]);

  // User dismissed the modal without granting. Drop pending jobs — the
  // recordings stay in place, just without transcripts.
  const handleConsentClosed = useCallback(() => {
    pendingConsentJobsRef.current = [];
    setNeedsConsent(false);
  }, []);

  // Cancel an in-flight transcribe and reset the status for a question. Used
  // when the user clicks Re-record so we don't waste API spend on a transcript
  // they're about to discard.
  const cancelTranscribeFor = useCallback((idx) => {
    const ctrl = transcribeAbortRef.current[idx];
    if (ctrl) {
      try { ctrl.abort(); } catch {}
      transcribeAbortRef.current[idx] = null;
    }
    setTranscriptStatus(prev => {
      if (prev[idx] == null) return prev;
      const next = [...prev];
      next[idx] = null;
      return next;
    });
    setTranscriptError(prev => {
      if (prev[idx] == null) return prev;
      const next = [...prev];
      next[idx] = null;
      return next;
    });
    // Also clear any stale transcript/score from a previous take.
    setTranscripts(prev => {
      if (prev[idx] == null) return prev;
      const next = [...prev];
      next[idx] = null;
      return next;
    });
    setScores(prev => {
      if (prev[idx] == null) return prev;
      const next = [...prev];
      next[idx] = null;
      return next;
    });
  }, []);

  // Fire onComplete with the latest scored items. Pulled out so the
  // pending-transcribe wait effect can call it too.
  const finishSession = useCallback(() => {
    setFinished(true);
    if (!onComplete) return;
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
  }, [current, total, recordings, elapsed, items, onComplete, transcripts, scores]);

  const SUBMIT_WAIT_CAP_SEC = 45; // hard cap so the user can never get stuck

  const handleNext = useCallback(() => {
    if (current < total - 1) {
      // Exam-controller mode: kick the NEXT sentence's clip synchronously in
      // this click (gesture-stack playback — belt and braces on top of the
      // unlocked element). The auto-play effect sees it and skips its timer.
      if (examController) {
        const next = items[current + 1];
        const nextSrc = next ? sameOriginAudio(next.audio_url) : null;
        if (nextSrc) examController.play(nextSrc, { section: "speaking", taskType: "repeat", itemId: next.id });
      }
      setCurrent(current + 1);
      setPhase("listen");
      return;
    }
    // Last sentence — if anything is still transcribing, hold the finish call
    // until those settle (otherwise the summary screen / mock-exam parent
    // would see null scores for in-flight items).
    if (transcriptStatus.some(s => s === "processing")) {
      setSubmitting(true);
      setSubmitWaitSeconds(SUBMIT_WAIT_CAP_SEC);
      return;
    }
    finishSession();
  }, [current, total, transcriptStatus, finishSession, examController, items]);

  // Force-finish escape hatch: user-triggered or hard-cap expiry. Aborts any
  // still-in-flight uploads to stop billing, then fires onComplete with the
  // partial result set.
  const forceFinish = useCallback(() => {
    // Cancel everything still uploading.
    transcribeAbortRef.current.forEach((c) => { try { c?.abort?.(); } catch {} });
    transcribeAbortRef.current = [];
    setSubmitting(false);
    setSubmitWaitSeconds(0);
    finishSession();
  }, [finishSession]);

  // Settle the deferred finish once all transcribes have landed.
  useEffect(() => {
    if (!submitting) return;
    if (transcriptStatus.some(s => s === "processing")) return;
    setSubmitting(false);
    setSubmitWaitSeconds(0);
    finishSession();
  }, [submitting, transcriptStatus, finishSession]);

  // Countdown for the hard cap.
  useEffect(() => {
    if (!submitting) return;
    if (submitWaitSeconds <= 0) {
      forceFinish();
      return;
    }
    const t = setTimeout(() => setSubmitWaitSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [submitting, submitWaitSeconds, forceFinish]);

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
                        <ReplayButton label="Original" onPlay={() => playOriginalSentence(item)} />
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
              {/* No MP3 AND no speech engine — the only case where we must reveal
                  the text so the user isn't stuck with silence. When an MP3 exists
                  it plays regardless of Web Speech support, so keep it hidden. */}
              {!ttsSupported && !sentence.audio_url && (
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
                <ReplayButton label="Original" onPlay={() => playOriginalSentence(sentence)} />
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
                <Btn
                  variant="secondary"
                  onClick={() => { cancelTranscribeFor(current); setPhase("record"); }}
                  disabled={submitting}
                >
                  Re-record
                </Btn>
                <Btn
                  onClick={handleNext}
                  disabled={submitting}
                  style={{ background: SPK.color, borderColor: SPK.color }}
                >
                  {submitting
                    ? `正在完成识别… (${submitWaitSeconds}s)`
                    : current < total - 1 ? "Next Sentence" : "Finish"}
                </Btn>
              </div>
              {submitting && (
                <div style={{ marginTop: 10, textAlign: "center" }}>
                  <button
                    onClick={forceFinish}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      fontSize: 12, color: C.t3, textDecoration: "underline", fontFamily: FONT,
                    }}
                  >
                    跳过等待，直接完成（未识别的题目不计分）
                  </button>
                </div>
              )}
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

      <SpeechConsentModal
        open={needsConsent}
        onClose={handleConsentClosed}
        onGranted={handleConsentGranted}
      />
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
