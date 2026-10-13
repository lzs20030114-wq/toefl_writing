// 原文批注提问的提示词与 message 拼装。和逐题追问（lib/qa/questionQa.js）共用编号原文与出处核对，
// 区别是：批注问的是「文章里的这一处」，不带题目、选项和答案。

import { numberSentences } from "../qa/questionQa";

export const NOTE_SYSTEM =
  "你是一位 TOEFL 阅读辅导老师。学生在复盘一篇文章时，选中了原文里的一处，就这一处向你提问。" +
  "只能依据下面给出的材料作答：原文（已按句编号 S1、S2…）、学生选中的原文、词典词条（如有）。" +
  "规则：" +
  "1）出处少而准：只在用到原文某句来支撑判断时标一次，写在那一点的末尾，格式 [S3]；同一句在回答里只标一次，不要每个分句都标。" +
  "引用原文原话时用英文双引号括起来，与原文一字不差。依据词典词条时标 [词典]。" +
  "2）正文里不要写 S2、S3 这种编号，指句子时说「这句」「前一句」「后一句」，或者直接引原话。" +
  "3）对原文的语法、词汇、句意、句间关系、段落作用做分析，属于范围之内，直接讲。" +
  "4）词形变化、固定搭配、近义词这类通用语言知识可以讲，词典词条里有的优先照词条讲；词条里没有、靠你自己补充的，单独起一行，以「补充：」开头。" +
  "5）原文里没有的事实信息（作者、出处、背景、文章之外的事）不要编：说「这篇材料里没有这个信息」。" +
  "6）拆句时：先给主干（主谓宾），再逐个说明从句、插入语、非谓语各修饰什么，最后给一句通顺的中文意思。" +
  "原文里的插入位置标记 [■1]、[A] 等照写，不用解释。" +
  "7）只答学生问到的：只问意思，就讲清意思（必要时补一句词形或搭配），不要另写「为什么」这样理解、不要写「注意：」这类没问到的提醒；" +
  "学生明确问「为什么」「怎么看出来」「依据是什么」时，才写依据和推理。" +
  "8）排版：分成 1 到 3 个短段，每段讲一件事，段与段之间换行；每段开头可以用一个四字以内的小标题加冒号（如「意思：」「语法：」「为什么：」，「为什么：」只在被问到时用）。" +
  "用中文回答，简洁具体，全篇一般不超过 8 句。直接输出纯文本，不要使用 markdown 的 ** 加粗、# 标题或列表符号。";

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

const BARE_ID_RE = /(?<![[A-Za-z0-9])S(\d{1,3})(?![\]A-Za-z0-9])/g;
const OFF_MATERIAL_RE = /[（(]\s*非本题材料\s*[)）]\s*/g;

/**
 * 笔记回答的显示整理（parseAnswer 之后）：
 * - 同一句的出处只留第一次（模型常把同一句在每个分句后都标一遍，读起来很碎）；核不上的出处照留，那是提醒。
 * - 正文里漏出来的 S2、S3 换成「第 1 段第 2 句」这种读者看得懂的写法。
 * - 旧提示词留下的「（非本题材料）」换成「补充：」。
 * - 换行拆成段落（{ type: "break" }），行首四字以内的小标题加冒号拆成 { type: "heading" }。
 * label(sentence) 由调用方给（界面用 sentenceLabel）。
 */
export function tidyNoteSegments(segments, sentences, label) {
  const byId = new Map((sentences || []).map((s) => [s.id, s]));
  const seen = new Set();
  const out = [];
  const pushText = (text) => {
    let t = text.replace(OFF_MATERIAL_RE, "补充：").replace(BARE_ID_RE, (m, n) => {
      const s = byId.get(`S${n}`);
      return s ? label(s) : m;
    });
    const parts = t.split(/\n+/);
    parts.forEach((part, i) => {
      if (i > 0) out.push({ type: "break" });
      if (!part) return;
      const m = part.match(/^\s*([一-龥]{1,4})[：:]\s*/);
      if (m && (i > 0 || out.length === 0 || out[out.length - 1].type === "break")) {
        out.push({ type: "heading", text: m[1] });
        part = part.slice(m[0].length);
        if (!part) return;
      }
      out.push({ type: "text", text: part });
    });
  };
  for (const seg of segments || []) {
    if (seg.type === "text") pushText(seg.text);
    else if (seg.type === "cite" && seg.kind === "sentence" && seg.valid) {
      if (seen.has(seg.id)) continue;
      seen.add(seg.id);
      out.push(seg);
    } else out.push(seg);
  }
  // 开头、结尾的空段不要
  while (out.length && out[0].type === "break") out.shift();
  while (out.length && out[out.length - 1].type === "break") out.pop();
  return out;
}
