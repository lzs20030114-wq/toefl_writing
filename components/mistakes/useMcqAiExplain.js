"use client";
import { useState, useCallback, useEffect } from "react";
import { getSavedTier } from "../../lib/AuthContext";
import { callAI } from "../../lib/ai/client";

// Pro-only AI explainer for Reading / Listening MCQ mistakes, mirroring the
// Build-a-Sentence useBsAiExplain pattern. Responses are cached in
// localStorage so opening the notebook a second time doesn't re-bill.
const SYSTEM_BY_SECTION = {
  reading: "你是一位专业的英语阅读老师。学生在 TOEFL 阅读练习中答错了一道题，请用中文简短解释（3-5 句话）：1）正确答案为什么是对的（结合文章/选项）；2）学生选项的错误点在哪里。语气友善专业，避免空话。",
  listening: "你是一位专业的英语听力老师。学生在 TOEFL 听力练习中答错了一道题，请用中文简短解释（3-5 句话）：1）正确答案为什么是对的（结合语境）；2）学生选项的错误点在哪里。语气友善专业，避免空话。",
};

function cacheBucket(section) {
  return `mcq-ai-explain-cache:${section}`;
}

const MAX_CACHE = 200;

function cacheKey(mistake) {
  // The (correctKey || correctAnswer, selected || userAnswer, first 60 chars of stem)
  // triple is stable across sessions for the same item, so this caches across
  // separate practice runs of the same question.
  const stemSig = String(mistake?.stem || "").slice(0, 60);
  return `${mistake?.correctKey || mistake?.correctAnswer || ""}|||${mistake?.selected || mistake?.userAnswer || ""}|||${stemSig}`;
}

function loadCache(section) {
  try { return JSON.parse(localStorage.getItem(cacheBucket(section)) || "{}"); } catch { return {}; }
}

function saveToCache(section, mistake, text) {
  try {
    const cache = loadCache(section);
    cache[cacheKey(mistake)] = text;
    const keys = Object.keys(cache);
    if (keys.length > MAX_CACHE) {
      keys.slice(0, keys.length - MAX_CACHE).forEach((k) => delete cache[k]);
    }
    localStorage.setItem(cacheBucket(section), JSON.stringify(cache));
  } catch {}
}

function getFromCache(section, mistake) {
  try { return loadCache(section)[cacheKey(mistake)] || null; } catch { return null; }
}

function buildPrompt(section, mistake, context) {
  const lines = [];
  if (section === "reading" && context?.passage) {
    const trimmed = String(context.passage).slice(0, 1500);
    lines.push(`文章：${trimmed}`);
  } else if (section === "listening" && context?.contextText) {
    const trimmed = String(context.contextText).slice(0, 1500);
    lines.push(`听力原文：${trimmed}`);
  }
  if (mistake.stem) lines.push(`题目：${mistake.stem}`);
  if (mistake.options) {
    const optLines = Object.entries(mistake.options).map(([k, v]) => `${k}. ${v}`).join("\n");
    lines.push(`选项：\n${optLines}`);
  }
  lines.push(`学生答案：${mistake.userAnswer || "(未作答)"}`);
  lines.push(`正确答案：${mistake.correctAnswer || ""}`);
  return lines.join("\n");
}

export function useMcqAiExplain(section = "reading") {
  const [aiExplains, setAiExplains] = useState({});
  const tier = typeof window !== "undefined" ? getSavedTier() : null;
  const isPro = tier === "legacy" || tier === "pro";

  const handleAiExplain = useCallback(async (key, mistake, context) => {
    const cached = getFromCache(section, mistake);
    if (cached) {
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text: cached, error: null } }));
      return;
    }
    setAiExplains((prev) => ({ ...prev, [key]: { loading: true, text: null, error: null } }));
    try {
      const sys = SYSTEM_BY_SECTION[section] || SYSTEM_BY_SECTION.reading;
      const message = buildPrompt(section, mistake, context);
      const text = await callAI(sys, message, 320, 60000, 0.3);
      saveToCache(section, mistake, text);
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text, error: null } }));
    } catch (e) {
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text: null, error: e.message || "请求失败" } }));
    }
  }, [section]);

  return { aiExplains, isPro, handleAiExplain };
}

export function McqAiExplainBlock({ explainKey, mistake, context, aiExplains, isPro, handleAiExplain, section }) {
  const ex = aiExplains[explainKey];

  useEffect(() => {
    if (!isPro) return;
    if (ex) return;
    const cached = getFromCache(section, mistake);
    if (cached) handleAiExplain(explainKey, mistake, context);
  }, [ex, explainKey, mistake, context, isPro, handleAiExplain, section]);

  if (!isPro) {
    return (
      <div style={{ marginTop: 8 }}>
        <button
          disabled
          title="AI 解释是 Pro 功能"
          style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: "#94a3b8", border: "none", borderRadius: 4, padding: "5px 14px", cursor: "default" }}
        >
          🔒 AI 解释 · Pro
        </button>
      </div>
    );
  }

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
        onClick={() => handleAiExplain(explainKey, mistake, context)}
        disabled={ex?.loading}
        style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: ex?.loading ? "#9ca3af" : "#7c3aed", border: "none", borderRadius: 4, padding: "5px 14px", cursor: ex?.loading ? "default" : "pointer" }}
      >
        {ex?.loading ? "分析中..." : "AI 解释"}
      </button>
      {ex?.error && <span style={{ fontSize: 12, color: "#E11D48", marginLeft: 8 }}>{ex.error}</span>}
    </div>
  );
}
