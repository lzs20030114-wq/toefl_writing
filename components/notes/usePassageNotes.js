"use client";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { getSavedTier } from "../../lib/AuthContext";
import { callAI, mapAiHelperError, AI_HELPER_MAX_TOKENS } from "../../lib/ai/client";
import { lookupWord } from "../../lib/dict/lookup";
import { numberSentences, plainText } from "../../lib/qa/questionQa";
import { dailyCount, bumpDaily, releaseDaily, QA_DAILY_LIMIT } from "../../lib/qa/qaStore";
import { NOTE_SYSTEM, buildNoteMessage, dictTermOfQuote } from "../../lib/notes/noteQa";
import { NOTE_FORMATS, formatFor } from "../../lib/qa/answerFormats";
import { NOTE_MAX_TURNS, NOTE_MAX_QUESTION, NOTE_MAX_QUOTE, makeNote, placeNotes } from "../../lib/notes/passageNotes";
import { noteAccount, notesForPassage, saveNote, deleteNote, subscribeNotes, ensureNotesPulled } from "../../lib/notes/noteStore";

// 原文批注提问的状态层：某篇原文上的笔记（本地存档 + 云同步）、展开收起、提问。
// 额度和逐题追问共用（lib/qa/qaStore 的每日 30 轮）；每条笔记最多 NOTE_MAX_TURNS 轮。
// 新笔记先作为「草稿」显示（高亮 + 转圈），AI 答上来才落存档；失败的草稿留着可以重试或丢掉。

export function isProTier() {
  const tier = typeof window !== "undefined" ? getSavedTier() : null;
  return tier === "pro" || tier === "legacy";
}

export function usePassageNotes(passage, { source = "reading" } = {}) {
  const account = noteAccount();
  const text = String(passage || "");
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const [loadingId, setLoadingId] = useState(null);
  const [errors, setErrors] = useState({});
  const [daily, setDaily] = useState(() => dailyCount(account));
  const inflight = useRef(false);

  useEffect(() => {
    ensureNotesPulled(account);
    return subscribeNotes((acc) => {
      if (acc === account) setVersion((v) => v + 1);
    });
  }, [account]);

  // 换了文章：草稿、展开状态都清掉。
  useEffect(() => {
    setDraft(null);
    setOpen(new Set());
    setErrors({});
  }, [text]);

  const stored = useMemo(() => (text ? notesForPassage(text, account) : []), [text, account, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const sentences = useMemo(() => numberSentences(text), [text]);
  const placed = useMemo(() => placeNotes(text, draft ? [...stored, draft] : stored), [text, stored, draft]);

  const isOpen = useCallback((id) => open.has(id), [open]);
  const setOpenId = useCallback((id, value) => {
    setOpen((cur) => {
      const next = new Set(cur);
      if (value ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const toggle = useCallback((id) => setOpenId(id), [setOpenId]);

  const run = useCallback(async (note, question, { presetId = null, label = null } = {}) => {
    const q = String(question || "").trim().slice(0, NOTE_MAX_QUESTION);
    if (!q || inflight.current) return false;
    if ((note.turns || []).length >= NOTE_MAX_TURNS) return false;
    if (dailyCount(account) >= QA_DAILY_LIMIT) {
      setDaily(dailyCount(account));
      setErrors((e) => ({ ...e, [note.id]: `今天的追问额度（${QA_DAILY_LIMIT} 轮）用完了，明天再问。` }));
      return false;
    }
    setDaily(bumpDaily(account));
    let reserved = true;
    inflight.current = true;
    setLoadingId(note.id);
    setErrors((e) => ({ ...e, [note.id]: null }));
    try {
      let dict = null;
      const term = dictTermOfQuote(note.quote);
      if (term) {
        try {
          dict = await lookupWord(term);
        } catch {
          dict = null;
        }
      }
      const history = (note.turns || []).map((t) => ({ q: t.q, a: t.a }));
      const { message } = buildNoteMessage({ passage: text, quote: note.quote, history, question: q, dict, format: formatFor(NOTE_FORMATS, presetId) });
      const raw = await callAI(NOTE_SYSTEM, message, AI_HELPER_MAX_TOKENS * 2, 60000, 0.3);
      const a = plainText(raw);
      if (!a) throw new Error("Empty AI response");
      const turn = { q, label, a, presetId, dict: dict ? dict.word || term : null, at: new Date().toISOString() };
      saveNote({ ...note, turns: [...(note.turns || []), turn] }, account);
      setDraft((d) => (d && d.id === note.id ? null : d));
      reserved = false;
      return true;
    } catch (e) {
      setErrors((cur) => ({ ...cur, [note.id]: mapAiHelperError(e) }));
      return false;
    } finally {
      if (reserved) setDaily(releaseDaily(account));
      inflight.current = false;
      setLoadingId(null);
    }
  }, [account, text]);

  /** 选中原文后第一次提问：先出草稿（高亮 + 展开），答上来再存。 */
  const askNew = useCallback((sel, question, opts = {}) => {
    const quote = String(sel?.quote || "").trim();
    if (!quote || !text || inflight.current) return false;
    const note = makeNote({ passage: text, quote: quote.slice(0, NOTE_MAX_QUOTE), sentenceText: sel.sentenceText || "", start: sel.start ?? null, source });
    setDraft({ ...note, draft: true, pendingQuestion: { q: String(question || "").trim(), label: opts.label || null, presetId: opts.presetId || null } });
    setOpenId(note.id, true);
    return run(note, question, opts);
  }, [text, source, run, setOpenId]);

  const askFollow = useCallback((id, question, opts = {}) => {
    const note = stored.find((n) => n.id === id) || (draft && draft.id === id ? draft : null);
    if (!note) return false;
    const { draft: _d, pendingQuestion: _p, ...clean } = note;
    return run(clean, question, opts);
  }, [stored, draft, run]);

  /** 草稿失败后重试第一问。 */
  const retryDraft = useCallback(() => {
    if (!draft) return false;
    const { draft: _d, pendingQuestion, ...clean } = draft;
    // 重试也要带上 presetId，不然快捷问题的回答格式（lib/qa/answerFormats）会丢
    return run(clean, pendingQuestion?.q, { label: pendingQuestion?.label || null, presetId: pendingQuestion?.presetId || null });
  }, [draft, run]);

  const remove = useCallback((id) => {
    if (draft && draft.id === id) setDraft(null);
    else deleteNote(id, account);
    setOpenId(id, false);
    setErrors((e) => ({ ...e, [id]: null }));
  }, [draft, account, setOpenId]);

  return {
    placed,
    sentences,
    isOpen,
    toggle,
    setOpen: setOpenId,
    askNew,
    askFollow,
    retryDraft,
    remove,
    loadingId,
    errors,
    dailyLeft: Math.max(0, QA_DAILY_LIMIT - daily),
    isPro: isProTier(),
  };
}
