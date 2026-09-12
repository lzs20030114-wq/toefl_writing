"use client";
import { useState, useCallback, useEffect } from "react";
import { getSavedTier } from "../../lib/AuthContext";
import { callAI, mapAiHelperError } from "../../lib/ai/client";

// CTW（阅读填词 / C-test）专用的 AI 讲解。与 useReadingAiExplain / useMcqAiExplain
// 同一骨架（Pro 门 + localStorage 缓存 + 点了才计费），差别只在 prompt：
// 填词考的是词形、搭配、上下文衔接，而不是选择题的选项陷阱。
const SYSTEM =
  "你是一位 TOEFL 阅读填词（C-test）辅导老师。学生在补全单词时填错了，请用中文简短讲解（3-5 句）：" +
  "1）正确答案为什么是这个词——从给出的字母前缀、所在句子的语法（时态/语态/单复数/词性）、" +
  "固定搭配或介词、以及上下文逻辑衔接中，指出决定性线索；" +
  "2）学生填的词错在哪——是词形/时态不对、搭配不成立、不合上下文，还是拼写问题。" +
  "如果学生没有作答，就讲第 1 点，并说明该怎么从前缀和语境一步步推出答案（同样 3-5 句，不要只写一句）。" +
  "不要重复原文，不要空话。" +
  // 面板是 whiteSpace: pre-wrap 的纯文本渲染，markdown 星号会原样显示成 **word**。
  "直接输出纯文本，不要使用 markdown 的 ** 加粗、# 标题或列表符号。";

const CACHE_KEY = "ctw-ai-explain-cache";
const MAX_CACHE = 200;

// 句末判据：词尾的 .!? 后面可能还跟着引号 / 括号（"hand."」 → 仍是句末）。
const SENTENCE_END_RE = /[.!?]["')\]”’]*$/;

const EMPTY_LOCATION = { sentence: "", words: [], targetIndexInSentence: -1, marked: "" };

/**
 * 定位某个空所在的句子。
 *
 * position 是 `passage.split(/\s+/)` 之后的词索引（与 CTWDetail 的
 * renderMarkedPassage 同一切法——两边必须完全一致，否则索引错位），
 * 所以这里也不 trim、不做别的归一。
 *
 * 只靠 position：真题库（data/realBank/reading/ctw.json）的 blank 没有
 * sentence_index / word_index_in_sentence，不能依赖它们。
 *
 * 返回 { sentence, words, targetIndexInSentence, marked }；
 * marked 是把目标词用【】包好的版本（喂给模型用），words + targetIndexInSentence
 * 供 UI 高亮。越界 / 空原文 / 非法 position 一律返回安全空值，不抛错。
 *
 * 缩写（Mr. / U.S. / e.g.）会被当成句末——只影响句子取多取少，不影响正确性。
 */
export function locateBlankSentence(passage, position) {
  const text = typeof passage === "string" ? passage : "";
  if (!text.trim()) return EMPTY_LOCATION;

  const words = text.split(/\s+/);
  const pos = Number(position);
  if (!Number.isInteger(pos) || pos < 0 || pos >= words.length) return EMPTY_LOCATION;

  let start = pos;
  while (start > 0 && !SENTENCE_END_RE.test(words[start - 1])) start -= 1;
  let end = pos;
  while (end < words.length - 1 && !SENTENCE_END_RE.test(words[end])) end += 1;

  const slice = words.slice(start, end + 1);
  const targetIndexInSentence = pos - start;
  return {
    sentence: slice.join(" "),
    words: slice,
    targetIndexInSentence,
    marked: slice
      .map((w, i) => (i === targetIndexInSentence ? `【${w}】` : w))
      .join(" "),
  };
}

function cacheKey(detail) {
  // 同一题 + 同一个空 + 同样的错答 → 共享同一份解析。
  const itemId = detail?.itemId || "";
  const pos = detail?.position == null ? "" : detail.position;
  const userFull = detail?.fullWord || "";
  const correct = detail?.original_word || "";
  return `${itemId}|${pos}|${userFull}|${correct}`;
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

function buildMessage(detail) {
  const passage = String(detail?.passage || "");
  const loc = locateBlankSentence(passage, detail?.position);
  const lines = [];
  // CTW 原文只有 ~120 词，全给；slice 只是防御脏数据。
  if (passage) {
    lines.push(`原文：${passage.slice(0, 1500)}${passage.length > 1500 ? "..." : ""}`);
  }
  if (loc.marked) lines.push(`该空所在句子：${loc.marked}`);
  const idx = Number(detail?.blankIndex);
  const total = Number(detail?.blankTotal);
  if (Number.isFinite(idx)) {
    lines.push(`第 ${idx + 1} 个空（共 ${Number.isFinite(total) ? total : idx + 1} 个）`);
  }
  lines.push(`已给出的字母：${detail?.displayed_fragment || ""}`);
  const answered = String(detail?.userAnswer ?? "").trim() !== "";
  lines.push(`学生填写：${answered ? detail?.fullWord || "" : "未作答"}`);
  lines.push(`正确答案：${detail?.original_word || ""}`);
  return lines.join("\n");
}

export function useCtwAiExplain() {
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
      // 700 而不是 350：实测 350 会把 3-5 句的中文讲解硬截断在句子中间
      // （deepseek-v4-flash 的推理 token 也吃这份预算）。只在用户点按钮时计费，
      // 上调预算的实际成本可忽略。
      const text = await callAI(SYSTEM, buildMessage(detail), 700, 60000, 0.3);
      saveToCache(detail, text);
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text, error: null } }));
    } catch (e) {
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text: null, error: mapAiHelperError(e) } }));
    }
  }, []);

  return { aiExplains, isPro, handleAiExplain };
}

/** 展开面板里的 AI 讲解块：有缓存则自动填充，否则等用户点按钮（点了才计费）。 */
export function CtwAiExplainBlock({ explainKey, detail, aiExplains, isPro, handleAiExplain }) {
  const ex = aiExplains[explainKey];

  // 缓存命中才自动调（走的是 getFromCache 分支，不发请求）；未命中不自动打 API。
  useEffect(() => {
    if (!isPro || detail?.isCorrect) return;
    if (ex) return;
    const cached = getFromCache(detail);
    if (cached) handleAiExplain(explainKey, detail);
  }, [ex, explainKey, detail, isPro, handleAiExplain]);

  if (!isPro || detail?.isCorrect) return null;

  if (ex?.text) {
    return (
      <div
        style={{
          marginTop: 8,
          padding: "10px 12px",
          background: "#f0f9ff",
          border: "1px solid #bae6fd",
          borderRadius: 8,
          fontSize: 13,
          color: "#0c4a6e",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
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
        type="button"
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
