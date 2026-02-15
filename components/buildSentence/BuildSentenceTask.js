"use client";
import React, { useState, useEffect, useRef } from "react";
import { renderResponseSentence } from "../../lib/questionBank/renderResponseSentence";
import { shuffle, capitalize, evaluateBuildSentenceOrder } from "../../lib/utils";
import { saveSess, addDoneIds } from "../../lib/sessionStore";
import { selectBSQuestions } from "../../lib/questionSelector";
import { C, FONT, Btn, Toast, TopBar } from "../shared/ui";

export function BuildSentenceTask({ onExit, questions }) {
  const initialBuildState = (() => {
    if (questions) return { qs: questions, error: null };
    try {
      return { qs: selectBSQuestions(), error: null };
    } catch (e) {
      return { qs: [], error: e?.message || "Question bank is unavailable." };
    }
  })();

  const [qs, setQs] = useState(() => initialBuildState.qs);
  const [selectionError] = useState(() => initialBuildState.error);
  const [idx, setIdx] = useState(0);
  const [slots, setSlots] = useState([]);
  const [bank, setBank] = useState([]);
  const [results, setResults] = useState([]);
  const [phase, setPhase] = useState("instruction");
  const [tl, setTl] = useState(350);
  const [run, setRun] = useState(false);
  const [toast, setToast] = useState(null);
  const tr = useRef(null);

  const autoSubmitRef = useRef(false);
  const resultsRef = useRef([]);
  const idxRef = useRef(0);
  const slotsRef = useRef([]);
  const submitLockRef = useRef(false);

  /* Drag state */
  const [dragItem, setDragItem] = useState(null); // { from: "bank"|"slot", chunk, slotIndex? }
  const [hoverSlot, setHoverSlot] = useState(null);
  const [hoverBank, setHoverBank] = useState(false);

  function initQ(i, questions) {
    const q = questions[i];
    setBank(shuffle((q.bank || []).map((c, j) => ({ text: c, id: i + "-" + j }))));
    setSlots(Array((q.bank || []).length).fill(null));
  }

  function startTimer() {
    if (phase !== "instruction") return;
    if (tr.current) clearInterval(tr.current);
    setPhase("active");
    setRun(true);
    initQ(0, qs);
    tr.current = setInterval(() => setTl(p => {
      if (p <= 1) { clearInterval(tr.current); setRun(false); autoSubmitRef.current = true; return 0; }
      return p - 1;
    }), 1000);
  }

  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => { idxRef.current = idx; }, [idx]);
  useEffect(() => { slotsRef.current = slots; }, [slots]);

  useEffect(() => {
    if (tl === 0 && autoSubmitRef.current && phase === "active") {
      autoSubmitRef.current = false;
      const curSlots = slotsRef.current;
      const curQ = qs[idxRef.current];
      const curAnswerOrder = curSlots.map(s => (s ? s.text : ""));
      const curRender = renderResponseSentence(curQ, curAnswerOrder);
      const curEval = evaluateBuildSentenceOrder(curQ, curAnswerOrder);
      let nr = [...resultsRef.current, { q: curQ, userAnswer: curRender.userSentenceFull || "(no answer)", correctAnswer: curRender.correctSentenceFull, isCorrect: curEval.isCorrect, alternateAccepted: curEval.alternateAccepted, acceptedReason: curEval.acceptedReason }];
      for (let i = idxRef.current + 1; i < qs.length; i++) {
        nr.push({ q: qs[i], userAnswer: "(no answer)", correctAnswer: renderResponseSentence(qs[i]).correctSentenceFull, isCorrect: false });
      }
      setResults(nr);
      setPhase("review");
      saveSess({
        type: "bs",
        correct: nr.filter(r => r.isCorrect).length,
        total: nr.length,
        errors: nr.filter(r => !r.isCorrect).map(r => r.q.gp),
        details: nr.map(r => ({
          prompt: r.q.prompt,
          userAnswer: r.userAnswer,
          correctAnswer: r.q.answer,
          isCorrect: r.isCorrect,
          gp: r.q.gp,
          difficulty: r.q.difficulty || "medium"
        }))
      });
      addDoneIds("toefl-bs-done", qs.map(q => q.id));
      submitLockRef.current = false;
    }
  }, [tl, phase, qs]);

  useEffect(() => () => clearInterval(tr.current), []);

  /* --- Click interactions --- */
  function pickChunk(chunk) {
    const emptyIdx = slots.findIndex(s => s === null);
    if (emptyIdx === -1) return;
    setSlots(p => { const n = [...p]; n[emptyIdx] = chunk; return n; });
    setBank(p => p.filter(x => x.id !== chunk.id));
  }

  function removeChunk(slotIdx) {
    const chunk = slots[slotIdx];
    if (!chunk) return;
    setSlots(p => { const n = [...p]; n[slotIdx] = null; return n; });
    setBank(p => [...p, chunk]);
  }

  /* --- Drag interactions --- */
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
        setBank(p => [...p.filter(x => x.id !== dragItem.chunk.id), targetChunk]);
        setSlots(p => { const n = [...p]; n[targetIdx] = dragItem.chunk; return n; });
      } else {
        setBank(p => p.filter(x => x.id !== dragItem.chunk.id));
        setSlots(p => { const n = [...p]; n[targetIdx] = dragItem.chunk; return n; });
      }
    } else if (dragItem.from === "slot") {
      if (targetIdx === dragItem.slotIndex) { /* dropped on self, no-op */ }
      else {
        setSlots(p => {
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
    setSlots(p => { const n = [...p]; n[dragItem.slotIndex] = null; return n; });
    setBank(p => [...p, dragItem.chunk]);
    setDragItem(null);
    setHoverBank(false);
  }

  function resetQ() { initQ(idx, qs); }

  function submit() {
    if (phase !== "active") return;
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    const q = qs[idx];
    const filledOrder = slots.map(s => (s ? s.text : ""));
    const rendered = renderResponseSentence(q, filledOrder);
    const score = evaluateBuildSentenceOrder(q, filledOrder);
    const nr = [...results, { q, userAnswer: rendered.userSentenceFull || "(no answer)", correctAnswer: rendered.correctSentenceFull, isCorrect: score.isCorrect, alternateAccepted: score.alternateAccepted, acceptedReason: score.acceptedReason }];
    setResults(nr);
    if (idx < qs.length - 1) { setIdx(idx + 1); initQ(idx + 1, qs); submitLockRef.current = false; }
    else {
      clearInterval(tr.current); setRun(false); setPhase("review");
      saveSess({
        type: "bs",
        correct: nr.filter(r => r.isCorrect).length,
        total: nr.length,
        errors: nr.filter(r => !r.isCorrect).map(r => r.q.gp),
        details: nr.map(r => ({
          prompt: r.q.prompt,
          userAnswer: r.userAnswer,
          correctAnswer: r.q.answer,
          isCorrect: r.isCorrect,
          gp: r.q.gp,
          difficulty: r.q.difficulty || "medium"
        }))
      });
      addDoneIds("toefl-bs-done", qs.map(q => q.id));
      submitLockRef.current = false;
    }
  }

  /* ---- Review phase ---- */
  if (phase === "review") {
    const ok = results.filter(r => r.isCorrect).length;
    const ge = {};
    results.filter(r => !r.isCorrect).forEach(r => { const g = r.q.gp || "general"; ge[g] = (ge[g] || 0) + 1; });
    const te = Object.entries(ge).sort((a, b) => b[1] - a[1]);

    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
        <TopBar title="Build a Sentence Report" section="Writing" onExit={onExit} />
        <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
          <div style={{ background: C.nav, color: "#fff", borderRadius: 6, padding: 24, textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 48, fontWeight: 800 }}>{ok}/{results.length}</div>
            <div style={{ fontSize: 14, opacity: 0.7 }}>Correct answers</div>
          </div>
          {te.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 12 }}>Weak grammar points</div>
              {te.map(([g, n], i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < te.length - 1 ? "1px solid #eee" : "none" }}><span>{g}</span><span style={{ background: "#fee2e2", color: C.red, padding: "2px 10px", borderRadius: 10, fontSize: 12, fontWeight: 600 }}>{n}x</span></div>)}
              <div style={{ marginTop: 12, fontSize: 13, color: C.blue, background: C.ltB, padding: 10, borderRadius: 4 }}><b>Suggestion:</b> Review these points first: {te.map(e => e[0]).join(", ")}</div>
            </div>
          )}
          {results.map((r, i) => (
            <div data-testid={`build-result-${i}`} data-correct={r.isCorrect ? "true" : "false"} key={i} style={{ background: "#fff", border: "1px solid " + (r.isCorrect ? "#c6f6d5" : "#fed7d7"), borderLeft: "4px solid " + (r.isCorrect ? C.green : C.red), borderRadius: 4, padding: 14, marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>Q{i + 1}: {r.q.context} <span style={{ color: C.blue }}>({r.q.gp || "build_sentence"})</span></div>
              <div style={{ fontSize: 14, color: r.isCorrect ? C.green : C.red }}>{r.isCorrect ? "Correct" : "Incorrect"}</div>
              {r.alternateAccepted && <div data-testid={`build-alternate-accepted-${i}`} style={{ fontSize: 12, color: C.blue, marginTop: 4 }}><b>Accepted alternative answer</b>{r.acceptedReason ? ` (${r.acceptedReason})` : ""}</div>}
              <div data-testid={`build-your-sentence-${i}`} style={{ fontSize: 13, color: C.t1, marginTop: 4 }}><b>Your full response sentence:</b> {capitalize(r.userAnswer)}</div>
              <div data-testid={`build-correct-answer-${i}`} style={{ fontSize: 13, color: C.blue, marginTop: 4 }}><b>Correct full response sentence:</b> {capitalize(r.correctAnswer || renderResponseSentence(r.q).correctSentenceFull)}</div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
            <Btn onClick={onExit} variant="secondary">Back to Practice</Btn>
          </div>
        </div>
      </div>
    );
  }

  if (selectionError) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        <TopBar title="Build a Sentence" section="Writing | Task 1" onExit={onExit} />
        <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 28 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.red, marginBottom: 8 }}>Question bank blocked by quality gate</div>
            <div style={{ fontSize: 14, color: C.t2, marginBottom: 16 }}>{selectionError}</div>
            <Btn onClick={onExit} variant="secondary">Back to Practice</Btn>
          </div>
        </div>
      </div>
    );
  }

  /* ---- Instruction phase ---- */
  if (phase === "instruction") {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        <TopBar title="Build a Sentence" section="Writing | Task 1" onExit={onExit} />
        <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "32px 40px" }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 20, color: C.nav }}>Task 1: Build a Sentence</h2>
            <div style={{ fontSize: 14, color: C.t1, lineHeight: 1.8 }}>
              <p><b>Directions:</b> Move the words in the boxes to the blank spaces to create a grammatically correct sentence.</p>
              <p><b>Questions:</b> 10 (3 easy + 3 medium + 4 hard)</p>
              <p><b>Time limit:</b> 5 minutes 50 seconds</p>
              <p>The timer will start when you click <b>Start</b>. When time runs out, your answers will be submitted automatically.</p>
            </div>
            <div style={{ marginTop: 24, textAlign: "center" }}><Btn data-testid="build-start" onClick={startTimer}>Start</Btn></div>
          </div>
        </div>
      </div>
    );
  }

  /* ---- Active phase (slot-based UI) ---- */
  const q = qs[idx];
  const allFilled = slots.length > 0 && slots.every(s => s !== null);

  const slotStyle = (i) => {
    const filled = slots[i] !== null;
    const isHover = hoverSlot === i && dragItem;
    return {
      minWidth: 80,
      minHeight: 40,
      padding: "6px 14px",
      borderRadius: 4,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 14,
      fontWeight: filled ? 500 : 400,
      cursor: filled ? "grab" : "default",
      userSelect: "none",
      transition: "border-color 0.15s, background 0.15s",
      ...(filled
        ? {
            background: C.blue,
            color: "#fff",
            border: "2px solid " + C.blue,
            opacity: dragItem && dragItem.from === "slot" && dragItem.slotIndex === i ? 0.4 : 1,
          }
        : {
            background: isHover ? "#e0ecff" : "#fafafa",
            color: "#aaa",
            border: "2px dashed " + (isHover ? C.blue : "#ccc"),
          }
      ),
    };
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      <TopBar title="Build a Sentence" section="Writing | Task 1" timeLeft={tl} isRunning={run} qInfo={(idx + 1) + " / " + qs.length} onExit={onExit} />
      <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
        {/* Directions */}
        <div style={{ background: C.ltB, border: "1px solid #b3d4fc", borderRadius: 4, padding: 14, marginBottom: 20, fontSize: 13 }}>
          <b>Directions:</b> Move the words in the boxes to the blank spaces to create a grammatically correct sentence.
        </div>

        {/* Context + response builder */}
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: C.t2, letterSpacing: 1, marginBottom: 8 }}>CONTEXT</div>
          <div style={{ fontSize: 15, color: C.t1, marginBottom: 14, lineHeight: 1.5 }}>{q.context}</div>
          <div style={{ fontSize: 11, color: C.t2, letterSpacing: 1, marginBottom: 8 }}>RESPONSE</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minHeight: 48, alignItems: "center", lineHeight: 1.6 }}>
            {Array.from({ length: (q.bank || []).length + 1 }, (_, pos) => (
              <React.Fragment key={`resp-pos-${pos}`}>
                {pos === (Number.isInteger(q.givenIndex) ? q.givenIndex : 0) && (
                  <span
                    data-testid="given-token"
                    style={{ fontSize: 14, color: C.nav, background: "#e6f0ff", border: "1px solid #b3d4fc", borderRadius: 4, padding: "4px 10px", fontWeight: 600 }}
                  >
                    {q.given}
                  </span>
                )}
                {pos < (q.bank || []).length && (() => {
                  const sidx = pos;
                  const slot = slots[sidx];
                  return (
                    <div
                      key={`slot-${sidx}`}
                      data-testid={`slot-${sidx}`}
                      style={slotStyle(sidx)}
                      draggable={!!slot}
                      onDragStart={slot ? (e) => onDragStartSlot(e, slot, sidx) : undefined}
                      onDragEnd={slot ? onDragEnd : undefined}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setHoverSlot(sidx); }}
                      onDragLeave={() => setHoverSlot(null)}
                      onDrop={(e) => onDropSlot(e, sidx)}
                      onClick={() => slot && removeChunk(sidx)}
                    >
                      {slot ? slot.text : (sidx + 1)}
                    </div>
                  );
                })()}
              </React.Fragment>
            ))}
            {q.responseSuffix && <span style={{ fontSize: 18, color: C.t1 }}>{q.responseSuffix}</span>}
          </div>
        </div>

        {/* Word Bank */}
        <div
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setHoverBank(true); }}
          onDragLeave={() => setHoverBank(false)}
          onDrop={onDropBank}
          style={{
            background: hoverBank && dragItem && dragItem.from === "slot" ? "#fff3f3" : "#fff",
            border: "1px solid " + C.bdr,
            borderRadius: 4,
            padding: 16,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 20,
            minHeight: 48,
          }}
        >
          <div style={{ fontSize: 11, color: C.t2, width: "100%", marginBottom: 4, letterSpacing: 1 }}>WORD BANK</div>
          {bank.length === 0 && <span style={{ fontSize: 13, color: "#aaa", fontStyle: "italic" }}>All chunks are placed. Click a filled slot to return one to the bank.</span>}
          {bank.map(chunk => (
            <button
              data-testid={`bank-chunk-${chunk.id}`}
              key={chunk.id}
              draggable
              onDragStart={(e) => onDragStartBank(e, chunk)}
              onDragEnd={onDragEnd}
              onClick={() => pickChunk(chunk)}
              style={{
                background: "#f8f9fa",
                color: C.t1,
                border: "1px solid " + C.bdr,
                borderRadius: 4,
                padding: "6px 14px",
                fontSize: 14,
                cursor: "grab",
                fontFamily: FONT,
                userSelect: "none",
                opacity: dragItem && dragItem.from === "bank" && dragItem.chunk.id === chunk.id ? 0.4 : 1,
              }}
            >{chunk.text}</button>
          ))}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 12 }}>
          <Btn onClick={resetQ} variant="secondary">Reset</Btn>
          <Btn data-testid="build-submit" onClick={submit} disabled={!allFilled}>
            {idx < qs.length - 1 ? "Next Question" : "Finish and Review"}
          </Btn>
        </div>
      </div>
    </div>
  );
}
