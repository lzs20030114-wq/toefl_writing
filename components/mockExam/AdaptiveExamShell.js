"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { C, FONT, READING_FONT, Btn, TopBar, SurfaceCard } from "../shared/ui";
import { AudioPlayer } from "../listening/AudioPlayer";
import { ExamAudioProvider, useExamAudio } from "../shared/ExamAudioProvider";
import { sameOriginAudio } from "../../lib/listening/audioSrc";
import { insertStemParts } from "../../lib/reading/insertSentence";
import { InsertSentenceStem } from "../reading/InsertSentenceStem";
import { apPassageText } from "../../lib/reading/passageLayout";
import { calculateAdaptiveScore } from "../../lib/mockExam/adaptiveScoring";
import {
  buildReadingModule1,
  routeModule2 as routeReadingM2,
  buildReadingModule2,
  describeModulePlan as describeReadingModulePlan,
  readingModuleSeconds,
} from "../../lib/mockExam/readingPlanner";
import {
  buildListeningModule1,
  routeModule2 as routeListeningM2,
  buildListeningModule2,
  describeModulePlan as describeListeningModulePlan,
  listeningModuleSeconds,
} from "../../lib/mockExam/listeningPlanner";
import { finalizeTimedOutResults } from "../../lib/mockExam/timeoutFinalize";
import { saveSess, loadDoneIds, addDoneIds } from "../../lib/sessionStore";
import { DONE_STORAGE_KEYS } from "../../lib/questionSelector";
import { saveAdaptiveCheckpoint, loadAdaptiveCheckpoint, clearAdaptiveCheckpoint } from "../../lib/mockExam/adaptiveCheckpoint";
import { getSavedCode } from "../../lib/AuthContext";
import { REAL_MOCK_TEMPLATE_VERSION, getRealMockConfig } from "../../lib/realMockExam/config";
import { prepareRealMockExam, markRealMockSeen, routeRealMockExam, finishRealMockExam } from "../../lib/realMockExam/client";
import { calculateRealAdaptiveScore, routeRealModule, validateRealAdaptivePaper } from "../../lib/realMockExam/adaptiveScore";
import { getVocabTargetWord, splitForHighlight, VOCAB_HIGHLIGHT_STYLE } from "../../lib/reading/vocabHighlight";
import { splitBlankToken } from "../../lib/reading/ctwToken";
import { listeningSecondsForType, LCR_SECONDS_PER_ITEM, formatAnswerTime } from "../../lib/listeningTiming";

// ------ Constants ------

// Per-module timers. Real ETS 2026 uses an independent countdown for each
// module (the on-screen clock shows time remaining in the *current* module
// and resets when Module 2 starts), so we model the same shape here.
// Both budgets are DERIVED from each planner's module plan so they track the
// question counts automatically (see readingModuleSeconds /
// listeningModuleSeconds for the conversion):
//   - Reading uses the real test's 30-min seated section budget, split by
//     scored question count (35 : 15 ⇒ 21 min / 9 min).
//   - Listening keeps its 29-min section budget; the split moved from raw
//     item count (12:8) to each module's time demand (audio + answer windows),
//     because M2 is lecture-heavy: ≈18.6 min / ≈10.4 min.
const SECTION_CONFIG = {
  reading: {
    label: "Reading",
    labelZh: "阅读",
    accent: "#3B82F6",
    accentSoft: "#EFF6FF",
    module1TimeSeconds: readingModuleSeconds(1),
    module2TimeSeconds: readingModuleSeconds(2),
    buildM1: buildReadingModule1,
    routeM2: routeReadingM2,
    buildM2: buildReadingModule2,
    sessionType: "adaptive-reading",
    // taskType → practice done-key. Shared with practice mode so a mock never
    // serves a passage the user already did (and completing a mock marks its
    // items done for practice too). RDL short+long both map to READING_RDL.
    taskDoneKeys: {
      ctw: DONE_STORAGE_KEYS.READING_CTW,
      rdl: DONE_STORAGE_KEYS.READING_RDL,
      ap: DONE_STORAGE_KEYS.READING_AP,
    },
  },
  listening: {
    label: "Listening",
    labelZh: "听力",
    accent: "#8B5CF6",
    accentSoft: "#F5F3FF",
    // Listening's per-module split isn't published precisely; we approximate
    // it from the 29-min section total, weighted by each module's estimated
    // wall-clock demand (audio + answer windows). This keeps the section pace
    // unchanged while still resetting the timer between modules to match the
    // real test's on-screen clock.
    module1TimeSeconds: listeningModuleSeconds(1),
    module2TimeSeconds: listeningModuleSeconds(2),
    buildM1: buildListeningModule1,
    routeM2: routeListeningM2,
    buildM2: buildListeningModule2,
    sessionType: "adaptive-listening",
    taskDoneKeys: {
      lcr: DONE_STORAGE_KEYS.LISTENING_LCR,
      la: DONE_STORAGE_KEYS.LISTENING_LA,
      lc: DONE_STORAGE_KEYS.LISTENING_LC,
      lat: DONE_STORAGE_KEYS.LISTENING_LAT,
    },
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
function CTWInlineTask({ item, onComplete, collectorRef, revealAnswers = false, partialState, onProgress }) {
  const [answers, setAnswers] = useState(() => item.blanks.map((_, i) =>
    typeof partialState?.answers?.[i] === "string" ? partialState.answers[i] : ""
  ));
  const [submitted, setSubmitted] = useState(false);
  const inputRefs = useRef([]);
  // Mirror the live answers into a ref so the timeout collector reads the
  // latest input without a stale closure (registered once on mount).
  const answersRef = useRef(answers);
  answersRef.current = answers;
  useEffect(() => { onProgress?.({ answers }); }, [answers, onProgress]);

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
      // token 上粘着的标点印在两边（此前这里连尾句号都没印，"...frag___" 后面的 "." 会丢）
      const { lead, tail } = splitBlankToken(words[wi], blank.original_word);
      const bi = blankIdx;
      const isCorrect = submitted
        ? (blank.displayed_fragment + answers[bi]).toLowerCase().replace(/[^a-z]/g, "") === blank.original_word.toLowerCase().replace(/[^a-z]/g, "")
        : null;
      rendered.push(
        <span key={`b-${bi}`} style={{ display: "inline-flex", alignItems: "baseline", margin: "2px 3px" }}>
          {lead && <span>{lead}</span>}
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
          {tail && <span>{tail}</span>}
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
function MCQInlineTask({ item, taskType, onComplete, collectorRef, revealAnswers = false, partialState, onProgress }) {
  const questions = item.questions || [];
  const isListeningType = taskType === "la" || taskType === "lc" || taskType === "lat";
  const answerSeconds = listeningSecondsForType(taskType);
  const [currentQ, setCurrentQ] = useState(() => Math.max(0, Math.min(questions.length - 1, Number.isInteger(partialState?.currentQ) ? partialState.currentQ : 0)));
  const [selections, setSelections] = useState(() => questions.map((_, i) => ["A", "B", "C", "D"].includes(partialState?.selections?.[i]) ? partialState.selections[i] : null));
  const [submitted, setSubmitted] = useState(false);
  const [answerTimeLeft, setAnswerTimeLeft] = useState(() => Number.isFinite(partialState?.answerTimeLeft) ? Math.max(0, Math.min(answerSeconds, partialState.answerTimeLeft)) : answerSeconds);
  const restoredTimerRef = useRef(Number.isFinite(partialState?.answerTimeLeft));
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
  // Audio restarts from this material after a refresh; answer selections and
  // the remaining answer window survive, but playback position is not guessed.
  const [phase, setPhase] = useState(isListeningType ? "listen" : "answer");
  const lastProgressRef = useRef(null);
  useEffect(() => {
    const answersKey = JSON.stringify({ currentQ, selections, phase });
    if (answersKey !== lastProgressRef.current || answerTimeLeft % 5 === 0) {
      lastProgressRef.current = answersKey;
      onProgress?.({ currentQ, selections, phase, answerTimeLeft });
    }
  }, [currentQ, selections, phase, answerTimeLeft, onProgress]);

  const question = questions[currentQ];
  const insertParts = insertStemParts(question);

  const handleAudioEnded = useCallback(() => {
    setPhase((p) => (p === "listen" ? "answer" : p));
  }, []);

  // Get the text content to display
  function getPassageContent() {
    if (taskType === "rdl") return item.text || "";
    if (taskType === "ap") return apPassageText(item); // 漏了段落空行的条目在这里补回（pre-wrap 只认空行）
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
    if (restoredTimerRef.current) restoredTimerRef.current = false;
    else setAnswerTimeLeft(answerSeconds);
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
      {insertParts ? (
        <InsertSentenceStem
          parts={insertParts}
          accent={SECTION_CONFIG.reading.accent}
          soft={SECTION_CONFIG.reading.accentSoft}
          style={{ marginBottom: 14 }}
        />
      ) : (
        <div style={{ fontSize: 15, fontWeight: 600, color: C.t1, lineHeight: 1.5, marginBottom: 14, fontFamily: READING_FONT }}>
          {getStem(question)}
        </div>
      )}

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
function LCRInlineTask({ item, onComplete, collectorRef, revealAnswers = false, partialState, onProgress }) {
  const [phase, setPhase] = useState("listen");
  const [selected, setSelected] = useState(() => ["A", "B", "C", "D"].includes(partialState?.selected) ? partialState.selected : null);
  const [submitted, setSubmitted] = useState(false);
  const [answerTimeLeft, setAnswerTimeLeft] = useState(() => Number.isFinite(partialState?.answerTimeLeft) ? Math.max(0, Math.min(LCR_SECONDS_PER_ITEM, partialState.answerTimeLeft)) : LCR_SECONDS_PER_ITEM);
  const restoredTimerRef = useRef(Number.isFinite(partialState?.answerTimeLeft));
  const lastProgressRef = useRef(null);
  useEffect(() => {
    const answersKey = `${selected || ""}:${phase}`;
    if (answersKey !== lastProgressRef.current || answerTimeLeft % 5 === 0) {
      lastProgressRef.current = answersKey;
      onProgress?.({ selected, phase, answerTimeLeft });
    }
  }, [selected, phase, answerTimeLeft, onProgress]);
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
    if (restoredTimerRef.current) restoredTimerRef.current = false;
    else setAnswerTimeLeft(LCR_SECONDS_PER_ITEM);
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
function AdaptiveTaskRenderer({ item, onComplete, collectorRef, partialState, onProgress }) {
  if (!item) return null;

  if (item.taskType === "ctw") {
    return <CTWInlineTask item={item} onComplete={onComplete} collectorRef={collectorRef} partialState={partialState} onProgress={onProgress} />;
  }
  if (item.taskType === "lcr") {
    return <LCRInlineTask item={item} onComplete={onComplete} collectorRef={collectorRef} partialState={partialState} onProgress={onProgress} />;
  }
  // RDL, AP, LA, LC, LAT all use MCQ
  return <MCQInlineTask item={item} taskType={item.taskType} onComplete={onComplete} collectorRef={collectorRef} partialState={partialState} onProgress={onProgress} />;
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
      realMockKey: item.realMockKey || null,
      realMockRole: item.realMockRole || null,
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
      sentence_timings: item.sentence_timings || null, // 复盘逐句点播（与 audio_url 同一次配音）
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

// ------ Done-set helpers (shared with practice-mode picker) ------

/**
 * Load the union of practice done-ids for every task type in this section.
 * All bank ids are globally unique strings (distinct type prefixes), so a
 * single merged Set can never mis-match an id across banks. localStorage-only
 * (loadDoneIds guards SSR) — only ever called from click / completion handlers.
 */
function loadSectionDoneIds(config) {
  const merged = new Set();
  for (const key of new Set(Object.values(config.taskDoneKeys || {}))) {
    for (const id of loadDoneIds(key)) merged.add(id);
  }
  return merged;
}

/**
 * Write every completed item's id back to its task-type done-key, so a finished
 * module (normal OR timeout) counts toward "already practised". Each result
 * carries `.item` (handleItemComplete enriches; finalizeTimedOutResults attaches
 * one too), so this covers both completion paths. Set semantics make re-adds a
 * no-op, so resuming/re-recording is harmless.
 */
function recordSectionDone(config, results) {
  const byKey = new Map();
  for (const r of results || []) {
    const item = r?.item;
    const id = item?.id;
    const key = item && config.taskDoneKeys?.[item.taskType];
    if (!id || !key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(id);
  }
  for (const [key, ids] of byKey) addDoneIds(key, ids);
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

function AdaptiveExamShellInner({ section = "reading", source = "standard", onExit }) {
  const invalidSection = !SECTION_CONFIG[section];
  const config = SECTION_CONFIG[section] || SECTION_CONFIG.reading;
  const isReal = source === "real-bank";
  const userCode = getSavedCode();
  const checkpointScope = useMemo(
    () => isReal ? { source, userCode, templateVersion: REAL_MOCK_TEMPLATE_VERSION } : {},
    [isReal, source, userCode]
  );

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
  const [paper, setPaper] = useState(null);
  const [seenItemIds, setSeenItemIds] = useState([]);
  const [currentPartial, setCurrentPartial] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [seenState, setSeenState] = useState({ key: null, ready: false, error: null });
  const [seenRetry, setSeenRetry] = useState(0);
  const [answerError, setAnswerError] = useState(null);
  const pendingAnswerRef = useRef(null);
  const answerBusyRef = useRef(false);
  const finishBusyRef = useRef(false);
  const cloudRetryRef = useRef(null);
  const [restartAttemptId, setRestartAttemptId] = useState(null);
  // ISO date this exam was saved under — used as the session's identity so the
  // results screen deep-links into THIS exact record, not just "the latest mock"
  // (which would surface a previous exam if this save silently failed to sync).
  const [savedSessionDate, setSavedSessionDate] = useState(null);

  // Resume support: load any in-progress checkpoint for this section once, so
  // the intro can offer "continue where you left off". Restored on demand via
  // handleResume (not auto-applied, so the user can also choose a fresh start).
  const [resumed, setResumed] = useState(() => loadAdaptiveCheckpoint(section, checkpointScope));

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
      seenItemIds: isReal ? seenItemIds : undefined,
      currentPartial: isReal && currentPartial?.phase === phase && currentPartial?.itemId === items[currentItemIndex]?.id ? currentPartial : null,
      paper: isReal ? paper : undefined,
    }, checkpointScope);
  }, [section, source, userCode, isReal, phase, m1Items, m2Items, m1Results, m2Results, currentItemIndex, routePath, usedIds, paper, seenItemIds, currentPartial, checkpointScope]);

  // A long passage can hold the same item for many minutes. Persist the real
  // exam clock periodically so a refresh cannot restore an old time budget.
  useEffect(() => {
    if (!isReal || !paper || (phase !== "module1" && phase !== "module2")) return;
    const timer = setInterval(() => {
      saveAdaptiveCheckpoint(section, {
        phase, m1Items, m2Items, m1Results, m2Results,
        currentItemIndex, routePath, timeLeft: timeLeftRef.current,
        usedIds: Array.from(usedIds), seenItemIds,
        currentPartial: currentPartial?.phase === phase && currentPartial?.itemId === (phase === "module1" ? m1Items : m2Items)?.[currentItemIndex]?.id ? currentPartial : null,
        paper,
      }, checkpointScope);
    }, 5000);
    return () => clearInterval(timer);
  }, [isReal, paper, phase, section, userCode, m1Items, m2Items, m1Results, m2Results, currentItemIndex, routePath, usedIds, seenItemIds, currentPartial, checkpointScope]);

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
      const completeTimeout = async () => {
        // Only the item actually displayed can become answered. Later planned
        // items stay unseen even though they count as wrong in the score.
        if (isReal && realTaskReady && currentItem) {
          try { await markRealMockSeen(paper, [currentItem], { answered: true }); }
          catch (e) {
            cloudRetryRef.current = completeTimeout;
            setError("超时作答同步失败：" + (e?.message || "请重试"));
            return;
          }
        }
        if (phase === "module1") {
          setM1Results(finalResults);
          handleM1Complete(finalResults);
        } else {
          setM2Results(finalResults);
          handleM2Complete(finalResults);
        }
      };
      completeTimeout();
    }
  }, [timeLeft, phase]);

  const currentItems = phase === "module1" ? m1Items : phase === "module2" ? m2Items : null;
  const currentItem = currentItems ? currentItems[currentItemIndex] : null;
  const partialForCurrent = isReal && currentPartial?.phase === phase && currentPartial?.itemId === currentItem?.id && currentPartial?.itemIndex === currentItemIndex
    ? currentPartial.data : null;
  const handlePartialProgress = useCallback((data) => {
    if (!isReal || !currentItem || (phase !== "module1" && phase !== "module2")) return;
    setCurrentPartial({ phase, itemId: currentItem.id, itemIndex: currentItemIndex, data });
  }, [isReal, phase, currentItem, currentItemIndex]);
  const seenKey = currentItem ? `${paper?.attemptId || ""}:${phase}:${currentItemIndex}:${currentItem.realMockKey || currentItem.id}` : null;
  const realTaskReady = !isReal || (seenState.key === seenKey && seenState.ready);
  holdTimersRef.current = !!(examAudio && examAudio.holdTimers) || (isReal && !realTaskReady) || answerBusyRef.current;

  const expired = timeLeft <= 0;
  useEffect(() => {
    if (!isReal || !paper || !currentItem || expired || autoFinishedRef.current || (phase !== "module1" && phase !== "module2")) return;
    let active = true;
    setSeenState({ key: seenKey, ready: false, error: null });
    markRealMockSeen(paper, [currentItem]).then(() => {
      if (!active) return;
      const doneKey = config.taskDoneKeys[currentItem.taskType];
      if (doneKey) addDoneIds(doneKey, [currentItem.id]);
      setSeenItemIds((ids) => ids.includes(currentItem.id) ? ids : [...ids, currentItem.id]);
      setSeenState({ key: seenKey, ready: true, error: null });
    }).catch((e) => {
      if (active) setSeenState({ key: seenKey, ready: false, error: e?.message || "已见记录同步失败，请重试。" });
    });
    return () => { active = false; };
  }, [isReal, paper, phase, currentItemIndex, currentItem, seenKey, seenRetry, expired]);

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

  async function handleStartExam() {
    // Unlock the shared exam audio element synchronously inside this click —
    // the one real user gesture WebKit will honor for the whole exam.
    if (examController) examController.unlock();
    if (preparing) return;
    setPreparing(true);
    setError(null);
    try {
      if (isReal) {
        if (!userCode) throw new Error("登录状态已失效，请重新登录。");
        const oldAttemptId = restartAttemptId || resumed?.paper?.attemptId;
        const fresh = await prepareRealMockExam(section, oldAttemptId ? { restartAttemptId: oldAttemptId } : undefined);
        if (!validateRealAdaptivePaper(fresh, section, userCode)) {
          if (fresh?.attemptId) await finishRealMockExam(fresh).catch(() => {});
          throw new Error("真题试卷不完整，暂时无法开考，请稍后重试。");
        }
        clearAdaptiveCheckpoint(section, checkpointScope);
        setResumed(null);
        setRestartAttemptId(null);
        setPaper(fresh);
        setSeenItemIds([]);
        setCurrentPartial(null);
        setM1Items(fresh.m1Items);
        setM2Items(null);
        setUsedIds(new Set(fresh.m1Items.map((item) => item.id)));
        setCurrentItemIndex(0);
        setM1Results([]);
        setM2Results([]);
        setTimeLeft(fresh.timing.module1Seconds);
        autoFinishedRef.current = false;
        setPhase("module1");
        return;
      }
      clearAdaptiveCheckpoint(section); // fresh start — drop any stale checkpoint
      // Prefer items the user hasn't practised yet (shared done-set with
      // practice mode); planner falls back to done items once the bank runs out.
      const m1 = config.buildM1(loadSectionDoneIds(config));
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
      if (isReal && e?.code === "ACTIVE_ATTEMPT") {
        setRestartAttemptId(e.attemptId || e.activeAttemptId || resumed?.paper?.attemptId || null);
      }
      const deficitText = Array.isArray(e?.deficits) && e.deficits.length
        ? ` 缺口：${e.deficits.map((d) => `${d.taskType || d.type || "题目"}需${d.required ?? d.need ?? "?"}、可用${d.available ?? "?"}`).join("；")}。`
        : "";
      setError(`${isReal ? "真题组卷失败" : "初始化考试失败"}：${e?.message || "请稍后重试。"}${deficitText}`);
    } finally {
      setPreparing(false);
    }
  }

  // Resume an in-progress exam from the saved checkpoint (offered on the intro).
  function handleResume() {
    if (!resumed) return;
    // Same in-gesture unlock as handleStartExam (resume is also a real click).
    if (examController) examController.unlock();
    try {
      if (isReal && (!resumed.paper || resumed.paper.userCode !== userCode || resumed.paper.templateVersion !== REAL_MOCK_TEMPLATE_VERSION)) throw new Error("断点账户或模板不匹配");
      setPaper(isReal ? resumed.paper : null);
      setSeenItemIds(isReal && Array.isArray(resumed.seenItemIds) ? resumed.seenItemIds : []);
      setCurrentPartial(isReal && resumed.currentPartial?.phase === resumed.phase &&
        resumed.currentPartial?.itemIndex === resumed.currentItemIndex &&
        resumed.currentPartial?.itemId === (resumed.phase === "module2" ? resumed.m2Items : resumed.m1Items)?.[resumed.currentItemIndex]?.id
        ? resumed.currentPartial : null);
      setM1Items(resumed.m1Items || null);
      setM2Items(resumed.m2Items || null);
      setM1Results(Array.isArray(resumed.m1Results) ? resumed.m1Results : []);
      setM2Results(Array.isArray(resumed.m2Results) ? resumed.m2Results : []);
      setCurrentItemIndex(Number.isFinite(resumed.currentItemIndex) ? resumed.currentItemIndex : 0);
      setRoutePath(resumed.routePath || null);
      setUsedIds(new Set(Array.isArray(resumed.usedIds) ? resumed.usedIds : []));
      setTimeLeft(Number.isFinite(resumed.timeLeft) ? resumed.timeLeft : (isReal ? resumed.paper.timing.module1Seconds : config.module1TimeSeconds));
      autoFinishedRef.current = false;
      setPhase(resumed.phase === "module2" ? "module2" : "module1");
    } catch {
      clearAdaptiveCheckpoint(section, checkpointScope);
      setError("无法恢复上次模考进度，请重新开始。");
    }
  }

  async function handleItemComplete(result) {
    // Timeout guard: a task's onComplete is fired from an 800/1200ms setTimeout
    // (submit animation). If the module already timed out, that delayed callback
    // still holds a stale closure — accepting it would double-append a result
    // and re-run handleM2Complete (a duplicate saveSess → duplicate history).
    // autoFinishedRef is reset to false on start/resume/entering M2, so the
    // normal (non-timeout) flow is unaffected.
    if (autoFinishedRef.current || answerBusyRef.current) return;
    answerBusyRef.current = true;
    pendingAnswerRef.current = result;
    if (isReal) {
      try {
        await markRealMockSeen(paper, [currentItem], { answered: true });
      } catch (e) {
        setAnswerError(e?.message || "作答同步失败，请重试后继续。");
        answerBusyRef.current = false;
        return;
      }
    }
    pendingAnswerRef.current = null;
    setAnswerError(null);
    answerBusyRef.current = false;
    setCurrentPartial(null);
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

  async function handleM1Complete(resultsOverride) {
    const results = resultsOverride || m1Results;
    // Mark Module 1's items done (covers normal + timeout finalize paths).
    if (!isReal) recordSectionDone(config, results);
    const m1Correct = sumCorrectFromResults(results);
    const m1Total = sumTotalFromResults(results);
    const accuracy = m1Total > 0 ? m1Correct / m1Total : 0;
    const path = isReal ? routeRealModule(m1Items, results, paper.routeThreshold ?? 0.6) : config.routeM2(accuracy);
    setRoutePath(path);
    setPhase("routing");

    // Build M2 after animation delay
    setTimeout(async () => {
      try {
        if (isReal) await routeRealMockExam(paper, path);
        const m2 = isReal ? { items: paper.m2ByPath[path], usedIds } : config.buildM2(path, usedIds, loadSectionDoneIds(config));
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
        setTimeLeft(isReal ? paper.timing.module2Seconds[path] : config.module2TimeSeconds);
        autoFinishedRef.current = false;
        setPhase("module2");
      } catch (e) {
        cloudRetryRef.current = () => handleM1Complete(results);
        setError("进入 Module 2 失败：" + (e.message || "请重试"));
      }
    }, 2500);
  }

  async function handleM2Complete(resultsOverride) {
    if (finishBusyRef.current) return;
    finishBusyRef.current = true;
    const m1Res = m1Results;
    const m2Res = resultsOverride || m2Results;
    // Mark Module 2's items done (covers normal + timeout finalize paths).
    if (!isReal) recordSectionDone(config, m2Res);
    const m1Correct = sumCorrectFromResults(m1Res);
    const m1Total = sumTotalFromResults(m1Res);
    const m2Correct = sumCorrectFromResults(m2Res);
    const m2Total = sumTotalFromResults(m2Res);
    const score = isReal
      ? calculateRealAdaptiveScore(m1Items, m1Res, m2Items, m2Res, routePath)
      : calculateAdaptiveScore(m1Correct, m1Total, m2Correct, m2Total, routePath);
    if (isReal) {
      try { await finishRealMockExam(paper); }
      catch (e) {
        finishBusyRef.current = false;
        cloudRetryRef.current = () => handleM2Complete(m2Res);
        setError("结束真题模考失败：" + (e?.message || "请重试"));
        return;
      }
    }
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
      const realItems = isReal ? [...m1Items, ...m2Items] : [];
      const realSnapshots = isReal ? [...buildTaskSnapshots(m1Res), ...buildTaskSnapshots(m2Res)] : [];
      saveSess({
        type: section,
        mode: "mock",
        ...(isReal ? {
          source: "real-bank", real: true, realMock: true,
          section,
          itemIds: realItems.map((item) => item.id),
        } : {}),
        date: sessionDate,
        correct: isReal ? score.correct : m1Correct + m2Correct,
        total: isReal ? score.total : m1Total + m2Total,
        band: score.band,
        details: {
          subtype: "mock",
          ...(isReal ? {
            source: "real-bank", real: true, realMock: true,
            section,
            attemptId: paper.attemptId, templateVersion: paper.templateVersion,
            itemIds: realItems.map((item) => item.id),
            seenItemIds,
            items: realItems, tasks: realSnapshots,
            paperSnapshot: { ...paper, m2ByPath: { [routePath]: m2Items } },
            scoredCorrect: score.correct, scoredTotal: score.total,
            extraCorrect: score.extraCorrect, extraTotal: score.extraTotal,
            scoreVersion: score.scoreVersion,
          } : {}),
          path: routePath,
          band: score.band,
          cefr: score.cefr,
          m1: {
            correct: isReal ? score.m1.scoredCorrect : m1Correct,
            total: isReal ? score.m1.scoredTotal : m1Total,
            ...(isReal ? { extraCorrect: score.m1.extraCorrect, extraTotal: score.m1.extraTotal } : {}),
            accuracy: isReal ? score.m1.scoredCorrect / score.m1.scoredTotal : score.m1Accuracy,
            tasks: buildTaskSnapshots(m1Res),
          },
          m2: {
            correct: isReal ? score.m2.scoredCorrect : m2Correct,
            total: isReal ? score.m2.scoredTotal : m2Total,
            ...(isReal ? { extraCorrect: score.m2.extraCorrect, extraTotal: score.m2.extraTotal } : {}),
            accuracy: isReal ? score.m2.scoredCorrect / score.m2.scoredTotal : score.m2Accuracy,
            tasks: buildTaskSnapshots(m2Res),
          },
          rawScore: score.rawScore,
        },
      });
    } catch {}

    clearAdaptiveCheckpoint(section, checkpointScope); // exam finished
    finishBusyRef.current = false;
    setPhase("results");
  }

  function handleRestart() {
    setRestartAttemptId(isReal && phase !== "results" ? paper?.attemptId || restartAttemptId : null);
    clearAdaptiveCheckpoint(section, checkpointScope);
    setResumed(null);
    setPaper(null);
    setSeenItemIds([]);
    setCurrentPartial(null);
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
    cloudRetryRef.current = null;
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
          `${isReal ? "真题" : ""}${config.labelZh}自适应模考`
        }
        section={`${config.label} | ${isReal ? "真题模考" : "模考模式"}`}
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
            <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
              {isReal && <Btn onClick={() => {
                setError(null);
                const retry = cloudRetryRef.current;
                cloudRetryRef.current = null;
                if (retry) retry();
                else handleStartExam();
              }}>重试</Btn>}
              <Btn onClick={handleRestart} variant="secondary">返回</Btn>
            </div>
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
            source={source}
            preparing={preparing}
            onExit={onExit}
          />
        )}

        {/* Module 1 & 2 — task rendering */}
        {(phase === "module1" || phase === "module2") && currentItem && !error && realTaskReady && (
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
              collectorRef={partialCollectorRef}
              partialState={partialForCurrent}
              onProgress={isReal ? handlePartialProgress : null}
            />
            {answerError && <div style={{ marginTop: 14, color: "#b91c1c", fontSize: 13 }}>
              {answerError} <Btn onClick={() => pendingAnswerRef.current && handleItemComplete(pendingAnswerRef.current)}>重试同步</Btn>
            </div>}
          </SurfaceCard>
        )}
        {isReal && (phase === "module1" || phase === "module2") && currentItem && !error && !realTaskReady && (
          <SurfaceCard style={{ padding: 24, textAlign: "center" }}>
            <div style={{ color: C.t2, fontSize: 14, marginBottom: 12 }}>
              {seenState.key === seenKey && seenState.error ? seenState.error : "正在确认这道题的已见记录…"}
            </div>
            {seenState.key === seenKey && seenState.error && <Btn onClick={() => setSeenRetry((n) => n + 1)}>重试加载</Btn>}
          </SurfaceCard>
        )}

        {/* Routing Phase — animated transition */}
        {phase === "routing" && !error && (
          <RoutingTransition path={routePath} accent={accent} accentSoft={accentSoft} source={source} />
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
            source={source}
            onRestart={handleRestart}
            onExit={onExit}
          />
        )}
      </div>
    </div>
  );
}

// ------ Sub-components ------

function IntroCard({ config, accent, accentSoft, onStart, onResume, hasResume, onExit, source = "standard", preparing = false }) {
  const isReading = config.label === "Reading";
  const isReal = source === "real-bank";
  // Composition strings are derived from the planners' module plans (reading
  // 35/15, listening 32/15 — see docs/realbank-set-blueprint.md §1), never
  // hand-written here. Upper/Lower share the SAME composition on both sections
  // (只题目难度不同), so each shows a single Module 2 box.
  const describe = isReading ? describeReadingModulePlan : describeListeningModulePlan;
  const m1Count = isReal ? `${isReading ? 35 : 32} 题（20 题计分）` : describe(1);
  const m2Count = isReal ? "15 题（全部计分）" : describe(2);
  const realTiming = isReal ? getRealMockConfig(isReading ? "reading" : "listening") : null;
  const m1Time = Math.round((realTiming?.module1Seconds || config.module1TimeSeconds) / 60);
  const m2Upper = Math.round((realTiming?.module2Seconds?.upper || config.module2TimeSeconds) / 60);
  const m2Lower = Math.round((realTiming?.module2Seconds?.lower || config.module2TimeSeconds) / 60);
  const m2Time = m2Upper === m2Lower ? `${m2Upper}` : `${Math.min(m2Upper, m2Lower)}–${Math.max(m2Upper, m2Lower)}`;
  const totalTime = m1Time + Math.max(m2Upper, m2Lower);

  return (
    <SurfaceCard style={{ padding: "32px 28px", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{isReading ? "\u{1F4D6}" : "\u{1F3A7}"}</div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: C.t1, marginBottom: 8 }}>
        {isReal ? "真题" : ""}{config.labelZh}自适应模考
      </h2>
      <p style={{ fontSize: 14, color: C.t2, lineHeight: 1.7, marginBottom: 20, maxWidth: 500, margin: "0 auto 20px" }}>
        {isReal
          ? "使用未见过的真题组成完整训练卷。Module 1 的20道计分题决定本站模拟路线，另外的训练题也会展示和计时。"
          : "模拟 TOEFL 2026 自适应考试流程。Module 1 决定你的路径，Module 2 根据表现调整难度。"}
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
        <InfoBox label="Module 2 题量" value={m2Count} accent={accent} accentSoft={accentSoft} />
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
        {isReal ? (
          <><strong style={{ color: accent }}>本站模拟规则：</strong> Module 1 的20道计分题正确率达到60%进入进阶路线，否则进入普通路线。两路题型构成不同，题目难度尚未校准；成绩为35题原始分和未校准的1–6估分。</>
        ) : (
          <><strong style={{ color: accent }}>自适应机制:</strong> Module 1 正确率 &ge; 60% 进入 Upper 路径 (更难, 最高 6.0 Band), 否则进入 Lower 路径 (较易, 最高 4.0 Band)。{" Upper 与 Lower 路径题量完全相同，仅题目难度不同。"}</>
        )}
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
          <Btn onClick={onResume} disabled={preparing} style={{ background: accent, borderColor: accent, padding: "12px 32px", fontSize: 15 }}>
            继续上次模考
          </Btn>
        )}
        <Btn
          onClick={onStart}
          disabled={preparing}
          variant={hasResume ? "secondary" : undefined}
          style={hasResume ? undefined : { background: accent, borderColor: accent, padding: "12px 32px", fontSize: 15 }}
        >
          {preparing ? "正在组卷…" : hasResume ? "重新开始" : "开始考试"}
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

function RoutingTransition({ path, accent, accentSoft, source = "standard" }) {
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
        {source === "real-bank" ? "正在进入下一模块…" : "正在根据你的表现调整后续题目难度..."}
      </h3>
      <p style={{ fontSize: 14, color: C.t2, marginBottom: 20 }}>
        你将进入 <strong style={{ color: accent }}>{source === "real-bank" ? (path === "upper" ? "进阶" : "普通") : (path === "upper" ? "Upper" : "Lower")} 路线</strong>
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

function ResultsCard({ score, m1Results, m2Results, config, section, sessionDate, onRestart, onExit, source = "standard" }) {
  const router = useRouter();
  const isReal = source === "real-bank";
  const palette = BAND_COLORS[score.color] || BAND_COLORS.blue;
  const levelLabel = LEVEL_LABELS[score.color] || "";
  const m1Correct = isReal ? score.m1.scoredCorrect : sumCorrectFromResults(m1Results);
  const m1Total = isReal ? score.m1.scoredTotal : sumTotalFromResults(m1Results);
  const m2Correct = isReal ? score.m2.scoredCorrect : sumCorrectFromResults(m2Results);
  const m2Total = isReal ? score.m2.scoredTotal : sumTotalFromResults(m2Results);
  // Total questions auto-scored wrong because the module clock ran out before
  // the student answered them (surfaced so the band doesn't look unexplained).
  const unanswered = [...m1Results, ...m2Results].reduce(
    (s, r) => s + (!isReal || r.item?.realMockRole === "scored" ? (r.unanswered || 0) : 0), 0
  );
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
          {isReal ? `真题${config.labelZh}模考结果` : `${config.labelZh}部分结果`}
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
          <span style={{ fontSize: 13, fontWeight: 600, color: palette.text, marginTop: 2 }}>{isReal ? "站内估分" : "Band"}</span>
        </div>

        {!isReal && <div style={{
          display: "inline-block", background: palette.bg,
          border: `1px solid ${palette.border}`, borderRadius: 14,
          padding: "3px 14px", fontSize: 13, fontWeight: 600, color: palette.text,
          marginBottom: 12,
        }}>
          CEFR: {score.cefr} {levelLabel && `\u00B7 ${levelLabel}`}
        </div>}

        {/* Path badge */}
        <div style={{ marginBottom: 8 }}>
          <span style={{
            display: "inline-block",
            background: score.path === "upper" ? "#dbeafe" : "#fef3c7",
            border: `1px solid ${score.path === "upper" ? "#93c5fd" : "#fcd34d"}`,
            color: score.path === "upper" ? "#1d4ed8" : "#92400e",
            borderRadius: 999, padding: "4px 14px", fontSize: 12, fontWeight: 700,
          }}>
            {isReal ? (score.path === "upper" ? "进阶路线" : "普通路线") : (score.path === "upper" ? "Upper 路径" : "Lower 路径")}
            {!isReal && <> {" \u00B7 "}最高 {score.maxBand.toFixed(1)} Band</>}
          </span>
        </div>
      </SurfaceCard>

      {/* Score breakdown */}
      <SurfaceCard style={{ overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid " + C.bdr, fontSize: 13, fontWeight: 700, color: C.t1 }}>
          分项结果
        </div>

        <ScoreBreakdownRow
          label={isReal ? "Module 1（20道计分题）" : "Module 1 (路由阶段)"}
          correct={m1Correct}
          total={m1Total}
          weight={isReal ? null : `${Math.round((score.m1Weight ?? 0) * 100)}%`}
          accent={config.accent}
        />
        <ScoreBreakdownRow
          label={`Module 2 (${isReal ? (score.path === "upper" ? "进阶" : "普通") : (score.path === "upper" ? "Upper" : "Lower")})`}
          correct={m2Correct}
          total={m2Total}
          weight={isReal ? null : `${Math.round((score.m2Weight ?? 0) * 100)}%`}
          accent={config.accent}
        />

        {/* Visual bar */}
        <div style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 12, color: C.t3, marginBottom: 6 }}>{isReal ? `计分题原始分 ${score.correct}/${score.total}` : "综合得分比"}</div>
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
      {isReal && <SurfaceCard style={{ padding: "12px 16px", fontSize: 13, color: C.t2, lineHeight: 1.6 }}>
        另有 {score.extraTotal} 道本站模拟额外题，答对 {score.extraCorrect} 道；它们参与训练和计时，不参与路线或估分。
      </SurfaceCard>}

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
          <span>因超时，有 <strong>{unanswered}</strong> 道{isReal ? "计分题" : "题"}未作答，已按错误计入成绩。</span>
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
        <Btn onClick={onExit} variant="secondary">{isReal ? "返回真题专区" : "返回首页"}</Btn>
      </div>

      {/* Disclaimer */}
      <div style={{
        background: "#fffbeb", border: "1px solid #fde68a",
        borderRadius: 6, padding: "10px 14px",
        fontSize: 12, color: "#92400e", lineHeight: 1.6,
      }}>
        {isReal ? "1–6估分按 1 + 5 ×（35道计分题答对数 / 35）计算，并四舍五入到0.5；未经校准，不是 ETS 官方等值成绩。路线按本站规则分流，题目难度尚未标定。" : "该分数基于模拟自适应考试算法估算，不代表官方 ETS 成绩。TOEFL 为 ETS 注册商标。"}
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
        {weight && <div style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>权重: {weight}</div>}
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
