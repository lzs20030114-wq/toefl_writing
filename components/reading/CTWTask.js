"use client";

import { useState, useRef, useEffect } from "react";
import { C, FONT, Btn, PageShell, SurfaceCard, TopBar } from "../shared/ui";

export function CTWTask({ item, onExit, onComplete, timeLimit = 0, isPractice = false }) {
  const [answers, setAnswers] = useState(() => item.blanks.map(() => ""));
  const [submitted, setSubmitted] = useState(false);
  const inputRefs = useRef([]);

  // Timer state
  const [timeLeft, setTimeLeft] = useState(timeLimit > 0 ? timeLimit : 0);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const autoSubmittedRef = useRef(false);

  useEffect(() => {
    if (submitted) { if (timerRef.current) clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => {
      setElapsed(prev => prev + 1);
      if (timeLimit > 0) {
        setTimeLeft(prev => { if (prev <= 1) { clearInterval(timerRef.current); return 0; } return prev - 1; });
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [submitted, timeLimit]);

  // Auto-submit on timeout
  useEffect(() => {
    if (timeLimit > 0 && timeLeft === 0 && !submitted && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      handleSubmit();
    }
  }, [timeLeft, timeLimit, submitted]);

  const accent = { color: "#3B82F6", soft: "#EFF6FF" };

  function handleChange(index, value) {
    if (submitted) return;
    const next = [...answers];
    next[index] = value;
    setAnswers(next);
  }

  function handleKeyDown(index, e) {
    if (submitted) return;
    if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      const nextIdx = index + 1;
      if (nextIdx < item.blanks.length && inputRefs.current[nextIdx]) {
        inputRefs.current[nextIdx].focus();
      }
    }
  }

  function handleSubmit() {
    setSubmitted(true);
    const results = item.blanks.map((blank, i) => {
      const expected = blank.original_word.toLowerCase().replace(/[^a-z]/g, "");
      const fragment = blank.displayed_fragment.toLowerCase();
      const userFull = (fragment + answers[i]).toLowerCase().replace(/[^a-z]/g, "");
      return { blank, userAnswer: answers[i], fullWord: fragment + answers[i], isCorrect: userFull === expected };
    });
    const correct = results.filter(r => r.isCorrect).length;
    if (onComplete) onComplete({ results, correct, total: item.blanks.length });
  }

  const correct = submitted ? item.blanks.filter((b, i) => {
    const expected = b.original_word.toLowerCase().replace(/[^a-z]/g, "");
    const fragment = b.displayed_fragment.toLowerCase();
    const userFull = (fragment + answers[i]).toLowerCase().replace(/[^a-z]/g, "");
    return userFull === expected;
  }).length : 0;

  // Build display text with inline inputs
  function renderPassage() {
    const sentences = item.passage.split(/(?<=[.!?])\s+/);
    const firstSentence = item.first_sentence || sentences[0];
    const blankPositions = new Set(item.blanks.map(b => b.position));

    // Tokenize entire passage
    const allWords = item.passage.split(/\s+/);
    let blankIndex = 0;
    const elements = [];

    for (let wi = 0; wi < allWords.length; wi++) {
      const isBlank = blankPositions.has(wi);
      if (isBlank && blankIndex < item.blanks.length) {
        const blank = item.blanks[blankIndex];
        const bi = blankIndex;
        const fragment = blank.displayed_fragment;
        const missingLen = blank.original_word.length - fragment.length;
        // Strip trailing punctuation from the original word to check
        const trailingPunct = allWords[wi].match(/[.,;:!?]+$/)?.[0] || "";

        const isCorrect = submitted && (fragment + answers[bi]).toLowerCase().replace(/[^a-z]/g, "") === blank.original_word.toLowerCase().replace(/[^a-z]/g, "");
        const isWrong = submitted && !isCorrect;

        elements.push(
          <span key={`blank-${bi}`} style={{ display: "inline", whiteSpace: "nowrap" }}>
            {/* Visible prefix letters */}
            <span style={{ fontSize: 16, fontWeight: 600, color: C.t1, fontFamily: "'Courier New', monospace", letterSpacing: "1px" }}>{fragment}</span>
            {/* Input styled as underscores — each underscore = 1 missing letter */}
            <span style={{ position: "relative", display: "inline-block", verticalAlign: "baseline" }}>
              {/* Underscore guides underneath */}
              <span style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                fontSize: 16, fontFamily: "'Courier New', monospace", letterSpacing: "1px",
                color: submitted ? (isCorrect ? "#059669" : "#DC2626") : "#94A3B8",
                pointerEvents: "none", userSelect: "none",
              }}>
                {"_".repeat(missingLen)}
              </span>
              <input
                ref={el => inputRefs.current[bi] = el}
                type="text"
                value={answers[bi]}
                onChange={e => {
                  const val = e.target.value.slice(0, missingLen);
                  handleChange(bi, val);
                }}
                onKeyDown={e => handleKeyDown(bi, e)}
                disabled={submitted}
                maxLength={missingLen}
                style={{
                  width: missingLen * 11.5,
                  border: "none",
                  background: "transparent",
                  outline: "none",
                  fontSize: 16,
                  fontFamily: "'Courier New', monospace",
                  fontWeight: 600,
                  letterSpacing: "1px",
                  color: submitted ? (isCorrect ? "#059669" : "#DC2626") : accent.color,
                  padding: 0,
                  margin: 0,
                  caretColor: accent.color,
                }}
              />
            </span>
            {/* Show correct answer if wrong */}
            {isWrong && (
              <span style={{ fontSize: 12, color: "#DC2626", fontWeight: 600, marginLeft: 2 }}>
                ({blank.original_word})
              </span>
            )}
            {trailingPunct && <span style={{ fontSize: 16, color: C.t1 }}>{trailingPunct}</span>}
          </span>
        );
        blankIndex++;
      } else {
        elements.push(<span key={`word-${wi}`} style={{ fontSize: 15, lineHeight: 2.0, color: C.t1 }}>{allWords[wi]} </span>);
      }
    }

    return elements;
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar
        title="Complete the Words"
        section="Reading | Task 1"
        timeLeft={!isPractice && timeLimit > 0 && !submitted ? timeLeft : undefined}
        elapsedTime={isPractice && !submitted ? elapsed : undefined}
        examTimeNote={isPractice && timeLimit > 0 ? `考试限时 ${Math.floor(timeLimit / 60)} min` : undefined}
        onExit={onExit}
      />
      <PageShell narrow>
        {/* Instructions */}
        <div style={{ fontSize: 13, color: C.t2, marginBottom: 16, lineHeight: 1.6 }}>
          阅读文章，根据上下文补全每个空缺单词的缺失字母。每个单词的开头字母已给出。
        </div>

        {/* Topic badge */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 999, background: accent.soft, border: `1px solid ${accent.color}25`, fontSize: 12, color: accent.color, fontWeight: 600, marginBottom: 16 }}>
          {item.topic} / {item.subtopic}
        </div>

        {/* Passage with blanks */}
        <SurfaceCard style={{ padding: "24px 28px", marginBottom: 20, lineHeight: 2.2 }}>
          <div style={{ fontFamily: "'Georgia', 'Noto Serif SC', serif", fontSize: 15, color: C.t1, lineHeight: 2.2 }}>
            {renderPassage()}
          </div>
        </SurfaceCard>

        {/* Submit / Result */}
        {!submitted ? (
          <div style={{ textAlign: "center" }}>
            <Btn onClick={handleSubmit} style={{ minWidth: 200, fontSize: 15, padding: "12px 32px" }}>
              提交答案
            </Btn>
          </div>
        ) : (
          <SurfaceCard style={{ padding: "20px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: correct === item.blanks.length ? "#059669" : correct >= 7 ? "#D97706" : "#DC2626", marginBottom: 8 }}>
              {correct} / {item.blanks.length}
            </div>
            <div style={{ fontSize: 14, color: C.t2, marginBottom: 16 }}>
              {correct === item.blanks.length ? "全部正确！" : correct >= 7 ? "不错！请回顾上方的错误答案。" : "继续加油！请回顾上方标红的正确答案。"}
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <Btn onClick={onExit} variant="secondary">返回</Btn>
              <Btn onClick={() => { setAnswers(item.blanks.map(() => "")); setSubmitted(false); }}>重新作答</Btn>
            </div>
          </SurfaceCard>
        )}
      </PageShell>
    </div>
  );
}
