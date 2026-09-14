"use client";
import { useState, useCallback, useEffect } from "react";
import { getSavedTier } from "../../lib/AuthContext";
import { callAI, mapAiHelperError, AI_HELPER_MAX_TOKENS } from "../../lib/ai/client";

// 听力题的 AI 讲解。与 useReadingAiExplain / useCtwAiExplain / useBsAiExplain 同一骨架：
// Pro 门 + localStorage 缓存 + 点了才计费。差别只在 prompt——而听力内部还要再分两支：
//
//   · lcr（应答题）：整道题只有说话人一句话（题库实测 28–98 字符），没有「原文定位」
//     可讲，考的是这句话的语用功能与该怎么回应；干扰项的坑是原词复现、答非所问、
//     人称时态错位。用阅读那套「答案句在第几段」的话术讲它只会讲空。
//   · la / lat / lc（通知 / 讲座 / 对话的选择题）：有原文可定位，但陷阱是听力特有的
//     （原词复现、同音近音、否定、时序颠倒、张冠李戴），不是阅读的偷换概念。
//
// 四个入口共用这一份：听力练习历史 LCRDetail / LADetail / LCDetail
//（/listening/progress 与 /real-bank/progress 共用，听力模考详情也走同一组 Detail）、
// 以及 ListeningMCQTask 与 LCRTask 交卷后的结果页。
const SYSTEM_LCR =
  "你是一位 TOEFL 听力应答题（Listen and Respond）辅导老师。学生选错了回应，请用中文简短讲解（3-5 句）：" +
  "1）说话人这句话在做什么——是请求、抱怨、征求意见、婉拒还是提醒，据此说明正确回应为什么接得上；" +
  "2）学生选的那句错在哪——指出具体陷阱（原词复现但答非所问、答非所答、人称或时态错位、" +
  "回应了没被问到的事、语气不得体等）。" +
  "如果学生未作答，就只讲第 1 点，并说明听到这种话该顺着哪个方向找回应（同样 3-5 句，不要只写一句）。" +
  "不要重复选项原文，不要空话。" +
  // 面板是 whiteSpace: pre-wrap 的纯文本渲染，markdown 星号会原样显示成 **word**。
  "直接输出纯文本，不要使用 markdown 的 ** 加粗、# 标题或列表符号。";

const SYSTEM_MCQ =
  "你是一位 TOEFL 听力辅导老师。学生做错了一道听力选择题，请用中文简短讲解（3-5 句）：" +
  "1）定位——原文哪一句给出了正确答案，把那句话的意思说清楚；" +
  "2）学生选的选项错在哪——指出听力特有的陷阱类型（原词复现但意思相反、同音近音词混淆、" +
  "漏听否定、把时间或步骤的先后顺序颠倒、张冠李戴说错人、过度推断等），并说明原文其实怎么说。" +
  "如果学生未作答，就只讲第 1 点，并说明该听哪个信号词定位到答案句（同样 3-5 句，不要只写一句）。" +
  "不要重复题干和选项原文，不要空话。" +
  "直接输出纯文本，不要使用 markdown 的 ** 加粗、# 标题或列表符号。";

const CACHE_KEY = "listening-ai-explain-cache-v1";
const MAX_CACHE = 200;

// 原文全给。LAT 讲座原文 1080–1893 字符（生成库 91/149、真题 42/74 超过 1500），
// 错题本那侧 1500 的上限会砍掉大半讲座的后半段，而答案句经常就在后半段——
// 模型看不到答案句时讲解必然是编的。4000 是防脏数据的兜底，不是正常路径会碰到的线。
const MAX_CONTEXT_CHARS = 4000;

/** 应答题（lcr）走语用那支，其余选择题走定位那支。 */
export function isRespondKind(subtype) {
  return String(subtype || "").toLowerCase() === "lcr";
}

function cacheKey(detail) {
  // 同一题 + 同样的错答 → 共享同一份解析（跨练习、跨入口复用，不重复计费）。
  //
  // 题干签名一律参与 key，不只在没有 qid 时兜底：听力题库的 question 没有 qid 字段，
  // 调用方只能自己拼合成 id，而模考详情的 adapter 拼出来的 session 既没有 id 也没有
  // itemIds —— 合成 id 会一起退化成 "undefined-q0"。只靠它做 key，同一场模考里
  // 两道「答案组合相同」的不同题就会撞进同一条缓存，第二题显示第一题的解析。
  const qid = detail?.qid || "";
  const stemSig = String(detail?.stem || detail?.speaker || "").slice(0, 80);
  return `${qid}|${stemSig}|||${detail?.selected || ""}|||${detail?.correct || ""}`;
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

/** 对话 turns（LC）拼成「说话人：内容」的逐行文字；已经是字符串就原样返回。 */
export function conversationText(conversation) {
  if (typeof conversation === "string") return conversation;
  if (!Array.isArray(conversation)) return "";
  return conversation
    .map((t, i) => {
      const who = t?.speaker || t?.name || (i % 2 === 0 ? "Speaker A" : "Speaker B");
      const text = t?.text || t?.content || "";
      return text ? `${who}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * 组装喂给模型的 message。
 *
 * 两支的字段不同：应答题给「说话人原话 + 各回应选项」，没有题干；
 * 选择题给「原文（讲座 transcript / 通知 / 对话逐行）+ 题干 + 选项」。
 * 选项键单写模型对不上号，键 + 原文一起给。
 */
export function buildListeningExplainMessage(detail) {
  const options = detail?.options || null;
  const answered = !!detail?.selected;
  const lines = [];

  const optText = (key) => {
    const v = key && options ? options[key] : "";
    return v ? `${key}. ${v}` : key || "";
  };
  const optionsBlock = () => {
    if (!options) return;
    lines.push(
      `选项：\n${Object.entries(options)
        .map(([k, v]) => `  ${k}. ${v}`)
        .join("\n")}`
    );
  };

  if (isRespondKind(detail?.subtype)) {
    if (detail?.situation) lines.push(`场景：${detail.situation}`);
    lines.push(`说话人说：${detail?.speaker || ""}`);
    // 题库给了语用功能就带上（应答题的考点本身）；没有就不写，不让模型去猜字段。
    if (detail?.pragmaticFunction) lines.push(`该句的语用功能：${detail.pragmaticFunction}`);
    if (options) {
      lines.push(
        `可选回应：\n${Object.entries(options)
          .map(([k, v]) => `  ${k}. ${v}`)
          .join("\n")}`
      );
    }
    lines.push(`学生选的回应：${answered ? optText(detail.selected) : "未作答"}`);
    lines.push(`正确回应：${optText(detail?.correct)}`);
    return lines.join("\n");
  }

  const context = String(detail?.contextText || "");
  if (context) {
    lines.push(
      `听力原文：\n${context.slice(0, MAX_CONTEXT_CHARS)}${context.length > MAX_CONTEXT_CHARS ? "..." : ""}\n`
    );
  }
  lines.push(`题目：${detail?.stem || ""}`);
  optionsBlock();
  lines.push(`学生选择：${answered ? optText(detail.selected) : "未作答"}`);
  lines.push(`正确答案：${optText(detail?.correct)}`);
  return lines.join("\n");
}

export function useListeningAiExplain() {
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
      const system = isRespondKind(detail?.subtype) ? SYSTEM_LCR : SYSTEM_MCQ;
      const text = await callAI(system, buildListeningExplainMessage(detail), AI_HELPER_MAX_TOKENS, 60000, 0.3);
      saveToCache(detail, text);
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text, error: null } }));
    } catch (e) {
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text: null, error: mapAiHelperError(e) } }));
    }
  }, []);

  return { aiExplains, isPro, handleAiExplain };
}

/** Inline UI：按钮 + 结果。有缓存则自动回填（不发请求），否则等用户点（点了才计费）。 */
export function ListeningAiExplainBlock({ explainKey, detail, aiExplains, isPro, handleAiExplain }) {
  const ex = aiExplains[explainKey];

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
        data-testid="listening-ai-explain"
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
