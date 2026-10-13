"use client";
import { useState } from "react";
import { presetsFor, NOTE_MAX_QUESTION } from "../../lib/notes/passageNotes";

// 选中原文后的「问 AI」输入块：快捷问题 + 自己写。放在划词词典弹窗底部，或长选区的提问气泡里。
// 选的是词 / 短语和选的是句子，快捷问题不一样（presetsFor）。

const ACCENT = "#B45309";

export function NoteAskBox({ quote, onAsk, dailyLeft = 1, autoFocus = false, title = "问 AI" }) {
  const [text, setText] = useState("");
  const presets = presetsFor(quote);
  const send = (q, opts) => {
    const v = String(q || "").trim();
    if (!v) return;
    onAsk(v, opts);
    setText("");
  };
  if (dailyLeft <= 0) {
    return <div data-testid="note-ask-quota" style={{ fontSize: 12, color: "#6b7280" }}>今天的提问额度用完了，明天再问。</div>;
  }
  return (
    <div data-testid="note-ask" style={{ fontSize: 12 }}>
      <div style={{ fontWeight: 700, color: ACCENT, marginBottom: 6 }}>
        {title}
        <span style={{ fontWeight: 400, color: "#8a7a62", marginLeft: 6 }}>回答会记在原文这一处</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            data-testid={`note-preset-${p.id}`}
            onClick={() => send(p.text, { presetId: p.id, label: p.label })}
            style={{ border: "1px solid #F3D9A4", background: "#FFFBEB", color: "#92400E", borderRadius: 999, padding: "3px 10px", font: "inherit", cursor: "pointer" }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); send(text); }}
        style={{ display: "flex", gap: 6 }}
      >
        <input
          data-testid="note-ask-input"
          value={text}
          autoFocus={autoFocus}
          maxLength={NOTE_MAX_QUESTION}
          onChange={(e) => setText(e.target.value)}
          placeholder="想问什么？比如：这个搭配还能怎么用"
          style={{ flex: 1, minWidth: 0, border: "1px solid #e5d3b3", borderRadius: 6, padding: "5px 8px", font: "inherit", color: "#22322a" }}
        />
        <button
          type="submit"
          data-testid="note-ask-send"
          disabled={!text.trim()}
          style={{ border: "none", borderRadius: 6, background: text.trim() ? ACCENT : "#d6c7ae", color: "#fff", padding: "5px 12px", font: "inherit", fontWeight: 600, cursor: text.trim() ? "pointer" : "default" }}
        >
          问
        </button>
      </form>
    </div>
  );
}
