import { answerSignature, selectedSignature, numberSentences } from "./questionQa";
import { answerEvidenceFor } from "./answerEvidence";

// 「举一反三」：从用户自己的阅读练习记录里挑同题型的题（做对、做错的都要），给追问做对比。
// 2026-10-13 用户拍板：最多 4 道，对错各 2 道；点「举一反三」或追问里提出类似需求时才检索。
// 只读本地练习记录（loadHist().sessions），不碰题库；每道题只带题干、选项、作答、
// 离线标注的答案依据句（真题）或题库解析（生成库），不带整篇原文，免得把上下文撑爆。

export const ANALOGY_MAX_WRONG = 2;
export const ANALOGY_MAX_RIGHT = 2;
const EXPLANATION_CHARS = 240;

/**
 * 练习记录里所有同题型的阅读选择题（不含本题），同一道题做过多次只留最近一次。
 * 只看普通练习的 RDL / AP 记录（type === "reading"，题目存在 details.questions 里）；
 * 模考记录的结构不同，第一版不收。
 */
export function collectPastQuestions(sessions, { questionType, subtype = "", stem = "", correctAnswer = "" } = {}) {
  if (!questionType) return [];
  const ownStem = String(stem || "").trim();
  const ownAnswer = String(correctAnswer || "").trim();
  const byKey = new Map();
  for (const s of sessions || []) {
    if (!s || s.type !== "reading") continue;
    const d = s.details || {};
    const st = d.subtype || "rdl";
    if (st !== "rdl" && st !== "ap") continue;
    if (subtype && st !== subtype) continue;
    const questions = Array.isArray(d.questions) ? d.questions : [];
    const results = Array.isArray(d.results) ? d.results : [];
    results.forEach((r, i) => {
      const q = questions[r?.qIndex ?? i];
      if (!q || (q.question_type || q.type) !== questionType) return;
      const detail = {
        qid: q.qid || `${d.itemId || ""}-q${r?.qIndex ?? i}`,
        stem: String(q.stem || "").trim(),
        question: q,
        options: q.options || null,
        selected: r?.selected || null,
        correct: r?.correct || q.correct_answer || q.answer || null,
        passage: d.passage || "",
        paragraphs: d.paragraphs,
        isCorrect: !!r?.isCorrect,
        date: String(s.date || "").slice(0, 10),
      };
      const sig = answerSignature(detail);
      if (detail.stem === ownStem && (!ownAnswer || sig === ownAnswer)) return; // 本题
      const key = `${detail.stem}|||${sig}`;
      const prev = byKey.get(key);
      if (!prev || String(detail.date) >= String(prev.date)) byKey.set(key, detail);
    });
  }
  return [...byKey.values()];
}

/**
 * 挑对比题：做错的至多 2 道（和本题陷阱相同的优先，再按时间），做对的至多 2 道（按时间）。
 * trap：本题的陷阱类型；trapOf(brief)：查以前那道题讲解归纳的陷阱（lib/qa/trapStore）。
 * evidenceData：answer-evidence.json 的内容，真题带上依据句原文。
 * 返回 { total, wrongTotal, rightTotal, items: [{ n, date, isCorrect, stem, options, userAnswer, correctAnswer, trap, evidence, explanation }] }。
 */
export function pickAnalogies(past, { trap = null, trapOf = null, evidenceData = null } = {}) {
  const list = past || [];
  const trapFor = (d) => (trapOf ? trapOf({ stem: d.stem, correctAnswer: answerSignature(d), userAnswer: selectedSignature(d) }) : null);
  const byDate = (a, b) => String(b.date).localeCompare(String(a.date));
  const wrong = list.filter((d) => !d.isCorrect).map((d) => ({ d, trap: trapFor(d) }));
  const sameTrap = (x) => (trap && trap !== "未作答" && x.trap === trap ? 1 : 0);
  wrong.sort((a, b) => sameTrap(b) - sameTrap(a) || byDate(a.d, b.d));
  const right = list.filter((d) => d.isCorrect).sort(byDate).map((d) => ({ d, trap: null }));
  const chosen = [...wrong.slice(0, ANALOGY_MAX_WRONG), ...right.slice(0, ANALOGY_MAX_RIGHT)];
  return {
    total: list.length,
    wrongTotal: wrong.length,
    rightTotal: right.length,
    items: chosen.map(({ d, trap: t }, i) => {
      const key = d.passage ? answerEvidenceFor(evidenceData, d, numberSentences(d.passage)) : null;
      return {
        n: i + 1,
        date: d.date,
        isCorrect: d.isCorrect,
        stem: d.stem.slice(0, 240),
        options: d.options ? Object.entries(d.options).map(([k, v]) => `${k}. ${String(v).slice(0, 160)}`) : [],
        userAnswer: selectedSignature(d).slice(0, 240),
        correctAnswer: answerSignature(d).slice(0, 240),
        trap: t,
        evidence: key ? key.sentences : [],
        explanation: key ? "" : String(d.question?.explanation || "").trim().slice(0, EXPLANATION_CHARS),
      };
    }),
  };
}

/** 对比题在证据包里的写法；[题N] 与 parseAnswer 的出处标签同名。 */
export function analogyLines(analogies) {
  if (!analogies?.items?.length) return [];
  const rows = analogies.items.map((m) => {
    const parts = [
      `  [题${m.n}] ${m.date} ${m.isCorrect ? "做对" : "做错"}｜题目：${m.stem}`,
      m.options.length ? `选项：${m.options.join("；")}` : "",
      `学生选：${m.userAnswer || "未作答"}`,
      `正确：${m.correctAnswer}`,
      m.trap ? `当时讲解归纳的陷阱：${m.trap}` : "",
      m.evidence.length ? `答案依据句（离线标注）："${m.evidence.join(" ")}"` : "",
      m.explanation ? `题库解析（AI 生成，仅供参考）：${m.explanation}` : "",
    ].filter(Boolean);
    return parts.join("｜");
  });
  return [`学生以前做过的同题型题（共 ${analogies.total} 道：做错 ${analogies.wrongTotal}、做对 ${analogies.rightTotal}；挑了下面 ${analogies.items.length} 道，看不到那几篇的原文）：\n${rows.join("\n")}`];
}

/** 校验引文时额外认的字符串：对比题的题干、选项、依据句。 */
export function analogyMaterials(analogies) {
  return (analogies?.items || []).flatMap((m) => [m.stem, ...m.options, ...m.evidence]);
}
