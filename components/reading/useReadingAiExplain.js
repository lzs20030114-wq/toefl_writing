"use client";
import { useState, useCallback, useEffect } from "react";
import { getSavedTier } from "../../lib/AuthContext";
import { callAIStream, mapAiHelperError, AI_EXPLAIN_BUDGET } from "../../lib/ai/client";
import { isSentenceSelection, sentenceOptionKeys, sentenceOptionText } from "../../lib/reading/sentenceSelection";

// 阅读选择题（RDL / AP，含真题选句题）的 AI 讲解。与 useCtwAiExplain / useBsAiExplain
// 同一骨架：Pro 门 + localStorage 缓存 + 点了才计费。差别只在 prompt——阅读考的是
// 「答案句在原文哪里」和「干扰项的陷阱类型」，不是填词的词形搭配。
//
// 三个入口共用这一份：阅读练习历史 RDLDetail（/progress/reading 与 /real-bank/progress
// 共用）、阅读模考详情 MockSessionDetail、以及 RDLTask 交卷后的逐题复盘。
const SYSTEM =
  "你是一位 TOEFL 阅读辅导老师。学生做错了一道阅读题，请用中文简短讲解（3-5 句）：" +
  "1）定位——原文哪一句/哪一段给出了正确答案，把那句话的意思说清楚；" +
  "2）学生选的选项错在哪——指出具体陷阱类型（偷换概念、过度推断、范围扩大或缩小、" +
  "原文未提、答非所问、张冠李戴等），并说明原文其实怎么说。" +
  "如果学生未作答，就只讲第 1 点，并说明该怎么从题干关键词一步步定位到答案句（同样 3-5 句，不要只写一句）。" +
  "不要重复题干和选项原文，不要空话。" +
  // 面板是 whiteSpace: pre-wrap 的纯文本渲染，markdown 星号会原样显示成 **word**。
  "直接输出纯文本，不要使用 markdown 的 ** 加粗、# 标题或列表符号。";

// 缓存桶带版本号：prompt 换过一次（旧版把原文砍在 1200 字、且没禁 markdown），
// 旧缓存里的讲解可能基于看不全的原文、还带着字面显示的 **。换桶比留着脏数据便宜。
const CACHE_KEY = "reading-ai-explain-cache-v2";
const MAX_CACHE = 200;

// 原文全给。旧版 1200 字的上限会砍掉 74/101 篇生成库 AP 与 84/86 篇真题 AP 的尾段
// （AP 原文中位数 1289–1434 字符，最长 1871），而阅读题的答案句经常就在后半篇——
// 模型看不到答案句时讲解必然是编的。4000 是防脏数据的兜底，不是正常路径会碰到的线。
const MAX_PASSAGE_CHARS = 4000;

function cacheKey(detail) {
  // Stable key: question id + 题干签名 + selected + correct。同一题同样的错答
  // 共享一份解析（跨练习、跨入口复用，不重复计费）。
  //
  // 题干签名一律参与 key，不只在没有 qid 时兜底：调用方拿不到真 qid 时只能自己拼
  // 合成 id，而缺 itemId 的老记录会把它拼成 "-q0" 这种退化值。只靠它做 key，
  // 同一份记录里两道「答案组合相同」的不同题就会撞进同一条缓存。
  const qid = detail.qid || "";
  const stemSig = String(detail.stem || "").slice(0, 80);
  return `${qid}|${stemSig}|||${detail.selected || ""}|||${detail.correct || ""}`;
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

/**
 * 组装喂给模型的 message。
 *
 * 选句题（真题 AP，question_type: "sentence_selection"）要单独走一支：作答值是
 * S1..Sn 这种句子键，直接写「学生选择：S3 / 正确答案：S4」模型完全无从下手——
 * 必须把键换成句子原文，并告诉它这是「在第 N 段里挑一句」而不是四选一。
 * 判据用 lib/reading/sentenceSelection 的 isSentenceSelection，与渲染、mapper 同源；
 * 第二来源那批被拍成 A–D 的选句题在那里就已经判为普通选择题，这里照四选一走。
 */
export function buildReadingExplainMessage(detail) {
  const question = detail?.question || null;
  const options = detail?.options || question?.options || null;
  const ss = isSentenceSelection(question) || isSentenceSelection({ question_type: detail?.questionType, options });
  const lines = [];

  const passage = String(detail?.passage || "");
  if (passage) {
    lines.push(`原文：\n${passage.slice(0, MAX_PASSAGE_CHARS)}${passage.length > MAX_PASSAGE_CHARS ? "..." : ""}\n`);
  }
  lines.push(`题目：${detail?.stem || ""}`);

  const answered = !!detail?.selected;
  if (ss) {
    const q = { options };
    // 展示用段号（契约里是 ≥1 整数）。脏数据给不出整数就不写段号，不要写成「第 null 段」。
    const paragraph = question?.paragraph ?? detail?.paragraph;
    lines.push(
      Number.isInteger(paragraph)
        ? `题型：选句题——要求在第 ${paragraph} 段的各句中挑出符合题干的那一句。`
        : "题型：选句题——要求在题干指定的那一段各句中挑出符合题干的那一句。"
    );
    const keys = sentenceOptionKeys(options);
    if (keys.length) {
      lines.push(
        `该段各句：\n${keys.map((k, i) => `  ${i + 1}. ${sentenceOptionText(q, k)}`).join("\n")}`
      );
    }
    lines.push(`学生选的句子：${answered ? sentenceOptionText(q, detail.selected) || detail.selected : "未作答"}`);
    lines.push(`正确句子：${sentenceOptionText(q, detail?.correct) || detail?.correct || ""}`);
    return lines.join("\n");
  }

  if (options) {
    lines.push(
      `选项：\n${Object.entries(options)
        .map(([k, v]) => `  ${k}. ${v}`)
        .join("\n")}`
    );
  }
  // 选项键单写模型对不上号（尤其命中缓存的老记录只存了键），键 + 原文一起给。
  const optText = (key) => {
    const v = key && options ? options[key] : "";
    return v ? `${key}. ${v}` : key || "";
  };
  lines.push(`学生选择：${answered ? optText(detail.selected) : "未作答"}`);
  lines.push(`正确答案：${optText(detail?.correct)}`);
  return lines.join("\n");
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
      const text = await callAIStream(SYSTEM, buildReadingExplainMessage(detail), AI_EXPLAIN_BUDGET.passage, {
        temperature: 0.3,
        // 边收边渲染:正文一出现就往面板里填,用户不必对着「分析中...」干等到底。
        onDelta: (partial) =>
          setAiExplains((prev) => ({ ...prev, [key]: { loading: true, text: partial, error: null } })),
      });
      saveToCache(detail, text);
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text, error: null } }));
    } catch (e) {
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text: null, error: mapAiHelperError(e) } }));
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
        data-testid="reading-ai-explain"
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
