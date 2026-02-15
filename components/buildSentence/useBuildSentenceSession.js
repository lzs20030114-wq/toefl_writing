"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { renderResponseSentence } from "../../lib/questionBank/renderResponseSentence";
import { shuffle, evaluateBuildSentenceOrder } from "../../lib/utils";
import { saveSess } from "../../lib/sessionStore";
import { selectBSQuestions } from "../../lib/questionSelector";
import runtimeModel from "../../lib/questionBank/runtimeModel";

function getUserChunks(slotsArr) {
  return slotsArr.filter((s) => s !== null).map((s) => s.text);
}

export function useBuildSentenceSession(questions) {
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
  const [results, setResults] = useState([]);
  const [phase, setPhase] = useState("instruction");
  const [tl, setTl] = useState(350);
  const [run, setRun] = useState(false);
  const [toast, setToast] = useState(initialBuildState.error || null);

  const [dragItem, setDragItem] = useState(null);
  const [hoverSlot, setHoverSlot] = useState(null);
  const [hoverBank, setHoverBank] = useState(false);

  const tr = useRef(null);
  const autoSubmitRef = useRef(false);
  const resultsRef = useRef([]);
  const idxRef = useRef(0);
  const slotsRef = useRef([]);
  const submitLockRef = useRef(false);

  function initQ(i, list) {
    const q = list[i];
    runtimeModel.validateRuntimeQuestion(q);
    const shuffled = shuffle(q.bank.map((c, j) => ({ text: c, id: i + "-" + j })));
    const slotCount = q.answerOrder.length;
    const nextSlots = Array(slotCount).fill(null);

    if (shuffled.length !== q.answerOrder.length || nextSlots.length !== q.answerOrder.length) {
      const msg = `题库数据异常（id=${q.id}）：slots/bank 与 answerOrder 长度不一致`;
      setToast(msg);
      throw new Error(msg);
    }

    setBank(shuffled);
    setSlots(nextSlots);
  }

  function startTimer() {
    if (phase !== "instruction") return;
    if (tr.current) clearInterval(tr.current);
    setPhase("active");
    setRun(true);
    initQ(0, qs);
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

  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => { idxRef.current = idx; }, [idx]);
  useEffect(() => { slotsRef.current = slots; }, [slots]);

  function saveSession(nr) {
    saveSess({
      type: "bs",
      correct: nr.filter((r) => r.isCorrect).length,
      total: nr.length,
      errors: nr.filter((r) => !r.isCorrect).flatMap((r) => r.q.grammar_points || []),
      details: nr.map((r) => ({
        prompt: r.q.prompt,
        userAnswer: r.userAnswer,
        correctAnswer: r.q.answer || "",
        isCorrect: r.isCorrect,
        grammar_points: r.q.grammar_points || [],
      })),
    });
  }

  useEffect(() => {
    if (tl === 0 && autoSubmitRef.current && phase === "active") {
      autoSubmitRef.current = false;
      const curSlots = slotsRef.current;
      const curQ = qs[idxRef.current];
      const curChunks = getUserChunks(curSlots);
      const curRender = renderResponseSentence(curQ, curChunks);
      const curEval = evaluateBuildSentenceOrder(curQ, curChunks);

      const nr = [...resultsRef.current, {
        q: curQ,
        userAnswer: curRender.userSentenceFull || "(no answer)",
        correctAnswer: curRender.correctSentenceFull,
        isCorrect: curEval.isCorrect,
      }];

      for (let i = idxRef.current + 1; i < qs.length; i++) {
        nr.push({
          q: qs[i],
          userAnswer: "(no answer)",
          correctAnswer: renderResponseSentence(qs[i]).correctSentenceFull,
          isCorrect: false,
        });
      }

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
    initQ(idx, qs);
  }

  function submit() {
    if (phase !== "active") return;
    if (submitLockRef.current) return;
    submitLockRef.current = true;

    const q = qs[idx];
    const userChunks = getUserChunks(slots);
    const rendered = renderResponseSentence(q, userChunks);
    const score = evaluateBuildSentenceOrder(q, userChunks);
    const nr = [...results, {
      q,
      userAnswer: rendered.userSentenceFull || "(no answer)",
      correctAnswer: rendered.correctSentenceFull,
      isCorrect: score.isCorrect,
    }];

    setResults(nr);
    if (idx < qs.length - 1) {
      setIdx(idx + 1);
      initQ(idx + 1, qs);
      submitLockRef.current = false;
    } else {
      clearInterval(tr.current);
      setRun(false);
      setPhase("review");
      saveSession(nr);
      submitLockRef.current = false;
    }
  }

  const q = qs[idx];
  const prefilledChunks = useMemo(() => (q?.given ? [q.given] : []), [q]);
  const allFilled = slots.length > 0 && slots.every((s) => s !== null);
  const punct = q?.responseSuffix || (q?.has_question_mark ? "?" : ".");

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
    dragItem,
    hoverSlot,
    hoverBank,
    setHoverSlot,
    setHoverBank,
    prefilledChunks,
    allFilled,
    punct,
    startTimer,
    resetQ,
    submit,
    pickChunk,
    removeChunk,
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

