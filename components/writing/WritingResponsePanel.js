"use client";
import React, { useEffect, useRef, useState } from "react";
import { C, Btn, FONT, SurfaceCard } from "../shared/ui";

const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u303F\u3040-\u30FF]/g;
const IME_TIP_DISMISSED_KEY = "toefl-ime-tip-dismissed";

function ExamToolbar({ taRef, onTextChange, disabled, historyRef, prevTextRef }) {
  function handleCopy() {
    const ta = taRef.current;
    if (!ta) return;
    const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (selected) navigator.clipboard.writeText(selected).catch(() => {});
  }

  async function handlePaste() {
    const ta = taRef.current;
    if (!ta) return;
    try {
      const raw = await navigator.clipboard.readText();
      const cleaned = raw.replace(CJK_RE, "");
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = ta.value.slice(0, start) + cleaned + ta.value.slice(end);
      onTextChange(next);
      setTimeout(() => {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = start + cleaned.length;
      }, 0);
    } catch {
      // Ignore clipboard permission errors.
    }
  }

  function handleUndo() {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current.pop();
    prevTextRef.current = prev;
    onTextChange(prev);
    setTimeout(() => taRef.current?.focus(), 0);
  }

  const btnStyle = {
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 700,
    border: "1px solid " + C.bdr,
    borderRadius: 8,
    background: disabled ? "#e5e7eb" : "#fff",
    color: disabled ? "#94a3b8" : C.t2,
    cursor: disabled ? "not-allowed" : "pointer",
    userSelect: "none",
    letterSpacing: "0.02em",
  };

  return (
    <div style={{ background: "#f8fafc", borderBottom: "1px solid " + C.bdrSubtle, padding: "8px 12px", display: "flex", gap: 6, alignItems: "center" }}>
      <button style={btnStyle} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={handleCopy}>Copy</button>
      <button style={btnStyle} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={handlePaste}>Paste</button>
      <button style={btnStyle} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={handleUndo}>Undo</button>
      <span style={{ marginLeft: 6, fontSize: 11, color: "#94a3b8" }}>仅保留英文输入</span>
    </div>
  );
}

export function WritingResponsePanel({
  type,
  pd,
  phase,
  text,
  onTextChange,
  w,
  minW,
  fb,
  deferScoring,
  requestState,
  scoreError,
  onStart,
  onSubmit,
  onRetry,
  onExit,
  embedded,
  isMobile,
}) {
  const taRef = useRef(null);
  const historyRef = useRef([]);
  const prevTextRef = useRef(text);
  const isComposingRef = useRef(false);
  const isEditable = phase === "writing";
  const [imeTipVisible, setImeTipVisible] = useState(false);
  const imeTipDismissedRef = useRef(false);

  useEffect(() => {
    try { imeTipDismissedRef.current = localStorage.getItem(IME_TIP_DISMISSED_KEY) === "1"; } catch {}
  }, []);

  useEffect(() => {
    if (text !== prevTextRef.current) {
      historyRef.current.push(prevTextRef.current);
      if (historyRef.current.length > 200) historyRef.current.shift();
      prevTextRef.current = text;
    }
  }, [text]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 8 : 12, ...(isMobile ? { flex: 1, minHeight: 0 } : {}) }}>
      {phase === "ready" ? (
        <SurfaceCard style={{ padding: 40, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 14, color: C.t2 }}>Read the prompt carefully, then click below to begin writing.</div>
          <Btn data-testid="writing-start" onClick={onStart}>Start Writing</Btn>
        </SurfaceCard>
      ) : (
        <>
          <SurfaceCard style={{ overflow: "hidden", flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ background: C.ltB, padding: "12px 16px", fontSize: 12, fontWeight: 700, color: C.t2, borderBottom: "1px solid " + C.bdrSubtle, display: "flex", justifyContent: "space-between" }}>
              <span>Your Response</span>
              <span style={{ color: w < minW ? C.orange : C.green }}>{w} words{w < minW ? ` (${minW - w} more needed)` : ""}</span>
            </div>

            {type === "email" && (
              <div style={{ padding: "10px 16px", borderBottom: "1px solid " + C.bdrSubtle, fontSize: 13, color: C.t1, lineHeight: 1.8 }}>
                <div><b>To:</b> {pd?.to || ""}</div>
                {pd?.subject && <div><b>Subject:</b> {pd.subject}</div>}
              </div>
            )}

            <ExamToolbar taRef={taRef} onTextChange={onTextChange} disabled={!isEditable} historyRef={historyRef} prevTextRef={prevTextRef} />

            {imeTipVisible && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", background: "#fffbeb", borderBottom: "1px solid #fde68a", fontSize: 12, color: "#92400e", lineHeight: 1.5 }}>
                <span style={{ flexShrink: 0, marginTop: 1 }}>&#9888;&#65039;</span>
                <div style={{ flex: 1 }}>
                  <b>检测到中文输入法</b> — 本练习仅支持英文。Mac 用户请前往「系统设置 &gt; 键盘 &gt; 输入法」开启「自动切换到文稿的输入法」，即可在答题时自动切换为英文。
                </div>
                <button
                  onClick={() => {
                    setImeTipVisible(false);
                    imeTipDismissedRef.current = true;
                    try { localStorage.setItem(IME_TIP_DISMISSED_KEY, "1"); } catch {}
                  }}
                  style={{ flexShrink: 0, background: "none", border: "none", color: "#92400e", cursor: "pointer", fontSize: 14, fontWeight: 700, padding: "0 2px", lineHeight: 1 }}
                >
                  &#10005;
                </button>
              </div>
            )}

            <textarea
              ref={taRef}
              data-testid="writing-textarea"
              lang="en"
              value={text}
              onCompositionStart={() => { isComposingRef.current = true; }}
              onCompositionEnd={(e) => {
                isComposingRef.current = false;
                const cleaned = e.target.value.replace(CJK_RE, "");
                if (cleaned !== text) onTextChange(cleaned);
                if (!imeTipDismissedRef.current && /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u303F\u3040-\u30FF]/.test(e.data || "")) setImeTipVisible(true);
              }}
              onChange={(e) => {
                if (isComposingRef.current) {
                  // Mac IME switch may skip compositionEnd — trust native flag
                  if (e.nativeEvent?.isComposing === false) {
                    isComposingRef.current = false;
                  } else {
                    return;
                  }
                }
                const cleaned = e.target.value.replace(CJK_RE, "");
                onTextChange(cleaned);
              }}
              onKeyDown={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  const k = e.key.toLowerCase();
                  if (k === "z") {
                    e.preventDefault();
                    if (historyRef.current.length > 0) {
                      const prev = historyRef.current.pop();
                      prevTextRef.current = prev;
                      onTextChange(prev);
                    }
                  } else if (!["c", "v", "a", "enter"].includes(k)) {
                    e.preventDefault();
                  }
                }
              }}
              disabled={!isEditable}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              placeholder={type === "email" ? "Dear " + pd.to + ",\n\n" : ""}
              style={{ flex: 1, minHeight: isMobile ? 80 : (type === "email" ? 280 : 320), border: "none", padding: isMobile ? "10px 12px" : 16, fontSize: 14, fontFamily: FONT, lineHeight: 1.7, color: C.t1, resize: "none", outline: "none", background: phase === "done" ? "#fafafa" : "#fff" }}
            />
          </SurfaceCard>

          {phase === "writing" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Btn data-testid="writing-submit" onClick={onSubmit} variant="success">Submit</Btn>
              <span style={{ fontSize: 11, color: C.t2 }}>Shortcut: Ctrl+Enter</span>
            </div>
          ) : null}
        </>
      )}

      {phase === "scoring" ? <SurfaceCard style={{ padding: 32, textAlign: "center", color: C.t2 }}>AI 正在评分，请稍候...</SurfaceCard> : null}

      {phase === "done" && deferScoring && !fb && requestState !== "error" ? (
        <div style={{ marginTop: 20 }}>
          <SurfaceCard style={{ padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.green, marginBottom: 6 }}>已提交作答</div>
            <div style={{ fontSize: 13, color: C.t2 }}>该任务会在稍后评分，并显示在模考总结果中。</div>
          </SurfaceCard>
        </div>
      ) : null}

      {phase === "done" && deferScoring && !fb && requestState === "error" ? (
        <div style={{ marginTop: 20 }}>
          <SurfaceCard style={{ padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.red, marginBottom: 6 }}>提交失败</div>
            <div style={{ fontSize: 13, color: C.t2, marginBottom: 10 }}>延迟评分数据未成功保存，请重新完成这道题。</div>
            {!!scoreError ? <div style={{ fontSize: 12, color: C.red }}>{scoreError}</div> : null}
          </SurfaceCard>
        </div>
      ) : null}

      {phase === "done" && !fb && !deferScoring ? (
        <div style={{ marginTop: 20 }}>
          <SurfaceCard style={{ padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>!</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.red, marginBottom: 8 }}>评分失败</div>
            <div style={{ fontSize: 14, color: C.t2, marginBottom: 20 }}>当前暂时无法完成评分，请稍后重试。</div>
            {!!scoreError ? <div data-testid="score-error-reason" style={{ fontSize: 12, color: C.red, marginBottom: 12 }}>{scoreError}</div> : null}
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <Btn onClick={onRetry}>重新评分</Btn>
              <Btn onClick={onExit} variant="secondary">{embedded ? "返回" : "返回菜单"}</Btn>
            </div>
          </SurfaceCard>
        </div>
      ) : null}
    </div>
  );
}
