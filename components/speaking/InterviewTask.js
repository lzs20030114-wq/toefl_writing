"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { C, FONT, Btn, TopBar, PageShell, SurfaceCard } from "../shared/ui";
import { VoiceRecorder } from "./VoiceRecorder";
import { SpeakingIntroScreen } from "./SpeakingIntroScreen";
import { buildInterviewIntro } from "../../lib/speakingGen/introTemplates";
import { SpeechConsentModal } from "./SpeechConsentModal";
import { transcribeWithServer } from "../../lib/speakingEval/serverStt";
import { scoreInterview } from "../../lib/speakingEval/interviewScorer";
import { sameOriginAudio } from "../../lib/listening/audioSrc";
import { useExamAudio } from "../shared/ExamAudioProvider";
import { trackAudioEvent } from "../../lib/analytics/audio";

const SPK = { color: "#F59E0B", soft: "#FFFBEB" };

const ANSWER_DURATION = 45; // seconds per question

/**
 * Take an Interview — Task 2 of TOEFL 2026 Speaking.
 *
 * Flow per question:
 *   1. Show question text + play TTS
 *   2. 45-second countdown timer, auto-record starts
 *   3. Auto-stop when timer hits 0 (or user stops early)
 *   4. Advance immediately — STT + AI scoring run in the background
 *   5. After 4 questions: summary with replay + AI analysis for each
 *      (a deferred-finish wait holds the summary until in-flight work lands)
 *
 * Props:
 *   items       — array of { id, question, category, difficulty } (4 items)
 *   setInfo     — { intro } for the setting/logistics intro narration
 *   onComplete  — called with session summary
 *   onExit      — back navigation
 *   isPractice  — if true, no auto-advance
 */
export function InterviewTask({ items, setInfo = null, onComplete, onExit, isPractice = false }) {
  // Exam-controller mode: the mock-exam shell AND (since 20dcc36) the speaking
  // practice page both mount an ExamAudioProvider, so question prompts play
  // through the shared persistent element. examController is non-null in practice
  // too — the legacy per-<Audio> paths below only run with no Provider mounted.
  const examAudio = useExamAudio();
  const examController = examAudio ? examAudio.controller : null;
  // Intro/setting screen gate: show the real-exam setting + logistics narration
  // and only start question 1 after the user taps 开始 — that gesture is where we
  // unlock the shared exam audio element.
  const [started, setStarted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState("prep"); // prep | answer | review
  // Exam-controller mode only: the clip errored AND no speech engine exists —
  // show an explicit "start answering" button instead of silently advancing.
  const [audioFailed, setAudioFailed] = useState(false);
  const [recordings, setRecordings] = useState([]); // blobUrl per index
  const [finished, setFinished] = useState(false);
  const [timeLeft, setTimeLeft] = useState(ANSWER_DURATION);
  const [totalElapsed, setTotalElapsed] = useState(0);
  const [ttsSupported, setTtsSupported] = useState(true);
  const [autoRecordReady, setAutoRecordReady] = useState(false);
  const [recordingStarted, setRecordingStarted] = useState(false); // true once the recorder actually starts
  const [autoBlocked, setAutoBlocked] = useState(false); // auto-start blocked (e.g. iOS Safari gesture requirement)
  const [transcripts, setTranscripts] = useState([]); // STT transcript per index
  // Per-question STT lifecycle: null | "processing" | "done" | "failed"
  const [transcriptStatus, setTranscriptStatus] = useState([]);
  const [transcriptError, setTranscriptError] = useState([]); // server error code per index when "failed"
  const [notPro, setNotPro] = useState(false); // sticky: once NOT_PRO, skip further uploads
  const [aiScores, setAiScores] = useState([]); // AI score result per index
  // Per-question AI scoring lifecycle: null | "processing" | "done" | "failed".
  // Per-index (not a single boolean) because the user advances without waiting,
  // so several questions can be scoring concurrently.
  const [scoringStatus, setScoringStatus] = useState([]);
  const [scoringErrors, setScoringErrors] = useState([]); // error message per index when "failed"
  const [expandedQ, setExpandedQ] = useState(null); // expanded question in summary
  // Hold the onComplete call when the user finishes while transcribes or AI
  // scoring are still in flight — otherwise the parent (mock exam shell)
  // gets a result set with null aiScores for trailing questions. The wait
  // is capped at 60s so the user can never get permanently stuck.
  const [submitting, setSubmitting] = useState(false);
  const [submitWaitSeconds, setSubmitWaitSeconds] = useState(0);

  // PIPL: queue blobs that hit NEEDS_CONSENT so the modal can replay them
  // after the user grants consent.
  const [needsConsent, setNeedsConsent] = useState(false);
  const pendingConsentJobsRef = useRef([]);
  // Show the v2 re-consent prompt at most once per session for legacy v1
  // consenters (their transcription still works; this only upgrades disclosure).
  const consentRePromptedRef = useRef(false);

  const timerRef = useRef(null);
  const totalTimerRef = useRef(null);
  const recorderStopRef = useRef(null);
  // Current pre-rendered MP3 <Audio> instance for the question prompt (preferred
  // over Web Speech). Held so we can stop it on advance / unmount.
  const audioElRef = useRef(null);
  // Exam-controller mode: exposes playQuestion's Web Speech fallback to the
  // controller subscription (a media error rescues via TTS there too).
  const playViaTTSRef = useRef(null);
  // AbortController per question — used by forceFinish to cancel in-flight
  // transcribe uploads when the user gives up on the deferred-finish wait.
  const transcribeAbortRef = useRef([]);

  const total = items.length;
  const question = items[current];

  // Global elapsed — only runs once the task has started (past the intro screen),
  // so reading the setting screen isn't counted as answering time.
  useEffect(() => {
    if (finished || !started) { if (totalTimerRef.current) clearInterval(totalTimerRef.current); return; }
    totalTimerRef.current = setInterval(() => setTotalElapsed(p => p + 1), 1000);
    return () => { if (totalTimerRef.current) clearInterval(totalTimerRef.current); };
  }, [finished, started]);

  // Check TTS support
  useEffect(() => {
    if (typeof window === "undefined") return;
    setTtsSupported("speechSynthesis" in window);
  }, []);

  // Stop any in-flight MP3 / utterance when the component unmounts.
  useEffect(() => {
    return () => {
      if (audioElRef.current) { try { audioElRef.current.pause(); } catch {} audioElRef.current = null; }
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  // (STT runs server-side now; no browser capability check needed.)

  // Countdown timer for answer phase
  useEffect(() => {
    // Only run the answer countdown once recording has actually started. On iOS
    // Safari the auto-start can be blocked (needs a user gesture); gating here
    // keeps the clock from draining to 0:00 and auto-submitting an empty answer.
    if (phase !== "answer" || !recordingStarted) {
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
  }, [phase, current, recordingStarted]);

  // Exam-controller mode: map the shared element's events onto the phase
  // machine. Crucially, `blocked` does NOT advance — the old per-instance
  // path silently skipped into the answer phase when autoplay was rejected,
  // so the student never heard the question. Now we stay in prep and let the
  // Provider overlay recover (its retry → playing → ended → advance).
  useEffect(() => {
    if (!examController) return undefined;
    const unsub = examController.subscribe((event) => {
      const meta = event.meta || {};
      if (meta.section !== "speaking" || meta.taskType !== "interview") return;
      if (event.type === "ended") {
        setAudioFailed(false);
        setAutoRecordReady(true);
        setPhase("answer");
      } else if (event.type === "error") {
        // Genuine media failure → rescue via Web Speech; if no speech engine
        // either, surface an explicit button — never a silent skip.
        trackAudioEvent("tts_fallback", {
          section: "speaking", taskType: "interview",
          itemId: meta.itemId, audioPath: event.src || null,
          errorName: event.errorName || null,
        });
        if (ttsSupported && playViaTTSRef.current) playViaTTSRef.current();
        else setAudioFailed(true);
      }
      // blocked: stay in prep — the overlay owns recovery.
    });
    return unsub;
  }, [examController, ttsSupported]);

  // Play the interviewer's question. Prefer a pre-rendered MP3 (served through
  // our same-origin /api/audio proxy — reachable in mainland China and on devices
  // with no English speech engine); fall back to the Web Speech API when there's
  // no clip or it fails. The question text stays on screen throughout, so even a
  // total audio failure never blocks the user (unlike Listen & Repeat).
  const playQuestion = useCallback(() => {
    if (!question) return;

    // Stop anything currently sounding.
    if (audioElRef.current) { try { audioElRef.current.pause(); } catch {} audioElRef.current = null; }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();

    const advance = () => { setAutoRecordReady(true); setPhase("answer"); };

    // Safari's getVoices() returns [] until voiceschanged fires — speaking
    // synchronously can fall back to the system default voice (Chinese on a
    // macOS-CN setup), so wait for the voice list with a 600ms hard timeout.
    function playViaTTS() {
      // No speech engine and no MP3 (or the clip errored): there is no way to
      // deliver the question audibly, and the question text stays hidden — so
      // surface the explicit error/retry/skip screen instead of a silent
      // dead-end. (Reading the question aloud is the middle rung of the failure
      // chain; this is the terminal rung.)
      if (!ttsSupported) { setAudioFailed(true); return; }
      function speakWithVoices(voices) {
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(question.question);
        utt.lang = "en-US";
        utt.rate = 0.85;
        const PREFERRED = ["Samantha", "Aria", "Google US English", "Alex", "Karen"];
        let enVoice = null;
        for (const name of PREFERRED) {
          enVoice = voices.find((v) => v.lang.startsWith("en-") && v.name.includes(name));
          if (enVoice) break;
        }
        if (!enVoice) enVoice = voices.find((v) => v.lang.startsWith("en-"));
        if (enVoice) utt.voice = enVoice;

        utt.onend = advance;
        utt.onerror = advance;
        window.speechSynthesis.speak(utt);
      }

      const synth = window.speechSynthesis;
      const initial = synth.getVoices();
      if (initial && initial.length > 0) { speakWithVoices(initial); return; }
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

    const src = sameOriginAudio(question.audio_url);
    // Exam-controller mode: play on the shared unlocked element instead of a
    // fresh Audio(). Ended/error/blocked handling lives in the controller
    // subscription above (blocked no longer skips the question).
    if (examController && src) {
      playViaTTSRef.current = playViaTTS;
      examController.play(src, { section: "speaking", taskType: "interview", itemId: question.id });
      return;
    }
    if (src) {
      const audio = new Audio(src);
      audioElRef.current = audio;
      audio.onended = () => {
        if (audioElRef.current !== audio) return;
        audioElRef.current = null;
        advance();
      };
      // Unreachable clip / decode error → rescue with Web Speech (reads the
      // question aloud); if there's no speech engine either, surface the
      // error/retry/skip screen — the question text is hidden, so we must never
      // drop the user into recording without them ever hearing it.
      audio.onerror = () => {
        if (audioElRef.current !== audio) return;
        audioElRef.current = null;
        if (ttsSupported) playViaTTS(); else setAudioFailed(true);
      };
      const pr = audio.play();
      if (pr && typeof pr.catch === "function") {
        // Autoplay blocked (legacy no-Provider / kill-switch path only). The
        // question is hidden, so we can't silently start answering — surface the
        // error/retry screen; a retry tap is a fresh gesture that will play.
        pr.catch(() => {
          if (audioElRef.current !== audio) return;
          audioElRef.current = null;
          setAudioFailed(true);
        });
      }
      return;
    }
    playViaTTS();
  }, [ttsSupported, question, examController]);

  // Auto-play question on prep phase — gated on `started` so nothing sounds
  // until the user taps 开始 on the intro screen (its gesture unlocks the audio).
  useEffect(() => {
    if (started && phase === "prep" && question && !finished) {
      // Exam-controller mode: handleNext already started this question inside
      // the click's gesture stack — don't double-play it from the timer.
      if (examController) {
        const src = sameOriginAudio(question.audio_url);
        const st = examController.getState();
        if (src && examController.getCurrentSrc() === src && (st === "loading" || st === "playing")) return;
      }
      const t = setTimeout(playQuestion, 600);
      return () => clearTimeout(t);
    }
  }, [current, phase, finished, started]);

  // Start STT when recording begins
  // Run AI scoring once we have a transcript. Takes transcript as a parameter
  // so we don't race against state updates from the transcribe step.
  const runScoring = useCallback(async (questionIdx, transcript) => {
    if (!transcript) {
      setScoringStatus(prev => {
        const next = [...prev];
        next[questionIdx] = "failed";
        return next;
      });
      setScoringErrors(prev => {
        const next = [...prev];
        next[questionIdx] = "未检测到语音内容，跳过评分";
        return next;
      });
      return;
    }
    // Mark "processing" synchronously (before the await) — the deferred-finish
    // wait in handleNext reads this array, and any gap between the transcript
    // landing and this flag would let a fast Finish click slip past the wait.
    setScoringStatus(prev => {
      const next = [...prev];
      next[questionIdx] = "processing";
      return next;
    });
    setScoringErrors(prev => {
      const next = [...prev];
      next[questionIdx] = null;
      return next;
    });
    try {
      const q = items[questionIdx];
      const result = await scoreInterview({
        question: q.question,
        transcript,
      });
      setAiScores(prev => {
        const next = [...prev];
        next[questionIdx] = result;
        return next;
      });
      setScoringStatus(prev => {
        const next = [...prev];
        next[questionIdx] = "done";
        return next;
      });
    } catch (err) {
      setScoringErrors(prev => {
        const next = [...prev];
        next[questionIdx] = "评分失败: " + (err.message || "未知错误");
        return next;
      });
      setScoringStatus(prev => {
        const next = [...prev];
        next[questionIdx] = "failed";
        return next;
      });
    }
  }, [items]);

  // Upload + handle a single blob. Pulled out of handleRecordingComplete so
  // the consent-modal retry path can call it too.
  const runTranscribeJob = useCallback(({ idx, blob, questionId, durationMs }) => {
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
        taskType: "interview",
        questionId,
        durationMs,
        signal: controller.signal,
      });
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
        setTranscriptStatus(prev => {
          const next = [...prev];
          next[idx] = "done";
          return next;
        });
        runScoring(idx, transcript);
        // Legacy v1 consenters: re-prompt onto the v2 disclosure once. Transcription
        // already succeeded, so this never blocks — granting just enables retention.
        if (result.consentVersion != null && result.consentVersion !== 2 && !consentRePromptedRef.current) {
          consentRePromptedRef.current = true;
          setNeedsConsent(true);
        }
        return;
      }

      if (result.code === "NOT_PRO") setNotPro(true);
      if (result.code === "NEEDS_CONSENT") {
        pendingConsentJobsRef.current.push({ idx, blob, questionId });
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
  }, [runScoring]);

  const handleRecordingComplete = useCallback((blobUrl, blob, durationMs) => {
    if (timerRef.current) clearInterval(timerRef.current);
    const idx = current;
    const q = items[idx];

    setRecordings(prev => {
      const next = [...prev];
      next[idx] = blobUrl;
      return next;
    });
    setPhase("review");
    setAutoRecordReady(false);
    setRecordingStarted(false);
    setAutoBlocked(false);

    // Skip if Pro gate already failed, or if we never got a blob.
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

    runTranscribeJob({ idx, blob, questionId: q?.id || "", durationMs });
  }, [current, items, notPro, runTranscribeJob]);

  const handleConsentGranted = useCallback(() => {
    const jobs = pendingConsentJobsRef.current;
    pendingConsentJobsRef.current = [];
    setNeedsConsent(false);
    for (const job of jobs) runTranscribeJob(job);
  }, [runTranscribeJob]);

  const handleConsentClosed = useCallback(() => {
    pendingConsentJobsRef.current = [];
    setNeedsConsent(false);
  }, []);

  // Bundle the result and call onComplete. Extracted so the pending-work
  // wait effect can call it too.
  const finishSession = useCallback(() => {
    setFinished(true);
    if (!onComplete) return;
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
  }, [current, total, recordings, totalElapsed, items, onComplete, transcripts, aiScores]);

  // Interview's DeepSeek scoring is slower than Repeat's pure STT, so the cap
  // is a touch more generous.
  const SUBMIT_WAIT_CAP_SEC = 60;

  const handleNext = useCallback(() => {
    if (current < total - 1) {
      // Exam-controller mode: kick the NEXT question's clip synchronously in
      // this click (gesture-stack playback). The auto-play effect sees it and
      // skips its timer.
      if (examController) {
        const next = items[current + 1];
        const nextSrc = next ? sameOriginAudio(next.audio_url) : null;
        if (nextSrc) examController.play(nextSrc, { section: "speaking", taskType: "interview", itemId: next.id });
      }
      setCurrent(current + 1);
      setPhase("prep");
      setAutoRecordReady(false);
      setRecordingStarted(false);
      setAutoBlocked(false);
      setAudioFailed(false);
      return;
    }
    // Last question — hold the finish call if anything's still in flight
    // (server STT transcript OR DeepSeek AI scoring, on ANY question: the user
    // advances without waiting, so earlier questions may still be processing).
    const pending = transcriptStatus.some(s => s === "processing")
      || scoringStatus.some(s => s === "processing");
    if (pending) {
      setSubmitting(true);
      setSubmitWaitSeconds(SUBMIT_WAIT_CAP_SEC);
      return;
    }
    finishSession();
  }, [current, total, transcriptStatus, scoringStatus, finishSession, examController, items]);

  // Escape hatch: aborts any in-flight uploads (no more billing) and fires
  // onComplete with whatever scores we have so far.
  const forceFinish = useCallback(() => {
    transcribeAbortRef.current.forEach((c) => { try { c?.abort?.(); } catch {} });
    transcribeAbortRef.current = [];
    setSubmitting(false);
    setSubmitWaitSeconds(0);
    finishSession();
  }, [finishSession]);

  // Settle the deferred finish once all background work has landed.
  useEffect(() => {
    if (!submitting) return;
    if (transcriptStatus.some(s => s === "processing")) return;
    if (scoringStatus.some(s => s === "processing")) return;
    setSubmitting(false);
    setSubmitWaitSeconds(0);
    finishSession();
  }, [submitting, transcriptStatus, scoringStatus, finishSession]);

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

  // Real-exam setting + logistics narration for the intro screen.
  const intro = useMemo(() => buildInterviewIntro({ intro: setInfo?.intro }), [setInfo?.intro]);

  // 开始: unlock the shared exam audio element inside this real gesture, then begin.
  const handleStart = useCallback(() => {
    if (examController) examController.unlock();
    setStarted(true);
  }, [examController]);

  // Failure-chain retry: re-attempt the question audio inside this fresh gesture
  // (so a blocked clip can play). Never reveals the question text.
  const retryPlay = useCallback(() => {
    setAudioFailed(false);
    playQuestion();
  }, [playQuestion]);

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

  // ── Intro / setting screen (before question 1) ──
  if (!started) {
    return (
      <SpeakingIntroScreen
        title="Interview"
        section="Speaking | Task 2"
        lines={[intro.settingText, intro.logisticsText]}
        onStart={handleStart}
        onExit={onExit}
      />
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
              recordingStarted ? (
                <div style={{
                  padding: "8px 16px", borderRadius: 999,
                  background: timeLeft <= 10 ? "#FEE2E2" : SPK.soft,
                  border: "1px solid " + (timeLeft <= 10 ? "#FECACA" : "#FDE68A"),
                  fontFamily: "Consolas, Menlo, 'Courier New', monospace", fontSize: 20, fontWeight: 800,
                  color: timeLeft <= 10 ? C.red : "#92400E",
                  animation: timeLeft <= 10 ? "spk-timer-pulse 1s ease-in-out infinite" : "none",
                  minWidth: 70, textAlign: "center",
                }}>
                  {formatTime(timeLeft)}
                </div>
              ) : (
                <div style={{
                  padding: "8px 16px", borderRadius: 999,
                  background: SPK.soft, border: "1px dashed #FDE68A",
                  fontSize: 13, fontWeight: 700, color: "#92400E",
                  minWidth: 70, textAlign: "center",
                }}>
                  {autoBlocked ? "待开始" : "准备中…"}
                </div>
              )
            )}
          </div>

          {/* Question面 — HIDDEN during prep/answer (real exam plays the question
              as audio only, never on screen). A neutral placeholder stands in;
              the actual question is revealed only after answering (review) and
              in the summary/feedback. The question text is still sent to scoring. */}
          {phase === "review" ? (
            <div style={{
              fontSize: 18, fontWeight: 700, color: C.t1, lineHeight: 1.7,
              marginBottom: 28, textAlign: "center", padding: "0 12px",
            }}>
              {question.question}
            </div>
          ) : (
            <div style={{
              fontSize: 16, fontWeight: 600, color: C.t2, lineHeight: 1.7,
              marginBottom: 28, textAlign: "center", padding: "0 12px",
            }}>
              Please answer the interviewer's question.
            </div>
          )}

          {/* Phase: Prep */}
          {phase === "prep" && (
            <div style={{ textAlign: "center" }}>
              {audioFailed ? (
                /* Terminal rung of the failure chain: the clip couldn't play AND
                   Web Speech couldn't read the question aloud. The question text
                   stays hidden — offer an explicit retry (fresh gesture) or a skip
                   (records nothing → 0, advances), never a silent start. */
                <div>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>🔇</div>
                  <div style={{
                    display: "inline-block", padding: "10px 16px", marginBottom: 18,
                    background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10,
                    fontSize: 14, fontWeight: 700, color: "#991B1B",
                  }}>
                    问题音频无法播放
                  </div>
                  <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                    <Btn onClick={retryPlay} style={{ background: SPK.color, borderColor: SPK.color }}>
                      重试播放
                    </Btn>
                    <Btn variant="secondary" onClick={handleNext}>
                      跳过本题
                    </Btn>
                  </div>
                </div>
              ) : (
                <>
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
                </>
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
                onRecordingStart={() => setRecordingStarted(true)}
                onStopRef={recorderStopRef}
                onAutoStartBlocked={() => setAutoBlocked(true)}
                // Belt-and-braces: VoiceRecorder already stops the exam controller
                // + Web Speech at record start; kill this task's legacy <Audio>
                // prompt too so it can't leak into the mic if the user抢跑 before
                // the question finished (auto-record normally starts only on end).
                onRecordingStateChange={(recording) => {
                  if (recording && audioElRef.current) {
                    try { audioElRef.current.pause(); } catch {}
                    audioElRef.current = null;
                  }
                }}
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
                  width: `${(recordingStarted ? timeLeft / ANSWER_DURATION : 1) * 100}%`,
                  transition: "width 1s linear, background 300ms ease",
                }} />
              </div>
              {autoBlocked && !recordingStarted && (
                <div style={{ marginTop: 12, fontSize: 13, color: "#92400E", lineHeight: 1.5 }}>
                  录音未自动开始，请点击上方按钮手动开始（iOS Safari 需手动授权麦克风）。
                </div>
              )}
            </div>
          )}

          {/* Phase: Review — never blocks on STT / AI scoring. Those run in the
              background (per-index status arrays) while the user moves on; the
              full AI analysis for every question shows together on the summary
              screen, same pattern as Listen & Repeat. */}
          {phase === "review" && (
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%", margin: "0 auto 16px",
                background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 26 }}>✓</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 12 }}>
                Answer recorded
              </div>

              {/* Background work hint */}
              {(transcriptStatus[current] === "processing" || scoringStatus[current] === "processing") && (
                <div style={{
                  margin: "0 auto 16px", padding: "10px 14px", maxWidth: 360,
                  background: "#F9FAFB", border: "1px solid " + C.bdr, borderRadius: 10,
                  fontSize: 13, color: C.t2, lineHeight: 1.6,
                }}>
                  <span style={{ display: "inline-block", marginRight: 8 }}>⏳</span>
                  正在识别与评分…（可以继续下一题，AI 解析会在完成后统一显示）
                </div>
              )}

              {/* STT failure: Pro gate */}
              {transcriptStatus[current] === "failed" && transcriptError[current] === "NOT_PRO" && (
                <div style={{
                  margin: "0 auto 16px", padding: "12px 16px", maxWidth: 360,
                  background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10,
                  fontSize: 13, color: "#92400E", lineHeight: 1.6, textAlign: "left",
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>🔒 语音识别为 Pro 专属</div>
                  录音已保存。升级 Pro 后可解锁自动识别和 AI 评分。
                </div>
              )}

              {/* STT failure: other errors */}
              {transcriptStatus[current] === "failed" && transcriptError[current] !== "NOT_PRO" && (
                <div style={{
                  margin: "0 auto 16px", padding: "10px 14px", maxWidth: 360,
                  background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10,
                  fontSize: 12, color: "#991B1B", lineHeight: 1.6,
                }}>
                  识别失败：{transcriptError[current] || "未知错误"}。录音已保存，可继续下一题。
                </div>
              )}

              {/* AI scoring failure */}
              {scoringStatus[current] === "failed" && scoringErrors[current] && (
                <div style={{
                  margin: "0 auto 16px", padding: "8px 14px", maxWidth: 360,
                  background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10,
                  fontSize: 12, color: "#991B1B", lineHeight: 1.6,
                }}>
                  {scoringErrors[current]}
                </div>
              )}

              {recordings[current] && (
                <div style={{ marginBottom: 16 }}>
                  <SummaryReplayButton blobUrl={recordings[current]} />
                </div>
              )}
              <Btn
                onClick={handleNext}
                disabled={submitting}
                style={{ background: SPK.color, borderColor: SPK.color }}
              >
                {submitting
                  ? `正在完成识别与评分… (${submitWaitSeconds}s)`
                  : current < total - 1 ? "Next Question" : "Finish Interview"}
              </Btn>
              {submitting && (
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={forceFinish}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      fontSize: 11, color: C.t3, textDecoration: "underline", fontFamily: FONT,
                    }}
                  >
                    跳过等待，直接完成（未识别的题目不计分）
                  </button>
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

      <SpeechConsentModal
        open={needsConsent}
        onClose={handleConsentClosed}
        onGranted={handleConsentGranted}
      />
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
