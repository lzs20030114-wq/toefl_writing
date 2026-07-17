"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { C, FONT, READING_FONT, Btn, TopBar, SurfaceCard } from "../shared/ui";
import { AudioPlayer } from "../listening/AudioPlayer";
import { ExamAudioProvider, useExamAudio } from "../shared/ExamAudioProvider";
import { sameOriginAudio } from "../../lib/listening/audioSrc";
import { calculateAdaptiveScore, getScoreColor, bandToCEFR } from "../../lib/mockExam/adaptiveScoring";
import { buildReadingModule1, routeModule2 as routeReadingM2, buildReadingModule2 } from "../../lib/mockExam/readingPlanner";
import { buildListeningModule1, routeModule2 as routeListeningM2, buildListeningModule2 } from "../../lib/mockExam/listeningPlanner";
import { finalizeTimedOutResults } from "../../lib/mockExam/timeoutFinalize";
import { saveSess } from "../../lib/sessionStore";
import { saveAdaptiveCheckpoint, loadAdaptiveCheckpoint, clearAdaptiveCheckpoint } from "../../lib/mockExam/adaptiveCheckpoint";
import { getVocabTargetWord, splitForHighlight, VOCAB_HIGHLIGHT_STYLE } from "../../lib/reading/vocabHighlight";
import { fmt } from "../../lib/utils";
import { listeningSecondsForType, LCR_SECONDS_PER_ITEM, TOEFL_LISTENING_SECTION_SECONDS, formatAnswerTime } from "../../lib/listeningTiming";

// ------ Constants ------

// Per-module timers. Real ETS 2026 uses an independent countdown for each
// module (the on-screen clock shows time remaining in the *current* module
// and resets when Module 2 starts), so we model the same shape here.
//   - Reading Module 1 (routing): ~12 min · Module 2 (adaptive): ~10 min
//   - Listening's section pace (29 min) is preserved but split roughly
//     proportional to item counts; the same per-module reset rule applies.
const SECTION_CONFIG = {
  reading: {
    label: "Reading",
    labelZh: "阅读",
    accent: "#3B82F6",
    accentSoft: "#EFF6FF",
    module1TimeSeconds: 12 * 60,
    module2TimeSeconds: 10 * 60,
    buildM1: buildReadingModule1,
    routeM2: routeReadingM2,
    buildM2: buildReadingModule2,
    sessionType: "adaptive-reading",
  },
  listening: {
    label: "Listening",
    labelZh: "听力",
    accent: "#8B5CF6",
    accentSoft: "#F5F3FF",
    // Listening's per-module split isn't published precisely; we approximate
    // it from the 29-min section total, weighted by item count (M1 has 12,
    // M2 has 8). This keeps the section pace unchanged while still resetting
    // the timer between modules to match the real test's on-screen clock.
    module1TimeSeconds: Math.round((TOEFL_LISTENING_SECTION_SECONDS * 12) / 20),
    module2TimeSeconds: Math.round((TOEFL_LISTENING_SECTION_SECONDS * 8) / 20),
    buildM1: buildListeningModule1,
    routeM2: routeListeningM2,
    buildM2: buildListeningModule2,
    sessionType: "adaptive-listening",
  },
};

const BAND_COLORS = {
  green: { bg: "#dcfce7", border: "#22c55e", text: "#15803d", ring: "#22c55e" },
  blue: { bg: "#dbeafe", border: "#3b82f6", text: "#1d4ed8", ring: "#3b82f6" },
  yellow: { bg: "#fef9c3", border: "#eab308", text: "#a16207", ring: "#eab308" },
  orange: { bg: "#ffedd5", border: "#f97316", text: "#c2410c", ring: "#f97316" },
  red: { bg: "#fee2e2", border: "#ef4444", text: "#b91c1c", ring: "#ef4444" },
};

const LEVEL_LABELS = {
  green: "高级",
  blue: "中高级",
  yellow: "中级",
  orange: "初中级",
  red: "初级",
};

// ------ Inline Task Renderers ------

/**
 * CTW Inline — fill-in-the-blanks within a passage.
 * Each blank shows the displayed_fragment + input for the missing letters.
 */
function CTWInlineTask({ item, onComplete, collectorRef, revealAnswers = false }) {
  const [answers, setAnswers] = useState(() => item.blanks.map(() => ""));
  const [submitted, setSubmitted] = useState(false);
  const inputRefs = useRef([]);
  // Mirror the live answers into a ref so the timeout collector reads the
  // latest input without a stale closure (registered once on mount).
  const answersRef = useRef(answers);
  answersRef.current = answers;

  // Register a partial-answer collector for the module timeout. Scoring here
  // mirrors handleSubmit exactly; only userAnswer differs — an unfilled blank
  // reports null (so the review shows "(未填)") instead of the bare fragment.
  useEffect(() => {
    if (!collectorRef) return;
    collectorRef.current = {
      itemId: item.id,
      collect: () => {
        const cur = answersRef.current || [];
        let unanswered = 0;
        const results = item.blanks.map((blank, i) => {
          const input = cur[i] || "";
          const expected = blank.original_word.toLowerCase().replace(/[^a-z]/g, "");
          const fragment = blank.displayed_fragment.toLowerCase();
          const userFull = (fragment + input).toLowerCase().replace(/[^a-z]/g, "");
          const filled = input.length > 0;
          if (!filled) unanswered++;
          return {
            userAnswer: filled ? blank.displayed_fragment + input : null,
            isCorrect: userFull === expected,
          };
        });
        const correct = results.filter((r) => r.isCorrect).length;
        return { itemId: item.id, correct, total: item.blanks.length, results, unanswered };
      },
    };
    return () => { collectorRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function focusBlank(idx) {
    if (idx >= 0 && idx < item.blanks.length && inputRefs.current[idx]) {
      inputRefs.current[idx].focus();
    }
  }

  function handleChange(index, value, missingLen) {
    if (submitted) return;
    const next = [...answers];
    next[index] = value;
    setAnswers(next);
    // Auto-advance once the missing letters are filled (keyboard-only flow). The
    // given prefix is a locked gray chip, so users type only the missing letters.
    if (value.length >= missingLen) {
      focusBlank(index + 1);
    }
  }

  function handleKeyDown(index, e) {
    if (submitted) return;
    if (e.key === "Enter") {
      e.preventDefault();
      focusBlank(index + 1);
    } else if (e.key === "Tab") {
      e.preventDefault();
      focusBlank(e.shiftKey ? index - 1 : index + 1); // Shift+Tab → previous blank
    } else if (e.key === "Backspace" && !e.currentTarget.value) {
      e.preventDefault();
      focusBlank(index - 1);
    }
  }

  function handleSubmit() {
    if (submitted) return;
    setSubmitted(true);
    const results = item.blanks.map((blank, i) => {
      const expected = blank.original_word.toLowerCase().replace(/[^a-z]/g, "");
      const fragment = blank.displayed_fragment.toLowerCase();
      const userInput = answers[i] || "";
      const userFull = (fragment + userInput).toLowerCase().replace(/[^a-z]/g, "");
      return {
        // Full user-typed word (fragment + their input). Captured so the
        // post-exam review can show "you typed: X" alongside the correct word.
        userAnswer: blank.displayed_fragment + userInput,
        isCorrect: userFull === expected,
      };
    });
    const correct = results.filter((r) => r.isCorrect).length;
    setTimeout(() => {
      onComplete({ correct, total: item.blanks.length, results });
    }, 800);
  }

  // Build passage with blanks rendered inline
  const words = item.passage.split(/\s+/);
  let blankIdx = 0;

  const rendered = [];
  for (let wi = 0; wi < words.length; wi++) {
    const blank = blankIdx < item.blanks.length && item.blanks[blankIdx].position === wi ? item.blanks[blankIdx] : null;
    if (blank) {
      const missingLen = blank.original_word.length - blank.displayed_fragment.length;
      const bi = blankIdx;
      const isCorrect = submitted
        ? (blank.displayed_fragment + answers[bi]).toLowerCase().replace(/[^a-z]/g, "") === blank.original_word.toLowerCase().replace(/[^a-z]/g, "")
        : null;
      rendered.push(
        <span key={`b-${bi}`} style={{ display: "inline-flex", alignItems: "baseline", margin: "2px 3px" }}>
          {/* Given prefix — shaded "locked" chip so users don't re-type it. */}
          <span style={{
            fontWeight: 700,
            color: submitted ? (revealAnswers ? (isCorrect ? "#16a34a" : "#dc2626") : C.t1) : "#475569",
            background: submitted ? "transparent" : "#E2E8F0",
            borderRadius: 3,
            padding: submitted ? 0 : "0 2px",
          }}>{blank.displayed_fragment}</span>
          <input
            ref={(el) => (inputRefs.current[bi] = el)}
            type="text"
            value={answers[bi]}
            onChange={(e) => handleChange(bi, e.target.value.slice(0, missingLen), missingLen)}
            onKeyDown={(e) => handleKeyDown(bi, e)}
            disabled={submitted}
            maxLength={missingLen}
            style={{
              width: Math.max(missingLen * 12, 36),
              border: "none",
              borderBottom: `2px solid ${submitted ? (revealAnswers ? (isCorrect ? "#22c55e" : "#ef4444") : "#cbd5e1") : "#94a3b8"}`,
              background: submitted ? (revealAnswers ? (isCorrect ? "#f0fdf4" : "#fef2f2") : "#f1f5f9") : "#f8fafc",
              fontSize: 14,
              fontFamily: READING_FONT,
              padding: "2px 4px",
              outline: "none",
              color: C.t1,
              borderRadius: 0,
            }}
            placeholder={"_".repeat(missingLen)}
          />
          {submitted && revealAnswers && !isCorrect && (
            <span style={{ fontSize: 11, color: "#ef4444", marginLeft: 4 }}>
              {blank.original_word}
            </span>
          )}
        </span>
      );
      blankIdx++;
    } else {
      rendered.push(<span key={`w-${wi}`}> {words[wi]}</span>);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.t3, marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
        Complete the Words
      </div>
      <div style={{ fontSize: 14, lineHeight: 2.0, color: C.t1, marginBottom: 16, fontFamily: READING_FONT }}>{rendered}</div>
      {!submitted && (
        <Btn onClick={handleSubmit} style={{ fontSize: 13 }}>
          提交
        </Btn>
      )}
      {submitted && (
        <div style={{ fontSize: 13, color: C.t2, marginTop: 8 }}>
          已提交，即将进入下一题...
        </div>
      )}
    </div>
  );
}

/**
 * MCQ Inline — generic multiple-choice for RDL, AP, LA, LC, LAT.
 * Shows passage/text, then one question at a time with A/B/C/D buttons.
 */
function MCQInlineTask({ item, taskType, onComplete, collectorRef, revealAnswers = false }) {
  const questions = item.questions || [];
  const isListeningType = taskType === "la" || taskType === "lc" || taskType === "lat";
  const answerSeconds = listeningSecondsForType(taskType);
  const [currentQ, setCurrentQ] = useState(0);
  const [selections, setSelections] = useState(() => questions.map(() => null));
  const [submitted, setSubmitted] = useState(false);
  const [answerTimeLeft, setAnswerTimeLeft] = useState(answerSeconds);
  // Mirror live selections so the timeout collector isn't stuck on a stale closure.
  const selectionsRef = useRef(selections);
  selectionsRef.current = selections;

  // Register a partial-answer collector for the module timeout — same scoring
  // as handleSubmit, with unanswered = count of questions still unselected.
  useEffect(() => {
    if (!collectorRef) return;
    collectorRef.current = {
      itemId: item.id,
      collect: () => {
        const cur = selectionsRef.current || [];
        const correctAnswer = (q) => q.correct_answer || q.answer;
        let unanswered = 0;
        const results = questions.map((q, i) => {
          const sel = cur[i] ?? null;
          if (sel == null) unanswered++;
          return { selected: sel, correct: correctAnswer(q), isCorrect: sel === correctAnswer(q) };
        });
        const correct = results.filter((r) => r.isCorrect).length;
        return { itemId: item.id, correct, total: questions.length, results, unanswered };
      },
    };
    return () => { collectorRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Listening tasks play their audio first; the answer timer must not start
  // until playback ends (real TOEFL runs the clock only while you answer, never
  // during audio). Reading tasks have no audio, so they begin answering at once.
  const [phase, setPhase] = useState(isListeningType ? "listen" : "answer");

  const question = questions[currentQ];

  const handleAudioEnded = useCallback(() => {
    setPhase((p) => (p === "listen" ? "answer" : p));
  }, []);

  // Get the text content to display
  function getPassageContent() {
    if (taskType === "rdl") return item.text || "";
    if (taskType === "ap") return item.passage || "";
    return null; // listening types show audio instead
  }

  // Get the question stem
  function getStem(q) {
    return q.stem || q.question || "";
  }

  function handleSelect(key) {
    if (submitted) return;
    const next = [...selections];
    next[currentQ] = key;
    setSelections(next);
  }

  function handleNext() {
    if (currentQ < questions.length - 1) {
      setCurrentQ(currentQ + 1);
    }
  }

  function handlePrev() {
    if (currentQ > 0) {
      setCurrentQ(currentQ - 1);
    }
  }

  const handleSubmit = useCallback((overrideSelections = selections) => {
    setSubmitted(true);
    const correctAnswer = (q) => q.correct_answer || q.answer;
    const results = questions.map((q, i) => ({
      selected: overrideSelections[i],
      correct: correctAnswer(q),
      isCorrect: overrideSelections[i] === correctAnswer(q),
    }));
    const correct = results.filter((r) => r.isCorrect).length;
    setTimeout(() => {
      onComplete({ correct, total: questions.length, results });
    }, 1200);
  }, [onComplete, questions, selections]);

  // Answer timer — only runs in the answer phase, i.e. after the audio has
  // finished for listening tasks. Resets for each question.
  useEffect(() => {
    if (!isListeningType || submitted || phase !== "answer") return;
    setAnswerTimeLeft(answerSeconds);
    const timer = setInterval(() => {
      setAnswerTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [answerSeconds, currentQ, isListeningType, submitted, phase]);

  useEffect(() => {
    if (!isListeningType || submitted || phase !== "answer" || answerTimeLeft !== 0) return;
    if (currentQ < questions.length - 1) {
      setCurrentQ((idx) => Math.min(questions.length - 1, idx + 1));
      return;
    }
    handleSubmit(selections);
  }, [answerTimeLeft, currentQ, handleSubmit, isListeningType, phase, questions.length, selections, submitted]);

  if (!question) return null;

  const passage = getPassageContent();
  // Highlight the target word in the passage when the current question is a
  // vocabulary-in-context item (null otherwise → no highlight).
  const vocabWord = getVocabTargetWord(question);
  const answeredAll = selections.every((s) => s !== null);
  const correctAnswer = (q) => q.correct_answer || q.answer;

  // Task label (shared)
  const taskLabel = (
    <div style={{ fontSize: 12, fontWeight: 700, color: C.t3, marginBottom: 10, letterSpacing: 0.5, textTransform: "uppercase" }}>
      {taskType === "rdl" && "Read in Daily Life"}
      {taskType === "ap" && "Academic Passage"}
      {taskType === "la" && "Announcement"}
      {taskType === "lc" && "Conversation"}
      {taskType === "lat" && "Academic Talk"}
    </div>
  );

  // Question stem + options + navigation (shared by both layouts)
  const questionUI = (
    <>
      {isListeningType && (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "4px 10px", borderRadius: 999, marginBottom: 10,
          background: answerTimeLeft <= 10 ? "#fee2e2" : "#f5f3ff",
          border: `1px solid ${answerTimeLeft <= 10 ? "#fecaca" : "#ddd6fe"}`,
          color: answerTimeLeft <= 10 ? "#b91c1c" : "#6d28d9",
          fontSize: 12, fontWeight: 800,
          fontFamily: "Consolas, Menlo, 'Courier New', monospace",
        }}>
          Time left {formatAnswerTime(answerTimeLeft)}
        </div>
      )}
      <div style={{ fontSize: 12, color: C.t3, marginBottom: 6 }}>
        Question {currentQ + 1} of {questions.length}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.t1, lineHeight: 1.5, marginBottom: 14, fontFamily: READING_FONT }}>
        {getStem(question)}
      </div>

      {/* Options */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {["A", "B", "C", "D"].map((key) => {
          if (!question.options[key]) return null;
          const isSelected = selections[currentQ] === key;
          const reveal = submitted && revealAnswers;
          const isCorrectKey = reveal && key === correctAnswer(question);
          const isWrongSelection = reveal && isSelected && key !== correctAnswer(question);

          let borderColor = C.bdr;
          let bg = "#fff";
          if (reveal) {
            if (isCorrectKey) { borderColor = "#22c55e"; bg = "#f0fdf4"; }
            else if (isWrongSelection) { borderColor = "#ef4444"; bg = "#fef2f2"; }
          } else if (isSelected) {
            borderColor = SECTION_CONFIG.reading.accent;
            bg = "#eff6ff";
          }

          return (
            <button
              key={key}
              onClick={() => handleSelect(key)}
              disabled={submitted}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "10px 14px",
                background: bg,
                border: `2px solid ${borderColor}`,
                borderRadius: 10,
                cursor: submitted ? "default" : "pointer",
                textAlign: "left",
                fontFamily: READING_FONT,
                fontSize: 13,
                color: C.t1,
                lineHeight: 1.5,
                transition: "all 120ms ease",
              }}
            >
              <span style={{
                width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700,
                background: isSelected ? (reveal ? (isWrongSelection ? "#fee2e2" : "#dcfce7") : "#dbeafe") : "#f1f5f9",
                color: isSelected ? (reveal ? (isWrongSelection ? "#ef4444" : "#22c55e") : "#3b82f6") : C.t3,
              }}>
                {key}
              </span>
              <span>{question.options[key]}</span>
            </button>
          );
        })}
      </div>

      {/* Navigation */}
      {!submitted && (
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {currentQ > 0 && !isListeningType && (
            <Btn onClick={handlePrev} variant="secondary" style={{ fontSize: 13 }}>
              上一题
            </Btn>
          )}
          {currentQ < questions.length - 1 && (
            <Btn onClick={handleNext} variant="secondary" style={{ fontSize: 13 }}>
              下一题
            </Btn>
          )}
          {/* Submit: reading shows it once everything is answered; a listening
              task can finish early from its last question (the countdown is only
              an upper bound — 可以提前跳过, no need to wait it out). */}
          {(answeredAll || (isListeningType && currentQ === questions.length - 1)) && (
            <Btn onClick={() => handleSubmit()} style={{ fontSize: 13 }}>
              提交
            </Btn>
          )}
        </div>
      )}
      {submitted && (
        <div style={{ fontSize: 13, color: C.t2, marginTop: 8 }}>
          已提交，即将进入下一题...
        </div>
      )}
    </>
  );

  // ── Reading types (RDL / AP): real-exam two-column layout (passage | question) ──
  if (passage) {
    return (
      <div>
        {taskLabel}
        <div
          className="tp-reading-split"
          style={{
            display: "flex",
            alignItems: "stretch",
            height: "calc(100vh - 270px)",
            minHeight: 340,
          }}
        >
          {/* LEFT — passage (scrolls independently) */}
          <div className="tp-reading-left" style={{ flex: 1, minWidth: 0, overflowY: "auto", paddingRight: 22, borderRight: `1px solid ${C.bdr}` }}>
            <div style={{ fontSize: 14, lineHeight: 1.8, color: C.t1, whiteSpace: "pre-wrap", fontFamily: READING_FONT }}>
              {vocabWord
                ? splitForHighlight(passage, vocabWord).map((seg, i) =>
                    seg.hit
                      ? <mark key={i} style={VOCAB_HIGHLIGHT_STYLE}>{seg.text}</mark>
                      : <React.Fragment key={i}>{seg.text}</React.Fragment>
                  )
                : passage}
            </div>
          </div>
          {/* RIGHT — question (scrolls independently) */}
          <div className="tp-reading-right" style={{ flex: 1, minWidth: 0, overflowY: "auto", paddingLeft: 22 }}>
            {questionUI}
          </div>
        </div>
      </div>
    );
  }

  // ── Listening types (audio) / no passage: single-column ──
  // The audio plays first (autoPlay); the questions + answer timer only appear
  // once playback ends, so the clock never runs while the audio is playing.
  return (
    <div>
      {taskLabel}
      {isListeningType && (
        <div style={{ marginBottom: 16 }}>
          <AudioPlayer
            src={item.audio_url || null}
            text={
              item.announcement ||
              item.lecture ||
              item.transcript ||
              (item.conversation ? item.conversation.map((t) => `${t.speaker}: ${t.text}`).join(". ") : "")
            }
            onEnded={handleAudioEnded}
            maxReplays={0}
            autoPlay
            taskType={taskType}
            itemId={item.id}
          />
        </div>
      )}
      {isListeningType && phase === "listen" ? (
        <div style={{ textAlign: "center", padding: "8px 20px 12px" }}>
          <div style={{ fontSize: 13, color: C.t3, marginBottom: 14, lineHeight: 1.6 }}>
            音频会自动播放；如果没有声音，请点击上方的播放按钮。
          </div>
          <Btn onClick={() => setPhase("answer")} variant="secondary" style={{ fontSize: 13 }}>
            开始答题
          </Btn>
        </div>
      ) : (
        questionUI
      )}
    </div>
  );
}

/**
 * LCR Inline — listen and choose a response (single question per item).
 */
function LCRInlineTask({ item, onComplete, collectorRef, revealAnswers = false }) {
  const [phase, setPhase] = useState("listen");
  const [selected, setSelected] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [answerTimeLeft, setAnswerTimeLeft] = useState(LCR_SECONDS_PER_ITEM);
  // Mirror the live selection so the timeout collector reads the latest value.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Register a partial-answer collector for the module timeout.
  useEffect(() => {
    if (!collectorRef) return;
    collectorRef.current = {
      itemId: item.id,
      collect: () => {
        const sel = selectedRef.current ?? null;
        const isCorrect = sel === item.answer;
        return {
          itemId: item.id,
          correct: isCorrect ? 1 : 0,
          total: 1,
          results: [{ selected: sel, correct: item.answer, isCorrect }],
          unanswered: sel == null ? 1 : 0,
        };
      },
    };
    return () => { collectorRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleAudioEnded() {
    setPhase("choose");
  }

  function handleSelect(key) {
    if (submitted || phase !== "choose") return;
    setSelected(key);
  }

  const completeAnswer = useCallback((answerValue) => {
    if (submitted) return;
    setSubmitted(true);
    const isCorrect = answerValue === item.answer;
    setTimeout(() => {
      onComplete({ correct: isCorrect ? 1 : 0, total: 1, results: [{ selected: answerValue || null, correct: item.answer, isCorrect }] });
    }, 800);
  }, [item.answer, onComplete, submitted]);

  function handleSubmit() {
    if (!selected || submitted) return;
    completeAnswer(selected);
  }

  useEffect(() => {
    if (phase !== "choose" || submitted) return;
    setAnswerTimeLeft(LCR_SECONDS_PER_ITEM);
    const timer = setInterval(() => {
      setAnswerTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, submitted]);

  useEffect(() => {
    if (phase !== "choose" || submitted || answerTimeLeft !== 0) return;
    completeAnswer(selected);
  }, [answerTimeLeft, completeAnswer, phase, selected, submitted]);

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.t3, marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
        Choose a Response
      </div>

      {/* Audio */}
      <div style={{ marginBottom: 16 }}>
        <AudioPlayer
          src={item.audio_url || null}
          text={item.speaker || ""}
          onEnded={handleAudioEnded}
          maxReplays={0}
          autoPlay
          taskType="lcr"
          itemId={item.id}
        />
      </div>

      {phase === "listen" && (
        <div style={{ textAlign: "center", padding: "8px 20px 12px" }}>
          <div style={{ fontSize: 13, color: C.t3, marginBottom: 14, lineHeight: 1.6 }}>
            音频会自动播放；如果没有声音，请点击上方的播放按钮。
          </div>
          <Btn onClick={() => setPhase("choose")} variant="secondary" style={{ fontSize: 13 }}>
            开始答题
          </Btn>
        </div>
      )}

      {phase === "choose" && (
        <>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "4px 10px", borderRadius: 999, marginBottom: 10,
            background: answerTimeLeft <= 10 ? "#fee2e2" : "#f5f3ff",
            border: `1px solid ${answerTimeLeft <= 10 ? "#fecaca" : "#ddd6fe"}`,
            color: answerTimeLeft <= 10 ? "#b91c1c" : "#6d28d9",
            fontSize: 12, fontWeight: 800,
            fontFamily: "Consolas, Menlo, 'Courier New', monospace",
          }}>
            Time left {formatAnswerTime(answerTimeLeft)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {["A", "B", "C", "D"].map((key) => {
              if (!item.options[key]) return null;
              const isSelected = selected === key;
              const reveal = submitted && revealAnswers;
              const isCorrectKey = reveal && key === item.answer;
              const isWrongSelection = reveal && isSelected && key !== item.answer;

              let borderColor = C.bdr;
              let bg = "#fff";
              if (reveal) {
                if (isCorrectKey) { borderColor = "#22c55e"; bg = "#f0fdf4"; }
                else if (isWrongSelection) { borderColor = "#ef4444"; bg = "#fef2f2"; }
              } else if (isSelected) {
                borderColor = "#8B5CF6";
                bg = "#f5f3ff";
              }

              return (
                <button
                  key={key}
                  onClick={() => handleSelect(key)}
                  disabled={submitted}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "10px 14px", background: bg,
                    border: `2px solid ${borderColor}`, borderRadius: 10,
                    cursor: submitted ? "default" : "pointer",
                    textAlign: "left", fontFamily: FONT, fontSize: 13,
                    color: C.t1, lineHeight: 1.5, transition: "all 120ms ease",
                  }}
                >
                  <span style={{
                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700,
                    background: isSelected ? (reveal ? (isWrongSelection ? "#fee2e2" : "#dcfce7") : "#ede9fe") : "#f1f5f9",
                    color: isSelected ? (reveal ? (isWrongSelection ? "#ef4444" : "#22c55e") : "#8B5CF6") : C.t3,
                  }}>
                    {key}
                  </span>
                  <span>{item.options[key]}</span>
                </button>
              );
            })}
          </div>

          {!submitted && selected && (
            <Btn onClick={handleSubmit} style={{ fontSize: 13 }}>确认</Btn>
          )}
          {submitted && (
            <div style={{ fontSize: 13, color: C.t2, marginTop: 8 }}>
              已提交，即将进入下一题...
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Routes to the correct inline renderer based on taskType.
 */
function AdaptiveTaskRenderer({ item, onComplete, accent, collectorRef }) {
  if (!item) return null;

  if (item.taskType === "ctw") {
    return <CTWInlineTask item={item} onComplete={onComplete} collectorRef={collectorRef} />;
  }
  if (item.taskType === "lcr") {
    return <LCRInlineTask item={item} onComplete={onComplete} collectorRef={collectorRef} />;
  }
  // RDL, AP, LA, LC, LAT all use MCQ
  return <MCQInlineTask item={item} taskType={item.taskType} onComplete={onComplete} collectorRef={collectorRef} />;
}

// ------ Helper: aggregate module results ------
// (Per-item scorable counting now lives in lib/mockExam/timeoutFinalize.js so
// the timeout scoring invariant can be unit-tested without the DOM.)

function sumCorrectFromResults(results) {
  let total = 0;
  for (const r of results) {
    total += r.correct || 0;
  }
  return total;
}

function sumTotalFromResults(results) {
  let total = 0;
  for (const r of results) {
    total += r.total || 0;
  }
  return total;
}

// Convert in-memory results into a serializable per-task snapshot that
// preserves enough context for the post-exam review (passage, questions,
// blanks, user answers). Strips anything large/transient (e.g. audio_url
// stays — they're short URLs/text references, not blobs).
function buildTaskSnapshots(results) {
  return results.map((r) => {
    const item = r?.item || {};
    // Common fields per task type:
    //   ctw: passage + blanks[]
    //   rdl: text + questions[]
    //   ap:  passage + paragraphs[] + questions[]
    //   lcr: audio_url/speaker + options + answer (single question per item)
    //   la/lc/lat: audio_url + text/announcement/lecture/conversation + questions[]
    return {
      taskType: item.taskType || null,
      itemId: item.id || null,
      topic: item.topic || item.subtopic || null,
      difficulty: item.difficulty || null,
      passage: item.passage || null,
      text: item.text || null,
      paragraphs: item.paragraphs || null,
      blanks: item.blanks || null,
      questions: item.questions || null,
      // For LCR (single-question listen-and-choose)
      options: item.options || null,
      answer: item.answer || null,
      explanation: item.explanation || null,
      // Audio refs (URLs / text fallback for TTS) — keep so listening review
      // can re-play. Strings only, no blobs.
      audio_url: item.audio_url || null,
      speaker: item.speaker || null,
      announcement: item.announcement || null,
      lecture: item.lecture || null,
      transcript: item.transcript || null,
      conversation: item.conversation || null,
      // Performance
      correct: r.correct ?? 0,
      total: r.total ?? 0,
      results: Array.isArray(r.results) ? r.results : [],
      // Timeout provenance — flags tasks the student never submitted (auto-
      // scored as wrong) so the review can badge them + count未作答 questions.
      timedOut: !!r.timedOut,
      unanswered: r.unanswered || 0,
    };
  });
}

// ------ Main Shell ------

/**
 * Outer export: mounts the ExamAudioProvider around the real shell so the
 * persistent exam audio element (and its one-time gesture unlock) survives
 * intro→module1→routing→module2→results without ever unmounting. Reading
 * exams don't play audio — the Provider is inert there (no side effects).
 */
export function AdaptiveExamShell(props) {
  return (
    <ExamAudioProvider>
      <AdaptiveExamShellInner {...props} />
    </ExamAudioProvider>
  );
}

function AdaptiveExamShellInner({ section = "reading", onExit }) {
  const invalidSection = !SECTION_CONFIG[section];
  const config = SECTION_CONFIG[section] || SECTION_CONFIG.reading;

  const [phase, setPhase] = useState("intro");
  const [m1Items, setM1Items] = useState(null);
  const [m2Items, setM2Items] = useState(null);
  const [m1Results, setM1Results] = useState([]);
  const [m2Results, setM2Results] = useState([]);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [routePath, setRoutePath] = useState(null);
  const [finalScore, setFinalScore] = useState(null);
  const [usedIds, setUsedIds] = useState(new Set());
  const [error, setError] = useState(null);
  // ISO date this exam was saved under — used as the session's identity so the
  // results screen deep-links into THIS exact record, not just "the latest mock"
  // (which would surface a previous exam if this save silently failed to sync).
  const [savedSessionDate, setSavedSessionDate] = useState(null);

  // Resume support: load any in-progress checkpoint for this section once, so
  // the intro can offer "continue where you left off". Restored on demand via
  // handleResume (not auto-applied, so the user can also choose a fresh start).
  const [resumed] = useState(() => loadAdaptiveCheckpoint(section));

  // Persistent exam audio (listening): unlocked once inside the start/resume
  // click, then reused for every clip. Null when the Provider's kill switch
  // is on — everything below degrades to the legacy per-element behavior.
  const examAudio = useExamAudio();
  const examController = examAudio ? examAudio.controller : null;
  // Mirror holdTimers into a ref so the countdown interval (rebuilt only on
  // phase changes) can read it without being torn down on every audio event.
  const holdTimersRef = useRef(false);
  holdTimersRef.current = !!(examAudio && examAudio.holdTimers);

  // Timer — each module has its own countdown. Real ETS resets the on-screen
  // clock when you enter Module 2, so the autoFinished ref is also keyed on
  // phase so a Module 1 timeout doesn't suppress the Module 2 timeout.
  const [timeLeft, setTimeLeft] = useState(config.module1TimeSeconds);
  const timerRef = useRef(null);
  const autoFinishedRef = useRef(false);
  // Points at the currently-mounted task's partial-answer collector (see the
  // inline task components). Read at timeout to score the in-progress task.
  const partialCollectorRef = useRef(null);
  // Latest timeLeft for the checkpoint, read without making the save-effect a
  // per-second writer (we checkpoint on progress milestones, not every tick).
  const timeLeftRef = useRef(timeLeft);
  useEffect(() => { timeLeftRef.current = timeLeft; }, [timeLeft]);

  // Checkpoint in-progress exam state on every progress change (item answered,
  // module switch, route decided) so an exit mid-exam can be resumed. timeLeft
  // is snapshotted from the ref so this doesn't fire each second.
  useEffect(() => {
    if (phase !== "module1" && phase !== "module2") return;
    const items = phase === "module1" ? m1Items : m2Items;
    const moduleResults = phase === "module1" ? m1Results : m2Results;
    // Skip the transient "module fully answered" state (just before the phase
    // advances to routing/results) so every saved checkpoint keeps
    // currentItemIndex === results.length — i.e. resume lands on the next
    // unanswered item and never re-scores the last one.
    if (!Array.isArray(items) || (Array.isArray(moduleResults) && moduleResults.length >= items.length)) return;
    saveAdaptiveCheckpoint(section, {
      phase, m1Items, m2Items, m1Results, m2Results,
      currentItemIndex, routePath, timeLeft: timeLeftRef.current,
      usedIds: Array.from(usedIds),
    });
  }, [section, phase, m1Items, m2Items, m1Results, m2Results, currentItemIndex, routePath, usedIds]);

  // Start timer when exam begins
  useEffect(() => {
    if (phase !== "module1" && phase !== "module2") {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      // Freeze the countdown while exam audio is blocked/buffering (overlay
      // up, nothing audible) — the student shouldn't bleed time to a browser
      // pause. No-op when there's no exam audio provider (reading).
      if (holdTimersRef.current) return;
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase]);

  // Auto-finish on timeout. Unlike a normal finish, we don't discard the
  // in-progress + not-yet-reached tasks: finalizeTimedOutResults folds in the
  // current task's partially-selected answers and marks every remaining
  // question wrong, so each module's scored total always equals its planned
  // total (未作答 = 错, matching real ETS). setM*Results must run first because
  // handleM2Complete reads m1Results from state when it settles the band.
  useEffect(() => {
    if (timeLeft === 0 && !autoFinishedRef.current && (phase === "module1" || phase === "module2")) {
      autoFinishedRef.current = true;
      const items = phase === "module1" ? m1Items : m2Items;
      const existing = phase === "module1" ? m1Results : m2Results;
      const collect = partialCollectorRef.current && partialCollectorRef.current.collect;
      const finalResults = finalizeTimedOutResults(items || [], existing, collect);
      if (phase === "module1") {
        setM1Results(finalResults);
        handleM1Complete(finalResults);
      } else {
        setM2Results(finalResults);
        handleM2Complete(finalResults);
      }
    }
  }, [timeLeft, phase]);

  const currentItems = phase === "module1" ? m1Items : phase === "module2" ? m2Items : null;
  const currentItem = currentItems ? currentItems[currentItemIndex] : null;

  // Warm the next clip (same module only) as soon as the current one ends —
  // the shared element is idle between questions, so preloading there makes
  // the next question's audio start instantly on slow mobile networks.
  const preloadStateRef = useRef({ items: null, index: 0 });
  preloadStateRef.current = { items: currentItems, index: currentItemIndex };
  useEffect(() => {
    if (!examController) return undefined;
    const unsub = examController.subscribe((event) => {
      if (event.type !== "ended") return;
      const { items, index } = preloadStateRef.current;
      const next = Array.isArray(items) ? items[index + 1] : null;
      if (next && next.audio_url) examController.preload(sameOriginAudio(next.audio_url));
    });
    return unsub;
  }, [examController]);

  const totalItemsInCurrentModule = currentItems ? currentItems.length : 0;

  // Reading passage tasks (RDL / AP) render as a wide two-column layout
  // (passage | question) to match the real exam. CTW (fill-in-the-blanks) and
  // every listening task stay single-column.
  const isWideReading = (phase === "module1" || phase === "module2") && !!currentItem && (currentItem.taskType === "rdl" || currentItem.taskType === "ap");

  // ------ Phase transitions ------

  function handleStartExam() {
    // Unlock the shared exam audio element synchronously inside this click —
    // the one real user gesture WebKit will honor for the whole exam.
    if (examController) examController.unlock();
    try {
      clearAdaptiveCheckpoint(section); // fresh start — drop any stale checkpoint
      const m1 = config.buildM1();
      if (!m1.items || m1.items.length === 0) {
        setError("题库数据不足，无法开始考试。请稍后再试。");
        return;
      }
      setM1Items(m1.items);
      setUsedIds(m1.usedIds);
      setCurrentItemIndex(0);
      setM1Results([]);
      setM2Results([]);
      setTimeLeft(config.module1TimeSeconds);
      autoFinishedRef.current = false;
      setPhase("module1");
    } catch (e) {
      setError("初始化考试失败: " + (e.message || "unknown error"));
    }
  }

  // Resume an in-progress exam from the saved checkpoint (offered on the intro).
  function handleResume() {
    if (!resumed) return;
    // Same in-gesture unlock as handleStartExam (resume is also a real click).
    if (examController) examController.unlock();
    try {
      setM1Items(resumed.m1Items || null);
      setM2Items(resumed.m2Items || null);
      setM1Results(Array.isArray(resumed.m1Results) ? resumed.m1Results : []);
      setM2Results(Array.isArray(resumed.m2Results) ? resumed.m2Results : []);
      setCurrentItemIndex(Number.isFinite(resumed.currentItemIndex) ? resumed.currentItemIndex : 0);
      setRoutePath(resumed.routePath || null);
      setUsedIds(new Set(Array.isArray(resumed.usedIds) ? resumed.usedIds : []));
      setTimeLeft(Number.isFinite(resumed.timeLeft) ? resumed.timeLeft : config.module1TimeSeconds);
      autoFinishedRef.current = false;
      setPhase(resumed.phase === "module2" ? "module2" : "module1");
    } catch {
      clearAdaptiveCheckpoint(section);
      setError("无法恢复上次模考进度，请重新开始。");
    }
  }

  function handleItemComplete(result) {
    // Timeout guard: a task's onComplete is fired from an 800/1200ms setTimeout
    // (submit animation). If the module already timed out, that delayed callback
    // still holds a stale closure — accepting it would double-append a result
    // and re-run handleM2Complete (a duplicate saveSess → duplicate history).
    // autoFinishedRef is reset to false on start/resume/entering M2, so the
    // normal (non-timeout) flow is unaffected.
    if (autoFinishedRef.current) return;
    // Attach the item to the result so the post-exam review can render the
    // original passage/questions alongside the user's answers. Without this,
    // results are just aggregated correctness — no way to show the test back.
    const enriched = { ...result, item: currentItem };
    if (phase === "module1") {
      const next = [...m1Results, enriched];
      setM1Results(next);
      const nextIndex = currentItemIndex + 1;
      if (nextIndex >= m1Items.length) {
        // M1 done
        handleM1Complete(next);
      } else {
        setCurrentItemIndex(nextIndex);
      }
    } else if (phase === "module2") {
      const next = [...m2Results, enriched];
      setM2Results(next);
      const nextIndex = currentItemIndex + 1;
      if (nextIndex >= m2Items.length) {
        // M2 done
        handleM2Complete(next);
      } else {
        setCurrentItemIndex(nextIndex);
      }
    }
  }

  function handleM1Complete(resultsOverride) {
    const results = resultsOverride || m1Results;
    const m1Correct = sumCorrectFromResults(results);
    const m1Total = sumTotalFromResults(results);
    const accuracy = m1Total > 0 ? m1Correct / m1Total : 0;
    const path = config.routeM2(accuracy);
    setRoutePath(path);
    setPhase("routing");

    // Build M2 after animation delay
    setTimeout(() => {
      try {
        const m2 = config.buildM2(path, usedIds);
        if (!m2.items || m2.items.length === 0) {
          setError("题库数据不足，无法构建 Module 2。");
          return;
        }
        setM2Items(m2.items);
        setUsedIds(m2.usedIds);
        setCurrentItemIndex(0);
        // Reset the timer for Module 2 — real ETS gives a fresh countdown
        // for each module, and we need to clear autoFinishedRef so the M2
        // timeout effect re-arms after the M1 one fired.
        setTimeLeft(config.module2TimeSeconds);
        autoFinishedRef.current = false;
        setPhase("module2");
      } catch (e) {
        setError("构建 Module 2 失败: " + (e.message || "unknown error"));
      }
    }, 2500);
  }

  function handleM2Complete(resultsOverride) {
    const m1Res = m1Results;
    const m2Res = resultsOverride || m2Results;
    const m1Correct = sumCorrectFromResults(m1Res);
    const m1Total = sumTotalFromResults(m1Res);
    const m2Correct = sumCorrectFromResults(m2Res);
    const m2Total = sumTotalFromResults(m2Res);
    const score = calculateAdaptiveScore(m1Correct, m1Total, m2Correct, m2Total, routePath);
    setFinalScore(score);

    // Stamp this exam's save identity once, reused for both the saved record's
    // `date` and the results-screen deep link, so the two always agree.
    const sessionDate = new Date().toISOString();
    setSavedSessionDate(sessionDate);

    // Save to history. Use the canonical section type ("reading"/"listening")
    // with details.subtype="mock" so ReadingProgressView / ListeningProgressView
    // pick these up alongside practice records. The old "adaptive-{section}"
    // type was never consumed by any view — regression introduced in 842cd85.
    //
    // Each module's `tasks` array is a per-item snapshot (taskType, item id,
    // passage/questions/blanks, user results) so the post-exam review can
    // render the original test back with right/wrong + AI explanations,
    // without having to re-query the question bank by id (which could shift).
    try {
      saveSess({
        type: section,
        mode: "mock",
        date: sessionDate,
        correct: m1Correct + m2Correct,
        total: m1Total + m2Total,
        band: score.band,
        details: {
          subtype: "mock",
          path: routePath,
          band: score.band,
          cefr: score.cefr,
          m1: {
            correct: m1Correct,
            total: m1Total,
            accuracy: score.m1Accuracy,
            tasks: buildTaskSnapshots(m1Res),
          },
          m2: {
            correct: m2Correct,
            total: m2Total,
            accuracy: score.m2Accuracy,
            tasks: buildTaskSnapshots(m2Res),
          },
          rawScore: score.rawScore,
        },
      });
    } catch {}

    clearAdaptiveCheckpoint(section); // exam finished — checkpoint no longer needed
    setPhase("results");
  }

  function handleRestart() {
    clearAdaptiveCheckpoint(section);
    setPhase("intro");
    setM1Items(null);
    setM2Items(null);
    setM1Results([]);
    setM2Results([]);
    setCurrentItemIndex(0);
    setRoutePath(null);
    setFinalScore(null);
    setSavedSessionDate(null);
    setUsedIds(new Set());
    setError(null);
    autoFinishedRef.current = false;
  }

  // ------ Render ------

  if (invalidSection) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
        <div>Unknown section: {section}</div>
      </div>
    );
  }

  const accent = config.accent;
  const accentSoft = config.accentSoft;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      {/* Top bar */}
      <TopBar
        title={
          phase === "module1" ? `Module 1 · 路由阶段` :
          phase === "module2" ? `Module 2 · ${routePath === "upper" ? "Upper" : "Lower"}` :
          phase === "routing" ? "正在调整难度..." :
          phase === "results" ? "考试结果" :
          `${config.labelZh}自适应模考`
        }
        section={`${config.label} | 模考模式`}
        timeLeft={(phase === "module1" || phase === "module2") ? timeLeft : undefined}
        qInfo={
          (phase === "module1" || phase === "module2")
            ? `${currentItemIndex + 1} / ${totalItemsInCurrentModule}`
            : undefined
        }
        onExit={onExit}
      />

      <div className="tp-reading-exam-wrap" style={{ maxWidth: isWideReading ? 1180 : 800, margin: "24px auto", padding: "0 20px", transition: "max-width 200ms ease" }}>
        {/* Error state */}
        {error && (
          <SurfaceCard style={{ padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>&#9888;&#65039;</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 8 }}>{error}</div>
            <Btn onClick={handleRestart} variant="secondary">返回</Btn>
          </SurfaceCard>
        )}

        {/* Intro Phase */}
        {phase === "intro" && !error && (
          <IntroCard
            config={config}
            accent={accent}
            accentSoft={accentSoft}
            onStart={handleStartExam}
            onResume={handleResume}
            hasResume={!!resumed}
            onExit={onExit}
          />
        )}

        {/* Module 1 & 2 — task rendering */}
        {(phase === "module1" || phase === "module2") && currentItem && !error && (
          <SurfaceCard style={{ padding: "20px 24px" }}>
            {/* Module badge */}
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: accentSoft, border: `1px solid ${accent}30`,
              borderRadius: 999, padding: "4px 12px", marginBottom: 16,
              fontSize: 11, fontWeight: 700, color: accent,
            }}>
              {phase === "module1" ? "Module 1 · Routing" : `Module 2 · ${routePath === "upper" ? "Upper" : "Lower"}`}
            </div>

            <AdaptiveTaskRenderer
              key={`${phase}-${currentItemIndex}`}
              item={currentItem}
              onComplete={handleItemComplete}
              accent={accent}
              collectorRef={partialCollectorRef}
            />
          </SurfaceCard>
        )}

        {/* Routing Phase — animated transition */}
        {phase === "routing" && !error && (
          <RoutingTransition path={routePath} accent={accent} accentSoft={accentSoft} />
        )}

        {/* Results Phase */}
        {phase === "results" && finalScore && !error && (
          <ResultsCard
            score={finalScore}
            m1Results={m1Results}
            m2Results={m2Results}
            config={config}
            section={section}
            sessionDate={savedSessionDate}
            onRestart={handleRestart}
            onExit={onExit}
          />
        )}
      </div>
    </div>
  );
}

// ------ Sub-components ------

function IntroCard({ config, accent, accentSoft, onStart, onResume, hasResume, onExit }) {
  const isReading = config.label === "Reading";
  // Reading: Module 1 = 20 scored questions, Module 2 = 30. Upper/Lower share
  // the SAME structure (只题目难度不同), so reading shows one Module 2 box.
  // Listening's Upper/Lower composition genuinely differs (LAT only on Upper;
  // 2×LA on Lower), so listening keeps its two separate boxes.
  const m1Count = isReading ? "20 题 (CTW 10空 + RDL 5题 + AP 5题)" : "12 项 (10 LCR + 1 LA + 1 LC)";
  const m2ReadingCount = "30 题 (CTW 20空 + RDL 5题 + AP 5题)";
  const m2UpperCount = "8 项 (5 LCR + 1 LA + 1 LC + 1 LAT)";
  const m2LowerCount = "8 项 (5 LCR + 2 LA + 1 LC)";
  const m1Time = Math.round(config.module1TimeSeconds / 60);
  const m2Time = Math.round(config.module2TimeSeconds / 60);
  const totalTime = m1Time + m2Time;

  return (
    <SurfaceCard style={{ padding: "32px 28px", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{isReading ? "\u{1F4D6}" : "\u{1F3A7}"}</div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: C.t1, marginBottom: 8 }}>
        {config.labelZh}自适应模考
      </h2>
      <p style={{ fontSize: 14, color: C.t2, lineHeight: 1.7, marginBottom: 20, maxWidth: 500, margin: "0 auto 20px" }}>
        模拟 TOEFL 2026 自适应考试流程。Module 1 决定你的路径，
        Module 2 根据表现调整难度。
      </p>

      {/* Info grid */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
        marginBottom: 24, maxWidth: 420, margin: "0 auto 24px",
      }}>
        <InfoBox
          label="Module 1 时间"
          value={`${m1Time} 分钟`}
          accent={accent}
          accentSoft={accentSoft}
        />
        <InfoBox
          label="Module 2 时间"
          value={`${m2Time} 分钟`}
          accent={accent}
          accentSoft={accentSoft}
        />
        <InfoBox label="Module 1 题量" value={m1Count} accent={accent} accentSoft={accentSoft} />
        {isReading ? (
          <InfoBox label="Module 2 题量" value={m2ReadingCount} accent={accent} accentSoft={accentSoft} />
        ) : (
          <>
            <InfoBox label="M2 Upper" value={m2UpperCount} accent={accent} accentSoft={accentSoft} />
            <InfoBox label="M2 Lower" value={m2LowerCount} accent={accent} accentSoft={accentSoft} />
          </>
        )}
        <InfoBox
          label="总计"
          value={`约 ${totalTime} 分钟`}
          accent={accent}
          accentSoft={accentSoft}
        />
      </div>

      {/* Adaptive explanation */}
      <div style={{
        background: accentSoft, border: `1px solid ${accent}25`,
        borderRadius: 10, padding: "12px 16px", marginBottom: 12,
        fontSize: 12, color: C.t2, lineHeight: 1.6, textAlign: "left",
      }}>
        <strong style={{ color: accent }}>自适应机制:</strong> Module 1 正确率 &ge; 60% 进入 Upper 路径 (更难, 最高 6.0 Band),
        否则进入 Lower 路径 (较易, 最高 4.0 Band)。
        {isReading && " Upper 与 Lower 路径题量完全相同，仅题目难度不同。"}
      </div>

      {/* Timer rule — matches real ETS behavior */}
      <div style={{
        background: "#FFFBEB", border: "1px solid #FDE68A",
        borderRadius: 10, padding: "10px 14px", marginBottom: 24,
        fontSize: 12, color: "#92400e", lineHeight: 1.6, textAlign: "left",
      }}>
        <strong>计时规则:</strong> 两个 Module 各自独立计时，进入 Module 2 时倒计时会重置。
        Module 1 时间用尽会自动进入 Module 2，无法回到上一个 Module 的题目。
      </div>

      {hasResume && (
        <div style={{
          background: accentSoft, border: `1px solid ${accent}40`,
          borderRadius: 10, padding: "10px 14px", marginBottom: 14,
          fontSize: 13, color: C.t1, lineHeight: 1.6, textAlign: "left",
        }}>
          检测到未完成的{config.labelZh}模考，可<strong style={{ color: accent }}>继续作答</strong>，或重新开始（重新开始会清空上次进度）。
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        {hasResume && (
          <Btn onClick={onResume} style={{ background: accent, borderColor: accent, padding: "12px 32px", fontSize: 15 }}>
            继续上次模考
          </Btn>
        )}
        <Btn
          onClick={onStart}
          variant={hasResume ? "secondary" : undefined}
          style={hasResume ? undefined : { background: accent, borderColor: accent, padding: "12px 32px", fontSize: 15 }}
        >
          {hasResume ? "重新开始" : "开始考试"}
        </Btn>
        <Btn onClick={onExit} variant="secondary">返回</Btn>
      </div>
    </SurfaceCard>
  );
}

function InfoBox({ label, value, accent, accentSoft }) {
  return (
    <div style={{
      background: accentSoft, border: `1px solid ${accent}20`,
      borderRadius: 10, padding: "10px 12px", textAlign: "center",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: accent, marginBottom: 4, letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 12, color: C.t1, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function RoutingTransition({ path, accent, accentSoft }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const duration = 2000;
    function tick() {
      const elapsed = Date.now() - start;
      const p = Math.min(1, elapsed / duration);
      setProgress(p);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, []);

  return (
    <SurfaceCard style={{ padding: "48px 28px", textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>
        {path === "upper" ? "\u{1F680}" : "\u{1F4DA}"}
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: C.t1, marginBottom: 12 }}>
        正在根据你的表现调整后续题目难度...
      </h3>
      <p style={{ fontSize: 14, color: C.t2, marginBottom: 20 }}>
        你将进入 <strong style={{ color: accent }}>{path === "upper" ? "Upper" : "Lower"} 路径</strong>
      </p>

      {/* Progress bar */}
      <div style={{
        maxWidth: 300, margin: "0 auto", height: 6,
        background: "#e2e8f0", borderRadius: 3, overflow: "hidden",
      }}>
        <div style={{
          width: `${progress * 100}%`, height: "100%",
          background: accent, borderRadius: 3,
          transition: "width 50ms linear",
        }} />
      </div>
    </SurfaceCard>
  );
}

function ResultsCard({ score, m1Results, m2Results, config, section, sessionDate, onRestart, onExit }) {
  const router = useRouter();
  const palette = BAND_COLORS[score.color] || BAND_COLORS.blue;
  const levelLabel = LEVEL_LABELS[score.color] || "";
  const m1Correct = sumCorrectFromResults(m1Results);
  const m1Total = sumTotalFromResults(m1Results);
  const m2Correct = sumCorrectFromResults(m2Results);
  const m2Total = sumTotalFromResults(m2Results);
  // Total questions auto-scored wrong because the module clock ran out before
  // the student answered them (surfaced so the band doesn't look unexplained).
  const unanswered = [...m1Results, ...m2Results].reduce((s, r) => s + (r.unanswered || 0), 0);
  // Deep-link into this section's practice records, auto-opening THIS exam by
  // its save identity (session date). Falls back to `mock=latest` only if the
  // date is somehow missing, so an older link shape still works.
  const reviewBase = `/${section === "listening" ? "listening" : "reading"}/progress`;
  const reviewHref = sessionDate
    ? `${reviewBase}?mock=${encodeURIComponent(sessionDate)}`
    : `${reviewBase}?mock=latest`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Band Score Hero */}
      <SurfaceCard style={{
        padding: "32px 24px", textAlign: "center",
        border: `2px solid ${palette.border}`,
      }}>
        <div style={{ fontSize: 13, color: C.t2, marginBottom: 8, letterSpacing: 1, textTransform: "uppercase" }}>
          {config.labelZh}部分结果
        </div>

        {/* Band circle */}
        <div style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", width: 120, height: 120, borderRadius: "50%",
          border: `4px solid ${palette.ring}`, background: palette.bg,
          margin: "8px auto 12px",
        }}>
          <span style={{ fontSize: 42, fontWeight: 800, color: palette.text, lineHeight: 1, fontFamily: FONT }}>
            {score.band.toFixed(1)}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: palette.text, marginTop: 2 }}>Band</span>
        </div>

        <div style={{
          display: "inline-block", background: palette.bg,
          border: `1px solid ${palette.border}`, borderRadius: 14,
          padding: "3px 14px", fontSize: 13, fontWeight: 600, color: palette.text,
          marginBottom: 12,
        }}>
          CEFR: {score.cefr} {levelLabel && `\u00B7 ${levelLabel}`}
        </div>

        {/* Path badge */}
        <div style={{ marginBottom: 8 }}>
          <span style={{
            display: "inline-block",
            background: score.path === "upper" ? "#dbeafe" : "#fef3c7",
            border: `1px solid ${score.path === "upper" ? "#93c5fd" : "#fcd34d"}`,
            color: score.path === "upper" ? "#1d4ed8" : "#92400e",
            borderRadius: 999, padding: "4px 14px", fontSize: 12, fontWeight: 700,
          }}>
            {score.path === "upper" ? "Upper 路径" : "Lower 路径"}
            {" \u00B7 "}最高 {score.maxBand.toFixed(1)} Band
          </span>
        </div>
      </SurfaceCard>

      {/* Score breakdown */}
      <SurfaceCard style={{ overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid " + C.bdr, fontSize: 13, fontWeight: 700, color: C.t1 }}>
          分项结果
        </div>

        <ScoreBreakdownRow
          label="Module 1 (路由阶段)"
          correct={m1Correct}
          total={m1Total}
          weight="40%"
          accent={config.accent}
        />
        <ScoreBreakdownRow
          label={`Module 2 (${score.path === "upper" ? "Upper" : "Lower"})`}
          correct={m2Correct}
          total={m2Total}
          weight="60%"
          accent={config.accent}
        />

        {/* Visual bar */}
        <div style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 12, color: C.t3, marginBottom: 6 }}>综合得分比</div>
          <div style={{ height: 8, background: "#e2e8f0", borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 4,
              background: `linear-gradient(90deg, ${palette.border}, ${palette.ring})`,
              width: `${score.rawScore * 100}%`,
              transition: "width 600ms ease",
            }} />
          </div>
          <div style={{ fontSize: 11, color: C.t3, marginTop: 4, textAlign: "right" }}>
            {(score.rawScore * 100).toFixed(1)}%
          </div>
        </div>
      </SurfaceCard>

      {/* Timeout transparency — questions the clock cut off are scored as wrong,
          so tell the student explicitly (mirrors the amber timer-rule box). */}
      {unanswered > 0 && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          background: "#FFFBEB", border: "1px solid #FDE68A",
          borderRadius: 8, padding: "11px 14px",
          fontSize: 13, color: "#92400e", lineHeight: 1.6,
        }}>
          <span style={{ fontSize: 15, flexShrink: 0 }}>{"⏱"}</span>
          <span>因超时，有 <strong>{unanswered}</strong> 道题未作答，已按错误计入成绩。</span>
        </div>
      )}

      {/* Review hint — the completion screen shows only the band; the
          per-question review (right/wrong + AI explanation) lives in the
          practice records, so send users straight there before they leave. */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 10,
        background: config.accentSoft, border: `1px solid ${config.accent}33`,
        borderRadius: 8, padding: "12px 14px",
        fontSize: 13, color: C.t2, lineHeight: 1.6,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <span style={{ fontSize: 15, flexShrink: 0 }}>{"\u{1F4A1}"}</span>
          <span>想回看每道题的作答与解析？点击下方按钮进入 <strong style={{ color: config.accent }}>{config.labelZh}练习记录</strong>，将自动展开本次模考详情。</span>
        </div>
        <Btn
          onClick={() => router.push(reviewHref)}
          style={{ alignSelf: "flex-start", background: config.accent, borderColor: config.accent, fontSize: 13 }}
        >
          查看本次逐题解析
        </Btn>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10 }}>
        <Btn onClick={onRestart} style={{ background: config.accent, borderColor: config.accent }}>
          重新考试
        </Btn>
        <Btn onClick={onExit} variant="secondary">返回首页</Btn>
      </div>

      {/* Disclaimer */}
      <div style={{
        background: "#fffbeb", border: "1px solid #fde68a",
        borderRadius: 6, padding: "10px 14px",
        fontSize: 12, color: "#92400e", lineHeight: 1.6,
      }}>
        该分数基于模拟自适应考试算法估算，不代表官方 ETS 成绩。TOEFL 为 ETS 注册商标。
      </div>
    </div>
  );
}

function ScoreBreakdownRow({ label, correct, total, weight, accent }) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "12px 16px", borderBottom: "1px solid #f0f0f0",
    }}>
      <div>
        <div style={{ fontSize: 14, color: C.t1, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>权重: {weight}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: accent }}>
          {correct}/{total}
        </div>
        <div style={{ fontSize: 11, color: C.t2 }}>{pct}%</div>
      </div>
    </div>
  );
}
