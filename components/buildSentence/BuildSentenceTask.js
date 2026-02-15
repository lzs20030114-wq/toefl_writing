"use client";
import React from "react";
import { C, FONT, Btn, Toast, TopBar } from "../shared/ui";
import { useBuildSentenceSession } from "./useBuildSentenceSession";

export function BuildSentenceTask({ onExit, questions }) {
  const {
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
  } = useBuildSentenceSession(questions);

  if (phase === "review") {
    const ok = results.filter((r) => r.isCorrect).length;
    const ge = {};
    results
      .filter((r) => !r.isCorrect)
      .forEach((r) => {
        (r.q.grammar_points || []).forEach((gp) => {
          ge[gp] = (ge[gp] || 0) + 1;
        });
      });
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
              {te.map(([g, n], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < te.length - 1 ? "1px solid #eee" : "none" }}>
                  <span>{g}</span>
                  <span style={{ background: "#fee2e2", color: C.red, padding: "2px 10px", borderRadius: 10, fontSize: 12, fontWeight: 600 }}>{n}x</span>
                </div>
              ))}
              <div style={{ marginTop: 12, fontSize: 13, color: C.blue, background: C.ltB, padding: 10, borderRadius: 4 }}>
                <b>Suggestion:</b> Review these points first: {te.map((e) => e[0]).join(", ")}
              </div>
            </div>
          )}
          {results.map((r, i) => (
            <div data-testid={`build-result-${i}`} data-correct={r.isCorrect ? "true" : "false"} key={i} style={{ background: "#fff", border: "1px solid " + (r.isCorrect ? "#c6f6d5" : "#fed7d7"), borderLeft: "4px solid " + (r.isCorrect ? C.green : C.red), borderRadius: 4, padding: 14, marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>Q{i + 1}: {r.q.prompt}</div>
              <div style={{ fontSize: 14, color: r.isCorrect ? C.green : C.red }}>{r.isCorrect ? "Correct" : "Incorrect"}</div>
              <div data-testid={`build-your-sentence-${i}`} style={{ fontSize: 13, color: C.t1, marginTop: 4 }}><b>Your answer:</b> {r.userAnswer}</div>
              <div data-testid={`build-correct-answer-${i}`} style={{ fontSize: 13, color: C.blue, marginTop: 4 }}><b>Correct answer:</b> {r.correctAnswer}</div>
              {(r.q.grammar_points || []).length > 0 && (
                <div style={{ fontSize: 12, color: C.t2, marginTop: 6 }}>
                  <b>Grammar:</b> {r.q.grammar_points.join(", ")}
                </div>
              )}
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
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
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

  if (phase === "instruction") {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        <TopBar title="Build a Sentence" section="Writing | Task 1" onExit={onExit} />
        <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "32px 40px" }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 20, color: C.nav }}>Task 1: Build a Sentence</h2>
            <div style={{ fontSize: 14, color: C.t1, lineHeight: 1.8 }}>
              <p><b>Directions:</b> Use the word chunks below to build a grammatically correct sentence. Some words may already be placed for you. One chunk may be a distractor that does not belong.</p>
              <p><b>Questions:</b> 10</p>
              <p><b>Time limit:</b> 5 minutes 50 seconds</p>
              <p>The timer will start when you click <b>Start</b>. When time runs out, your answers will be submitted automatically.</p>
            </div>
            <div style={{ marginTop: 24, textAlign: "center" }}><Btn data-testid="build-start" onClick={startTimer}>Start</Btn></div>
          </div>
        </div>
      </div>
    );
  }

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
          }),
    };
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      <TopBar title="Build a Sentence" section="Writing | Task 1" timeLeft={tl} isRunning={run} qInfo={idx + 1 + " / " + qs.length} onExit={onExit} />
      <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
        <div style={{ background: C.ltB, border: "1px solid #b3d4fc", borderRadius: 4, padding: 14, marginBottom: 20, fontSize: 13 }}>
          <b>Directions:</b> Use the word chunks below to build a grammatically correct sentence. One chunk may be a distractor.
        </div>

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: C.t2, letterSpacing: 1, marginBottom: 8 }}>PROMPT</div>
          <div style={{ fontSize: 15, color: C.t1, marginBottom: 14, lineHeight: 1.5 }}>{q.prompt}</div>
          <div style={{ fontSize: 11, color: C.t2, letterSpacing: 1, marginBottom: 8 }}>RESPONSE</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minHeight: 48, alignItems: "center", lineHeight: 1.6 }}>
            {Array.from({ length: slots.length + 1 }, (_, i) => i).map((i) => (
              <React.Fragment key={`resp-${i}`}>
                {prefilledChunks.length > 0 && q.givenIndex === i && (
                  <span
                    data-testid="given-token"
                    style={{
                      fontSize: 14,
                      color: "#666",
                      background: "#e8e8e8",
                      border: "1px solid #ccc",
                      borderRadius: 4,
                      padding: "4px 10px",
                      fontWeight: 600,
                      opacity: 0.8,
                    }}
                  >
                    {prefilledChunks[0]}
                  </span>
                )}
                {i < slots.length && (
                  <div
                    key={`slot-${i}`}
                    data-testid={`slot-${i}`}
                    style={slotStyle(i)}
                    draggable={!!slots[i]}
                    onDragStart={slots[i] ? (e) => onDragStartSlot(e, slots[i], i) : undefined}
                    onDragEnd={slots[i] ? onDragEnd : undefined}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setHoverSlot(i); }}
                    onDragLeave={() => setHoverSlot(null)}
                    onDrop={(e) => onDropSlot(e, i)}
                    onClick={() => slots[i] && removeChunk(i)}
                  >
                    {slots[i] ? slots[i].text : i + 1}
                  </div>
                )}
              </React.Fragment>
            ))}
            <span style={{ fontSize: 18, color: C.t1, fontWeight: 700 }}>{punct}</span>
          </div>
        </div>

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
          <div style={{ fontSize: 11, color: C.t2, width: "100%", marginBottom: 4, letterSpacing: 1 }}>CHUNK BANK</div>
          {bank.length === 0 && <span style={{ fontSize: 13, color: "#aaa", fontStyle: "italic" }}>All chunks are placed. Click a filled slot to return one.</span>}
          {bank.map((chunk) => (
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
            >
              {chunk.text}
            </button>
          ))}
        </div>

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

