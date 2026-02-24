"use client";
import React, { useRef, useEffect } from "react";
import { C, Btn, FONT } from "../shared/ui";

const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u303F\u3040-\u30FF]/g;

function ExamToolbar({ taRef, text, onTextChange, disabled, historyRef, prevTextRef }) {
  // Copy — 复制选中文字到剪贴板
  function handleCopy() {
    const ta = taRef.current;
    if (!ta) return;
    const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (selected) navigator.clipboard.writeText(selected).catch(() => {});
  }

  // Paste — 从剪贴板读取并插入光标位置，自动过滤汉字
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
      // 浏览器拒绝权限时静默忽略
    }
  }

  // Undo — 从自维护历史栈中恢复上一个文本状态
  function handleUndo() {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current.pop();
    prevTextRef.current = prev;
    onTextChange(prev);
    setTimeout(() => taRef.current?.focus(), 0);
  }

  const btnStyle = {
    padding: "3px 14px",
    fontSize: 12,
    fontWeight: 600,
    border: "1px solid #b0b8c4",
    borderRadius: 3,
    background: disabled ? "#e8e8e8" : "#f0f0f0",
    color: disabled ? "#aaa" : "#333",
    cursor: disabled ? "not-allowed" : "pointer",
    userSelect: "none",
    letterSpacing: "0.02em",
  };

  return (
    <div style={{ background: "#dde2e8", borderBottom: "1px solid " + C.bdr, padding: "5px 12px", display: "flex", gap: 6, alignItems: "center" }}>
      <button style={btnStyle} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={handleCopy}>Copy</button>
      <button style={btnStyle} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={handlePaste}>Paste</button>
      <button style={btnStyle} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={handleUndo}>Undo</button>
      <span style={{ marginLeft: 6, fontSize: 11, color: "#94a3b8" }}>仅限英文输入</span>
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
}) {
  const taRef = useRef(null);
  const historyRef = useRef([]);   // 历史文本栈
  const prevTextRef = useRef(text); // 上一次的文本值
  const isEditable = phase === "writing";

  // 每次 text 变化时将旧值压栈（最多保留 200 步）
  useEffect(() => {
    if (text !== prevTextRef.current) {
      historyRef.current.push(prevTextRef.current);
      if (historyRef.current.length > 200) historyRef.current.shift();
      prevTextRef.current = text;
    }
  }, [text]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {phase === "ready" ? (
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 40, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 14, color: C.t2 }}>Read the prompt, then click start to begin writing.</div>
          <Btn data-testid="writing-start" onClick={onStart}>Start Writing</Btn>
        </div>
      ) : (
        <>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, overflow: "hidden", flex: 1, display: "flex", flexDirection: "column" }}>
            {/* 标题栏：词数 */}
            <div style={{ background: "#e8e8e8", padding: "10px 16px", fontSize: 12, fontWeight: 700, color: C.t2, borderBottom: "1px solid " + C.bdr, display: "flex", justifyContent: "space-between" }}>
              <span>你的作答</span>
              <span style={{ color: w < minW ? C.orange : C.green }}>{w} 词 {w < minW ? "(还差 " + (minW - w) + " 词)" : ""}</span>
            </div>

            {/* 工具栏：Copy / Paste / Undo */}
            <ExamToolbar taRef={taRef} text={text} onTextChange={onTextChange} disabled={!isEditable} historyRef={historyRef} prevTextRef={prevTextRef} />

            {/* 答题区 */}
            <textarea
              ref={taRef}
              data-testid="writing-textarea"
              value={text}
              onChange={(e) => {
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
              placeholder={type === "email" ? "Dear " + pd.to + ",\n\nI am writing to..." : "I think this is an interesting question..."}
              style={{ flex: 1, minHeight: type === "email" ? 280 : 320, border: "none", padding: 16, fontSize: 14, fontFamily: FONT, lineHeight: 1.7, color: C.t1, resize: "none", outline: "none", background: phase === "done" ? "#fafafa" : "#fff" }}
            />
          </div>

          {phase === "writing" && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Btn data-testid="writing-submit" onClick={onSubmit} variant="success">提交评分</Btn>
              <span style={{ fontSize: 11, color: C.t2 }}>Ctrl+Enter</span>
            </div>
          )}
        </>
      )}

      {phase === "scoring" && <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 32, textAlign: "center", color: C.t2 }}>AI 正在评分，请稍候...</div>}

      {phase === "done" && deferScoring && !fb && requestState !== "error" && (
        <div style={{ marginTop: 20 }}>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.green, marginBottom: 6 }}>已提交作答</div>
            <div style={{ fontSize: 13, color: C.t2 }}>
              本题将延迟评分，并在模考总结中统一展示。
            </div>
          </div>
        </div>
      )}

      {phase === "done" && deferScoring && !fb && requestState === "error" && (
        <div style={{ marginTop: 20 }}>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.red, marginBottom: 6 }}>提交失败</div>
            <div style={{ fontSize: 13, color: C.t2, marginBottom: 10 }}>
              延迟评分数据未保存成功，请重试该题。
            </div>
            {!!scoreError && <div style={{ fontSize: 12, color: C.red }}>{scoreError}</div>}
          </div>
        </div>
      )}

      {phase === "done" && !fb && !deferScoring && (
        <div style={{ marginTop: 20 }}>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>!</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.red, marginBottom: 8 }}>评分失败</div>
            <div style={{ fontSize: 14, color: C.t2, marginBottom: 20 }}>
              {scoreError === "评分失败，AI服务暂时不可用"
                ? "评分失败，AI服务暂时不可用"
                : (scoreError || "此部分暂时无法加载")}
            </div>
            {requestState === "error" && !!scoreError && <div data-testid="score-error-reason" style={{ fontSize: 12, color: C.red, marginBottom: 12 }}>{scoreError}</div>}
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <Btn onClick={onRetry}>重试评分</Btn>
              <Btn onClick={onExit} variant="secondary">{embedded ? "返回" : "返回菜单"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
