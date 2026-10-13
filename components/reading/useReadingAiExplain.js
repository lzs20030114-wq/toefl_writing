"use client";
import { useState, useCallback, useEffect } from "react";
import { getSavedTier } from "../../lib/AuthContext";
import { callAI, mapAiHelperError, AI_HELPER_MAX_TOKENS } from "../../lib/ai/client";
import { EXPLAIN_SYSTEM, EXPLAIN_SYSTEM_CORRECT, buildEvidence, parseTrap, plainText } from "../../lib/qa/questionQa";
import { saveTrap } from "../../lib/qa/trapStore";
import { loadAnswerEvidence, answerEvidenceFor } from "../../lib/qa/answerEvidence";
import { AiExplainView } from "../shared/AiExplainView";
import { QuestionQaPanel, CitedText } from "./QuestionQaPanel";

// 阅读选择题（RDL / AP，含真题选句题）的 AI 讲解。与 useCtwAiExplain / useBsAiExplain
// 同一骨架：Pro 门 + localStorage 缓存 + 点了才计费。差别只在 prompt——阅读考的是
// 「答案句在原文哪里」和「干扰项的陷阱类型」，不是填词的词形搭配。
//
// 三个入口共用这一份：阅读练习历史 RDLDetail（/progress/reading 与 /real-bank/progress
// 共用）、阅读模考详情 MockSessionDetail、以及 RDLTask 交卷后的逐题复盘。
// prompt 与追问共用一套（lib/qa/questionQa：EXPLAIN_SYSTEM / EXPLAIN_SYSTEM_CORRECT）：编号原文、
// 先引原话再标 [S编号]、不得改判；错题末尾一行「陷阱：X」写进陷阱表，给同类错题按陷阱检索。
// 缓存桶带版本号：prompt 换过两次（v1 把原文砍在 1200 字、没禁 markdown；v2 原文没编号、不标出处）。
// 旧缓存里的讲解没有 [S编号]，核对器无从核对，换桶比留着脏数据便宜。
const CACHE_KEY = "reading-ai-explain-cache-v3";
const MAX_CACHE = 200;

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
 * 组装喂给模型的 message：和追问同一份证据包（lib/qa/questionQa 的 buildEvidence）——
 * 原文按句编号、选句题的 S 键换成句子原文并对回原文句号、插入句位置标号、题库解析标「仅供参考」。
 */
export function buildReadingExplainMessage(detail, keyEvidence = null) {
  return buildEvidence(detail, null, keyEvidence).text;
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
      // 真题有离线标注的答案依据句就一并给（lib/qa/answerEvidence）；加载失败照常讲。
      // 预算 ×3（与追问同）：讲解要先引英文原话再标句号、末尾写陷阱行，v4-flash 的推理 token 又计入
      // max_tokens；2026-10-13 离线评估在 ×1 下空回复/截断 5.6%。只是上限，用不到不计费。
      const keyEvidence = answerEvidenceFor(await loadAnswerEvidence(), detail, buildEvidence(detail).sentences);
      const text = plainText(await callAI(detail.isCorrect ? EXPLAIN_SYSTEM_CORRECT : EXPLAIN_SYSTEM, buildReadingExplainMessage(detail, keyEvidence), AI_HELPER_MAX_TOKENS * 3, 60000, 0.3));
      if (!text) throw new Error("Empty AI response");
      saveToCache(detail, text);
      if (!detail.isCorrect) saveTrap(detail, parseTrap(text));
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text, error: null } }));
    } catch (e) {
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text: null, error: mapAiHelperError(e) } }));
    }
  }, []);

  return { aiExplains, isPro, handleAiExplain };
}

/** Inline UI: button + result. Pass a unique key, the detail, and the hook returns. */
export function ReadingAiExplainBlock({ explainKey, detail, aiExplains, isPro, handleAiExplain, includeCorrect = false, variant }) {
  const ex = aiExplains[explainKey];
  // 「问这道题」：不看讲解也能直接追问（打开就是展开的对话框，第一轮讲解为空）。
  const [askOpen, setAskOpen] = useState(false);

  // Auto-load from cache on mount (no API call — cache hit is free)
  useEffect(() => {
    if (!isPro || (detail.isCorrect && !includeCorrect)) return;
    if (ex) return;
    const cached = getFromCache(detail);
    if (cached) handleAiExplain(explainKey, detail);
  }, [ex, explainKey, detail, isPro, handleAiExplain, includeCorrect]);

  if (!isPro || (detail.isCorrect && !includeCorrect)) return null;

  // 真题练习记录页的逐题回顾用统一的「AI 讲解」外观（状态与计费仍在上面的 hook 里）。
  // 讲解出来之后，下面接「继续追问」（components/reading/QuestionQaPanel；没有原文的老记录它自己不渲染）。
  // key 带上 explainKey：交卷后复盘翻页时同一个位置换了题，面板状态（展开、选区、输入）要跟着重置。
  const qaPanel = ex?.text || askOpen
    ? <QuestionQaPanel key={explainKey} detail={detail} firstExplain={ex?.text || ""} variant={variant} defaultExpanded={askOpen} />
    : null;
  // 没有原文的老记录追问不了（面板自己也不渲染），不放按钮。
  const askBtn = !ex?.text && !askOpen && String(detail?.passage || "").trim()
    ? <AskQuestionButton review={variant === "review"} onClick={() => setAskOpen(true)} />
    : null;

  if (variant === "review") {
    return (
      <>
        <AiExplainView ex={ex} onRun={() => handleAiExplain(explainKey, detail)} testId="reading-ai-explain" extra={askBtn}
          body={ex?.text ? <CitedText text={ex.text} detail={detail} variant={variant} /> : null} />
        {qaPanel}
      </>
    );
  }

  if (ex?.text) {
    return (
      <>
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
        <CitedText text={ex.text} detail={detail} variant={variant} />
      </div>
      {qaPanel}
      </>
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
      {askBtn}
      {ex?.error && (
        <span style={{ fontSize: 12, color: "#E11D48", marginLeft: 8 }}>{ex.error}</span>
      )}
      {qaPanel}
    </div>
  );
}

function AskQuestionButton({ review, onClick }) {
  const style = review
    ? { padding: "5px 10px", borderRadius: 8, border: "1px solid #6366F1", background: "#fff", color: "#4338CA", fontSize: 12, fontWeight: 700, cursor: "pointer" }
    : { marginLeft: 8, fontSize: 12, fontWeight: 600, color: "#0284c7", background: "#fff", border: "1px solid #0284c7", borderRadius: 6, padding: "4px 12px", cursor: "pointer" };
  return <button type="button" data-testid="qa-ask" onClick={onClick} style={style}>问这道题</button>;
}
