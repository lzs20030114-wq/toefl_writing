"use client";
import React, { useState, useCallback, useRef, useEffect } from "react";
import { C, FONT, Btn, InfoStrip, PageShell, SurfaceCard, Toast, TopBar } from "../shared/ui";
import { useBuildSentenceSession } from "./useBuildSentenceSession";
import { formatLongDuration, PRACTICE_MODE } from "../../lib/practiceMode";
import { translateGrammarPoint } from "../../lib/utils";
import { BANK_EXHAUSTED_ERRORS } from "../../lib/questionSelector";
import { useIsMobile } from "../../hooks/useIsMobile";

/* ── 触觉反馈 ── */
function vibrate(ms = 12) {
  try { navigator?.vibrate?.(ms); } catch {}
}

/* ── 造句交互动画 CSS ── */
const BS_INTERACTION_CSS = `
@keyframes bsPopIn {
  0%   { transform: scale(0.6); opacity: 0.4; }
  60%  { transform: scale(1.1); opacity: 1; }
  100% { transform: scale(1); }
}
@keyframes bsPulseSlot {
  0%   { box-shadow: 0 0 0 0 rgba(13,150,104,0.4); }
  70%  { box-shadow: 0 0 0 8px rgba(13,150,104,0); }
  100% { box-shadow: 0 0 0 0 rgba(13,150,104,0); }
}
@keyframes bsReturnPop {
  0%   { transform: scale(0.5); opacity: 0; }
  60%  { transform: scale(1.08); }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes bsPress {
  0%   { transform: scale(1); }
  50%  { transform: scale(0.92); }
  100% { transform: scale(1); }
}
.bs-chunk:active {
  transform: scale(0.9) !important;
  transition: transform 0.05s !important;
}
.bs-slot-filled:active {
  transform: scale(0.92) !important;
  transition: transform 0.05s !important;
}
.bs-dragging {
  opacity: 0.3 !important;
  transform: scale(0.92) !important;
  transition: all 0.15s !important;
}
.bs-drag-target {
  border-color: #0d9668 !important;
  background: rgba(13,150,104,0.08) !important;
  transform: scale(1.06);
  transition: all 0.12s !important;
  box-shadow: 0 0 0 3px rgba(13,150,104,0.15) !important;
}
`;

function formatChunkDisplay(text) {
  return String(text || "")
    .split(/\s+/)
    .map((w) => {
      const lower = w.toLowerCase();
      if (lower === "i") return "I";
      if (lower === "i'm") return "I'm";
      if (lower === "i've") return "I've";
      if (lower === "i'll") return "I'll";
      if (lower === "i'd") return "I'd";
      return w;
    })
    .join(" ");
}

function confirmEarlySubmit() {
  const confirmFn = typeof window !== "undefined" ? window.confirm : null;
  if (typeof confirmFn !== "function") return true;
  const isJsdom = typeof navigator !== "undefined" && /jsdom/i.test(String(navigator.userAgent || ""));
  if (isJsdom && !confirmFn._isMockFunction) return true;
  try {
    return confirmFn("还有剩余时间，确定要提前提交吗？");
  } catch {
    // jsdom and some embedded contexts do not implement confirm; default allow.
  }
  return true;
}

export function BuildSentenceTask({
  onExit,
  questions,
  embedded = false,
  persistSession = true,
  onComplete = null,
  onTimerChange = null,
  timeLimitSeconds = 410,
  practiceMode = PRACTICE_MODE.STANDARD,
}) {
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
    givenSlots,
    allFilled,
    punct,
    startTimer,
    resetQ,
    submit,
    pickChunk,
    removeChunk,
    placeChunkAt,
    moveSlotTo,
    onDragStartBank,
    onDragStartSlot,
    onDragEnd,
    onDropSlot,
    onDropBank,
    isPracticeMode,
  } = useBuildSentenceSession(questions, { persistSession, onComplete, onTimerChange, timeLimitSeconds, practiceMode });
  const isMobile = useIsMobile();
  const exhausted = String(selectionError || "").includes(BANK_EXHAUSTED_ERRORS.BUILD_SENTENCE);

  /* ── 交互动画状态 ── */
  const [animSlot, setAnimSlot] = useState(null);      // 刚填入的槽位 index
  const [animChunkId, setAnimChunkId] = useState(null); // 刚退回的词块 id
  const animTimer = useRef(null);

  const handlePickChunk = useCallback((chunk) => {
    vibrate(12);
    // 找到即将填入的槽位
    const targetSlot = slots.findIndex((s) => s === null);
    pickChunk(chunk);
    if (targetSlot !== -1) {
      setAnimSlot(targetSlot);
      clearTimeout(animTimer.current);
      animTimer.current = setTimeout(() => setAnimSlot(null), 450);
    }
  }, [slots, pickChunk]);

  const handleRemoveChunk = useCallback((i) => {
    vibrate(8);
    const chunk = slots[i];
    removeChunk(i);
    if (chunk) {
      setAnimChunkId(chunk.id);
      clearTimeout(animTimer.current);
      animTimer.current = setTimeout(() => setAnimChunkId(null), 450);
    }
  }, [slots, removeChunk]);

  const handlePlaceAt = useCallback((chunk, targetIdx) => {
    vibrate(12);
    placeChunkAt(chunk, targetIdx);
    setAnimSlot(targetIdx);
    clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setAnimSlot(null), 450);
  }, [placeChunkAt]);

  const handleMoveSlot = useCallback((fromIdx, targetIdx) => {
    vibrate(12);
    moveSlotTo(fromIdx, targetIdx);
    setAnimSlot(targetIdx);
    clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setAnimSlot(null), 450);
  }, [moveSlotTo]);

  /* ── Touch Drag (mobile) ── */
  const touchDrag = useRef({ active: false, source: null, sourceEl: null, startX: 0, startY: 0, ghost: null, moved: false, lastHL: null });
  const suppressClick = useRef(false);
  const pickRef = useRef(handlePickChunk);
  const removeRef = useRef(handleRemoveChunk);
  const placeRef = useRef(handlePlaceAt);
  const moveRef = useRef(handleMoveSlot);
  pickRef.current = handlePickChunk;
  removeRef.current = handleRemoveChunk;
  placeRef.current = handlePlaceAt;
  moveRef.current = handleMoveSlot;

  const startTouch = useCallback((e, source) => {
    const t = e.touches[0];
    const td = touchDrag.current;
    td.active = true;
    td.source = source;
    td.sourceEl = e.currentTarget;
    td.startX = t.clientX;
    td.startY = t.clientY;
    td.moved = false;
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    const THRESH = 8;

    function onMove(e) {
      const td = touchDrag.current;
      if (!td.active) return;
      const touch = e.touches[0];
      const dx = touch.clientX - td.startX;
      const dy = touch.clientY - td.startY;
      if (!td.moved && Math.hypot(dx, dy) < THRESH) return;
      e.preventDefault();

      if (!td.moved) {
        td.moved = true;
        vibrate(15);
        suppressClick.current = true;
        const g = document.createElement("div");
        g.textContent = formatChunkDisplay(td.source.chunk.text);
        Object.assign(g.style, {
          position: "fixed", zIndex: "10000", pointerEvents: "none",
          background: C.blue, color: "#fff", padding: "10px 18px",
          borderRadius: "12px", fontSize: "16px", fontWeight: "600",
          fontFamily: FONT, boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          transform: "scale(1.08)", whiteSpace: "nowrap",
        });
        document.body.appendChild(g);
        td.ghost = g;
        if (td.sourceEl) td.sourceEl.classList.add("bs-dragging");
      }

      if (td.ghost) {
        td.ghost.style.left = (touch.clientX - (td.ghost.offsetWidth || 80) / 2) + "px";
        td.ghost.style.top = (touch.clientY - (td.ghost.offsetHeight || 40) - 20) + "px";
      }

      // highlight drop target — hide ghost to get element underneath
      if (td.ghost) td.ghost.style.display = "none";
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (td.ghost) td.ghost.style.display = "";
      if (td.lastHL) { td.lastHL.classList.remove("bs-drag-target"); td.lastHL = null; }
      if (el) {
        const tgt = td.source.from === "bank"
          ? (el.closest("[data-slot-index]") || el.closest("[data-answer-area]"))
          : (el.closest("[data-slot-index]") || el.closest("[data-bank-area]"));
        if (tgt) { tgt.classList.add("bs-drag-target"); td.lastHL = tgt; }
      }
    }

    function onEnd(e) {
      const td = touchDrag.current;
      if (!td.active) return;
      if (td.lastHL) { td.lastHL.classList.remove("bs-drag-target"); td.lastHL = null; }
      if (td.sourceEl) { td.sourceEl.classList.remove("bs-dragging"); td.sourceEl = null; }
      if (td.ghost) { td.ghost.remove(); td.ghost = null; }
      if (!td.moved) { td.active = false; suppressClick.current = false; return; }

      const touch = e.changedTouches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      let dropped = false;
      if (el) {
        const slotEl = el.closest("[data-slot-index]");
        const bankEl = el.closest("[data-bank-area]");
        const answerEl = el.closest("[data-answer-area]");
        if (td.source.from === "bank") {
          if (slotEl) {
            const ti = parseInt(slotEl.getAttribute("data-slot-index"), 10);
            placeRef.current(td.source.chunk, ti); dropped = true;
          } else if (answerEl) {
            pickRef.current(td.source.chunk); dropped = true;
          }
        } else if (td.source.from === "slot") {
          if (slotEl) {
            const ti = parseInt(slotEl.getAttribute("data-slot-index"), 10);
            moveRef.current(td.source.slotIndex, ti); dropped = true;
          } else if (bankEl) {
            removeRef.current(td.source.slotIndex); dropped = true;
          }
        }
      }
      if (dropped) vibrate(10);
      td.active = false; td.source = null; td.moved = false;
      setTimeout(() => { suppressClick.current = false; }, 100);
    }

    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
      const td = touchDrag.current;
      if (td.ghost) { td.ghost.remove(); td.ghost = null; }
      if (td.sourceEl) { td.sourceEl.classList.remove("bs-dragging"); }
      if (td.lastHL) { td.lastHL.classList.remove("bs-drag-target"); }
    };
  }, [isMobile]);

  function handleSubmitClick() {
    if (!isPracticeMode) {
      const isFinalQuestion = idx >= qs.length - 1;
      const hasRemainingTime = Number.isFinite(tl) && tl > 0;
      if (isFinalQuestion && hasRemainingTime) {
        const ok = confirmEarlySubmit();
        if (!ok) return;
      }
    }
    submit();
  }

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

    // Band score based on TOEFL iBT 2026 writing section 1-6 scale
    const bsBand = (() => {
      const total = results.length || 1;
      const pct = ok / total;
      if (pct >= 1.0) return 6;
      if (pct >= 0.9) return 5.5;
      if (pct >= 0.8) return 5;
      if (pct >= 0.7) return 4.5;
      if (pct >= 0.6) return 4;
      if (pct >= 0.5) return 3.5;
      if (pct >= 0.4) return 3;
      if (pct >= 0.3) return 2.5;
      if (pct >= 0.2) return 2;
      if (pct >= 0.1) return 1.5;
      return 1;
    })();
    const bandColor = bsBand >= 5 ? "#34d399" : bsBand >= 4 ? "#fbbf24" : "#f87171";

    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
        {!embedded && <TopBar title="Build a Sentence — Results" section="Writing Practice" onExit={onExit} />}
        <PageShell narrow>
          <SurfaceCard style={{ background: C.nav, color: "#fff", padding: 24, textAlign: "center", marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 16 }}>
              <div>
                <div style={{ fontSize: 48, fontWeight: 800 }}>{ok}/{results.length}</div>
                <div style={{ fontSize: 14, opacity: 0.7 }}>答对题数</div>
              </div>
              <div style={{ borderLeft: "1px solid rgba(255,255,255,0.2)", paddingLeft: 16 }}>
                <div style={{ fontSize: 36, fontWeight: 800, color: bandColor }}>{bsBand.toFixed(1)}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Band</div>
              </div>
            </div>
          </SurfaceCard>
          {te.length > 0 && (
            <SurfaceCard style={{ padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 12 }}>高频薄弱语法点</div>
              {te.map(([g, n], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < te.length - 1 ? "1px solid #eee" : "none" }}>
                  <span>{translateGrammarPoint(g)}</span>
                  <span style={{ background: "#fee2e2", color: C.red, padding: "2px 10px", borderRadius: 10, fontSize: 12, fontWeight: 600 }}>{n}x</span>
                </div>
              ))}
              <div style={{ marginTop: 12, fontSize: 13, color: C.blue, background: C.ltB, padding: 10, borderRadius: 4 }}>
                <b>建议优先复习：</b>{te.map((e) => translateGrammarPoint(e[0])).join("、")}
              </div>
            </SurfaceCard>
          )}
          {results.map((r, i) => (
            <div data-testid={`build-result-${i}`} data-correct={r.isCorrect ? "true" : "false"} key={i} style={{ background: "#fff", border: "1px solid " + (r.isCorrect ? "#c6f6d5" : "#fed7d7"), borderLeft: "4px solid " + (r.isCorrect ? C.green : C.red), borderRadius: 4, padding: 14, marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>第 {i + 1} 题：{r.q.prompt}</div>
              <div style={{ fontSize: 14, color: r.isCorrect ? C.green : C.red }}>{r.isCorrect ? "答对" : "答错"}</div>
              <div data-testid={`build-your-sentence-${i}`} style={{ fontSize: 13, color: C.t1, marginTop: 4 }}><b>你的答案：</b>{r.userAnswer}</div>
              <div data-testid={`build-correct-answer-${i}`} style={{ fontSize: 13, color: C.blue, marginTop: 4 }}><b>正确答案：</b>{r.correctAnswer}</div>
              {(r.q.grammar_points || []).length > 0 && (
                <div style={{ fontSize: 12, color: C.t2, marginTop: 6 }}>
                  <b>语法点：</b>{r.q.grammar_points.map(translateGrammarPoint).join("、")}
                </div>
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
            <Btn onClick={onExit} variant="secondary">{embedded ? "返回" : "返回练习"}</Btn>
          </div>
        </PageShell>
      </div>
    );
  }

  if (selectionError) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
        {!embedded && <TopBar title="Build a Sentence" section="Writing Practice | Task 1" onExit={onExit} />}
        <PageShell narrow>
          <SurfaceCard style={{ padding: 28 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.red, marginBottom: 8 }}>
              {exhausted ? "题目已答完" : "题库暂时不可用"}
            </div>
            <div style={{ fontSize: 14, color: C.t2, marginBottom: 16 }}>
              {exhausted ? "当前账号拼句练习题库已全部答完。" : selectionError}
            </div>
            <Btn onClick={onExit} variant="secondary">{embedded ? "返回" : "返回练习"}</Btn>
          </SurfaceCard>
        </PageShell>
      </div>
    );
  }

  if (phase === "instruction") {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        {!embedded && <TopBar title="Build a Sentence" section="Writing Practice | Task 1" onExit={onExit} />}
        <PageShell narrow>
          <SurfaceCard className="tp-instruction-card" style={{ padding: "32px 40px" }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 20, color: C.nav }}>Task 1: Build a Sentence</h2>
            <div style={{ fontSize: 14, color: C.t1, lineHeight: 1.8 }}>
              <p>You will be given a set of word chunks. Arrange them to form a grammatically correct sentence.</p>
              {isPracticeMode
                ? <p>No time limit in Practice mode. Complete {qs.length} questions at your own pace.</p>
                : <p>You will have {formatLongDuration(timeLimitSeconds)} to complete {qs.length} questions.</p>}
              {practiceMode === PRACTICE_MODE.CHALLENGE && <p>Mode: <b>Challenge</b> (reduced time limit)</p>}
              {isPracticeMode && <p>Mode: <b>Practice</b> (no time limit)</p>}
              {!isPracticeMode && <p>The timer starts when you click <b>Start</b>. Your answers will be submitted automatically when time runs out.</p>}
            </div>
            <div style={{ marginTop: 24, textAlign: "center" }}><Btn data-testid="build-start" onClick={startTimer}>Start</Btn></div>
          </SurfaceCard>
        </PageShell>
      </div>
    );
  }

  const slotStyle = (i) => {
    const filled = slots[i] !== null;
    const isHover = hoverSlot === i && dragItem;
    const justPlaced = animSlot === i && filled;
    return {
      minWidth: isMobile ? 44 : 80,
      minHeight: isMobile ? 34 : 40,
      padding: isMobile ? "5px 10px" : "6px 14px",
      borderRadius: isMobile ? 8 : 4,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: isMobile ? 14 : 14,
      fontWeight: filled ? 600 : 400,
      cursor: filled ? "pointer" : "default",
      userSelect: "none",
      transition: "border-color 0.15s, background 0.15s",
      animation: justPlaced ? "bsPopIn 0.35s cubic-bezier(0.34,1.56,0.64,1), bsPulseSlot 0.5s ease-out" : "none",
      ...(filled
        ? {
            background: C.blue,
            color: "#fff",
            border: "2px solid " + C.blue,
            boxShadow: justPlaced ? "0 0 0 4px rgba(13,150,104,0.2)" : "0 2px 4px rgba(13,150,104,0.15)",
            opacity: dragItem && dragItem.from === "slot" && dragItem.slotIndex === i ? 0.4 : 1,
          }
        : {
            background: isHover ? "#e0ecff" : (isMobile ? "#f0f4f2" : "#fafafa"),
            color: "#aaa",
            border: "2px dashed " + (isHover ? C.blue : (isMobile ? "#b8c9bf" : "#ccc")),
          }),
    };
  };

  /* ── shared sub-elements ── */
  const slotsJSX = (
    <div data-answer-area="true" style={{ display: "flex", flexWrap: "wrap", gap: isMobile ? 6 : 8, minHeight: isMobile ? 36 : 48, alignItems: "center", lineHeight: 1.5 }}>
      {Array.from({ length: slots.length + 1 }, (_, i) => i).map((i) => (
        <React.Fragment key={`resp-${i}`}>
          {givenSlots.filter((gs) => gs.givenIndex === i).map((gs, gi) => (
            <span
              key={`given-${i}-${gi}`}
              data-testid={`given-token-${i}`}
              style={{
                fontSize: isMobile ? 14 : 14,
                color: "#555",
                background: "#e8ede9",
                border: "1px solid #c5d0c8",
                borderRadius: isMobile ? 8 : 4,
                padding: isMobile ? "5px 10px" : "4px 10px",
                fontWeight: 600,
                opacity: 0.85,
              }}
            >
              {formatChunkDisplay(gs.chunk)}
            </span>
          ))}
          {i < slots.length && (
            <div
              key={`slot-${i}`}
              data-testid={`slot-${i}`}
              data-slot-index={i}
              className={slots[i] ? "bs-slot-filled" : undefined}
              style={{ ...slotStyle(i), touchAction: isMobile && slots[i] ? "none" : undefined }}
              draggable={!isMobile && !!slots[i]}
              onDragStart={!isMobile && slots[i] ? (e) => onDragStartSlot(e, slots[i], i) : undefined}
              onDragEnd={!isMobile && slots[i] ? onDragEnd : undefined}
              onDragOver={!isMobile ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setHoverSlot(i); } : undefined}
              onDragLeave={!isMobile ? () => setHoverSlot(null) : undefined}
              onDrop={!isMobile ? (e) => onDropSlot(e, i) : undefined}
              onTouchStart={isMobile && slots[i] ? (e) => startTouch(e, { from: "slot", chunk: slots[i], slotIndex: i }) : undefined}
              onClick={() => { if (suppressClick.current) return; slots[i] && handleRemoveChunk(i); }}
            >
              {slots[i] ? formatChunkDisplay(slots[i].text) : i + 1}
            </div>
          )}
        </React.Fragment>
      ))}
      <span style={{ fontSize: isMobile ? 16 : 18, color: C.t1, fontWeight: 700 }}>{punct}</span>
    </div>
  );

  const bankJSX = (compact) => (
    <div
      data-bank-area="true"
      onDragOver={!isMobile ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setHoverBank(true); } : undefined}
      onDragLeave={!isMobile ? () => setHoverBank(false) : undefined}
      onDrop={!isMobile ? onDropBank : undefined}
      style={{
        background: hoverBank && dragItem && dragItem.from === "slot" ? "#fff3f3" : "#fff",
        border: "1px solid " + C.bdr,
        borderRadius: compact ? 10 : 4,
        padding: compact ? "8px 10px" : 16,
        display: "flex",
        flexWrap: "wrap",
        gap: compact ? 8 : 8,
        ...(compact ? { flex: 1, alignContent: "flex-start", overflow: "auto", minHeight: 0 } : { marginBottom: 20, minHeight: 48 }),
      }}
    >
      {!compact && <div style={{ fontSize: 11, color: C.t2, width: "100%", marginBottom: 4, letterSpacing: 1 }}>词块区</div>}
      {bank.length === 0 && <span style={{ fontSize: 12, color: "#aaa", fontStyle: "italic" }}>{compact ? "已全部放入" : "所有词块都已放入句子，可点击已填槽位退回词块。"}</span>}
      {bank.map((chunk) => {
        const justReturned = animChunkId === chunk.id;
        return (
          <button
            data-testid={`bank-chunk-${chunk.id}`}
            key={chunk.id}
            className="bs-chunk"
            draggable={!isMobile}
            onDragStart={!isMobile ? (e) => onDragStartBank(e, chunk) : undefined}
            onDragEnd={!isMobile ? onDragEnd : undefined}
            onTouchStart={isMobile ? (e) => startTouch(e, { from: "bank", chunk }) : undefined}
            onClick={() => { if (suppressClick.current) return; handlePickChunk(chunk); }}
            style={{
              background: compact ? "#fff" : "#f8f9fa",
              color: C.t1,
              border: (compact ? "1.5px" : "1px") + " solid " + C.bdr,
              borderRadius: compact ? 8 : 4,
              padding: compact ? "7px 12px" : "6px 14px",
              fontSize: compact ? 14 : 14,
              fontWeight: compact ? 500 : 400,
              cursor: "pointer",
              fontFamily: FONT,
              userSelect: "none",
              touchAction: isMobile ? "none" : undefined,
              opacity: dragItem && dragItem.from === "bank" && dragItem.chunk.id === chunk.id ? 0.4 : 1,
              transition: "transform 0.12s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.15s",
              animation: justReturned ? "bsReturnPop 0.35s cubic-bezier(0.34,1.56,0.64,1)" : "none",
              boxShadow: compact ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
            }}
          >
            {formatChunkDisplay(chunk.text)}
          </button>
        );
      })}
    </div>
  );

  const topBarH = embedded ? 0 : 56;

  return (
    <div style={{ minHeight: isMobile ? undefined : "100vh", height: isMobile ? "100dvh" : undefined, background: C.bg, fontFamily: FONT, display: isMobile ? "flex" : undefined, flexDirection: isMobile ? "column" : undefined, overflow: isMobile ? "hidden" : undefined }}>
      <style>{BS_INTERACTION_CSS}</style>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      {!embedded && <TopBar title="Build a Sentence" section="Writing Practice | Task 1" timeLeft={isPracticeMode ? undefined : tl} isRunning={run} qInfo={idx + 1 + " / " + qs.length} onExit={onExit} />}

      {isMobile ? (
        /* ── 手机端：一屏布局 ── */
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "8px 12px 12px", gap: 6, overflow: "hidden", minHeight: 0 }}>
          {/* 紧凑题目 + 作答区 */}
          <div style={{ background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: "10px 12px", flexShrink: 0, boxShadow: C.shadow }}>
            <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.4, marginBottom: 6 }}>{q.prompt}</div>
            <div style={{ fontSize: 10, color: C.t3, marginBottom: 4 }}>拖动或点击词块 · 可能含干扰项</div>
            {slotsJSX}
          </div>
          {/* 词块区 — 填充剩余空间 */}
          {bankJSX(true)}
          {/* 按钮 */}
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <Btn data-testid="build-submit" onClick={handleSubmitClick} disabled={!allFilled} style={{ flex: 1, padding: "10px 0", fontSize: 14 }}>
              {idx < qs.length - 1 ? "下一题" : "完成"}
            </Btn>
            <Btn onClick={resetQ} variant="secondary" style={{ padding: "10px 16px", fontSize: 13 }}>重置</Btn>
          </div>
        </div>
      ) : (
        /* ── 桌面端：原有布局 ── */
        <PageShell narrow>
          <InfoStrip style={{ marginBottom: 20 }}>
            <b>Directions: </b>Use the word chunks below to form a grammatically correct sentence. There may be one distractor chunk that does not belong.
          </InfoStrip>
          <SurfaceCard style={{ padding: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: C.t2, letterSpacing: 1, marginBottom: 8 }}>题目</div>
            <div style={{ fontSize: 15, color: C.t1, marginBottom: 14, lineHeight: 1.5 }}>{q.prompt}</div>
            <div style={{ fontSize: 11, color: C.t2, letterSpacing: 1, marginBottom: 8 }}>作答区</div>
            {slotsJSX}
          </SurfaceCard>
          {bankJSX(false)}
          <div style={{ display: "flex", gap: 12 }}>
            <Btn data-testid="build-submit" onClick={handleSubmitClick} disabled={!allFilled}>
              {idx < qs.length - 1 ? "下一题" : "完成并查看结果"}
            </Btn>
            <Btn onClick={resetQ} variant="secondary">重置</Btn>
          </div>
        </PageShell>
      )}
    </div>
  );
}
