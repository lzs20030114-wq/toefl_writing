"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { C, FONT, Btn, TopBar, SurfaceCard } from "../shared/ui";
import { AudioPlayer } from "../listening/AudioPlayer";
import { calculateAdaptiveScore, getScoreColor, bandToCEFR } from "../../lib/mockExam/adaptiveScoring";
import { buildReadingModule1, routeModule2 as routeReadingM2, buildReadingModule2 } from "../../lib/mockExam/readingPlanner";
import { buildListeningModule1, routeModule2 as routeListeningM2, buildListeningModule2 } from "../../lib/mockExam/listeningPlanner";
import { saveSess } from "../../lib/sessionStore";
import { fmt } from "../../lib/utils";

// ------ Constants ------

const SECTION_CONFIG = {
  reading: {
    label: "Reading",
    labelZh: "阅读",
    accent: "#3B82F6",
    accentSoft: "#EFF6FF",
    totalTimeSeconds: 27 * 60,
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
    totalTimeSeconds: 22 * 60,
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
function CTWInlineTask({ item, onComplete }) {
  const [answers, setAnswers] = useState(() => item.blanks.map(() => ""));
  const [submitted, setSubmitted] = useState(false);
  const inputRefs = useRef([]);

  function handleChange(index, value, missingLen) {
    if (submitted) return;
    const next = [...answers];
    next[index] = value;
    setAnswers(next);
    if (value.length >= missingLen) {
      const nextIdx = index + 1;
      if (nextIdx < item.blanks.length && inputRefs.current[nextIdx]) {
        inputRefs.current[nextIdx].focus();
      }
    }
  }

  function handleKeyDown(index, e) {
    if (submitted) return;
    if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      const nextIdx = index + 1;
      if (nextIdx < item.blanks.length && inputRefs.current[nextIdx]) {
        inputRefs.current[nextIdx].focus();
      } else if (e.key === "Enter") {
        handleSubmit();
      }
    }
  }

  function handleSubmit() {
    if (submitted) return;
    setSubmitted(true);
    const results = item.blanks.map((blank, i) => {
      const expected = blank.original_word.toLowerCase().replace(/[^a-z]/g, "");
      const fragment = blank.displayed_fragment.toLowerCase();
      const userFull = (fragment + answers[i]).toLowerCase().replace(/[^a-z]/g, "");
      return { isCorrect: userFull === expected };
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
          <span style={{ fontWeight: 600, color: C.t1 }}>{blank.displayed_fragment}</span>
          <input
            ref={(el) => (inputRefs.current[bi] = el)}
            type="text"
            value={answers[bi]}
            onChange={(e) => handleChange(bi, e.target.value.slice(0, missingLen + 2), missingLen)}
            onKeyDown={(e) => handleKeyDown(bi, e)}
            disabled={submitted}
            maxLength={missingLen + 2}
            style={{
              width: Math.max(missingLen * 12, 36),
              border: "none",
              borderBottom: `2px solid ${submitted ? (isCorrect ? "#22c55e" : "#ef4444") : "#94a3b8"}`,
              background: submitted ? (isCorrect ? "#f0fdf4" : "#fef2f2") : "#f8fafc",
              fontSize: 14,
              fontFamily: FONT,
              padding: "2px 4px",
              outline: "none",
              color: C.t1,
              borderRadius: 0,
            }}
            placeholder={"_".repeat(missingLen)}
          />
          {submitted && !isCorrect && (
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
      <div style={{ fontSize: 14, lineHeight: 2.0, color: C.t1, marginBottom: 16 }}>{rendered}</div>
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
function MCQInlineTask({ item, taskType, onComplete }) {
  const questions = item.questions || [];
  const [currentQ, setCurrentQ] = useState(0);
  const [selections, setSelections] = useState(() => questions.map(() => null));
  const [submitted, setSubmitted] = useState(false);

  const question = questions[currentQ];
  if (!question) return null;

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

  function handleSubmit() {
    setSubmitted(true);
    const correctAnswer = (q) => q.correct_answer || q.answer;
    const results = questions.map((q, i) => ({
      selected: selections[i],
      correct: correctAnswer(q),
      isCorrect: selections[i] === correctAnswer(q),
    }));
    const correct = results.filter((r) => r.isCorrect).length;
    setTimeout(() => {
      onComplete({ correct, total: questions.length, results });
    }, 1200);
  }

  const passage = getPassageContent();
  const answeredAll = selections.every((s) => s !== null);
  const correctAnswer = (q) => q.correct_answer || q.answer;

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.t3, marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
        {taskType === "rdl" && "Read in Daily Life"}
        {taskType === "ap" && "Academic Passage"}
        {taskType === "la" && "Announcement"}
        {taskType === "lc" && "Conversation"}
        {taskType === "lat" && "Academic Talk"}
      </div>

      {/* Passage for reading types */}
      {passage && (
        <div style={{
          background: "#f8fafc",
          border: "1px solid " + C.bdr,
          borderRadius: 10,
          padding: "14px 16px",
          fontSize: 13,
          lineHeight: 1.7,
          color: C.t1,
          marginBottom: 16,
          maxHeight: 300,
          overflowY: "auto",
          whiteSpace: "pre-wrap",
        }}>
          {passage}
        </div>
      )}

      {/* Audio for listening types */}
      {!passage && (taskType === "la" || taskType === "lc" || taskType === "lat") && (
        <div style={{ marginBottom: 16 }}>
          <AudioPlayer
            src={item.audio_url || null}
            text={
              item.announcement ||
              item.lecture ||
              (item.conversation ? item.conversation.map((t) => `${t.speaker}: ${t.text}`).join(". ") : "")
            }
            maxReplays={2}
          />
        </div>
      )}

      {/* Question */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: C.t3, marginBottom: 6 }}>
          Question {currentQ + 1} of {questions.length}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.t1, lineHeight: 1.5, marginBottom: 12 }}>
          {getStem(question)}
        </div>

        {/* Options */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {["A", "B", "C", "D"].map((key) => {
            if (!question.options[key]) return null;
            const isSelected = selections[currentQ] === key;
            const isCorrectKey = submitted && key === correctAnswer(question);
            const isWrongSelection = submitted && isSelected && key !== correctAnswer(question);

            let borderColor = C.bdr;
            let bg = "#fff";
            if (submitted) {
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
                  fontFamily: FONT,
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
                  background: isSelected ? (submitted ? (isWrongSelection ? "#fee2e2" : "#dcfce7") : "#dbeafe") : "#f1f5f9",
                  color: isSelected ? (submitted ? (isWrongSelection ? "#ef4444" : "#22c55e") : "#3b82f6") : C.t3,
                }}>
                  {key}
                </span>
                <span>{question.options[key]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Navigation */}
      {!submitted && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {currentQ > 0 && (
            <Btn onClick={handlePrev} variant="secondary" style={{ fontSize: 13 }}>
              上一题
            </Btn>
          )}
          {currentQ < questions.length - 1 && (
            <Btn onClick={handleNext} variant="secondary" style={{ fontSize: 13 }}>
              下一题
            </Btn>
          )}
          {answeredAll && (
            <Btn onClick={handleSubmit} style={{ fontSize: 13 }}>
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
    </div>
  );
}

/**
 * LCR Inline — listen and choose a response (single question per item).
 */
function LCRInlineTask({ item, onComplete }) {
  const [phase, setPhase] = useState("listen");
  const [selected, setSelected] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  function handleAudioEnded() {
    setPhase("choose");
  }

  function handleSelect(key) {
    if (submitted || phase !== "choose") return;
    setSelected(key);
  }

  function handleSubmit() {
    if (!selected || submitted) return;
    setSubmitted(true);
    const isCorrect = selected === item.answer;
    setTimeout(() => {
      onComplete({ correct: isCorrect ? 1 : 0, total: 1, results: [{ selected, correct: item.answer, isCorrect }] });
    }, 800);
  }

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
          maxReplays={2}
        />
      </div>

      {phase === "listen" && (
        <div style={{ fontSize: 13, color: C.t3, textAlign: "center", padding: 20 }}>
          请先播放并听完音频...
        </div>
      )}

      {phase === "choose" && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {["A", "B", "C", "D"].map((key) => {
              if (!item.options[key]) return null;
              const isSelected = selected === key;
              const isCorrectKey = submitted && key === item.answer;
              const isWrongSelection = submitted && isSelected && key !== item.answer;

              let borderColor = C.bdr;
              let bg = "#fff";
              if (submitted) {
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
                    background: isSelected ? (submitted ? (isWrongSelection ? "#fee2e2" : "#dcfce7") : "#ede9fe") : "#f1f5f9",
                    color: isSelected ? (submitted ? (isWrongSelection ? "#ef4444" : "#22c55e") : "#8B5CF6") : C.t3,
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
function AdaptiveTaskRenderer({ item, onComplete, accent }) {
  if (!item) return null;

  if (item.taskType === "ctw") {
    return <CTWInlineTask item={item} onComplete={onComplete} />;
  }
  if (item.taskType === "lcr") {
    return <LCRInlineTask item={item} onComplete={onComplete} />;
  }
  // RDL, AP, LA, LC, LAT all use MCQ
  return <MCQInlineTask item={item} taskType={item.taskType} onComplete={onComplete} />;
}

// ------ Helper: count total scorable items ------

function countTotalScorableItems(items) {
  let total = 0;
  for (const item of items) {
    if (item.taskType === "ctw") {
      total += (item.blanks || []).length;
    } else if (item.taskType === "lcr") {
      total += 1;
    } else {
      total += (item.questions || []).length;
    }
  }
  return total;
}

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

// ------ Main Shell ------

export function AdaptiveExamShell({ section = "reading", onExit }) {
  const config = SECTION_CONFIG[section];
  if (!config) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
        <div>Unknown section: {section}</div>
      </div>
    );
  }

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

  // Timer
  const [timeLeft, setTimeLeft] = useState(config.totalTimeSeconds);
  const timerRef = useRef(null);
  const autoFinishedRef = useRef(false);

  // Start timer when exam begins
  useEffect(() => {
    if (phase !== "module1" && phase !== "module2") {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
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

  // Auto-finish on timeout
  useEffect(() => {
    if (timeLeft === 0 && !autoFinishedRef.current && (phase === "module1" || phase === "module2")) {
      autoFinishedRef.current = true;
      if (phase === "module1") {
        handleM1Complete();
      } else {
        handleM2Complete();
      }
    }
  }, [timeLeft, phase]);

  const currentItems = phase === "module1" ? m1Items : phase === "module2" ? m2Items : null;
  const currentItem = currentItems ? currentItems[currentItemIndex] : null;

  const totalItemsInCurrentModule = currentItems ? currentItems.length : 0;

  // ------ Phase transitions ------

  function handleStartExam() {
    try {
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
      setTimeLeft(config.totalTimeSeconds);
      autoFinishedRef.current = false;
      setPhase("module1");
    } catch (e) {
      setError("初始化考试失败: " + (e.message || "unknown error"));
    }
  }

  function handleItemComplete(result) {
    if (phase === "module1") {
      const next = [...m1Results, result];
      setM1Results(next);
      const nextIndex = currentItemIndex + 1;
      if (nextIndex >= m1Items.length) {
        // M1 done
        handleM1Complete(next);
      } else {
        setCurrentItemIndex(nextIndex);
      }
    } else if (phase === "module2") {
      const next = [...m2Results, result];
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

    // Save to history
    try {
      saveSess({
        type: config.sessionType,
        date: new Date().toISOString(),
        path: routePath,
        band: score.band,
        cefr: score.cefr,
        m1: { correct: m1Correct, total: m1Total, accuracy: score.m1Accuracy },
        m2: { correct: m2Correct, total: m2Total, accuracy: score.m2Accuracy },
        rawScore: score.rawScore,
      });
    } catch {}

    setPhase("results");
  }

  function handleRestart() {
    setPhase("intro");
    setM1Items(null);
    setM2Items(null);
    setM1Results([]);
    setM2Results([]);
    setCurrentItemIndex(0);
    setRoutePath(null);
    setFinalScore(null);
    setUsedIds(new Set());
    setError(null);
    autoFinishedRef.current = false;
  }

  // ------ Render ------

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

      <div style={{ maxWidth: 800, margin: "24px auto", padding: "0 20px" }}>
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
            onRestart={handleRestart}
            onExit={onExit}
          />
        )}
      </div>
    </div>
  );
}

// ------ Sub-components ------

function IntroCard({ config, accent, accentSoft, onStart, onExit }) {
  const isReading = config.label === "Reading";
  const m1Count = isReading ? "16 项 (10 CTW + 5 RDL + 1 AP)" : "12 项 (10 LCR + 1 LA + 1 LC)";
  const m2UpperCount = isReading ? "8 项 (5 CTW + 2 RDL + 1 AP)" : "8 项 (5 LCR + 1 LA + 1 LC + 1 LAT)";
  const m2LowerCount = isReading ? "9 项 (5 CTW + 3 RDL + 1 AP)" : "8 项 (5 LCR + 2 LA + 1 LC)";
  const totalTime = Math.floor(config.totalTimeSeconds / 60);

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
        <InfoBox label="总时间" value={`${totalTime} 分钟`} accent={accent} accentSoft={accentSoft} />
        <InfoBox label="Module 1" value={m1Count} accent={accent} accentSoft={accentSoft} />
        <InfoBox label="M2 Upper" value={m2UpperCount} accent={accent} accentSoft={accentSoft} />
        <InfoBox label="M2 Lower" value={m2LowerCount} accent={accent} accentSoft={accentSoft} />
      </div>

      {/* Adaptive explanation */}
      <div style={{
        background: accentSoft, border: `1px solid ${accent}25`,
        borderRadius: 10, padding: "12px 16px", marginBottom: 24,
        fontSize: 12, color: C.t2, lineHeight: 1.6, textAlign: "left",
      }}>
        <strong style={{ color: accent }}>自适应机制:</strong> Module 1 正确率 &ge; 60% 进入 Upper 路径 (更难, 最高 6.0 Band),
        否则进入 Lower 路径 (较易, 最高 4.0 Band)。
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <Btn onClick={onStart} style={{ background: accent, borderColor: accent, padding: "12px 32px", fontSize: 15 }}>
          开始考试
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

function ResultsCard({ score, m1Results, m2Results, config, onRestart, onExit }) {
  const palette = BAND_COLORS[score.color] || BAND_COLORS.blue;
  const levelLabel = LEVEL_LABELS[score.color] || "";
  const m1Correct = sumCorrectFromResults(m1Results);
  const m1Total = sumTotalFromResults(m1Results);
  const m2Correct = sumCorrectFromResults(m2Results);
  const m2Total = sumTotalFromResults(m2Results);

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
