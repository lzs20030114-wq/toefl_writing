"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { C, FONT, Btn, PageShell, SurfaceCard, TopBar } from "../shared/ui";
import { buildDraftKey, loadDraft, clearDraft, useDraftPersist } from "../../lib/draftPersist";

/**
 * RDL Task — matches real TOEFL interface:
 * - One question at a time (passage always visible)
 * - Select answer → Next (no immediate feedback)
 * - After all questions → Submit → See all results at once
 */
export function RDLTask({ item, onExit, onComplete, timeLimit = 0, isPractice = false, title = "Read in Daily Life", section = "Reading | Task 2" }) {
  // Scope drafts by item id; reading tasks use the same RDLTask shell for AP too,
  // so prefix the id with the perceived subtype to avoid collisions.
  const draftKey = buildDraftKey("rdl", item?.id || "");
  const draftRestored = loadDraft(draftKey);
  const [selections, setSelections] = useState(() => {
    const qLen = (item?.questions || []).length;
    if (Array.isArray(draftRestored?.selections) && draftRestored.selections.length === qLen) {
      return draftRestored.selections;
    }
    return (item?.questions || []).map(() => null);
  });
  const [currentQ, setCurrentQ] = useState(() => {
    const idx = Number(draftRestored?.currentQ);
    if (Number.isInteger(idx) && idx >= 0 && idx < (item?.questions || []).length) return idx;
    return 0;
  });
  const [submitted, setSubmitted] = useState(false);

  useDraftPersist(draftKey, { selections, currentQ }, { enabled: !submitted });

  // Timer state
  const [timeLeft, setTimeLeft] = useState(timeLimit > 0 ? timeLimit : 0);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const autoSubmittedRef = useRef(false);

  const accent = { color: "#3B82F6", soft: "#EFF6FF" };
  const questions = item.questions || [];
  const question = questions[currentQ];
  const answeredCount = selections.filter(s => s !== null).length;
  const allAnswered = answeredCount === questions.length;

  // Timer: countdown or elapsed
  useEffect(() => {
    if (submitted) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setElapsed(prev => prev + 1);
      if (timeLimit > 0) {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [submitted, timeLimit]);

  // Auto-submit when time runs out
  useEffect(() => {
    if (timeLimit > 0 && timeLeft === 0 && !submitted && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      // Force submit with whatever is answered
      setSubmitted(true);
      clearDraft(draftKey);
      setCurrentQ(0);
      const results = questions.map((q, i) => ({
        selected: selections[i],
        correct: q.correct_answer,
        isCorrect: selections[i] === q.correct_answer,
      }));
      const correct = results.filter(r => r.isCorrect).length;
      if (onComplete) onComplete({ results, correct, total: questions.length });
    }
  }, [timeLeft, timeLimit, submitted, selections, questions, onComplete, draftKey]);

  function handleSelect(key) {
    if (submitted) return;
    setSelections(prev => {
      const next = [...prev];
      next[currentQ] = key;
      return next;
    });
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
    if (!allAnswered) return;
    setSubmitted(true);
    clearDraft(draftKey);
    setCurrentQ(0); // Go back to Q1 to review
    const results = questions.map((q, i) => ({
      selected: selections[i],
      correct: q.correct_answer,
      isCorrect: selections[i] === q.correct_answer,
    }));
    const correct = results.filter(r => r.isCorrect).length;
    if (onComplete) onComplete({ results, correct, total: questions.length });
  }

  const results = submitted ? questions.map((q, i) => ({
    selected: selections[i],
    correct: q.correct_answer,
    isCorrect: selections[i] === q.correct_answer,
  })) : null;
  const correctCount = results ? results.filter(r => r.isCorrect).length : 0;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar
        title={title}
        section={section}
        timeLeft={!isPractice && timeLimit > 0 && !submitted ? timeLeft : undefined}
        elapsedTime={isPractice && !submitted ? elapsed : undefined}
        examTimeNote={isPractice && timeLimit > 0 ? `考试限时 ${Math.floor(timeLimit / 60)} min` : undefined}
        qInfo={`${currentQ + 1} / ${questions.length}`}
        onExit={onExit}
      />
      <PageShell narrow>
        {/* Score banner (after submit) */}
        {submitted && (
          <SurfaceCard style={{
            padding: "16px 20px", marginBottom: 16, textAlign: "center",
            background: correctCount === questions.length ? "#F0FDF4" : correctCount >= 2 ? "#FFFBEB" : "#FEF2F2",
            border: `1px solid ${correctCount === questions.length ? "#BBF7D0" : correctCount >= 2 ? "#FDE68A" : "#FECACA"}`,
          }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: correctCount === questions.length ? "#059669" : correctCount >= 2 ? "#D97706" : "#DC2626" }}>
              {correctCount} / {questions.length}
            </div>
            <div style={{ fontSize: 13, color: C.t2, marginTop: 4 }}>
              {correctCount === questions.length ? "全部正确！" : "使用下方导航回顾每道题的详解。"}
            </div>
            <div style={{ marginTop: 10 }}>
              <Btn onClick={onExit} variant="secondary" style={{ fontSize: 13 }}>返回</Btn>
            </div>
          </SurfaceCard>
        )}

        {/* Genre badge */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 999, background: accent.soft, border: `1px solid ${accent.color}25`, fontSize: 12, color: accent.color, fontWeight: 600, marginBottom: 12 }}>
          {item.genre}
        </div>

        {/* Passage */}
        <SurfaceCard style={{ padding: "20px 24px", marginBottom: 16, maxHeight: submitted ? 180 : 260, overflow: "auto" }}>
          <div style={{ fontSize: 14, color: C.t1, lineHeight: 1.8, whiteSpace: "pre-wrap", fontFamily: FONT }}>
            {item.text}
          </div>
        </SurfaceCard>

        {/* Question navigation dots */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 16 }}>
          {questions.map((_, i) => {
            const isActive = i === currentQ;
            const isAnswered = selections[i] !== null;
            const r = results ? results[i] : null;

            let bg = "#E5E7EB";
            let border = "#D1D5DB";
            let color = C.t3;

            if (submitted && r) {
              bg = r.isCorrect ? "#D1FAE5" : "#FEE2E2";
              border = r.isCorrect ? "#059669" : "#DC2626";
              color = r.isCorrect ? "#059669" : "#DC2626";
            } else if (isActive) {
              bg = accent.color;
              border = accent.color;
              color = "#fff";
            } else if (isAnswered) {
              bg = accent.soft;
              border = accent.color;
              color = accent.color;
            }

            return (
              <button
                key={i}
                onClick={() => setCurrentQ(i)}
                style={{
                  width: 32, height: 32, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: bg, border: `2px solid ${border}`,
                  fontSize: 13, fontWeight: 700, color,
                  cursor: "pointer", transition: "all 0.15s",
                }}
              >
                {submitted && r ? (r.isCorrect ? "✓" : "✗") : i + 1}
              </button>
            );
          })}
        </div>

        {/* Current question */}
        <SurfaceCard style={{
          padding: "24px 28px",
          border: submitted ? `2px solid ${results[currentQ].isCorrect ? "#BBF7D0" : "#FECACA"}` : `1px solid ${C.bdr}`,
        }}>
          <div style={{ fontSize: 13, color: C.t3, marginBottom: 8 }}>
            第 {currentQ + 1} 题 / 共 {questions.length} 题
            <span style={{ marginLeft: 8, color: accent.color }}>({question.question_type})</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.t1, marginBottom: 16, lineHeight: 1.5 }}>
            {question.stem}
          </div>

          {/* Options — circle radio style like real TOEFL */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {["A", "B", "C", "D"].map(key => {
              const isSelected = selections[currentQ] === key;
              const r = results ? results[currentQ] : null;
              const isCorrectOption = submitted && key === question.correct_answer;
              const isWrongSelected = submitted && isSelected && key !== question.correct_answer;

              let bg = "#FAFAFA";
              let border = "#E5E7EB";
              let color = C.t1;

              if (submitted) {
                if (isCorrectOption) { bg = "#D1FAE5"; border = "#059669"; color = "#065F46"; }
                else if (isWrongSelected) { bg = "#FEE2E2"; border = "#DC2626"; color = "#991B1B"; }
                else { color = C.t3; }
              } else if (isSelected) {
                bg = accent.soft; border = accent.color; color = accent.color;
              }

              return (
                <button
                  key={key}
                  onClick={() => handleSelect(key)}
                  disabled={submitted}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 14px", borderRadius: 8,
                    background: bg, border: `1.5px solid ${border}`,
                    cursor: submitted ? "default" : "pointer",
                    textAlign: "left", fontFamily: FONT, fontSize: 14, color,
                    transition: "all 0.12s",
                  }}
                >
                  {/* Circle radio — like real TOEFL (no letter labels) */}
                  <span style={{
                    width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                    border: `2px solid ${submitted ? (isCorrectOption ? "#059669" : isWrongSelected ? "#DC2626" : "#D1D5DB") : isSelected ? accent.color : "#D1D5DB"}`,
                    background: isSelected && !submitted ? accent.color : isCorrectOption ? "#059669" : isWrongSelected ? "#DC2626" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {(isSelected && !submitted) && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />}
                    {isCorrectOption && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
                    {isWrongSelected && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✗</span>}
                  </span>
                  <span style={{ flex: 1 }}>{question.options[key]}</span>
                </button>
              );
            })}
          </div>

          {/* Explanation (only after submit) */}
          {submitted && question.explanation && (
            <div style={{
              marginTop: 14, padding: "10px 14px", borderRadius: 8,
              background: results[currentQ].isCorrect ? "#F0FDF4" : "#FEF2F2",
              border: `1px solid ${results[currentQ].isCorrect ? "#BBF7D0" : "#FECACA"}`,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: results[currentQ].isCorrect ? "#065F46" : "#991B1B", marginBottom: 3 }}>
                {results[currentQ].isCorrect ? "回答正确" : `回答错误 — 正确答案: ${question.correct_answer}`}
              </div>
              <div style={{ fontSize: 12, color: C.t2, lineHeight: 1.5 }}>{question.explanation}</div>
            </div>
          )}
        </SurfaceCard>

        {/* Navigation + Submit */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 32 }}>
          <Btn
            onClick={handlePrev}
            variant="secondary"
            disabled={currentQ === 0}
            style={{ opacity: currentQ === 0 ? 0.4 : 1, fontSize: 13, minWidth: 80 }}
          >
            ← 上一题
          </Btn>

          {!submitted && (
            <div style={{ textAlign: "center", fontSize: 12, color: C.t3 }}>
              {allAnswered ? "可以提交" : `已作答 ${answeredCount}/${questions.length}`}
            </div>
          )}

          {!submitted && currentQ === questions.length - 1 && allAnswered ? (
            <Btn onClick={handleSubmit} style={{ fontSize: 13, minWidth: 120 }}>
              提交全部
            </Btn>
          ) : (
            <Btn
              onClick={handleNext}
              variant={submitted ? "secondary" : undefined}
              disabled={currentQ === questions.length - 1 && submitted}
              style={{ opacity: currentQ === questions.length - 1 && submitted ? 0.4 : 1, fontSize: 13, minWidth: 80 }}
            >
              下一题 →
            </Btn>
          )}
        </div>
      </PageShell>
    </div>
  );
}
