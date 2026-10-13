"use client";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { getSavedCode } from "../../lib/AuthContext";
import { callAI, mapAiHelperError, AI_HELPER_MAX_TOKENS } from "../../lib/ai/client";
import { loadHist } from "../../lib/sessionStore";
import { loadPool, mergeEntries, activeCards } from "../../lib/mistakes/pool";
import { extractMistakeEntries } from "../../lib/mistakes/extract";
import { lookupWord } from "../../lib/dict/lookup";
import {
  QA_SYSTEM,
  QA_MAX_TURNS,
  buildEvidence,
  buildQaMessage,
  conversationKey,
  answerSignature,
  pickRelatedMistakes,
  wantsMistakeContext,
  wantsAnalogy,
  dictTermFor,
  plainText,
} from "../../lib/qa/questionQa";
import { trapOfBrief, trapOfDetail } from "../../lib/qa/trapStore";
import { loadAnswerEvidence, answerEvidenceFor } from "../../lib/qa/answerEvidence";
import { collectPastQuestions, pickAnalogies, analogyLines } from "../../lib/qa/pastQuestions";
import { loadConversation, saveConversation, dailyCount, bumpDaily, releaseDaily, QA_DAILY_LIMIT } from "../../lib/qa/qaStore";

// 练习记录逐题「继续追问」的状态层。第一轮仍是 useReadingAiExplain 的讲解（prompt 与缓存桶都不动），
// 这里只管之后的多轮：证据包 + 历史拼进同一条 message 走 /api/ai（接口不改）。
// 计划见 docs/rag-qa-implementation-plan.md §3。

function accountKey() {
  try {
    return String(getSavedCode() || "").trim().toUpperCase() || "guest";
  } catch {
    return "guest";
  }
}

/** 同类历史错题：只读错题池（不 savePool），并入从练习记录现算的部分，与错题本同口径。 */
function readRelatedMistakes(detail) {
  try {
    const sessions = loadHist()?.sessions || [];
    const { pool } = mergeEntries(loadPool(), extractMistakeEntries(sessions));
    const question = detail?.question || null;
    // 本题的陷阱来自第一轮讲解（lib/qa/trapStore）；没讲解过就退回按题型 + 时间。
    const ownTrap = trapOfDetail(detail);
    const related = pickRelatedMistakes(activeCards(pool), {
      questionType: question?.question_type || detail?.questionType || "",
      subtype: detail?.subtype || "",
      stem: detail?.stem || "",
      correctAnswer: answerSignature(detail),
      trap: ownTrap,
      trapOf: trapOfBrief,
    });
    return { ...related, ownTrap };
  } catch {
    return { total: 0, sameQuestionWrongCount: 0, items: [] };
  }
}

/** 本题同题型、以前做过的题（练习记录里现算，只读）。 */
function readPastQuestions(detail) {
  try {
    const question = detail?.question || null;
    return collectPastQuestions(loadHist()?.sessions || [], {
      questionType: question?.question_type || detail?.questionType || "",
      subtype: detail?.subtype || "",
      stem: detail?.stem || "",
      correctAnswer: answerSignature(detail),
    });
  } catch {
    return [];
  }
}

export function useQuestionQa(detail, firstExplain) {
  const account = accountKey();
  const key = useMemo(() => conversationKey(detail), [detail]);
  const evidence = useMemo(() => buildEvidence(detail), [detail]);
  const [conv, setConv] = useState(() => loadConversation(account, key) || { turns: [], related: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [daily, setDaily] = useState(() => dailyCount(account));
  const inflight = useRef(false);
  const convRef = useRef(conv);
  convRef.current = conv;

  // 同一个面板换了题（交卷后复盘翻页）→ 读回那道题的存档。
  useEffect(() => {
    setConv(loadConversation(account, key) || { turns: [], related: null });
    setError(null);
  }, [account, key]);

  // 「举一反三」按钮只在真有以前做过的同题型题时露出（不然点了也只能白花一轮额度）。
  const pastCount = useMemo(() => readPastQuestions(detail).length, [detail]);

  const turnsLeft = QA_MAX_TURNS - conv.turns.length;
  const dailyLeft = QA_DAILY_LIMIT - daily;
  const remaining = Math.max(0, Math.min(turnsLeft, dailyLeft));

  const ask = useCallback(async (question, { presetId = null, label = null, selection = null } = {}) => {
    const q = String(question || "").trim();
    if (!q || inflight.current) return false;
    const cur = convRef.current;
    if (cur.turns.length >= QA_MAX_TURNS) return false;
    if (dailyCount(account) >= QA_DAILY_LIMIT) {
      setDaily(dailyCount(account));
      return false;
    }
    // 先占名额再发请求（同步读写，同页多个面板同时问也越不过上限），失败再退回。
    setDaily(bumpDaily(account));
    let reserved = true;
    inflight.current = true;
    setLoading(true);
    setError(null);
    try {
      let related = cur.related;
      // 举一反三优先：对比题里已经含做错的题（同陷阱优先），就不再另附错题。
      const analogy = wantsAnalogy(q, presetId);
      const wantMistakes = !analogy && wantsMistakeContext(q, presetId);
      if (wantMistakes && !related) related = readRelatedMistakes(detail);
      const evidenceData = await loadAnswerEvidence();
      const keyEvidence = answerEvidenceFor(evidenceData, detail, evidence.sentences);
      const analogies = analogy
        ? pickAnalogies(readPastQuestions(detail), { trap: trapOfDetail(detail), trapOf: trapOfBrief, evidenceData })
        : null;
      const ev = wantMistakes || keyEvidence || analogies?.items.length
        ? buildEvidence(detail, wantMistakes ? related : null, keyEvidence, analogyLines(analogies))
        : evidence;

      // 选中了短语、或提问里点名了一个原文里的词，就查 ECDICT；整句选区不查。
      let dict = null;
      const term = dictTermFor(q, selection, ev.sentences);
      if (term) {
        try {
          dict = await lookupWord(term);
        } catch {
          dict = null;
        }
      }

      const history = cur.turns.map((t) => ({ q: t.selection?.text ? `（选中："${t.selection.text}"）${t.q}` : t.q, a: t.a }));
      const message = buildQaMessage({ evidence: ev.text, firstExplain: firstExplain || "", history, question: q, selection, dict });
      const raw = await callAI(QA_SYSTEM, message, AI_HELPER_MAX_TOKENS * 2, 60000, 0.3);
      const a = plainText(raw);
      if (!a) throw new Error("Empty AI response");
      const next = {
        turns: [...cur.turns, { q, label, a, presetId, selection: selection || null, dict: dict ? dict.word || true : null, mistakes: wantMistakes ? related?.items?.length || 0 : 0, past: analogies?.items?.length ? analogies.items : null, at: new Date().toISOString() }],
        related: related || cur.related || null,
      };
      saveConversation(account, key, next);
      setConv(next);
      reserved = false;
      return true;
    } catch (e) {
      setError(mapAiHelperError(e));
      return false;
    } finally {
      if (reserved) setDaily(releaseDaily(account));
      inflight.current = false;
      setLoading(false);
    }
  }, [account, key, detail, evidence, firstExplain]);

  return {
    turns: conv.turns,
    related: conv.related,
    sentences: evidence.sentences,
    pastCount,
    materials: evidence.materials,
    loading,
    error,
    remaining,
    turnsLeft,
    dailyLeft,
    ask,
  };
}
