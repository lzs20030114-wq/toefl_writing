"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { renderResponseSentence } from "../../lib/questionBank/renderResponseSentence";
import { shuffle, evaluateBuildSentenceOrder } from "../../lib/utils";
import { addDoneIds, saveSess } from "../../lib/sessionStore";
import { DONE_STORAGE_KEYS, selectBSQuestions } from "../../lib/questionSelector";
import runtimeModel from "../../lib/questionBank/runtimeModel";

function getUserChunks(slotsArr) {
  return slotsArr.filter((s) => s !== null).map((s) => s.text);
}

export function useBuildSentenceSession(questions, options = {}) {
  const persistSession = options.persistSession !== false;
  const onComplete = typeof options.onComplete === "function" ? options.onComplete : null;
  const onTimerChange = typeof options.onTimerChange === "function" ? options.onTimerChange : null;
  const isPracticeMode = options.practiceMode === "practice";
  const timeLimitSeconds = isPracticeMode ? 0 : (Number.isFinite(options.timeLimitSeconds) && options.timeLimitSeconds > 0 ? options.timeLimitSeconds : 410);
  const practiceMode = options.practiceMode || "standard";
  const initialBuildState = (() => {
    try {
      const source = questions || selectBSQuestions();
      const prepared = runtimeModel.prepareQuestions(source, { strictThrow: process.env.NODE_ENV !== "production" });
      if (prepared.questions.length === 0) {
        return { qs: [], error: prepared.errors[0] || "Question bank is unavailable." };
      }
      return { qs: prepared.questions, error: null };
    } catch (e) {
      return { qs: [], error: e?.message || "Question bank is unavailable." };
    }
  })();

  const [qs] = useState(() => initialBuildState.qs);
  const [selectionError] = useState(() => initialBuildState.error);
  const [idx, setIdx] = useState(0);
  const [slots, setSlots] = useState([]);
  const [bank, setBank] = useState([]);
  const [results, setResults] = useState(() => Array(initialBuildState.qs.length).fill(null));
  const [phase, setPhase] = useState("instruction");
  const [tl, setTl] = useState(timeLimitSeconds);
  const [run, setRun] = useState(false);
  const [toast, setToast] = useState(initialBuildState.error || null);

  const [dragItem, setDragItem] = useState(null);
  const [hoverSlot, setHoverSlot] = useState(null);
  const [hoverBank, setHoverBank] = useState(false);

  const tr = useRef(null);
  const autoSubmitRef = useRef(false);
  const resultsRef = useRef(results);
  const idxRef = useRef(0);
  const slotsRef = useRef([]);
  const submitLockRef = useRef(false);
  const completionSentRef = useRef(false);
  const savedStatesRef = useRef([]);

  function freshInitQ(i, list) {
    const q = list[i];
    runtimeModel.validateRuntimeQuestion(q);
    const shuffled = shuffle(q.bank.map((c, j) => ({ text: c, id: i + "-" + j })));
    const slotCount = q.answerOrder.length;
    const nextSlots = Array(slotCount).fill(null);

    const hasDistractor = q.distractor != null;
    const expectedBankLen = hasDistractor ? slotCount + 1 : slotCount;
    if (shuffled.length !== expectedBankLen) {
      const msg = `题库数据异常（id=${q.id}）：bank 长度 ${shuffled.length} 与预期 ${expectedBankLen} 不一致`;
      setToast(msg);
      throw new Error(msg);
    }

    setBank(shuffled);
    setSlots(nextSlots);
  }

  function restoreOrInitQ(i, list) {
    const saved = savedStatesRef.current[i];
    if (saved) {
      setBank(saved.bank);
      setSlots(saved.slots);
    } else {
      freshInitQ(i, list);
    }
  }

  function saveCurrentState() {
    savedStatesRef.current[idx] = { slots: [...slots], bank: [...bank] };
  }

  function startTimer() {
    if (phase !== "instruction") return;
    if (tr.current) clearInterval(tr.current);
    try {
      freshInitQ(0, qs);
    } catch {
      setPhase("instruction");
      setRun(false);
      return;
    }
    setPhase("active");
    setRun(true);
    if (!isPracticeMode) {
      tr.current = setInterval(() => setTl((p) => {
        if (p <= 1) {
          clearInterval(tr.current);
          setRun(false);
          autoSubmitRef.current = true;
          return 0;
        }
        return p - 1;
      }), 1000);
    }
  }

  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => { idxRef.current = idx; }, [idx]);
  useEffect(() => { slotsRef.current = slots; }, [slots]);
  useEffect(() => {
    if (onTimerChange) {
      onTimerChange({ timeLeft: tl, isRunning: run, phase });
    }
  }, [tl, run, phase, onTimerChange]);

  function saveSession(nr) {
    const doneSetIds = new Set(
      nr
        .map((r) => Number(r?.q?.__sourceSetId))
        .filter((id) => Number.isInteger(id) && id > 0)
    );
    if (doneSetIds.size > 0) {
      addDoneIds(DONE_STORAGE_KEYS.BUILD_SENTENCE, [...doneSetIds]);
    }
    const doneGroupIds = new Set(
      nr
        .map((r) => r?.q?.__sourceGroupId)
        .filter((id) => typeof id === "string" && id)
    );
    if (doneGroupIds.size > 0) {
      addDoneIds(DONE_STORAGE_KEYS.BUILD_SENTENCE_GP, [...doneGroupIds]);
    }

    const correctCount = nr.filter((r) => r.isCorrect).length;
    const pct = nr.length > 0 ? correctCount / nr.length : 0;
    const band = pct >= 1 ? 6 : pct >= 0.9 ? 5.5 : pct >= 0.8 ? 5 : pct >= 0.7 ? 4.5 : pct >= 0.6 ? 4 : pct >= 0.5 ? 3.5 : pct >= 0.4 ? 3 : pct >= 0.3 ? 2.5 : pct >= 0.2 ? 2 : pct >= 0.1 ? 1.5 : 1;
    const payload = {
      type: "bs",
      mode: practiceMode,
      correct: correctCount,
      total: nr.length,
      band,
      errors: nr.filter((r) => !r.isCorrect).flatMap((r) => r.q.grammar_points || []),
      details: nr.map((r) => ({
        prompt: r.q.prompt,
        userAnswer: r.userAnswer,
        correctAnswer: r.q.answer || "",
        isCorrect: r.isCorrect,
        grammar_points: r.q.grammar_points || [],
      })),
    };
    if (persistSession) {
      saveSess(payload);
    }
    if (onComplete && !completionSentRef.current) {
      completionSentRef.current = true;
      onComplete(payload);
    }
  }

  function evaluateQ(i, slotsArr) {
    const q = qs[i];
    const chunks = getUserChunks(slotsArr);
    if (chunks.length === 0 || slotsArr.some((s) => s === null)) {
      return {
        q,
        userAnswer: "(no answer)",
        correctAnswer: renderResponseSentence(q).correctSentenceFull,
        isCorrect: false,
      };
    }
    const rendered = renderResponseSentence(q, chunks);
    const score = evaluateBuildSentenceOrder(q, chunks);
    return {
      q,
      userAnswer: rendered.userSentenceFull || "(no answer)",
      correctAnswer: rendered.correctSentenceFull,
      isCorrect: score.isCorrect,
    };
  }

  function buildFinalResults() {
    // Collect results for all questions, evaluating saved states for unanswered ones
    const nr = [];
    for (let i = 0; i < qs.length; i++) {
      if (i === idxRef.current) {
        nr.push(evaluateQ(i, slotsRef.current));
      } else if (resultsRef.current[i]) {
        nr.push(resultsRef.current[i]);
      } else if (savedStatesRef.current[i]) {
        nr.push(evaluateQ(i, savedStatesRef.current[i].slots));
      } else {
        nr.push({
          q: qs[i],
          userAnswer: "(no answer)",
          correctAnswer: renderResponseSentence(qs[i]).correctSentenceFull,
          isCorrect: false,
        });
      }
    }
    return nr;
  }

  useEffect(() => {
    if (isPracticeMode) return;
    if (tl === 0 && autoSubmitRef.current && phase === "active") {
      autoSubmitRef.current = false;
      const nr = buildFinalResults();
      setResults(nr);
      setPhase("review");
      saveSession(nr);
      submitLockRef.current = false;
    }
  }, [tl, phase, qs]);

  useEffect(() => () => clearInterval(tr.current), []);

  function pickChunk(chunk) {
    const emptyIdx = slots.findIndex((s) => s === null);
    if (emptyIdx === -1) return;
    setSlots((p) => { const n = [...p]; n[emptyIdx] = chunk; return n; });
    setBank((p) => p.filter((x) => x.id !== chunk.id));
  }

  function removeChunk(slotIdx) {
    const chunk = slots[slotIdx];
    if (!chunk) return;
    setSlots((p) => { const n = [...p]; n[slotIdx] = null; return n; });
    setBank((p) => [...p, chunk]);
  }

  function placeChunkAt(chunk, targetIdx) {
    if (targetIdx < 0 || targetIdx >= slots.length) return;
    const targetChunk = slots[targetIdx];
    if (targetChunk) {
      setBank((p) => [...p.filter((x) => x.id !== chunk.id), targetChunk]);
    } else {
      setBank((p) => p.filter((x) => x.id !== chunk.id));
    }
    setSlots((p) => { const n = [...p]; n[targetIdx] = chunk; return n; });
  }

  function moveSlotTo(fromIdx, targetIdx) {
    if (fromIdx === targetIdx) return;
    if (fromIdx < 0 || fromIdx >= slots.length || targetIdx < 0 || targetIdx >= slots.length) return;
    setSlots((p) => {
      const n = [...p];
      n[targetIdx] = p[fromIdx];
      n[fromIdx] = p[targetIdx];
      return n;
    });
  }

  function onDragStartBank(e, chunk) {
    setDragItem({ from: "bank", chunk });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", chunk.id);
    e.currentTarget.style.opacity = "0.4";
  }

  function onDragStartSlot(e, chunk, slotIdx) {
    setDragItem({ from: "slot", chunk, slotIndex: slotIdx });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", chunk.id);
    e.currentTarget.style.opacity = "0.4";
  }

  function onDragEnd(e) {
    e.currentTarget.style.opacity = "1";
    setDragItem(null);
    setHoverSlot(null);
    setHoverBank(false);
  }

  function onDropSlot(e, targetIdx) {
    e.preventDefault();
    if (!dragItem) return;
    const targetChunk = slots[targetIdx];

    if (dragItem.from === "bank") {
      if (targetChunk) {
        setBank((p) => [...p.filter((x) => x.id !== dragItem.chunk.id), targetChunk]);
        setSlots((p) => { const n = [...p]; n[targetIdx] = dragItem.chunk; return n; });
      } else {
        setBank((p) => p.filter((x) => x.id !== dragItem.chunk.id));
        setSlots((p) => { const n = [...p]; n[targetIdx] = dragItem.chunk; return n; });
      }
    } else if (dragItem.from === "slot") {
      if (targetIdx !== dragItem.slotIndex) {
        setSlots((p) => {
          const n = [...p];
          n[targetIdx] = dragItem.chunk;
          n[dragItem.slotIndex] = targetChunk;
          return n;
        });
      }
    }

    setDragItem(null);
    setHoverSlot(null);
  }

  function onDropBank(e) {
    e.preventDefault();
    if (!dragItem || dragItem.from !== "slot") return;
    setSlots((p) => { const n = [...p]; n[dragItem.slotIndex] = null; return n; });
    setBank((p) => [...p, dragItem.chunk]);
    setDragItem(null);
    setHoverBank(false);
  }

  function resetQ() {
    savedStatesRef.current[idx] = null;
    freshInitQ(idx, qs);
  }

  function goBack() {
    if (idx <= 0 || phase !== "active") return;
    saveCurrentState();
    const prevIdx = idx - 1;
    setIdx(prevIdx);
    restoreOrInitQ(prevIdx, qs);
  }

  function submit() {
    if (phase !== "active") return;
    if (submitLockRef.current) return;
    submitLockRef.current = true;

    const q = qs[idx];
    const userChunks = getUserChunks(slots);
    const rendered = renderResponseSentence(q, userChunks);
    const score = evaluateBuildSentenceOrder(q, userChunks);

    saveCurrentState();
    const nr = [...results];
    nr[idx] = {
      q,
      userAnswer: rendered.userSentenceFull || "(no answer)",
      correctAnswer: rendered.correctSentenceFull,
      isCorrect: score.isCorrect,
    };

    if (idx < qs.length - 1) {
      setResults(nr);
      setIdx(idx + 1);
      restoreOrInitQ(idx + 1, qs);
      submitLockRef.current = false;
    } else {
      // Finalize: evaluate any unanswered questions from saved states
      for (let i = 0; i < qs.length; i++) {
        if (nr[i]) continue;
        const saved = savedStatesRef.current[i];
        nr[i] = saved ? evaluateQ(i, saved.slots) : {
          q: qs[i],
          userAnswer: "(no answer)",
          correctAnswer: renderResponseSentence(qs[i]).correctSentenceFull,
          isCorrect: false,
        };
      }
      clearInterval(tr.current);
      setRun(false);
      setResults(nr);
      setPhase("review");
      saveSession(nr);
      submitLockRef.current = false;
    }
  }

  const q = qs[idx];
  const givenSlots = useMemo(() => (Array.isArray(q?.givenSlots) ? q.givenSlots : []), [q]);
  const allFilled = slots.length > 0 && slots.every((s) => s !== null);
  const punct = q?.responseSuffix || (q?.has_question_mark ? "?" : ".");
  const canGoBack = idx > 0 && phase === "active";

  return {
    qs,
    q,
    selectionError,
    idx,
    slots,
    bank,
    results,
    phase,
    tl,
    run,
    toast,
    setToast,
    isPracticeMode,
    dragItem,
    hoverSlot,
    hoverBank,
    setHoverSlot,
    setHoverBank,
    givenSlots,
    allFilled,
    punct,
    canGoBack,
    startTimer,
    resetQ,
    submit,
    goBack,
    pickChunk,
    removeChunk,
    placeChunkAt,
    moveSlotTo,
    onDragStartBank,
    onDragStartSlot,
    onDragEnd,
    onDropSlot,
    onDropBank,
  };
}

export const __internal = {
  normalizeRuntimeQuestion: runtimeModel.normalizeRuntimeQuestion,
  validateRuntimeQuestion: runtimeModel.validateRuntimeQuestion,
  prepareQuestions: runtimeModel.prepareQuestions,
};
