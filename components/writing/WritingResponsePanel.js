"use client";
import React from "react";
import { C, Btn, FONT } from "../shared/ui";

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
            <div style={{ background: "#e8e8e8", padding: "10px 16px", fontSize: 12, fontWeight: 700, color: C.t2, borderBottom: "1px solid " + C.bdr, display: "flex", justifyContent: "space-between" }}>
              <span>你的作答 <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 11 }}>· 仅限英文 · Copy / Paste / Undo</span></span>
              <span style={{ color: w < minW ? C.orange : C.green }}>{w} 词 {w < minW ? "(还差 " + (minW - w) + " 词)" : ""}</span>
            </div>
            <textarea
              data-testid="writing-textarea"
              value={text}
              onChange={(e) => {
                // 过滤所有 CJK 汉字及全角字符，只保留英文内容
                const cleaned = e.target.value.replace(
                  /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u303F\u3040-\u30FF]/g,
                  ""
                );
                onTextChange(cleaned);
              }}
              onKeyDown={(e) => {
                // 仅允许 Ctrl/Cmd + C（复制）、V（粘贴）、Z（撤销）、A（全选）、Enter（提交）
                if (e.ctrlKey || e.metaKey) {
                  const k = e.key.toLowerCase();
                  if (!["c", "v", "z", "a", "enter"].includes(k)) {
                    e.preventDefault();
                  }
                }
              }}
              disabled={phase === "scoring" || phase === "done"}
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
