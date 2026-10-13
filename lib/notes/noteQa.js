// 原文批注提问的提示词与 message 拼装。和逐题追问（lib/qa/questionQa.js）共用编号原文与出处核对，
// 区别是：批注问的是「文章里的这一处」，不带题目、选项和答案。

import { numberSentences } from "../qa/questionQa";

export const NOTE_SYSTEM =
  "你是一位 TOEFL 阅读辅导老师。学生在复盘一篇文章时，选中了原文里的一处，就这一处向你提问。" +
  "只能依据下面给出的材料作答：原文（已按句编号 S1、S2…）、学生选中的原文、词典词条（如有）。" +
  "规则：" +
  "1）讲到原文时标出处：在句末写 [S编号]（例如 [S3]）；引用原文原话时用英文双引号括起来、紧跟着写出处，且必须与原文一字不差。依据词典词条写 [词典]。" +
  "2）对原文的语法、词汇、句意、句间关系、段落作用做分析，属于范围之内，直接讲。" +
  "3）词形变化、固定搭配、近义词这类通用语言知识可以讲，词典词条里有的优先照词条讲；词条里没有、靠你自己补充的那部分，开头写「（非本题材料）」。" +
  "4）原文里没有的事实信息（作者、出处、背景、文章之外的事）不要编：说「这篇材料里没有这个信息」。" +
  "5）拆句时：先给主干（主谓宾），再逐个说明从句、插入语、非谓语各修饰什么，最后给一句通顺的中文意思。" +
  "原文里的插入位置标记 [■1]、[A] 等照写，不用解释。" +
  "用中文回答，简洁具体，一般不超过 8 句。直接输出纯文本，不要使用 markdown 的 ** 加粗、# 标题或列表符号。";

/** 选中处落在哪几句（按编号）：选区和句子文字有重叠就算。 */
export function sentencesOfQuote(sentences, quote) {
  const q = String(quote || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!q) return [];
  const hits = (sentences || []).filter((s) => {
    const t = s.text.toLowerCase();
    return t.includes(q) || q.includes(t);
  });
  if (hits.length) return hits.map((s) => s.id);
  // 跨句选区：按句末标点切开，每一截各找它落在哪句。
  const pieces = q.split(/(?<=[.!?]["”’)]?)\s+/).map((x) => x.trim()).filter((x) => x.length >= 3);
  const ids = new Set();
  for (const piece of pieces) {
    for (const s of sentences || []) {
      const t = s.text.toLowerCase();
      if (t.includes(piece) || piece.includes(t)) ids.add(s.id);
    }
  }
  return (sentences || []).filter((s) => ids.has(s.id)).map((s) => s.id);
}

/**
 * 拼本轮 message。history: [{ q, a }]（不含本轮）。dict: ECDICT 词条 { word, p, t } 或 null。
 * 返回 { message, sentences }：sentences 留给前端核对出处。
 */
export function buildNoteMessage({ passage, quote, history = [], question, dict = null }) {
  const sentences = numberSentences(passage);
  const ids = sentencesOfQuote(sentences, quote);
  const parts = [];
  parts.push(`【原文】\n${sentences.map((s) => `[${s.id}] ${s.text}`).join("\n")}`);
  parts.push(`【学生选中的原文】"${String(quote || "").trim()}"${ids.length ? `（在 ${ids.join("、")}）` : ""}`);
  if (dict && dict.word && dict.t) {
    parts.push(`【词典】（ECDICT）${dict.word}${dict.p ? ` /${dict.p}/` : ""}：${String(dict.t).replace(/\n/g, "；")}`);
  }
  if (history.length) {
    parts.push(`【之前的问答】\n${history.map((h, i) => `学生${i + 1}：${h.q}\n老师${i + 1}：${h.a}`).join("\n")}`);
  }
  parts.push(`【学生现在的问题】${String(question || "").trim()}`);
  return { message: parts.join("\n\n"), sentences };
}

/** 选的是一个英文词（或词组的中心词）时拿去查词典；句子不查。 */
export function dictTermOfQuote(quote) {
  const words = String(quote || "").trim().match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  if (words.length === 1) return words[0].toLowerCase();
  return null;
}
