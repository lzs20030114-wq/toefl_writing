"use client";
import { useState, useCallback } from "react";
import { getSavedTier } from "../../lib/AuthContext";
import { callAI } from "../../lib/ai/client";

const SYSTEM = "你是一位专业的英语语法老师。学生在拖拽造句练习中答错了一道题，请用中文简短解释（3-5句话）：1）学生的答案哪里有问题；2）正确答案为什么是对的。重点讲语法，不要重复题目内容。";

export function useBsAiExplain() {
  const [aiExplains, setAiExplains] = useState({});
  const isLegacy = typeof window !== "undefined" && getSavedTier() === "legacy";

  const handleAiExplain = useCallback(async (key, detail) => {
    setAiExplains((prev) => ({ ...prev, [key]: { loading: true, text: null, error: null } }));
    try {
      const message = `题目：${detail.prompt}\n学生答案：${detail.userAnswer}\n正确答案：${detail.correctAnswer}${detail.grammar_points?.length ? `\n涉及语法点：${detail.grammar_points.join(", ")}` : ""}`;
      const text = await callAI(SYSTEM, message, 300, 30000, 0.3);
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text, error: null } }));
    } catch (e) {
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text: null, error: e.message || "请求失败" } }));
    }
  }, []);

  return { aiExplains, isLegacy, handleAiExplain };
}

/** Inline UI for the AI explain button + result. Pass a unique key, the detail object, and the hook returns. */
export function BsAiExplainBlock({ explainKey, detail, aiExplains, isLegacy, handleAiExplain }) {
  if (!isLegacy || detail.isCorrect) return null;
  const ex = aiExplains[explainKey];
  if (ex?.text) {
    return (
      <div style={{ marginTop: 8, padding: "10px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 13, color: "#1a2420", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
        {ex.text}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => handleAiExplain(explainKey, detail)}
        disabled={ex?.loading}
        style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: ex?.loading ? "#9ca3af" : "#7c3aed", border: "none", borderRadius: 4, padding: "5px 14px", cursor: ex?.loading ? "default" : "pointer" }}
      >
        {ex?.loading ? "分析中..." : "AI 解释"}
      </button>
      {ex?.error && <span style={{ fontSize: 12, color: "#E11D48", marginLeft: 8 }}>{ex.error}</span>}
    </div>
  );
}
