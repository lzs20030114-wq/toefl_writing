"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { C, FONT, Btn, TopBar, PageShell, SurfaceCard } from "../shared/ui";
import { VoiceRecorder, warmUpMicrophone } from "./VoiceRecorder";
import { SpeakingIntroScreen } from "./SpeakingIntroScreen";
import { AssetPreloadGate } from "../shared/AssetPreloadGate";
import { SceneImage } from "./SceneImage";
import { buildRepeatIntro } from "../../lib/speakingGen/introTemplates";
import { SpeechConsentModal } from "./SpeechConsentModal";
import { transcribeWithServer } from "../../lib/speakingEval/serverStt";
import { scoreRepeat } from "../../lib/speakingEval/repeatScorer";
import { levelMeanToBand } from "../../lib/mockExam/speakingBand";
import { sameOriginAudio } from "../../lib/listening/audioSrc";
import { useExamAudio } from "../shared/ExamAudioProvider";
import { trackAudioEvent } from "../../lib/analytics/audio";

const SPK = { color: "#F59E0B", soft: "#FFFBEB" };

/**
 * 真考的 Listen & Repeat：一套 N 句共用一张场景插图常驻屏幕，每念一句图上高亮该句物件。
 * 真题专区的题库可能带两个可选字段（见 lib/realBank.js mapRealRepeatSet）：
 *   setInfo.scene_image     = { url, w, h }                        无高亮底图
 *   setInfo.sentence_frames = [ { sentence_id, n, url, w, h } ]    逐句高亮帧
 *
 * **对齐只认 sentence_id**（题库里该句的 id），既不是数组下标、也不是 id 的 `_s<k>` 后缀：
 * 后缀不等于真题题号 —— 3.15 / 4.20 / 5.23 这几套录入时丢了靠前的句子、剩下的又连号重排，
 * 题库 s1 对的是真题 Q2。帧里的 n 只留档（真题题号），匹配一律不看它。
 * 找不到对应帧就退底图，底图也没有就什么都不渲染
 * （生成库 / 个人题库 / 无图真题：UI 一个像素都不变）。
 */
export function pickSceneFrame(setInfo, sentenceId) {
  const frames = Array.isArray(setInfo?.sentence_frames) ? setInfo.sentence_frames : [];
  const sid = typeof sentenceId === "string" ? sentenceId : "";
  if (sid) {
    const hit = frames.find((f) => f && f.sentence_id === sid && f.url);
    if (hit) return hit;
  }
  const base = setInfo?.scene_image;
  return base && base.url ? base : null;
}

/** 进任务前要预热的图（底图 + 全部逐句帧）；没图返回空数组，AssetPreloadGate 原样透传。 */
export function sceneImagePreloadUrls(setInfo) {
  const out = [];
  const base = setInfo?.scene_image;
  if (base && base.url) out.push(base.url);
  for (const f of Array.isArray(setInfo?.sentence_frames) ? setInfo.sentence_frames : []) {
    if (f && f.url) out.push(f.url);
  }
  return out;
}


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
 * Flow per sentence (真考节奏):
 *   1. "Listen" phase — the sentence plays by itself
 *   2. The mic opens by itself the moment the audio ends (VoiceRecorder autoStart);
 *      the user just speaks and taps stop. The intro's 开始 gesture pre-requests
 *      mic permission (warmUpMicrophone) so the browser prompt never lands here.
 *   3. "Recorded" — NO per-sentence verdict (the real test never tells you how
 *      that one went); STT/scoring runs in the background, replay + Re-record
 *      stay available, "Next Sentence" advances
 *   4. After 7 sentences: summary with per-sentence accuracy + word highlight
 *
 * Props:
 *   items       — array of { id, sentence, difficulty } (7 items)
 *   setInfo     — { id, scenario, speaker_role } for the intro/setting narration;
 *                 optional `settingText` overrides the generated setting line verbatim
 *                 (真题专区 passes the exam's own prompt, which must not be re-templated)
 *   onComplete  — called with session summary
 *   onExit      — back navigation
 *   isPractice  — accepted for caller compatibility; currently no effect. It used to
 *                 reveal the reference sentence right after each take, which is exactly
 *                 the per-sentence verdict the real test never gives — the summary
 *                 screen shows every sentence's text + word highlight in both modes.
 */
function RepeatTaskInner({ items, setInfo = null, onComplete, onExit }) {
  // Exam-controller mode: the SpeakingExamShell AND (since 20dcc36) the speaking
  // practice page both mount an ExamAudioProvider, so sentence clips play through
  // the shared persistent element unlocked on the first gesture. examController
  // is therefore non-null in practice too — the legacy per-<Audio> paths below
  // only run when no Provider is mounted (or the kill switch is on).
  const examAudio = useExamAudio();
  const examController = examAudio ? examAudio.controller : null;
  // Intro/setting screen gate: the task shows the real-exam setting narration
  // (scenario + "Listen to … Repeat only once.") and only begins the first
  // sentence after the user taps 开始 — which is also where we explicitly unlock
  // the shared exam audio element (a real gesture that roots out the zero-click
  // autoplay unlock race on practice pages).
  const [started, setStarted] = useState(false);
  // 开始 tapped and the mic permission is being requested inside that gesture
  // (see handleStart): the intro stays up, button relabelled, until it settles.
  const [starting, setStarting] = useState(false);
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState("listen"); // listen | record | review
  // True from the instant a recording attempt begins until it ends — drives the
  // replay-button lockout + the playSentence() guard so the reference audio can
  // never sound (and leak into the mic / STT) while the user is recording.
  const [isRecording, setIsRecording] = useState(false);
  // The recorder's auto-start was refused (iOS Safari without a prior grant,
  // permission denied…) → show the manual-tap hint under the mic button.
  const [autoBlocked, setAutoBlocked] = useState(false);
  const [recordings, setRecordings] = useState([]); // blobUrl per index
  const [finished, setFinished] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  // Legacy (no-Provider) path only: autoplay rejected by the browser → show an
  // explicit "tap Play Again" hint instead of failing silently (iOS Safari).
  const [playBlocked, setPlayBlocked] = useState(false);
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
  const mountedRef = useRef(true);
  // Double-tap guard for 开始 while the permission prompt is up.
  const startingRef = useRef(false);
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

  // Elapsed timer — only runs once the task has actually started (past the
  // intro screen), so the reading time on the setting screen isn't counted.
  useEffect(() => {
    if (finished || !started) {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
      return;
    }
    elapsedRef.current = setInterval(() => setElapsed(p => p + 1), 1000);
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [finished, started]);

  // Check TTS support
  useEffect(() => {
    if (typeof window === "undefined") return;
    setTtsSupported("speechSynthesis" in window);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Stop any in-flight MP3 / utterance (incl. an "Original" replay) on unmount.
  useEffect(() => {
    return () => {
      if (audioElRef.current) { try { audioElRef.current.pause(); } catch {} audioElRef.current = null; }
      if (currentOriginalAudio) { try { currentOriginalAudio.pause(); } catch {} currentOriginalAudio = null; }
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  // Silence this component's own legacy playback paths (the exam controller is
  // stopped by VoiceRecorder itself). Called the instant recording starts.
  const stopLocalPlayback = useCallback(() => {
    if (audioElRef.current) { try { audioElRef.current.pause(); } catch {} audioElRef.current = null; }
    if (currentOriginalAudio) { try { currentOriginalAudio.pause(); } catch {} currentOriginalAudio = null; }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  // VoiceRecorder reports its record-intent here. Mirror it into state (locks
  // the replay button) and, on start, kill any reference audio still sounding.
  const handleRecordingStateChange = useCallback((recording) => {
    setIsRecording(recording);
    if (recording) stopLocalPlayback();
  }, [stopLocalPlayback]);

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
    // Defensive闸: never play the reference sentence while recording — a stray
    // caller (or a not-yet-disabled button) must not leak the original into the
    // mic / STT. The record phase is the only time this can fire; auto-play runs
    // in the listen phase (isRecording false) and handleNext prewarm bypasses
    // playSentence entirely, so neither is affected.
    if (isRecording) return;
    setPlayBlocked(false);

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
        // surface the hint and leave the play button enabled so a tap (a fresh
        // gesture) replays it.
        pr.catch(() => {
          if (audioElRef.current !== audio) return;
          setTtsPlaying(false);
          setPlayBlocked(true);
        });
      }
      return;
    }
    playViaTTS();
  }, [ttsSupported, sentence, examController, isRecording]);

  // Auto-play on new sentence — gated on `started` so nothing sounds until the
  // user taps 开始 on the intro screen (its gesture unlocks the exam audio).
  useEffect(() => {
    if (started && !finished && phase === "listen" && sentence) {
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
  }, [current, phase, finished, started]);

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
    // Band estimate runs off the UNROUNDED level mean (rounding twice would drift).
    const avgLevel = validScores.length
      ? validScores.reduce((sum, s) => sum + s.score.score, 0) / validScores.length
      : null;
    const band = levelMeanToBand(avgLevel);
    onComplete({
      type: "speaking-repeat",
      total,
      attempted: recordings.filter(Boolean).length + (recordings[current] ? 0 : 1),
      elapsed,
      averageScore: avgScore,
      band,
      items: scoredItems,
    });
  }, [current, total, recordings, elapsed, items, onComplete, transcripts, scores]);

  const SUBMIT_WAIT_CAP_SEC = 45; // hard cap so the user can never get stuck

  const handleNext = useCallback(() => {
    setAutoBlocked(false);
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

  // Real-exam setting narration for the intro screen (deterministic per set).
  //
  // setInfo.settingText is an explicit override used by the 真题专区 (app/real-bank):
  // a real set already carries the exam's own full setting prompt ("You are working at a
  // university library. Your manager is training you to …"), whereas buildRepeatIntro
  // expects `scenario` to be a short PLACE TAG ("IT Help Desk") and splices it into a
  // template — feeding it the full prompt produced a garbled lower-cased run-on sentence.
  // When the caller has the authentic wording, show that verbatim instead of rebuilding it.
  const intro = useMemo(
    () => {
      const override = String(setInfo?.settingText || "").trim();
      const built = buildRepeatIntro({
        id: setInfo?.id,
        scenario: setInfo?.scenario,
        speaker_role: setInfo?.speaker_role,
      });
      if (!override) return built;
      // 原卷提示语通常已经把「听谁说、重复几遍」写在里面了，再拼一句生成的指令就是重复。
      // 所以 settingText 覆盖时，instructionText 也交给调用方决定（省略 = 不显示，
      // SpeakingIntroScreen 用 lines.filter(Boolean) 天然吃掉空行）。
      const instruction = setInfo?.instructionText;
      return {
        settingText: override,
        instructionText: instruction === undefined ? built.instructionText : String(instruction || ""),
      };
    },
    [setInfo?.id, setInfo?.scenario, setInfo?.speaker_role, setInfo?.settingText, setInfo?.instructionText],
  );

  // 开始: unlock the shared exam audio element inside this real gesture (idempotent;
  // examController may be null under the kill switch — guard it), ask for the mic
  // in the SAME gesture, and only then begin.
  //
  // Recording now starts by itself after every sentence, so the mic permission
  // must be settled up front: otherwise the browser's permission popup would pop
  // over the first sentence (audio playing while the user hunts for「允许」, first
  // take truncated), and iOS Safari — which only prompts from a gesture — would
  // refuse the first auto-start outright. The intro stays up until the prompt is
  // answered (or 10s pass, so a hung getUserMedia can never strand the user);
  // a denial just falls through to the recorder's manual-tap hint.
  const handleStart = useCallback(() => {
    if (startingRef.current) return;
    if (examController) examController.unlock();
    const warm = warmUpMicrophone();
    if (!warm) { setStarted(true); return; } // no getUserMedia here → old synchronous start
    startingRef.current = true;
    setStarting(true);
    warm.then(() => {
      startingRef.current = false;
      if (!mountedRef.current) return;
      setStarting(false);
      setStarted(true);
    });
  }, [examController]);

  // 当前句该显示哪一帧（逐句帧按题号对齐，找不到退底图，都没有则 null）。
  const sceneFrame = useMemo(
    () => pickSceneFrame(setInfo, sentence?.id),
    [setInfo, sentence?.id],
  );

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
    // Unrounded level mean → the same 1-6 band scale the mock exam reports.
    const avgLevel = validScores.length
      ? validScores.reduce((sum, s) => sum + s.score, 0) / validScores.length
      : null;
    const estBand = levelMeanToBand(avgLevel);
    const accuracyColor = (acc) => acc >= 80 ? "#16A34A" : acc >= 60 ? "#D97706" : "#DC2626";
    const bandColor = (band) =>
      band >= 5.5 ? "#16A34A"
      : band >= 4.5 ? "#2563EB"
      : band >= 3.5 ? "#D97706"
      : band >= 2.5 ? "#EA580C"
      : "#DC2626";

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
              {estBand != null && (
                <>
                  <div style={{ width: 1, background: "#FDE68A" }} />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: bandColor(estBand) }}>{estBand.toFixed(1)}</div>
                    <div style={{ fontSize: 11, color: C.t3 }}>Est. Band /6</div>
                  </div>
                </>
              )}
            </div>
            {estBand != null && (
              <div style={{ fontSize: 12, color: C.t3, marginTop: 10, lineHeight: 1.5 }}>
                Avg level {avgLevel.toFixed(1)}/5 across {validScores.length} sentences · band estimated from Listen &amp; Repeat only, not an official ETS score
              </div>
            )}
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

  // ── Intro / setting screen (before the first sentence) ──
  if (!started) {
    return (
      <SpeakingIntroScreen
        title="Listen & Repeat"
        section="Speaking | Task 1"
        // 真考的场景插图在设定屏就已经在了；没图时 image 为空，引入屏一个节点都不多。
        image={setInfo?.scene_image || null}
        lines={[intro.settingText, intro.instructionText]}
        buttonLabel={starting ? "正在准备麦克风…" : "开始"}
        onStart={handleStart}
        onExit={onExit}
      />
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
          {/* 场景插图：听句 / 录音 / 复盘三阶段都常驻卡片顶部，按当前句切高亮帧。
              key 带上 url —— 换帧时重新挂载，上一帧的加载失败状态不会粘在新帧上。 */}
          {sceneFrame && <SceneImage key={sceneFrame.url} frame={sceneFrame} />}

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
                The sentence will play automatically — recording starts as soon as it ends.
              </div>
              {playBlocked && !ttsPlaying && (
                <div style={{
                  margin: "0 auto 14px", maxWidth: 340, padding: "10px 14px",
                  background: SPK.soft, border: "1px solid #FDE68A", borderRadius: 10,
                  fontSize: 13, color: "#92400E", lineHeight: 1.6,
                }}>
                  浏览器拦截了自动播放，请点击下方按钮手动播放
                </div>
              )}
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
                {isRecording
                  ? "Recording — repeat the sentence you just heard, then tap the button to stop."
                  : "Repeat the sentence you just heard"}
              </div>
              {/* 真考节奏：原句一放完麦克风就自动打开，不等用户点。autoStart 每次进入
                  录音阶段（含 Re-record）都生效；被浏览器拒绝时退回手动点麦 + 提示。 */}
              <VoiceRecorder
                onRecordingComplete={handleRecordingComplete}
                onRecordingStateChange={handleRecordingStateChange}
                onRecordingStart={() => setAutoBlocked(false)}
                onAutoStartBlocked={() => setAutoBlocked(true)}
                autoStart
                maxDuration={30}
              />
              {autoBlocked && !isRecording && (
                <div style={{ marginTop: 12, fontSize: 13, color: "#92400E", lineHeight: 1.5 }}>
                  录音未自动开始，请点击上方按钮手动开始（iOS Safari 需手动授权麦克风）。
                </div>
              )}
              <div style={{ marginTop: 20 }}>
                <button
                  onClick={() => playSentence()}
                  disabled={isRecording}
                  title={isRecording ? "录音中不可重放（避免原句被录进麦克风）" : undefined}
                  style={{
                    background: "none", border: "none",
                    cursor: isRecording ? "not-allowed" : "pointer",
                    fontSize: 13, color: isRecording ? C.t3 : SPK.color, fontWeight: 600, fontFamily: FONT,
                    textDecoration: isRecording ? "none" : "underline",
                    opacity: isRecording ? 0.6 : 1,
                  }}
                >
                  Replay original sentence
                </button>
                {isRecording && (
                  <div style={{ marginTop: 6, fontSize: 11, color: C.t3 }}>
                    录音中不可重放
                  </div>
                )}
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
              <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 6 }}>
                Recorded
              </div>
              {/* 真考里每句答完直接进下一句，不会当场告诉你这句对了多少。逐句准确率 /
                  逐词对照统一放到最后的总结页（scores 照常在后台回填，这里不渲染）。 */}
              <div style={{ fontSize: 13, color: C.t3, marginBottom: 16 }}>
                这句的识别结果不在这里显示，全部录完后在总结页统一查看
              </div>

              <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 24 }}>
                <ReplayButton label="Original" onPlay={() => playOriginalSentence(sentence)} />
                {recordings[current] && (
                  <ReplayButton label="My Recording" blobUrl={recordings[current]} />
                )}
              </div>

              {/* Pro upsell — server returned NOT_PRO */}
              {!scores[current] && transcriptStatus[current] === "failed" && transcriptError[current] === "NOT_PRO" && (
                <div style={{
                  marginBottom: 20, padding: "12px 16px",
                  background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10,
                  fontSize: 13, color: "#92400E", lineHeight: 1.6,
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>🔒 语音识别为 Pro 专属</div>
                  录音已保存，总结页可对照原句自查。升级 Pro 后可解锁自动识别和发音评分。
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

              <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
                <Btn
                  variant="secondary"
                  onClick={() => { cancelTranscribeFor(current); setAutoBlocked(false); setPhase("record"); }}
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

/**
 * 对外的 RepeatTask：只在**有图**时多一层预加载门（底图 + 全部逐句帧先拉完再挂任务组件），
 * 免得用户刚进第一句、图还在路上。没图的套（生成库 / 个人题库 / 无图真题）images 为空，
 * AssetPreloadGate 原样透传 children —— DOM 与改动前逐字一致。
 * 图坏了 / 超时（15s）门也会放行，绝不把人锁在加载页。
 */
export function RepeatTask(props) {
  return (
    <AssetPreloadGate
      images={sceneImagePreloadUrls(props.setInfo)}
      title="Listen & Repeat"
      section="Speaking | Task 1"
      onExit={props.onExit}
    >
      <RepeatTaskInner {...props} />
    </AssetPreloadGate>
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
