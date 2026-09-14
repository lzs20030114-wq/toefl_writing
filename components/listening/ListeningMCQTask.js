"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { C, FONT, Btn, TopBar, SurfaceCard, PageShell } from "../shared/ui";
import { AudioPlayer } from "./AudioPlayer";
import { useListeningAiExplain, ListeningAiExplainBlock, conversationText } from "./useListeningAiExplain";
import { buildDraftKey, loadDraft, clearDraft, useDraftPersist } from "../../lib/draftPersist";
import { listeningSecondsForType, formatAnswerTime } from "../../lib/listeningTiming";

const ACCENT = { color: "#8B5CF6", soft: "#F3E8FF" };
const KEYS = ["A", "B", "C", "D"];

/**
 * Generic Listening MCQ Task — used for LA (Announcement), LC (Conversation), LAT (Academic Talk).
 *
 * Data shape expected:
 *   item.audio_url — URL to audio file (optional, falls back to TTS of transcript)
 *   item.transcript OR item.announcement OR item.lecture — text for TTS fallback
 *   item.questions[] — array of { stem, options: {A,B,C,D}, answer, type, explanation }
 *
 * Flow: listen to audio → answer questions one by one → results
 */
// Gender per turn: speakers[].gender by name, else infer from the conventional
// "Man"/"Woman" labels, else null (player falls back to the default voice).
function conversationTurns(item) {
  const byName = {};
  for (const sp of item.speakers || []) if (sp && sp.name) byName[sp.name] = sp.gender;
  return (item.conversation || []).map((t) => {
    const name = String(t.speaker || "");
    const g = byName[name] || (/^wom[ae]n$|^female$|^girl$/i.test(name) ? "female" : /^m[ae]n$|^male$|^boy$/i.test(name) ? "male" : null);
    return { text: String(t.text || ""), gender: g };
  });
}

export function ListeningMCQTask({ item, taskType, onComplete, onExit, onNext, isPractice = false, title = "Listening", section = "Listening" }) {
  const questions = item?.questions || [];
  const totalQ = questions.length;
  const answerSeconds = listeningSecondsForType(taskType);

  // Get the text for TTS fallback
  const transcript = item?.transcript || item?.announcement || item?.lecture || "";
  // For conversations: never speak the speaker labels ("Man:"), and hand the player
  // the turns with genders so the fallback can voice the two speakers differently.
  const ttsText = item?.conversation
    ? item.conversation.map(t => t.text).join(" ")
    : transcript;
  const ttsTurns = item?.conversation ? conversationTurns(item) : null;

  // Restore in-progress selections from localStorage when re-opening the same item.
  const draftKey = buildDraftKey("listening-mcq", item?.id || "");
  const draftRestored = loadDraft(draftKey);
  const initialSelections = (() => {
    if (Array.isArray(draftRestored?.selections) && draftRestored.selections.length === totalQ) {
      return draftRestored.selections;
    }
    return Array(totalQ).fill(null);
  })();
  // If user already started answering, skip the listen phase on resume.
  const hasAnyAnswer = initialSelections.some((s) => s !== null);

  const [phase, setPhase] = useState(hasAnyAnswer ? "answer" : "listen"); // listen | answer | results
  const [currentQ, setCurrentQ] = useState(() => {
    const idx = Number(draftRestored?.currentQ);
    if (Number.isInteger(idx) && idx >= 0 && idx < totalQ) return idx;
    return 0;
  });
  const [selections, setSelections] = useState(initialSelections);
  const [lockedQuestions, setLockedQuestions] = useState(() => {
    if (Array.isArray(draftRestored?.lockedQuestions) && draftRestored.lockedQuestions.length === totalQ) {
      return draftRestored.lockedQuestions.map(Boolean);
    }
    return Array(totalQ).fill(false);
  });
  const [submitted, setSubmitted] = useState(false);
  const [hover, setHover] = useState(null);
  const [answerTimeLeft, setAnswerTimeLeft] = useState(answerSeconds);

  const resultsRef = useRef(null);
  const completedRef = useRef(false);
  const isTimed = !isPractice;

  useDraftPersist(draftKey, { selections, currentQ, lockedQuestions }, { enabled: !submitted });

  const handleAudioEnded = useCallback(() => {
    // Auto-advance to answer phase after audio ends
    if (phase === "listen") setPhase("answer");
  }, [phase]);

  const handleSelect = (key) => {
    if (submitted || (isTimed && lockedQuestions[currentQ])) return;
    const next = [...selections];
    next[currentQ] = key;
    setSelections(next);
  };

  const buildResults = useCallback((overrideSelections = selections) => {
    return questions.map((q, i) => ({
      qIndex: i,
      selected: overrideSelections[i],
      correct: q.answer,
      isCorrect: overrideSelections[i] === q.answer,
    }));
  }, [questions, selections]);

  // 交卷即回调（= 落库）。历史记录不能押在结果页那颗按钮上：调用方的 onComplete
  // 只负责存不负责跳，用户点「退出」这次练习就白做了。completedRef 保证只回调一次。
  const handleSubmit = useCallback((overrideSelections = selections) => {
    const results = buildResults(overrideSelections);
    resultsRef.current = results;
    setSubmitted(true);
    clearDraft(draftKey);
    if (completedRef.current) return;
    completedRef.current = true;
    if (typeof onComplete === "function") {
      onComplete({ correct: results.filter((r) => r.isCorrect).length, total: totalQ, results });
    }
  }, [buildResults, draftKey, onComplete, selections, totalQ]);

  const lockCurrentQuestion = useCallback(() => {
    setLockedQuestions((prev) => {
      if (prev[currentQ]) return prev;
      const next = [...prev];
      next[currentQ] = true;
      return next;
    });
  }, [currentQ]);

  // 能不能离开当前题：练习模式只要选了（或已锁定）；计时模式同理——没作答不许走，
  // 免得底部题号一点就把空白题锁死。
  const canLeaveCurrent = selections[currentQ] !== null || lockedQuestions[currentQ];

  // 上一题 / 下一题 / 底部题号统一走这里。计时模式「离开即锁定」：
  // 回看的题一律只读，也因此永远回不到一道未锁定的题 —— 来回跳题刷不出新的答题时间。
  const goToQuestion = (index) => {
    if (submitted || index === currentQ || index < 0 || index > totalQ - 1) return;
    if (isTimed) {
      if (!canLeaveCurrent) return;
      lockCurrentQuestion();
    }
    setCurrentQ(index);
  };

  useEffect(() => {
    if (!isTimed || phase !== "answer" || submitted) return;
    if (lockedQuestions[currentQ]) return;
    setAnswerTimeLeft(answerSeconds);
    const timer = setInterval(() => {
      setAnswerTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [answerSeconds, currentQ, isTimed, lockedQuestions, phase, submitted]);

  const handleQuestionTimeout = useCallback(() => {
    lockCurrentQuestion();
    if (currentQ < totalQ - 1) {
      // 必须和 setCurrentQ 一起把倒计时拨回满格：否则下一次 commit 里
      // 「归零即超时」那条 effect 会拿着旧的 answerTimeLeft=0 再触发一次，一超时连跳两题。
      setAnswerTimeLeft(answerSeconds);
      setCurrentQ((idx) => Math.min(totalQ - 1, idx + 1));
      return;
    }
    handleSubmit(selections);
    setPhase("results");
  }, [answerSeconds, currentQ, handleSubmit, lockCurrentQuestion, selections, totalQ]);

  useEffect(() => {
    if (!isTimed || phase !== "answer" || submitted || answerTimeLeft !== 0) return;
    handleQuestionTimeout();
  }, [answerTimeLeft, handleQuestionTimeout, isTimed, phase, submitted]);

  // 交卷后答错的题可点开看 AI 讲解（Pro 门 + 缓存在 hook 里，点了才计费）。
  // 必须在下面几个 early return 之前调 —— hooks 不能写在条件返回之后。
  const listeningAi = useListeningAiExplain();
  const explainContext =
    item?.transcript || item?.announcement || item?.lecture || conversationText(item?.conversation) || "";

  if (!item || totalQ === 0) {
    return (
      <PageShell>
        <div style={{ textAlign: "center", padding: "80px 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎧</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>No questions available</div>
          <div style={{ marginTop: 20 }}>
            <Btn onClick={onExit} variant="secondary">返回</Btn>
          </div>
        </div>
      </PageShell>
    );
  }

  const q = questions[currentQ];
  const allAnswered = selections.every(s => s !== null);
  const canSubmitCurrent = selections[currentQ] !== null || (isTimed && lockedQuestions[currentQ]);
  const isCurrentLocked = isTimed && !!lockedQuestions[currentQ];
  const isUrgent = isTimed && !isCurrentLocked && answerTimeLeft <= 10;

  // ── LISTEN PHASE ──
  if (phase === "listen") {
    return (
      <PageShell narrow>
        <TopBar title={title} section={section} onExit={onExit} />
        <SurfaceCard style={{ padding: "40px 24px", textAlign: "center", marginTop: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.t1, marginBottom: 24 }}>
            Listen carefully
          </div>
          <AudioPlayer
            src={item.audio_url || null}
            text={ttsText}
            turns={ttsTurns}
            onEnded={handleAudioEnded}
            maxReplays={isPractice ? 99 : 0}
            isPractice={isPractice}
            autoPlay
            taskType={taskType}
            itemId={item.id}
          />
          {/* Manual advance — always available (not just practice) so a blocked
              autoplay or failed audio never traps a timed session. */}
          <div style={{ marginTop: 24 }}>
            <Btn onClick={() => setPhase("answer")} variant="secondary">
              {isPractice ? "I'm ready to answer" : "开始答题"}
            </Btn>
          </div>
        </SurfaceCard>
      </PageShell>
    );
  }

  // ── RESULTS PHASE ──
  if (phase === "results" || submitted) {
    const results = resultsRef.current || [];
    const correct = results.filter(r => r.isCorrect).length;

    return (
      <PageShell narrow>
        <TopBar title={title} section={section} onExit={onExit} />
        <SurfaceCard style={{ padding: "24px", marginTop: 20 }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: ACCENT.color, textTransform: "uppercase", marginBottom: 4 }}>Result</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: C.t1 }}>{correct}/{totalQ}</div>
          </div>

          {questions.map((q, i) => {
            const r = results[i];
            return (
              <div key={i} style={{ marginBottom: 20, padding: "16px", background: r?.isCorrect ? "#F0FDF4" : "#FEF2F2", borderRadius: 10, border: `1px solid ${r?.isCorrect ? "#BBF7D0" : "#FECACA"}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.t1, marginBottom: 8 }}>
                  Q{i + 1}: {q.stem}
                </div>
                {KEYS.map(k => {
                  const isCorrect = k === q.answer;
                  const isSelected = k === r?.selected;
                  let bg = "#fff";
                  let border = "#E5E7EB";
                  let color = C.t1;
                  if (isCorrect) { bg = "#D1FAE5"; border = "#059669"; color = "#065F46"; }
                  else if (isSelected && !isCorrect) { bg = "#FEE2E2"; border = "#DC2626"; color = "#991B1B"; }

                  return (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 4, background: bg, border: `1px solid ${border}`, borderRadius: 6, fontSize: 13, color }}>
                      <span style={{ fontWeight: 700, minWidth: 20 }}>{k}.</span>
                      <span>{q.options[k]}</span>
                      {isCorrect && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700 }}>✓</span>}
                      {isSelected && !isCorrect && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700 }}>✗</span>}
                    </div>
                  );
                })}
                {q.explanation && (
                  <div style={{ marginTop: 8, fontSize: 12, color: C.t2, lineHeight: 1.5, padding: "8px 10px", background: "#FFFBEB", borderRadius: 6, border: "1px solid #FDE68A" }}>
                    <strong>Explanation:</strong> {q.explanation}
                  </div>
                )}
                {/* AI 讲解：只给答错的题。题库自带的 explanation 可能缺失，
                    这一块独立于它渲染 —— 没有静态解析的题恰恰最需要讲解。 */}
                {r && !r.isCorrect && (
                  <ListeningAiExplainBlock
                    explainKey={`${item.id || "task"}-q${i}`}
                    detail={{
                      subtype: taskType,
                      qid: q.qid || `${item.id || "task"}-q${i}`,
                      stem: q.stem,
                      contextText: explainContext,
                      options: q.options,
                      selected: r.selected,
                      correct: q.answer,
                      isCorrect: r.isCorrect,
                    }}
                    {...listeningAi}
                  />
                )}
              </div>
            );
          })}

          {/* 成绩在交卷那一刻就已经回调保存了，这里两颗按钮都只管跳转。
              旧版把保存挂在「完成」上，而调用方的 onComplete 只存不跳 —— 练习模式点了没反应。 */}
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
            {typeof onNext === "function" && (
              <Btn onClick={onNext} variant="secondary">换一题</Btn>
            )}
            <Btn onClick={onExit}>完成并返回</Btn>
          </div>
        </SurfaceCard>
      </PageShell>
    );
  }

  // ── ANSWER PHASE ──
  return (
    <PageShell narrow>
      <TopBar
        title={title}
        section={section}
        onExit={onExit}
        qInfo={`Q ${currentQ + 1}/${totalQ}`}
      />

      <SurfaceCard style={{ padding: "24px", marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "6px 12px", borderRadius: 999,
            background: isCurrentLocked ? "#F3F4F6" : isUrgent ? "#FEE2E2" : ACCENT.soft,
            border: `1px solid ${isCurrentLocked ? "#E5E7EB" : isUrgent ? "#FECACA" : "#E9D5FF"}`,
            color: isCurrentLocked ? C.t2 : isUrgent ? "#DC2626" : "#5B21B6",
            fontSize: 12, fontWeight: 800,
            fontFamily: "Consolas, Menlo, 'Courier New', monospace",
          }}>
            {/* 回看已锁定的题时倒计时是冻住的，直说「已锁定」比摆个不走的钟清楚 */}
            {!isTimed ? "Practice mode" : isCurrentLocked ? "本题已锁定 · 仅可回看" : `Time left ${formatAnswerTime(answerTimeLeft)}`}
          </div>
        </div>
        {/* Question */}
        <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 16, lineHeight: 1.5 }}>
          Q{currentQ + 1}. {q.stem}
        </div>

        {/* Options */}
        {KEYS.map(k => {
          if (!q.options[k]) return null;
          const isSelected = selections[currentQ] === k;
          let bg = "#FAFAFA";
          let border = "#E5E7EB";
          let color = C.t1;

          if (isSelected) {
            bg = ACCENT.soft;
            border = ACCENT.color;
            color = ACCENT.color;
          }

          return (
            <button
              key={k}
              onClick={() => handleSelect(k)}
              onMouseEnter={() => setHover(k)}
              onMouseLeave={() => setHover(null)}
              disabled={submitted || (isTimed && lockedQuestions[currentQ])}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "12px 14px", marginBottom: 8, background: bg,
                border: `1.5px solid ${border}`, borderRadius: 10, cursor: isTimed && lockedQuestions[currentQ] ? "not-allowed" : "pointer",
                color, fontSize: 14, fontFamily: FONT, textAlign: "left",
                transition: "all 0.12s",
                transform: hover === k ? "translateY(-1px)" : "none",
                boxShadow: hover === k ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
              }}
            >
              <span style={{
                width: 28, height: 28, borderRadius: "50%", display: "flex",
                alignItems: "center", justifyContent: "center", fontWeight: 800,
                fontSize: 13, flexShrink: 0,
                background: isSelected ? ACCENT.color : "#F3F4F6",
                color: isSelected ? "#fff" : C.t2,
              }}>
                {k}
              </span>
              <span style={{ flex: 1 }}>{q.options[k]}</span>
            </button>
          );
        })}

        {/* Navigation —— 主按钮（下一题/提交）一律靠右下角，左边留给上一题。
            计时模式也能往回翻，只是翻回去的题已锁定，只能看不能改。 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 20 }}>
          <Btn
            onClick={() => goToQuestion(currentQ - 1)}
            variant="secondary"
            disabled={currentQ === 0 || (isTimed && !canLeaveCurrent)}
          >
            上一题
          </Btn>
          {currentQ < totalQ - 1 ? (
            <Btn onClick={() => goToQuestion(currentQ + 1)} disabled={!canLeaveCurrent}>下一题</Btn>
          ) : (
            <Btn onClick={() => { lockCurrentQuestion(); handleSubmit(); setPhase("results"); }} disabled={isTimed ? !canSubmitCurrent : !allAnswered}>提交</Btn>
          )}
        </div>

        {/* 题号导航：点序号直接跳题（以前只有练习模式能点，计时模式只能一题题按「下一题」）。 */}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 16 }}>
          {questions.map((_, i) => {
            const isActive = i === currentQ;
            const isAnswered = selections[i] !== null;
            // 计时模式下离开当前题即锁定，所以没作答时不给跳，免得把空白题锁死。
            const canJump = isActive || !isTimed || canLeaveCurrent;
            let bg = "#E5E7EB";
            if (isActive) bg = ACCENT.color;
            else if (isAnswered) bg = ACCENT.soft;

            return (
              <button
                key={i}
                onClick={() => goToQuestion(i)}
                disabled={!canJump}
                title={`第 ${i + 1} 题${isAnswered ? " · 已作答" : ""}`}
                aria-label={`第 ${i + 1} 题${isAnswered ? " · 已作答" : ""}`}
                aria-current={isActive ? "true" : undefined}
                style={{
                  width: 32, height: 32, borderRadius: "50%",
                  border: isActive ? `2px solid ${ACCENT.color}` : `1px solid ${isAnswered ? "#E9D5FF" : "#E5E7EB"}`,
                  background: bg, fontSize: 13, fontWeight: 700,
                  cursor: canJump ? "pointer" : "not-allowed",
                  opacity: canJump ? 1 : 0.5,
                  color: isActive ? "#fff" : isAnswered ? ACCENT.color : C.t3,
                  fontFamily: FONT,
                  transition: "all 0.15s",
                }}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        {!isTimed && currentQ === totalQ - 1 && !allAnswered && (
          <div style={{ textAlign: "center", marginTop: 10, fontSize: 12, color: C.t3 }}>
            还有 {selections.filter((sel) => sel === null).length} 题没作答，点上面的题号回去补。
          </div>
        )}
      </SurfaceCard>
    </PageShell>
  );
}
