"use client";
import { useState, useCallback, useEffect, useMemo } from "react";
import { getSavedTier } from "../../lib/AuthContext";
import { callAI, mapAiHelperError, AI_HELPER_MAX_TOKENS, AI_HELPER_TIMEOUT_MS } from "../../lib/ai/client";
import { AiExplainView } from "../shared/AiExplainView";
import { LISTENING_EXPLAIN_SYSTEM, LISTENING_EXPLAIN_SYSTEM_CORRECT, buildEvidence, plainText } from "../../lib/qa/questionQa";
import { listeningQaDetail } from "../../lib/qa/qaKinds";
import { QuestionQaPanel, CitedText, AskQuestionButton } from "../reading/QuestionQaPanel";

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

const SYSTEM_LCR_CORRECT =
  "你是一位 TOEFL 听力应答题辅导老师。学生选对了回应，请用中文简短讲解（3-5 句）：说明说话人的语用意图、正确回应为什么接得上，以及听到哪些线索可判断。不要虚构学生的错误，不要重复选项原文。直接输出纯文本，不要使用 markdown 的 ** 加粗、# 标题或列表符号。";

// 应答题的讲解没变，仍用 v1 桶；选择题 2026-10 改成和阅读一样按句编号、先引原话再标 [S编号]
//（lib/qa/questionQa LISTENING_EXPLAIN_SYSTEM），换 v2 桶——旧讲解没有出处，核对器无从核对。
const CACHE_KEY = "listening-ai-explain-cache-v1";
const MCQ_CACHE_KEY = "listening-ai-explain-cache-v2";
const MAX_CACHE = 200;


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

const bucketOf = (detail) => (isRespondKind(detail?.subtype) ? CACHE_KEY : MCQ_CACHE_KEY);

function loadCache(bucket) {
  try {
    return JSON.parse(localStorage.getItem(bucket) || "{}");
  } catch {
    return {};
  }
}

function saveToCache(detail, text) {
  try {
    const bucket = bucketOf(detail);
    const cache = loadCache(bucket);
    cache[cacheKey(detail)] = text;
    const keys = Object.keys(cache);
    if (keys.length > MAX_CACHE) {
      keys.slice(0, keys.length - MAX_CACHE).forEach((k) => delete cache[k]);
    }
    localStorage.setItem(bucket, JSON.stringify(cache));
  } catch {}
}

function getFromCache(detail) {
  try {
    return loadCache(bucketOf(detail))[cacheKey(detail)] || null;
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

  // 选择题（对话 / 通知 / 讲座）：和追问同一份证据包（lib/qa/questionQa buildEvidence），原文按句编号，
  // 对话题给了 conversation 就按轮编号并标说话人。原文全给（讲座的答案句经常在后半段），4000 字是防脏数据的兜底。
  return buildEvidence(listeningQaDetail(detail)).text;
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
      let text;
      if (isRespondKind(detail?.subtype)) {
        text = await callAI(detail.isCorrect ? SYSTEM_LCR_CORRECT : SYSTEM_LCR, buildListeningExplainMessage(detail), AI_HELPER_MAX_TOKENS, AI_HELPER_TIMEOUT_MS, 0.3);
      } else {
        // 选择题：和追问同一份证据包（原文按句编号，对话标说话人）。预算 ×3 同阅读讲解：先引原话再标句号，
        // v4-flash 的推理 token 又计入 max_tokens。只是上限，用不到不计费。
        const system = detail.isCorrect ? LISTENING_EXPLAIN_SYSTEM_CORRECT : LISTENING_EXPLAIN_SYSTEM;
        text = plainText(await callAI(system, buildListeningExplainMessage(detail), AI_HELPER_MAX_TOKENS * 3, AI_HELPER_TIMEOUT_MS, 0.3));
      }
      if (!text) throw new Error("Empty AI response");
      saveToCache(detail, text);
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text, error: null } }));
    } catch (e) {
      setAiExplains((prev) => ({ ...prev, [key]: { loading: false, text: null, error: mapAiHelperError(e) } }));
    }
  }, []);

  return { aiExplains, isPro, handleAiExplain };
}

/** Inline UI：按钮 + 结果。有缓存则自动回填（不发请求），否则等用户点（点了才计费）。
 *  讲解出来之后（或点了「问这道题」）下面接「继续追问」（components/reading/QuestionQaPanel，听力题型见 lib/qa/qaKinds）；
 *  选择题的讲解按出处核对显示，点「第 3 句」就播放并高亮那句。对话题在 detail 里带上 conversation 才能标说话人。 */
export function ListeningAiExplainBlock({ explainKey, detail, aiExplains, isPro, handleAiExplain, includeCorrect = false, variant }) {
  const ex = aiExplains[explainKey];
  const [askOpen, setAskOpen] = useState(false);
  const qaDetail = useMemo(() => listeningQaDetail(detail), [detail]);

  useEffect(() => {
    if (!isPro || (detail?.isCorrect && !includeCorrect)) return;
    if (ex) return;
    const cached = getFromCache(detail);
    if (cached) handleAiExplain(explainKey, detail);
  }, [ex, explainKey, detail, isPro, handleAiExplain, includeCorrect]);

  if (!isPro || (detail?.isCorrect && !includeCorrect)) return null;

  const cited = !isRespondKind(detail?.subtype);
  const body = ex?.text ? (cited ? <CitedText text={ex.text} detail={qaDetail} variant={variant} /> : ex.text) : null;
  // key 带上 explainKey：同一位置换了题时面板状态跟着重置。没有原文的老记录追问不了（面板自己不渲染），不放按钮。
  const qaPanel = ex?.text || askOpen
    ? <QuestionQaPanel key={explainKey} detail={qaDetail} firstExplain={ex?.text || ""} variant={variant} defaultExpanded={askOpen} />
    : null;
  const askBtn = !ex?.text && !askOpen && String(qaDetail.passage || "").trim()
    ? <AskQuestionButton review={variant === "review"} onClick={() => setAskOpen(true)} />
    : null;

  // 真题练习记录页的逐题回顾用统一的「AI 讲解」外观（状态与计费仍在上面的 hook 里）。
  if (variant === "review") {
    return (
      <>
        <AiExplainView ex={ex} onRun={() => handleAiExplain(explainKey, detail)} testId="listening-ai-explain" extra={askBtn} body={body} />
        {qaPanel}
      </>
    );
  }

  if (ex?.text) {
    return (
      <>
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
        {body}
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
