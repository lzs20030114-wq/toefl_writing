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
  askedEnglishTerm,
  plainText,
} from "../../lib/qa/questionQa";
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
    return pickRelatedMistakes(activeCards(pool), {
      questionType: question?.question_type || detail?.questionType || "",
      subtype: detail?.subtype || "",
      stem: detail?.stem || "",
      correctAnswer: answerSignature(detail),
    });
  } catch {
    return { total: 0, sameQuestionWrongCount: 0, items: [] };
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
      const wantMistakes = wantsMistakeContext(q, presetId);
      if (wantMistakes && !related) related = readRelatedMistakes(detail);
      const ev = wantMistakes ? buildEvidence(detail, related) : evidence;

      let dict = null;
      if (!selection) {
        const term = askedEnglishTerm(q, ev.sentences);
        if (term) {
          try {
            dict = await lookupWord(term);
          } catch {
            dict = null;
          }
        }
      }

      const history = cur.turns.map((t) => ({ q: t.selection?.text ? `（选中："${t.selection.text}"）${t.q}` : t.q, a: t.a }));
      const message = buildQaMessage({ evidence: ev.text, firstExplain: firstExplain || "", history, question: q, selection, dict });
      const raw = await callAI(QA_SYSTEM, message, AI_HELPER_MAX_TOKENS * 2, 60000, 0.3);
      const a = plainText(raw);
      if (!a) throw new Error("Empty AI response");
      const next = {
        turns: [...cur.turns, { q, label, a, presetId, selection: selection || null, dict: dict ? dict.word || true : null, at: new Date().toISOString() }],
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
    materials: evidence.materials,
    loading,
    error,
    remaining,
    turnsLeft,
    dailyLeft,
    ask,
  };
}
