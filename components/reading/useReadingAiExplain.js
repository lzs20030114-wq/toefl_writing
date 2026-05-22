"use client";
import { useState, useCallback, useEffect } from "react";
import { getSavedTier } from "../../lib/AuthContext";
import { callAI } from "../../lib/ai/client";

// System prompt is reading-specific: stem + options + the right/wrong
// answers. Pattern mirrors useBsAiExplain so caching + Pro gate stay in sync.
const SYSTEM =
  "你是一位 TOEFL 阅读题辅导老师。学生在阅读题中答错了，请用中文简短解释（3-5 句）：1）原文哪一句/哪一段告诉了正确答案；2）学生选的那个选项错在哪里（常见陷阱：偷换概念、过度推断、范围错误等）。不要重复题干。";

const CACHE_KEY = "reading-ai-explain-cache";
const MAX_CACHE = 200;

function cacheKey(detail) {
  // Stable key: question id (or stem) + selected + correct. Two students
  // who answered the same question identically can share an explanation.
  const qid = detail.qid || detail.stem || "";
  return `${qid}|||${detail.selected || ""}|||${detail.correct || ""}`;
}

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveToCache(detail, text) {
  try {
    const cache = loadCache();
    cache[cacheKey(detail)] = text;
    const keys = Object.keys(cache);
    if (keys.length > MAX_CACHE) {
      keys.slice(0, keys.length - MAX_CACHE).forEach((k) => delete cache[k]);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function getFromCache(detail) {
  try {
    return loadCache()[cacheKey(detail)] || null;
  } catch {
    return null;
  }
}

export function useReadingAiExplain() {
  const [aiExplains, setAiExplains] = useState({});
  const tier = typeof window !== "undefined" ? getSavedTier() : null;
  const isPro = tier === "legacy" || tier === "pro";

  const handleAiExplain = useCallback(async (key, detail) => {
    const cached = getFromCache(detail);
    if (cached) {
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text: cached, error: null } }));
      return;
    }
    setAiExplains((prev) => ({ ...prev, [key]: { loading: true, text: null, error: null } }));
    try {
      const optionsBlock = detail.options
        ? Object.entries(detail.options)
            .map(([k, v]) => `  ${k}. ${v}`)
            .join("\n")
        : "";
      const passageBlock = detail.passage
        ? `原文：\n${detail.passage.slice(0, 1200)}${detail.passage.length > 1200 ? "..." : ""}\n\n`
        : "";
      const message =
        `${passageBlock}` +
        `题目：${detail.stem}\n` +
        (optionsBlock ? `选项：\n${optionsBlock}\n` : "") +
        `学生选择：${detail.selected || "未作答"}\n` +
        `正确答案：${detail.correct}`;
      const text = await callAI(SYSTEM, message, 350, 60000, 0.3);
      saveToCache(detail, text);
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text, error: null } }));
    } catch (e) {
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text: null, error: e.message || "请求失败" } }));
    }
  }, []);

  return { aiExplains, isPro, handleAiExplain };
}

/** Inline UI: button + result. Pass a unique key, the detail, and the hook returns. */
export function ReadingAiExplainBlock({ explainKey, detail, aiExplains, isPro, handleAiExplain }) {
  const ex = aiExplains[explainKey];

  // Auto-load from cache on mount (no API call — cache hit is free)
  useEffect(() => {
    if (!isPro || detail.isCorrect) return;
    if (ex) return;
    const cached = getFromCache(detail);
    if (cached) handleAiExplain(explainKey, detail);
  }, [ex, explainKey, detail, isPro, handleAiExplain]);

  if (!isPro || detail.isCorrect) return null;

  if (ex?.text) {
    return (
      <div
        style={{
          marginTop: 8,
          padding: "10px 12px",
          background: "#f0f9ff",
          border: "1px solid #bae6fd",
          borderRadius: 6,
          fontSize: 13,
          color: "#0c4a6e",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
        }}
      >
        <span style={{ fontWeight: 700, marginRight: 4 }}>🤖 AI:</span>
        {ex.text}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => handleAiExplain(explainKey, detail)}
        disabled={ex?.loading}
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "#fff",
          background: ex?.loading ? "#9ca3af" : "#0284c7",
          border: "none",
          borderRadius: 6,
          padding: "5px 14px",
          cursor: ex?.loading ? "default" : "pointer",
        }}
      >
        {ex?.loading ? "分析中..." : "🤖 AI 深入解析"}
      </button>
      {ex?.error && (
        <span style={{ fontSize: 12, color: "#E11D48", marginLeft: 8 }}>{ex.error}</span>
      )}
    </div>
  );
}
