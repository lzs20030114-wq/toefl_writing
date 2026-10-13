// 阅读错题的陷阱类型表：第一轮「AI 讲解」末尾的「陷阱：X」存在这里，追问时按陷阱类型挑同类错题
// （lib/qa/questionQa 的 pickRelatedMistakes）。键用题干 + 正确答案原文 + 学生所选原文，
// 与错题卡 brief（lib/readingMistakes）同口径，错题池里的卡片不用回查题库就能对上。
// 和讲解缓存一样不分账号：存的只是题目和陷阱名，没有用户自己打的字。
import { answerSignature, selectedSignature } from "./questionQa";

export const TRAP_STORE_KEY = "reading-trap-v1";
export const TRAP_STORE_MAX = 500;

export function trapKey({ stem, correctAnswer, userAnswer }) {
  return `${String(stem || "").trim().slice(0, 80)}|||${String(correctAnswer || "").trim()}|||${String(userAnswer || "").trim()}`;
}

/** 本题（讲解用的 detail）对应的键。 */
export function detailTrapKey(detail) {
  return trapKey({ stem: detail?.stem, correctAnswer: answerSignature(detail), userAnswer: selectedSignature(detail) });
}

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(TRAP_STORE_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function saveTrap(detail, trap) {
  if (!trap || !detail?.selected) return;
  try {
    const store = load();
    const key = detailTrapKey(detail);
    delete store[key]; // 重新插到末尾：淘汰按插入顺序从最旧的开始
    store[key] = trap;
    const keys = Object.keys(store);
    if (keys.length > TRAP_STORE_MAX) keys.slice(0, keys.length - TRAP_STORE_MAX).forEach((k) => delete store[k]);
    localStorage.setItem(TRAP_STORE_KEY, JSON.stringify(store));
  } catch {}
}

/** 错题卡（brief）或本题 detail 的陷阱类型；没讲解过返回 null。 */
export function trapOfBrief(brief) {
  return load()[trapKey(brief || {})] || null;
}

export function trapOfDetail(detail) {
  return load()[detailTrapKey(detail)] || null;
}
