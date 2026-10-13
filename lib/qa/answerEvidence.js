import { quoteInTexts, locateSentence } from "./questionQa";

// 真题阅读选择题的「答案依据句」离线标注（scripts/qa/annotate-answer-evidence.mjs 产出
// data/realBank/reading/answer-evidence.json）。存句子原文而不是句号：原文分句规则以后变了，
// 运行时用 locateSentence 按原文重新对回当前句号；对不回的就不用。

export const ANSWER_EVIDENCE_VERSION = 1;

/** 与练习记录里 detail.qid 同口径：`${itemId}-q${题号}`。 */
export function evidenceKey(itemId, index) {
  return `${itemId}-q${index}`;
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
    .map((v) => ({ ids: [...new Set((v.ids || []).map((x) => String(x).trim().toUpperCase().replace(/^(\d)/, "S$1")))].filter((id) => byId.has(id)), quote: String(v.quote || "") }))
    .filter((v) => v.ids.length);
  const need = Math.min(2, (votes || []).length);
  if (valid.length < need) return { status: "disputed", reason: "有效票不足" };
  let common = valid[0].ids;
  for (const v of valid.slice(1)) common = common.filter((id) => v.ids.includes(id));
  if (!common.length) return { status: "disputed", reason: `两票句号无交集（${valid.map((v) => v.ids.join("+")).join(" / ")}）` };
  common.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const texts = common.map((id) => byId.get(id).text);
  const quote = valid.map((v) => v.quote).find((q) => q && quoteInTexts(q, texts));
  if (!quote) return { status: "disputed", reason: "引文在所标句子里找不到" };
  return { status: "ok", ids: common, sentences: texts, quote };
}

/**
 * 本题的依据句（当前句号）。data：answer-evidence.json 的内容；detail 需要 qid 与 stem。
 * 键或题干签名对不上（题库重建过、生成库的题）都返回 null。
 */
export function answerEvidenceFor(data, detail, sentences) {
  const e = data?.items?.[String(detail?.qid || "")];
  if (!e || e.status !== "ok") return null;
  if (e.stem !== String(detail?.stem || "").slice(0, 80)) return null;
  const ids = (e.sentences || []).map((t) => locateSentence(sentences, t)).filter(Boolean);
  return ids.length === (e.sentences || []).length ? { ids, sentences: e.sentences } : null;
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
