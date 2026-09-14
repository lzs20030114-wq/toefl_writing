"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { C, FONT, READING_FONT, Btn, SurfaceCard, TopBar } from "../shared/ui";
import { buildDraftKey, loadDraft, clearDraft, useDraftPersist } from "../../lib/draftPersist";
import { getVocabTargetWord, splitForHighlight, VOCAB_HIGHLIGHT_STYLE } from "../../lib/reading/vocabHighlight";
import { materialImageSrc } from "../../lib/reading/materialImage";
import { questionTypeLabel } from "../../lib/reading/questionTypeLabels";
import {
  isSentenceSelection,
  sentenceOptionKeys,
  sentenceOptionText,
  sentenceSelectionLayout,
  sentenceSelectionSegments,
} from "../../lib/reading/sentenceSelection";
import { useReadingAiExplain, ReadingAiExplainBlock } from "./useReadingAiExplain";

const MCQ_KEYS = ["A", "B", "C", "D"];

// 选句题的句子是行内 span（按钮是 inline-block，会把整句顶成一块、打断正文换行），
// 键盘焦点环只能靠 :focus-visible —— 行内 style 写不了伪类，这里挂一小段样式。
// 顺带一条提示语的断点：≤768px 时阅读分栏上下堆叠（app/mobile.css 同一断点），文章在题目上方，
// 「点击左侧文章」要换成「点击上方文章」。
const SENTENCE_SELECTION_CSS = [
  ".tp-ss-sentence:focus-visible{outline:2px solid #3B82F6;outline-offset:2px;}",
  ".tp-ss-hint-stacked{display:none;}",
  "@media (max-width: 768px){.tp-ss-hint-split{display:none;}.tp-ss-hint-stacked{display:inline;}}",
].join("");

/**
 * RDL Task — matches real TOEFL interface:
 * - Two-column layout: passage on the left, question on the right (real-exam style)
 * - One question at a time (passage always visible)
 * - Select answer → Next (no immediate feedback)
 * - After all questions → Submit → See all results at once
 *
 * 真题学术阅读的选句题（sentence_selection，契约见 lib/reading/sentenceSelection.js）：
 * 作答区在左栏 —— paragraphs[paragraph_index] 那一段的每一句变成可点（悬停淡高亮、选中实底、
 * Tab/Enter 可操作），右栏只放题干 + 「第 N 段」提示（N = 题干段号 paragraph，只管展示）+「已选：…」。
 * 原图模式下这道题强制显示文字（图上点不了句子）。
 * 版面定位不到时（mapper 已拦，这里兜底）右栏退回逐句列表作答，绝不出点不了的死题。
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
  // 材料框原图（真题专区独有的可选字段）。有图默认显示图 —— 真题界面的版面
  // （邮件表头 / 短信气泡 / 海报分栏 / 柱状图）在纯文本里是丢掉的。
  const materialImage = materialImageSrc(item);
  const [showMaterialImage, setShowMaterialImage] = useState(true);
  useEffect(() => { setShowMaterialImage(true); }, [item?.id]);

  useDraftPersist(draftKey, { selections, currentQ }, { enabled: !submitted });

  // Timer state
  const [timeLeft, setTimeLeft] = useState(timeLimit > 0 ? timeLimit : 0);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const autoSubmittedRef = useRef(false);

  const accent = { color: "#3B82F6", soft: "#EFF6FF" };
  const questions = item.questions || [];
  const question = questions[currentQ];
  // Vocab-in-context: highlight the asked word in the passage (real-exam behavior).
  const vocabWord = getVocabTargetWord(question);
  const answeredCount = selections.filter(s => s !== null).length;
  const allAnswered = answeredCount === questions.length;

  // 选句题：第 N 段每一句在正文里的位置。null = 不是选句题，或定位不到（→ 右栏列表兜底）。
  const isSelection = isSentenceSelection(question);
  const selectionLayout = useMemo(
    () => (isSelection ? sentenceSelectionLayout(item, question) : null),
    // item 是页面每次渲染新拼的适配对象，只盯真正参与定位的字段。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSelection, item.text, item.passage, item.paragraphs, question]
  );
  const [hoverSentence, setHoverSentence] = useState(null); // `${题号}:${S 键}`
  // 交卷后答错的题可点开看 AI 讲解（Pro 门 + 缓存在 hook 里，点了才计费）。
  const readingAi = useReadingAiExplain();
  const leftPaneRef = useRef(null);
  const selectionParagraphRef = useRef(null);

  // 切到选句题时把第 N 段滚进左栏视口（整段已经可见就不动，免得来回切题时文章乱跳）。
  // 只滚左栏自己的滚动容器，不动整页 —— 手机上左栏在上、题目在下，整页一滚题目就没了。
  useEffect(() => {
    if (!selectionLayout) return;
    const box = leftPaneRef.current;
    const target = selectionParagraphRef.current;
    if (!box || !target) return;
    const b = box.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    if (t.top >= b.top && t.bottom <= b.bottom) return;
    const top = Math.max(0, box.scrollTop + (t.top - b.top) - 16);
    if (typeof box.scrollTo === "function") box.scrollTo({ top, behavior: "smooth" });
    else box.scrollTop = top;
  }, [currentQ, selectionLayout]);

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

  // Centered heading — show the passage's own title when the bank provides one,
  // otherwise fall back to the task label ("Read in Daily Life" / "Academic Passage").
  const heading = item.format_metadata?.title || item.format_metadata?.subject || title;

  // 原图模式下，选句题强制显示文字（图上没法点句子）；换到别的题，原图偏好照旧生效。
  const forceText = !!selectionLayout;
  const showImage = !!materialImage && showMaterialImage && !forceText;
  // 右栏选项键：四选一 A–D；选句题（仅在正文定位不到时走列表兜底）用 S1..Sn。
  const optionKeys = isSelection ? sentenceOptionKeys(question.options) : MCQ_KEYS;
  const selectedKey = selections[currentQ];
  const selectedSentence = isSelection ? sentenceOptionText(question, selectedKey) : "";
  const correctSentence = isSelection ? sentenceOptionText(question, question.correct_answer) : "";

  const renderPlain = (text, keyPrefix) => (
    vocabWord
      ? splitForHighlight(text, vocabWord).map((seg, i) =>
          seg.hit
            ? <mark key={`${keyPrefix}-${i}`} style={VOCAB_HIGHLIGHT_STYLE}>{seg.text}</mark>
            : <span key={`${keyPrefix}-${i}`}>{seg.text}</span>
        )
      : text
  );

  // 选句题的正文：段前 / 第 N 段（逐句可点）/ 段后。词汇高亮在每一截里照常生效。
  function renderSelectionPassage() {
    const { before, paragraph, after } = sentenceSelectionSegments(item.text, selectionLayout);
    return (
      <>
        {renderPlain(before, "before")}
        <span
          ref={selectionParagraphRef}
          data-testid="ss-paragraph"
          data-paragraph={selectionLayout.paragraph}
          data-paragraph-index={selectionLayout.paragraphIndex}
        >
          {paragraph.map((part, i) => {
            if (part.type !== "sentence") return <span key={`gap-${i}`}>{renderPlain(part.text, `gap-${i}`)}</span>;
            const { key } = part;
            const isChosen = selectedKey === key;
            const isHover = !submitted && hoverSentence === `${currentQ}:${key}`;
            let state = "idle";
            if (submitted) {
              if (key === question.correct_answer) state = "correct";
              else if (isChosen) state = "wrong";
              else state = "review";
            } else if (isChosen) state = "selected";
            else if (isHover) state = "hover";

            // 每个状态写满同一组长属性：简写 textDecoration 与长属性混用，切状态时 React 会报样式冲突。
            const [background, color, underline] = {
              idle: ["transparent", C.t1, `${accent.color}66`],
              hover: [accent.soft, C.t1, accent.color],
              selected: [accent.color, "#fff", null],
              correct: ["#D1FAE5", "#065F46", null],
              wrong: ["#FEE2E2", "#991B1B", null],
              review: ["transparent", C.t1, null],
            }[state];
            const look = {
              background,
              color,
              textDecorationLine: underline ? "underline" : "none",
              textDecorationStyle: "dashed",
              textDecorationColor: underline || "transparent",
            };
            const interactive = !submitted;
            return (
              <span
                key={key}
                className="tp-ss-sentence"
                data-ss-key={key}
                data-ss-state={state}
                data-no-dict={interactive ? "" : undefined}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-pressed={interactive ? isChosen : undefined}
                onClick={interactive ? () => handleSelect(key) : undefined}
                onKeyDown={interactive ? (e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelect(key); }
                } : undefined}
                onMouseEnter={interactive ? () => setHoverSentence(`${currentQ}:${key}`) : undefined}
                onMouseLeave={interactive ? () => setHoverSentence(null) : undefined}
                style={{
                  ...look,
                  textUnderlineOffset: 5,
                  borderRadius: 4,
                  // 只给竖向内边距：行内元素的横向 padding 会占宽度，切到本题时整段换行位置会跟着变。
                  padding: "2px 0",
                  boxDecorationBreak: "clone",
                  WebkitBoxDecorationBreak: "clone",
                  cursor: interactive ? "pointer" : "default",
                  transition: "background 0.12s, color 0.12s",
                }}
              >
                {renderPlain(part.text, `s-${key}`)}
              </span>
            );
          })}
        </span>
        {renderPlain(after, "after")}
      </>
    );
  }

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

      <div className="tp-shell-inner" style={{ maxWidth: 1180, margin: "0 auto", padding: "20px 24px 40px" }}>
        {/* Centered passage heading — real-exam style */}
        <h1 className="tp-reading-title" style={{ textAlign: "center", fontSize: 22, fontWeight: 700, color: C.t1, margin: "4px 0 18px", lineHeight: 1.3, fontFamily: READING_FONT }}>
          {heading}
        </h1>

        {/* Score banner (after submit) — full width, above the split */}
        {submitted && (
          <SurfaceCard style={{
            padding: "14px 20px", marginBottom: 16, textAlign: "center",
            background: correctCount === questions.length ? "#F0FDF4" : correctCount >= 2 ? "#FFFBEB" : "#FEF2F2",
            border: `1px solid ${correctCount === questions.length ? "#BBF7D0" : correctCount >= 2 ? "#FDE68A" : "#FECACA"}`,
          }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: correctCount === questions.length ? "#059669" : correctCount >= 2 ? "#D97706" : "#DC2626" }}>
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

        {/* Two-column split: passage (left) + question (right) — real TOEFL layout */}
        <div
          className="tp-reading-split"
          style={{
            display: "flex",
            alignItems: "stretch",
            height: `calc(100vh - ${submitted ? 290 : 168}px)`,
            minHeight: 380,
            background: C.card,
            border: `1px solid ${C.bdr}`,
            borderRadius: 14,
            boxShadow: C.shadow,
            overflow: "hidden",
          }}
        >
          {/* LEFT — passage (scrolls independently) */}
          <div ref={leftPaneRef} className="tp-reading-left" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "22px 26px", borderRight: `1px solid ${C.bdr}` }}>
            {/* Genre / topic badge */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 999, background: accent.soft, border: `1px solid ${accent.color}25`, fontSize: 12, color: accent.color, fontWeight: 600, marginBottom: 14 }}>
              {item.genre}
            </div>
            {/* 材料原图（真题）：默认显图，可切回文本；没有该字段时整段行为与从前一致。
                选句题例外：强制显示文字（showImage 已把它排除）。 */}
            {showImage ? (
              <div>
                {vocabWord && (
                  <div style={{
                    fontSize: 12.5, color: "#92400E", background: "#FFFBEB",
                    border: "1px solid #FDE68A", borderRadius: 8,
                    padding: "7px 10px", marginBottom: 10, lineHeight: 1.5,
                  }}>
                    本题考查词汇，可切换为文字查看高亮
                  </div>
                )}
                <img
                  src={materialImage}
                  alt={item.genre ? `真题材料原图：${item.genre}` : "真题材料原图"}
                  style={{
                    display: "block", maxWidth: "100%", height: "auto",
                    borderRadius: 10, border: `1px solid ${C.bdr}`, background: "#fff",
                  }}
                />
                <button
                  onClick={() => setShowMaterialImage(false)}
                  style={{
                    marginTop: 10, padding: "6px 12px", borderRadius: 999,
                    border: `1px solid ${C.bdr}`, background: "#fff",
                    fontSize: 12.5, color: C.t2, cursor: "pointer", fontFamily: FONT,
                  }}
                >
                  切换为文字
                </button>
              </div>
            ) : (
              <>
                {forceText && materialImage && showMaterialImage && (
                  <div style={{
                    fontSize: 12.5, color: "#1E40AF", background: accent.soft,
                    border: `1px solid ${accent.color}33`, borderRadius: 8,
                    padding: "7px 10px", marginBottom: 10, lineHeight: 1.5,
                  }}>
                    {submitted ? "选句题在文字里回看，已切换为文字" : "本题需要在文章里点选句子，已切换为文字"}
                  </div>
                )}
                {forceText && <style>{SENTENCE_SELECTION_CSS}</style>}
                {/* Passage */}
                <div style={{ fontSize: 15, color: C.t1, lineHeight: 1.9, whiteSpace: "pre-wrap", fontFamily: READING_FONT }}>
                  {selectionLayout
                    ? renderSelectionPassage()
                    : vocabWord
                      ? splitForHighlight(item.text, vocabWord).map((seg, i) =>
                          seg.hit
                            ? <mark key={i} style={VOCAB_HIGHLIGHT_STYLE}>{seg.text}</mark>
                            : <span key={i}>{seg.text}</span>
                        )
                      : item.text}
                </div>
                {materialImage && !forceText && (
                  <button
                    onClick={() => setShowMaterialImage(true)}
                    style={{
                      marginTop: 14, padding: "6px 12px", borderRadius: 999,
                      border: `1px solid ${C.bdr}`, background: "#fff",
                      fontSize: 12.5, color: C.t2, cursor: "pointer", fontFamily: FONT,
                    }}
                  >
                    查看原图
                  </button>
                )}
              </>
            )}
          </div>

          {/* RIGHT — question (scrolls independently) */}
          <div className="tp-reading-right" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "22px 26px", display: "flex", flexDirection: "column" }}>
            {/* Question navigation dots */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
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
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: C.t3, marginBottom: 8 }}>
                第 {currentQ + 1} 题 / 共 {questions.length} 题
                {questionTypeLabel(question.question_type) && (
                  <span style={{ marginLeft: 8, color: accent.color }}>({questionTypeLabel(question.question_type)})</span>
                )}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 18, lineHeight: 1.5, fontFamily: READING_FONT }}>
                {question.stem}
              </div>

              {/* 选句题：作答在左栏正文里，右栏只报「已选哪一句」 */}
              {selectionLayout && !submitted && (
                <div data-testid="ss-answer-panel">
                  <div style={{ fontSize: 13, color: C.t2, marginBottom: 10, lineHeight: 1.5 }}>
                    <span className="tp-ss-hint-split">点击左侧文章第 {selectionLayout.paragraph} 段中的一句作答</span>
                    <span className="tp-ss-hint-stacked">点击上方文章第 {selectionLayout.paragraph} 段中的一句作答</span>
                  </div>
                  <div style={{
                    padding: "11px 14px", borderRadius: 8, lineHeight: 1.6,
                    background: selectedSentence ? accent.soft : "#FAFAFA",
                    border: `1.5px solid ${selectedSentence ? accent.color : "#E5E7EB"}`,
                  }}>
                    {selectedSentence ? (
                      <>
                        <span style={{ fontSize: 13, fontWeight: 700, color: accent.color }}>已选：</span>
                        <span style={{ fontSize: 14, color: C.t1, fontFamily: READING_FONT }}>{selectedSentence}</span>
                      </>
                    ) : (
                      <span style={{ fontSize: 13, color: C.t3 }}>尚未选择</span>
                    )}
                  </div>
                </div>
              )}

              {/* Options — circle radio style like real TOEFL (no letter labels) */}
              {!selectionLayout && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {optionKeys.map(key => {
                  const isSelected = selections[currentQ] === key;
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
                        padding: "11px 14px", borderRadius: 8,
                        background: bg, border: `1.5px solid ${border}`,
                        cursor: submitted ? "default" : "pointer",
                        textAlign: "left", fontFamily: READING_FONT, fontSize: 14, color,
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
              )}

              {/* 选句题复盘：正确句原文必须写出来（S 键对用户没有意义） */}
              {submitted && isSelection && (
                <div data-testid="ss-review" style={{
                  marginTop: selectionLayout ? 0 : 16, padding: "10px 14px", borderRadius: 8,
                  background: results[currentQ].isCorrect ? "#F0FDF4" : "#FEF2F2",
                  border: `1px solid ${results[currentQ].isCorrect ? "#BBF7D0" : "#FECACA"}`,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: results[currentQ].isCorrect ? "#065F46" : "#991B1B", marginBottom: 6 }}>
                    {results[currentQ].isCorrect ? "回答正确" : "回答错误"}
                  </div>
                  {!results[currentQ].isCorrect && (
                    <div style={{ fontSize: 13, color: "#991B1B", lineHeight: 1.6, marginBottom: 6 }}>
                      <span style={{ fontWeight: 700 }}>你选的：</span>
                      <span style={{ fontFamily: READING_FONT }}>{selectedSentence || "未作答"}</span>
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: "#065F46", lineHeight: 1.6 }}>
                    <span style={{ fontWeight: 700 }}>正确句：</span>
                    <span style={{ fontFamily: READING_FONT }}>{correctSentence}</span>
                  </div>
                  {question.explanation && (
                    <div style={{ fontSize: 12, color: C.t2, lineHeight: 1.5, marginTop: 6 }}>{question.explanation}</div>
                  )}
                </div>
              )}

              {/* Explanation (only after submit) */}
              {submitted && !isSelection && question.explanation && (
                <div style={{
                  marginTop: 16, padding: "10px 14px", borderRadius: 8,
                  background: results[currentQ].isCorrect ? "#F0FDF4" : "#FEF2F2",
                  border: `1px solid ${results[currentQ].isCorrect ? "#BBF7D0" : "#FECACA"}`,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: results[currentQ].isCorrect ? "#065F46" : "#991B1B", marginBottom: 3 }}>
                    {results[currentQ].isCorrect ? "回答正确" : `回答错误 — 正确答案: ${question.correct_answer}`}
                  </div>
                  <div style={{ fontSize: 12, color: C.t2, lineHeight: 1.5 }}>{question.explanation}</div>
                </div>
              )}

              {/* AI 讲解：交卷后只给答错的题。题库自带的 explanation 可能缺失，
                  这一块独立于它渲染 —— 没有静态解析的题恰恰最需要讲解。 */}
              {submitted && !results[currentQ].isCorrect && (
                <ReadingAiExplainBlock
                  explainKey={`${item.id || "task"}-q${currentQ}`}
                  detail={{
                    qid: question.qid || `${item.id || "task"}-q${currentQ}`,
                    stem: question.stem,
                    question,
                    options: question.options,
                    selected: selections[currentQ],
                    correct: question.correct_answer,
                    passage: item.text || item.passage,
                    isCorrect: results[currentQ].isCorrect,
                  }}
                  {...readingAi}
                />
              )}
            </div>

            {/* Navigation + Submit — pinned to the bottom of the question column */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.bdrSubtle}` }}>
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
                <Btn
                  onClick={handleSubmit}
                  style={{
                    fontSize: 13,
                    minWidth: 120,
                    background: accent.color,
                    borderColor: accent.color,
                  }}
                >
                  提交全部
                </Btn>
              ) : (
                <Btn
                  onClick={handleNext}
                  variant={submitted ? "secondary" : undefined}
                  disabled={currentQ === questions.length - 1 && submitted}
                  style={{
                    opacity: currentQ === questions.length - 1 && submitted ? 0.4 : 1,
                    fontSize: 13,
                    minWidth: 80,
                    ...(submitted ? {} : { background: accent.color, borderColor: accent.color }),
                  }}
                >
                  下一题 →
                </Btn>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
