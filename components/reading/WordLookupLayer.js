"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { lookupWord, normalizeWord, prefetchShards } from "../../lib/dict/lookup";
import { sentenceAtOffsets, splitSenses } from "../../lib/dict/core";
import { CONTEXT_SENSE_SYSTEM, contextSenseMessage, parseContextSense, usableContextSense } from "../../lib/dict/aiSense";
import { getSavedTier, AUTH_CHANGED_EVENT } from "../../lib/AuthContext";
import { callAI, mapAiHelperError, AI_HELPER_MAX_TOKENS } from "../../lib/ai/client";
import { getCard, saveWord, removeWord, addSentence, chooseSense, adoptContextSense, getVocabAccountKey } from "../../lib/vocab/vocabStore";
import { MAX_CONTEXTS, definitionForContext } from "../../lib/vocab/book";
import { SpeakButton } from "../shared/SpeakButton";
import { DefLine } from "../shared/DictSenses";

// 复盘时的划词小词典：把原文容器包一层，点词或划词就在词边上弹出释义。
//
// 之所以做成「包一层」而不是把每个词渲染成可点的 span：复盘页的原文有两种形态
// （CTW 是 passage.split(/\s+/) 后的 span 序列，RDL/模考是一整个文本节点），
// 用 Range 取词对两种形态都成立，也就不用动任何现有渲染代码。

const POP_W = 300;
const AI_CACHE_KEY = "dict-ai-explain-cache";
const MAX_AI_CACHE = 120;


const WORD_CHAR = /[A-Za-z0-9'’‐-]/;

function isWordChar(ch) {
  return WORD_CHAR.test(ch);
}

/** 点击位置 → 该处整个单词的 Range（点在空白或标点上则返回 null）。 */
function wordRangeFromPoint(x, y) {
  let range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }
  if (!range) return null;
  const node = range.startContainer;
  if (!node || node.nodeType !== 3) return null;

  const text = node.textContent || "";
  let i = range.startOffset;
  // 光标常落在词尾右侧（"cell|. "），往左退一格再判。
  if (i >= text.length || !isWordChar(text[i])) {
    if (i > 0 && isWordChar(text[i - 1])) i -= 1;
    else return null;
  }
  let s = i;
  let e = i;
  while (s > 0 && isWordChar(text[s - 1])) s -= 1;
  while (e < text.length && isWordChar(text[e])) e += 1;
  if (e <= s) return null;

  const r = document.createRange();
  r.setStart(node, s);
  r.setEnd(node, e);
  return r;
}

/**
 * 被查的词落在听力原文的哪一句里（SentenceTranscript 渲染的 data-sentence-index）。
 * 只认可定位的句子（playable="1"）；不在句子里、或调用方根本没渲染句子时返回 -1。
 */
function sentenceIndexOf(range) {
  const el = sentenceElementOf(range);
  if (el?.getAttribute("data-sentence-playable") !== "1") return -1;
  const i = Number(el.getAttribute("data-sentence-index"));
  return Number.isInteger(i) && i >= 0 ? i : -1;
}

function sentenceElementOf(range) {
  if (!range) return null;
  const startNode = range.startContainer?.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
  const endNode = range.endContainer?.nodeType === 3 ? range.endContainer.parentElement : range.endContainer;
  const start = startNode?.closest?.("[data-sentence-index]") || null;
  const end = endNode?.closest?.("[data-sentence-index]") || null;
  return start && start === end ? start : null;
}

function sentenceFromRange(root, range) {
  if (!root || !range || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return "";
  try {
    const full = document.createRange();
    full.selectNodeContents(root);
    const text = full.toString();
    const before = full.cloneRange();
    before.setEnd(range.startContainer, range.startOffset);
    const through = full.cloneRange();
    through.setEnd(range.endContainer, range.endOffset);
    return sentenceAtOffsets(text, before.toString().length, through.toString().length);
  } catch { return ""; }
}

function loadAiCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(AI_CACHE_KEY) || "{}");
    return cache && typeof cache === "object" && !Array.isArray(cache) ? cache : {};
  } catch {
    return {};
  }
}

function saveAiCache(key, value) {
  try {
    const cache = loadAiCache();
    cache[key] = value;
    const keys = Object.keys(cache);
    if (keys.length > MAX_AI_CACHE) {
      keys.slice(0, keys.length - MAX_AI_CACHE).forEach((k) => delete cache[k]);
    }
    localStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

/**
 * 用法：<WordLookupLayer passage={passage}>…原文…</WordLookupLayer>
 * 带 data-no-dict 属性的子节点（例如 CTW 里点开解析的填空 chip）不触发查词。
 * 带 data-dict-word="词" 的子节点整块算一个词：点它里面任何位置都查这个词——
 * 给拆成几段上色的词用（真题记录的填词空：已给片段 + 补全部分是两个节点）。
 * source 会记进单词本，用来在 /vocab-notebook 里显示这个词是从哪儿收藏的。
 * onPlaySentence(index) 可选：听力复盘传进来后，词落在某一句里时弹窗多一颗「听这一句」
 * （index 是 SentenceTranscript 渲染的那份句子列表的下标）；不传就当没有这个功能。
 */
export function WordLookupLayer({ passage, children, style, source = "reading", onPlaySentence, listeningAudio }) {
  const rootRef = useRef(null);
  const popRef = useRef(null);
  const rangeRef = useRef(null); // 被查那个词的 Range，滚动时用它重算位置
  const identityRef = useRef(null); // 原句、账户与每次打开共同限定异步响应。
  const openSequence = useRef(0);
  const aiSequence = useRef(0);
  const [pop, setPop] = useState(null); // { word, rect, entry, loading, notFound }
  const [ai, setAi] = useState(null); // { loading, text, sense, error }
  const [senseEdit, setSenseEdit] = useState(null);
  const [senseFeedback, setSenseFeedback] = useState(null);
  // 当前这个词在单词本里的那张卡（没收藏就是 null）。存整张卡而不是一个布尔，
  // 是因为义项选中态、「这句在不在卡上」都要读卡上的字段。
  const [card, setCard] = useState(null);
  const [reviewMode, setReviewMode] = useState(source === "listening" ? "listening" : "reading");
  const saved = !!card;

  const tier = typeof window !== "undefined" ? getSavedTier() : null;
  const isPro = tier === "legacy" || tier === "pro";

  const close = useCallback(() => {
    identityRef.current = null;
    aiSequence.current += 1;
    setSenseEdit(null);
    setSenseFeedback(null);
    setPop(null);
    setAi(null);
    setCard(null);
  }, []);

  // 文章用到哪些首字母就预热哪些分片，点词时不必等网络。
  useEffect(() => {
    if (!passage) return;
    const letters = new Set();
    const lower = String(passage).toLowerCase();
    for (const m of lower.matchAll(/\b[a-z]/g)) letters.add(m[0]);
    prefetchShards([...letters]);
  }, [passage]);

  const openFor = useCallback(async (raw, range) => {
    const word = normalizeWord(raw);
    if (!word || !/[a-z]/.test(word)) return;
    // 记住这个词的 Range：页面滚动时据此重算位置，弹窗才跟得住词。
    rangeRef.current = range;
    const identity = { id: ++openSequence.current, account: getVocabAccountKey(), word };
    identityRef.current = identity;
    aiSequence.current += 1;
    setAi(null);
    setSenseEdit(null);
    setSenseFeedback(null);
    const existing = getCard(word);
    setCard(existing);
    setReviewMode(existing?.reviewMode || (source === "listening" ? "listening" : "reading"));
    const sentenceEl = sentenceElementOf(range);
    const sentenceText = sentenceEl?.getAttribute("data-sentence-text")?.trim()
      || sentenceEl?.textContent?.trim() || sentenceFromRange(rootRef.current, range);
    setPop({
      word,
      identityId: identity.id,
      account: identity.account,
      rect: range.getBoundingClientRect(),
      entry: null,
      loading: true,
      notFound: false,
      sentenceIndex: sentenceIndexOf(range),
      sentenceText,
      crossSentence: !range.collapsed && (!sentenceText
        || (!sentenceEl && !!range.startContainer?.parentElement?.closest?.("[data-sentence-index]"))),
    });
    const entry = await lookupWord(word);
    if (identityRef.current !== identity || getVocabAccountKey() !== identity.account) return;
    setPop((prev) =>
      prev && prev.identityId === identity.id
        ? { ...prev, entry, loading: false, notFound: !entry }
        : prev
    );
  }, [source]);

  const handlePick = useCallback(
    (ev) => {
      if (ev.target && ev.target.closest && ev.target.closest("[data-no-dict]")) return;
      if (popRef.current && popRef.current.contains(ev.target)) return;

      const sel = window.getSelection();
      const picked = sel && !sel.isCollapsed ? sel.toString().trim() : "";
      if (picked) {
        // 划词：限制在一句以内，别把整段当词查
        if (picked.length > 60 || picked.split(/\s+/).length > 6) return;
        // selection 的 Range 是 live 的（用户再选别处就会变），克隆一份快照留着定位
        openFor(picked, sel.getRangeAt(0).cloneRange());
        return;
      }
      const whole = ev.target && ev.target.closest && ev.target.closest("[data-dict-word]");
      if (whole && rootRef.current && rootRef.current.contains(whole)) {
        const wr = document.createRange();
        wr.selectNodeContents(whole);
        openFor(whole.getAttribute("data-dict-word") || wr.toString(), wr);
        return;
      }
      const r = wordRangeFromPoint(ev.clientX, ev.clientY);
      if (!r) {
        close();
        return;
      }
      openFor(r.toString(), r);
    },
    [openFor, close]
  );

  // 手指长按选词后 selection 要一拍才稳定
  const handleTouch = useCallback(
    (ev) => {
      const t = ev.changedTouches && ev.changedTouches[0];
      if (!t) return;
      const point = { target: ev.target, clientX: t.clientX, clientY: t.clientY };
      setTimeout(() => handlePick(point), 10);
    },
    [handlePick]
  );

  // 只在「开/关」这个布尔翻转时装拆监听——位置更新走 ref，不进依赖，
  // 否则每滚一帧 setPop 都会把监听重装一遍。
  const isOpen = !!pop;
  useEffect(() => {
    if (!isOpen) return undefined;
    const onDown = (e) => {
      if (!popRef.current || !popRef.current.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    // 滚动时跟着词走，而不是收起：AI 讲解展开后内容长，用户正需要滚着读。
    // 词滚出视口才收起——那时弹窗已经没有依附对象了。
    // 同步算，不走 requestAnimationFrame：rAF 在页面不渲染时（后台标签页、
    // 被遮挡的窗口）会被挂起，那样弹窗就停在旧位置不动，比收起来还糟。
    // 只有弹窗开着时才挂这个监听，一次 getBoundingClientRect 的开销可以忽略。
    const reposition = () => {
      const range = rangeRef.current;
      if (!range) return;
      const r = range.getBoundingClientRect();
      const gone = r.width === 0 && r.height === 0; // 节点被重渲染换掉了
      if (gone || r.bottom < 0 || r.top > window.innerHeight) {
        close();
        return;
      }
      setPop((prev) => {
        if (!prev) return prev;
        const p = prev.rect;
        if (p && Math.abs(p.top - r.top) < 0.5 && Math.abs(p.left - r.left) < 0.5) {
          return prev; // 词没动（例如在弹窗内部滚动），别白白重渲染
        }
        return { ...prev, rect: r };
      });
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen, close]);

  // 词典命中的原形才是该进单词本的那个词：学生查 studies，收藏的应该是 study。
  const saveWordForm = (pop && pop.entry && pop.entry.word) || (pop && pop.word) || "";

  // 查词结果回来后词形可能被归一，重新对一次收藏态。
  useEffect(() => {
    if (!saveWordForm) return;
    const existing = getCard(saveWordForm);
    setCard(existing);
    if (existing) setReviewMode(existing.reviewMode || "reading");
  }, [saveWordForm]);

  // 这个词在本页原文里的那一句：收藏时当主句，之后当「再加一句语境」的素材。
  const popWord = pop ? pop.word : "";
  const timing = pop?.sentenceIndex >= 0 && Array.isArray(listeningAudio?.timings)
    ? listeningAudio.timings[pop.sentenceIndex] : null;
  const listeningContext = useMemo(() => typeof listeningAudio?.audioUrl === "string" && listeningAudio.audioUrl
    && timing && typeof timing.text === "string" && timing.text.trim()
    && Number.isFinite(timing.start) && Number.isFinite(timing.end) && timing.end > timing.start
    ? { audioUrl: listeningAudio.audioUrl, start: timing.start, end: timing.end, text: timing.text.trim() }
    : null, [listeningAudio?.audioUrl, timing]);
  const curSentence = popWord && !pop?.crossSentence
    ? (listeningContext?.text || pop?.sentenceText || "").trim() : "";
  const canBindSense = !!curSentence && curSentence !== popWord
    && curSentence.toLowerCase().includes(popWord.toLowerCase())
    && (curSentence.match(/[A-Za-z]+(?:['’‐-][A-Za-z]+)*/g) || []).length > 1;
  const candidateUsed = !!ai?.sense && !!card && !!curSentence
    && definitionForContext(card, curSentence) === ai.sense
    && card.contextSenses?.some((item) => item.sentence === curSentence);


  // 登录状态可在弹窗打开期间改变：关闭旧账户弹窗，也让在途响应失效。
  useEffect(() => {
    const onAccount = () => {
      if (identityRef.current && identityRef.current.account !== getVocabAccountKey()) close();
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onAccount);
    window.addEventListener("storage", onAccount);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, onAccount);
      window.removeEventListener("storage", onAccount);
    };
  }, [close]);

  const canAct = useCallback(() => {
    const identity = identityRef.current;
    if (!identity || identity.id !== pop?.identityId || identity.account !== getVocabAccountKey()) {
      close();
      return false;
    }
    return true;
  }, [pop?.identityId, close]);

  const askAi = useCallback(async (refresh = false) => {
    if (!pop || !isPro || !canAct()) return;
    const identity = identityRef.current;
    const request = ++aiSequence.current;
    const sentence = curSentence || pop.word;
    const key = `v2:${JSON.stringify([identity.account, pop.word, sentence.replace(/\s+/g, " ").trim()])}`;
    const legacyKey = `${pop.word}|||${sentence.slice(0, 80)}`;
    const current = () => identityRef.current === identity && request === aiSequence.current
      && getVocabAccountKey() === identity.account;
    setSenseEdit(null);
    setSenseFeedback(null);
    const cache = loadAiCache();
    const cached = !refresh && (cache[key] || cache[legacyKey]);
    if (cached) {
      const result = parseContextSense(cached);
      // 旧键只记前80字；只沿用讲解，不把它的短义项绑定到可能不同的长句。
      if (!cache[key]) result.sense = "";
      if (result.text) {
        setAi({ loading: false, ...result, error: null });
        return;
      }
    }
    setAi({ loading: true, text: null, sense: "", error: null });
    try {
      const message = contextSenseMessage(pop.word, sentence, pop.entry?.t);
      const raw = await callAI(CONTEXT_SENSE_SYSTEM, message, AI_HELPER_MAX_TOKENS, 60000, 0.3);
      if (!current()) return;
      const result = parseContextSense(raw);
      if (!result.text) {
        setAi({ loading: false, text: null, sense: "", error: "AI 这次没返回内容，再点一次试试" });
        return;
      }
      saveAiCache(key, result);
      setAi({ loading: false, ...result, error: null });
    } catch (e) {
      if (!current()) return;
      setAi({ loading: false, text: null, sense: "", error: mapAiHelperError(e) });
    }
  }, [pop, curSentence, isPro, canAct]);

  const adoptSense = useCallback((definition) => {
    if (!pop || !canAct()) return;
    if (!canBindSense || pop.crossSentence) {
      setSenseFeedback({ error: true, text: "请在原文语境中选词后再保存释义" });
      return;
    }
    if (!usableContextSense(definition)) {
      setSenseFeedback({ error: true, text: "请输入可用于复习的短释义，最多300字" });
      return;
    }
    if (definitionForContext(card, curSentence) === definition.trim()
      && card?.contextSenses?.some((item) => item.sentence === curSentence)) {
      setAi((prev) => prev ? { ...prev, sense: definition.trim() } : prev);
      setSenseEdit(null);
      setSenseFeedback(null);
      return;
    }
    try {
      const next = adoptContextSense({
        word: saveWordForm, display: saveWordForm, phonetic: pop.entry?.p || "",
        defFull: pop.entry?.t || "", tag: pop.entry?.g || "", source, reviewMode,
        ...(listeningContext ? { listeningContext } : {}),
      }, definition.trim(), curSentence, new Date(), pop.account);
      if (!next) {
        setSenseFeedback({ error: true, text: "没有保存成功，请重新打开这个词后再试" });
        return;
      }
      setCard(next);
      setAi((prev) => prev ? { ...prev, sense: definition.trim() } : prev);
      setSenseEdit(null);
      setSenseFeedback({ error: false, text: "✓ 已用于这句的复习" });
    } catch (error) {
      setSenseFeedback({ error: true, text: error.message || "没有保存成功，请稍后再试" });
    }
  }, [pop, canAct, curSentence, canBindSense, saveWordForm, source, reviewMode, listeningContext, card]);

  const changeReviewMode = useCallback((mode) => {
    if (!canAct()) return;
    setReviewMode(mode);
    if (!card) return;
    const next = saveWord({ ...card, reviewMode: mode, ...(listeningContext ? { listeningContext } : {}) });
    if (next) setCard(next);
  }, [card, listeningContext, canAct]);

  /** 收藏这个词。def 传空就用整条词典释义（用户没点义项时的老行为）。 */
  const saveCurrent = useCallback(
    (def) => {
      if (!pop || !saveWordForm || !canAct()) return null;
      const full = (pop.entry && pop.entry.t) || "";
      const next = saveWord({
        word: saveWordForm,
        display: saveWordForm,
        phonetic: (pop.entry && pop.entry.p) || "",
        def: def || full,
        // 用户点了某条义项时，整条释义留作备份；没点就没必要重复存一遍
        defFull: def ? full : "",
        tag: (pop.entry && pop.entry.g) || "",
        // 连词所在的整句一起存：复习时在原语境里认词比孤立词表记得牢。
        sentence: curSentence,
        source,
        reviewMode,
        ...(listeningContext ? { listeningContext } : {}),
      });
      setCard(next || getCard(saveWordForm));
      return next;
    },
    [pop, saveWordForm, curSentence, source, reviewMode, listeningContext, canAct],
  );

  const toggleSave = useCallback(() => {
    saveCurrent("");
  }, [saveCurrent]);

  /**
   * 点一条义项：把它设成这张卡的主释义（整条词典释义留作 defFull）。
   * 还没收藏就顺手收藏 —— 「点义项」本身就是一次明确的收藏意图。
   */
  const pickSense = useCallback(
    (pos, sense) => {
      if (!pop || !saveWordForm || !canAct()) return;
      const chosen = `${pos} ${sense}`.trim();
      if (!chosen) return;
      setSenseFeedback(null);
      setSenseEdit(null);
      try {
        if (saved) {
          const next = chooseSense(saveWordForm, chosen, (pop.entry && pop.entry.t) || "", new Date(), curSentence || null);
          if (next) {
            const updated = saveWord({ ...next, reviewMode, ...(listeningContext ? { listeningContext } : {}) });
            setCard(updated || next);
          }
          return;
        }
        saveCurrent(chosen);
      } catch (error) {
        setSenseFeedback({ error: true, text: error.message || "没有保存成功，请稍后再试" });
      }
    },
    [pop, saveWordForm, saved, saveCurrent, reviewMode, listeningContext, canAct, curSentence],
  );

  const pool = (card && Array.isArray(card.sentences) ? card.sentences : []);
  const sentenceOnCard = !!card && !!curSentence
    && (curSentence === card.sentence || pool.includes(curSentence));
  const poolFull = pool.length >= MAX_CONTEXTS;
  const canSupplementAudio = sentenceOnCard && !!listeningContext && !card?.listeningContext;
  const addSentenceLabel = canSupplementAudio
    ? "＋ 补充原句音频"
    : sentenceOnCard
    ? "✓ 这句已在卡上"
    : poolFull
      ? "语境已满 3 句"
      : "＋ 加这句语境";
  const canAddSentence = !!card && !!curSentence && !sentenceOnCard && !poolFull;

  const addCurrentSentence = useCallback(() => {
    if (!saveWordForm || !curSentence) return;
    const next = addSentence(saveWordForm, curSentence);
    if (!next) return;
    const updated = listeningContext ? saveWord({ ...next, reviewMode, listeningContext }) : next;
    setCard(updated || next);
  }, [saveWordForm, curSentence, reviewMode, listeningContext]);

  const dropWord = useCallback(() => {
    if (!saveWordForm) return;
    removeWord(saveWordForm);
    setCard(null);
  }, [saveWordForm]);

  // 多义项的词拆成 chips 让用户点定一个意思；单义项（或拆不出来）退回纯文本。
  const senseGroups = !pop || pop.loading || !pop.entry || !pop.entry.t
    ? []
    : splitSenses(pop.entry.t);

  // 贴在词的正下方；下方装不下就翻到上方，左右不越界。
  let popStyle = null;
  if (pop && pop.rect) {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const spaceBelow = vh - pop.rect.bottom - 16;
    const spaceAbove = pop.rect.top - 16;
    // 下方够放就放下方，否则挑空间大的一侧
    const below = spaceBelow >= 200 || spaceBelow >= spaceAbove;
    // AI 讲解会把弹窗撑高：限制在可用空间内，让它自己内部滚动，别顶出视口
    const maxHeight = Math.round(Math.max(140, Math.min(320, below ? spaceBelow : spaceAbove)));
    const left = Math.max(
      8,
      Math.min(pop.rect.left + pop.rect.width / 2 - POP_W / 2, vw - POP_W - 8)
    );
    popStyle = below
      ? { top: Math.round(pop.rect.bottom + 8), left: Math.round(left), maxHeight }
      : { bottom: Math.round(vh - pop.rect.top + 8), left: Math.round(left), maxHeight };
  }

  return (
    <div ref={rootRef} onMouseUp={handlePick} onTouchEnd={handleTouch} style={style}>
      {children}
      {/* Portal 到 body：页面外层 <main> 的 animation 用了 fill-mode both，结束态留下
          transform: translateY(0)；任何非 none 的 transform 都会成为 position:fixed
          后代的包含块，弹窗会被整体推走（实测偏 344,213）。挂到 body 上才跟得住词。 */}
      {pop && popStyle && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          onMouseUp={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            ...popStyle,
            width: POP_W,
            // 不加这行的话 padding 会撑出 POP_W，靠右边的词弹窗会溢出视口
            boxSizing: "border-box",
            overflowY: "auto",
            // 弹窗内滚到底时别把页面一起带着滚
            overscrollBehavior: "contain",
            background: "#fff",
            border: "1px solid #d8e0da",
            borderRadius: 12,
            boxShadow: "0 8px 28px rgba(15, 42, 30, 0.16)",
            padding: "12px 14px",
            zIndex: 4000,
            fontSize: 13,
            lineHeight: 1.6,
            color: "#22322a",
            cursor: "auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            {/* 词条本身（词/音标/发音/词性）挤不下就在这一块里换行；关闭钮是它的兄弟节点，
                所以永远留在第一行右上角。写成一整排 + marginLeft:auto 的话，长词一挤
                × 就会被顶到第二行去。 */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#14281e" }}>
                {(pop.entry && pop.entry.word) || pop.word}
              </span>
              {pop.entry && pop.entry.p && (
                <span
                  style={{
                    fontSize: 12,
                    color: "#6b8078",
                    fontFamily: "'Courier New', monospace",
                  }}
                >
                  /{pop.entry.p}/
                </span>
              )}
              {/* 念的是标题上这个词（词典命中的原形 study，而不是学生点的 studies），
                  和旁边显示的音标才对得上。 */}
              <SpeakButton
                word={saveWordForm}
                size={24}
                palette={{ border: "#dbe3dd" }}
                style={{ alignSelf: "center" }}
              />
              {/* 听力复盘专属：这个词所在的那一句可以直接放一遍（弹窗不关，边听边看释义）。
                  阅读等没传 onPlaySentence 的调用方，以及词不在可播放句里时，都不渲染。 */}
              {typeof onPlaySentence === "function" && pop.sentenceIndex >= 0 && (
                <button
                  type="button"
                  onClick={() => onPlaySentence(pop.sentenceIndex)}
                  aria-label="听这一句"
                  title="播放原文里的这一句"
                  style={{
                    alignSelf: "center",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    border: "1px solid #dbe3dd",
                    background: "#fff",
                    color: "#5a6b62",
                    borderRadius: 999,
                    padding: "2px 9px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                    lineHeight: 1.5,
                    whiteSpace: "nowrap",
                  }}
                >
                  ▶ 听这一句
                </button>
              )}
              {pop.entry && pop.entry.g && (
                <span
                  style={{
                    fontSize: 10,
                    color: "#3f7a5c",
                    background: "#e8f5ee",
                    borderRadius: 5,
                    padding: "1px 6px",
                    fontWeight: 600,
                  }}
                >
                  {pop.entry.g}
                </span>
              )}
            </div>
            <button
              onClick={close}
              aria-label="关闭"
              style={{
                flexShrink: 0,
                border: "none",
                background: "transparent",
                color: "#9aa8a1",
                fontSize: 16,
                cursor: "pointer",
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </div>

          {pop.loading && (
            <div style={{ marginTop: 8, color: "#8a9a92", fontSize: 12 }}>查询中…</div>
          )}
          <div role="group" aria-label="选择复习类型" style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {[["reading", "阅读词"], ["listening", "听力词"]].map(([mode, label]) => (
              <button key={mode} type="button" aria-pressed={reviewMode === mode} disabled={pop.loading}
                onClick={() => changeReviewMode(mode)}
                style={{ border: `1px solid ${reviewMode === mode ? "#0891B2" : "#dbe3dd"}`, background: reviewMode === mode ? "#ECFEFF" : "#fff", color: reviewMode === mode ? "#08758f" : "#596b61", borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                {label}
              </button>
            ))}
          </div>
          {/* 释义区：多义项拆成可点的 chips，点一条就把它定成这张卡的主释义 ——
              整条词典条目（七八个义项）存进单词本，复习时根本对不上原句那个意思。
              拆不出多个义项（或压根只有一条）时保持老的纯文本展示。 */}
          {!pop.loading && pop.entry && pop.entry.t && senseGroups.length === 0 && (
            <DefLine text={pop.entry.t} style={{ marginTop: 8, color: "#31423a" }} />
          )}
          {!pop.loading && senseGroups.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {senseGroups.map((group, gi) => (
                <div
                  key={`${group.pos}-${gi}`}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 6,
                    marginTop: gi === 0 ? 0 : 6,
                  }}
                >
                  {(group.posLabels.length > 0 || group.domainLabels.length > 0) && (
                    <span style={{ fontSize: 11, color: "#8a9a92", flexShrink: 0 }}>
                      {[
                        ...group.posLabels,
                        ...group.domainLabels.map((d) => `〔${d}〕`),
                      ].join(" ")}
                    </span>
                  )}
                  {group.senses.map((sense) => {
                    const chosen = `${group.pos} ${sense}`.trim();
                    const on = !!card && definitionForContext(card, curSentence) === chosen;
                    return (
                      <button
                        key={sense}
                        type="button"
                        onClick={() => pickSense(group.pos, sense)}
                        title={on ? "复习时就按这个意思考" : "把这条义项定成这个词的释义"}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          border: `1px solid ${on ? "#0891B2" : "#dbe3dd"}`,
                          background: on ? "#ECFEFF" : "#fff",
                          color: on ? "#0891B2" : "#31423a",
                          fontWeight: on ? 700 : 400,
                          borderRadius: 999,
                          padding: "2px 9px",
                          fontSize: 12,
                          lineHeight: 1.6,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          maxWidth: "100%",
                          textAlign: "left",
                        }}
                      >
                        {sense}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div style={{ marginTop: 6, fontSize: 11, color: "#8a9a92" }}>
                {saved ? "点义项可以换成这句里的意思" : "点一个义项收藏，复习时就按这个意思考"}
              </div>
            </div>
          )}
          {!pop.loading && pop.notFound && (
            <div style={{ marginTop: 8, color: "#8a9a92", fontSize: 12 }}>
              词库里没有这个词{isPro ? "，可以让 AI 按上下文讲一下。" : "。"}
            </div>
          )}

          {!pop.loading && (
            <div style={{ marginTop: 10, borderTop: "1px solid #eef2ef", paddingTop: 8 }}>
              {!saved ? (
                <button
                  onClick={toggleSave}
                  aria-label="收藏到单词本"
                  title="收藏到单词本，之后按遗忘曲线安排复习"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    border: "1px solid #dbe3dd",
                    background: "#fff",
                    color: "#5a6b62",
                    borderRadius: 999,
                    padding: "4px 12px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    lineHeight: 1.5,
                    whiteSpace: "nowrap",
                  }}
                >
                  ☆ 收藏到单词本
                </button>
              ) : (
                /* 已收藏：收藏钮让位给两件真正还能做的事 —— 给这张卡再加一句语境，
                   或者把词移出去。点「已收藏」误删的路也就此堵掉了。 */
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={addCurrentSentence}
                    disabled={!canAddSentence && !canSupplementAudio}
                    aria-label={addSentenceLabel}
                    title={
                      canSupplementAudio
                        ? "给这句补上对应的原声，听力复习时使用"
                        : sentenceOnCard
                        ? "这句已经在这张卡的语境里了"
                        : poolFull
                          ? "一张卡最多存 3 句额外语境"
                          : canAddSentence
                            ? "把这句也存进这张卡，复习时轮换着考"
                            : "这里没抓到完整的一句话"
                    }
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      border: `1px solid ${canAddSentence || canSupplementAudio ? "#f0c14b" : "#dbe3dd"}`,
                      background: canAddSentence || canSupplementAudio ? "#fff8e6" : "#f6f8f7",
                      color: canAddSentence || canSupplementAudio ? "#9a6b00" : "#8a9a92",
                      borderRadius: 999,
                      padding: "4px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: canAddSentence || canSupplementAudio ? "pointer" : "default",
                      lineHeight: 1.5,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {addSentenceLabel}
                  </button>
                  <button
                    onClick={dropWord}
                    aria-label="从单词本移除"
                    title="把这个词移出单词本"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      border: "1px solid #dbe3dd",
                      background: "#fff",
                      color: "#8a9a92",
                      borderRadius: 999,
                      padding: "4px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      lineHeight: 1.5,
                      whiteSpace: "nowrap",
                    }}
                  >
                    移出单词本
                  </button>
                </div>
              )}
            </div>
          )}

          {isPro && !pop.loading && (
            <div style={{ marginTop: 8, paddingTop: 0 }}>
              {ai && ai.text ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "#0c4a6e",
                    background: "#f0f9ff",
                    border: "1px solid #bae6fd",
                    borderRadius: 8,
                    padding: "8px 10px",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  <div>{ai.text}</div>
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #bae6fd" }}>
                    <div style={{ fontWeight: 700 }}>这句里的意思：{ai.sense || "可从讲解中填写短释义"}</div>
                    {senseEdit ? (
                      <div style={{ marginTop: 6 }}>
                        <textarea aria-label="这句的短释义" value={senseEdit.value}
                          onChange={(event) => setSenseEdit((prev) => prev ? { ...prev, value: event.target.value } : prev)}
                          rows={2} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #7dd3fc", borderRadius: 6, padding: "6px 8px", font: "inherit", color: "#22322a", resize: "vertical" }} />
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                          <button type="button" onClick={() => {
                            if (senseEdit.identityId === pop.identityId) adoptSense(senseEdit.value);
                          }} style={{ border: "none", borderRadius: 6, background: "#0284c7", color: "#fff", padding: "4px 10px", font: "inherit", cursor: "pointer" }}>保存释义</button>
                          <button type="button" onClick={() => { setSenseEdit(null); setSenseFeedback(null); }} style={{ border: "1px solid #bae6fd", borderRadius: 6, background: "#fff", color: "#0c4a6e", padding: "4px 10px", font: "inherit", cursor: "pointer" }}>取消</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                        {ai.sense && <button type="button" onClick={() => adoptSense(ai.sense)}
                          disabled={candidateUsed || !canBindSense || pop.crossSentence}
                          style={{ border: "none", borderRadius: 6, background: "#0284c7", color: "#fff", padding: "4px 10px", font: "inherit", cursor: !candidateUsed && canBindSense && !pop.crossSentence ? "pointer" : "default", opacity: canBindSense && !pop.crossSentence ? 1 : 0.5 }}>{candidateUsed ? "✓ 已用于这句的复习" : "用这个意思复习"}</button>}
                        <button type="button" onClick={() => {
                          if (!canAct()) return;
                          setSenseEdit({ identityId: pop.identityId, value: ai.sense || "" });
                          setSenseFeedback(null);
                        }} style={{ border: "1px solid #bae6fd", borderRadius: 6, background: "#fff", color: "#0c4a6e", padding: "4px 10px", font: "inherit", cursor: "pointer" }}>编辑释义</button>
                        {!ai.sense && <button type="button" onClick={() => askAi(true)} style={{ border: "none", background: "transparent", color: "#0284c7", font: "inherit", cursor: "pointer" }}>重新分析</button>}
                      </div>
                    )}
                    {card && curSentence && !sentenceOnCard && poolFull && <div style={{ marginTop: 6, fontSize: 11, color: "#64748b" }}>采用后以这句复习，其他语境保留最近3句</div>}
                    {(!canBindSense || pop.crossSentence) && <div style={{ marginTop: 6, color: "#64748b" }}>在原文语境中选词后才能保存释义</div>}
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => askAi()}
                    disabled={ai && ai.loading}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#fff",
                      background: ai && ai.loading ? "#9ca3af" : "#0284c7",
                      border: "none",
                      borderRadius: 6,
                      padding: "5px 12px",
                      cursor: ai && ai.loading ? "default" : "pointer",
                    }}
                  >
                    {ai && ai.loading ? "分析中…" : "讲讲这句里的用法"}
                  </button>
                  {ai && ai.error && (
                    <span style={{ fontSize: 11, color: "#E11D48", marginLeft: 8 }}>
                      {ai.error}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          {senseFeedback?.error && <div role="alert" style={{ marginTop: 6, fontSize: 12, color: "#E11D48" }}>{senseFeedback.text}</div>}
        </div>,
        document.body
      )}
    </div>
  );
}
