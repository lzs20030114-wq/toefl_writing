import { quoteInTexts, locateSentence, plainText } from "./questionQa";

// 真题阅读选择题的「答案依据句」离线标注（scripts/qa/annotate-answer-evidence.mjs 产出
// data/realBank/reading/answer-evidence.json）。存句子原文而不是句号：原文分句规则以后变了，
// 运行时用 locateSentence 按原文重新对回当前句号；对不回的就不用。

export const ANSWER_EVIDENCE_VERSION = 1;

/** 与练习记录里 detail.qid 同口径：`${itemId}-q${题号}`。 */
export function evidenceKey(itemId, index) {
  return `${itemId}-q${index}`;
}

/**
 * 一票里的句号写法五花八门：["S7"]、"S7"、"[S7]"、"7"、"S7-S9"、"S7, S8"。统一成 ["S7", …]，范围展开（最多 6 句）。
 */
export function normalizeIds(ids) {
  const raw = Array.isArray(ids) ? ids : ids == null ? [] : [ids];
  const out = [];
  for (const x of raw) {
    const s = String(x).toUpperCase();
    for (const m of s.matchAll(/S?(\d+)(?:\s*[-–~至到]\s*S?(\d+))?/g)) {
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      if (b >= a && b - a < 6) for (let n = a; n <= b; n++) out.push(`S${n}`);
      else out.push(`S${a}`);
    }
  }
  return [...new Set(out)];
}

/** 解析标注脚本一票的输出：{ ids, quote, raw }；ids 为空 = 这票没给出可用句号（raw 留着排查）。 */
export function parseVote(text) {
  const raw = plainText(text);
  const m = raw.match(/\{[\s\S]*\}/);
  let v = null;
  try {
    v = m ? JSON.parse(m[0]) : null;
  } catch {}
  if (v && typeof v === "object") return { ids: normalizeIds(v.ids ?? v.id ?? v.sentences), quote: String(v.quote || ""), raw };
  // JSON 坏了（引文里有没转义的引号、被截断）：退回从字面上抠句号和引文。
  const idsPart = raw.match(/"ids?"\s*:\s*(\[[^\]]*\]|"[^"]*")/);
  const quotePart = raw.match(/"quote"\s*:\s*"([\s\S]*?)"\s*[,}]/);
  return { ids: normalizeIds(idsPart ? idsPart[1] : null), quote: quotePart ? quotePart[1] : "", raw };
}

/**
 * 引文核对：模型常把几句的片段用分号拼成一条，或一条引文跨了两句，整串去找就核不上。
 * 按分号、句末标点拆成片段，每段都得在所标句子里一字不差找到。
 */
export function quoteInSentences(quote, texts) {
  const parts = String(quote || "").split(/[;；]\s*|(?<=[.!?])\s+/).map((p) => p.trim().replace(/[.;；,]+$/, "")).filter(Boolean);
  return parts.length > 0 && parts.every((p) => quoteInTexts(p, texts));
}

/**
 * 合并几票标注。每票 { ids: ["S7"], quote }（或 null = 这票失败）。
 * 收的条件：至少两票有效（只跑一票时一票）、所有有效票的句号有交集、
 * 至少一票的引文能在交集句子里一字不差找到。返回 { status: "ok", ids, sentences, quote }
 * 或 { status: "disputed", reason }。
 */
export function verifyEvidence(votes, sentences) {
  const byId = new Map((sentences || []).map((s) => [s.id, s]));
  const valid = (votes || [])
    .filter(Boolean)
    .map((v) => ({ ids: normalizeIds(v.ids).filter((id) => byId.has(id)), quote: String(v.quote || "") }))
    .filter((v) => v.ids.length);
  const need = Math.min(2, (votes || []).length);
  if (valid.length < need) return { status: "disputed", reason: "有效票不足" };
  let common = valid[0].ids;
  for (const v of valid.slice(1)) common = common.filter((id) => v.ids.includes(id));
  if (!common.length) return { status: "disputed", reason: `两票句号无交集（${valid.map((v) => v.ids.join("+")).join(" / ")}）` };
  common.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const texts = common.map((id) => byId.get(id).text);
  const quote = valid.map((v) => v.quote).find((q) => q && quoteInSentences(q, texts));
  if (!quote) return { status: "disputed", reason: "引文在所标句子里找不到" };
  return { status: "ok", ids: common, sentences: texts, quote };
}

/**
 * 本题的依据句（当前句号）。data：answer-evidence.json 的内容；detail 需要 qid 与 stem。
 * 键或题干签名对不上（题库重建过、生成库的题）都返回 null。
 */
export function answerEvidenceFor(data, detail, sentences) {
  const e = data?.items?.[String(detail?.qid || "")];
  if (!e || e.status !== "ok") return vocabTargetEvidence(detail, sentences);
  if (e.stem !== String(detail?.stem || "").slice(0, 80)) return null;
  const ids = (e.sentences || []).map((t) => locateSentence(sentences, t)).filter(Boolean);
  return ids.length === (e.sentences || []).length ? { ids, sentences: e.sentences } : null;
}

/**
 * 词汇题（The word "X" in the passage is closest in meaning to）不靠标注也能定位：原文里整词出现 X 的那一句。
 * 只在恰好一句命中时用——同根词（fostered / fostering）不算，2026-10-13 评估里模型就把同根词那句当成了题目所在句。
 */
export function vocabTargetEvidence(detail, sentences) {
  const q = detail?.question || {};
  const type = q.question_type || q.type || "";
  const stem = String(detail?.stem || q.stem || "");
  if (type !== "vocabulary_in_context" && !/closest in meaning/i.test(stem)) return null;
  const m = stem.match(/["“]([^"”]{1,60})["”]/);
  if (!m) return null;
  const word = m[1].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^A-Za-z])${word}($|[^A-Za-z])`, "i");
  const hits = (sentences || []).filter((s) => re.test(s.text));
  return hits.length === 1 ? { ids: [hits[0].id], sentences: [hits[0].text] } : null;
}

let cache = null;
/** 浏览器里按需加载（单独打包，不进首屏）；失败返回 null，答疑照常能用，只是少一行依据句。 */
export function loadAnswerEvidence() {
  if (!cache) {
    cache = import("../../data/realBank/reading/answer-evidence.json")
      .then((m) => m.default || m)
      .catch(() => null);
  }
  return cache;
}
