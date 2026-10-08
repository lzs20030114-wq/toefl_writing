"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FONT } from "../shared/ui";
import { RATING, STATE } from "../../lib/vocab/srs";
import { activeSentence, definitionForContext, cardDirection, clozeSentence, contextSentence, needsDictFill, needsSpelling, sourceLabel } from "../../lib/vocab/book";
import { SpeakButton } from "../shared/SpeakButton";
import { DefLine, DictSenses } from "../shared/DictSenses";
import { hasUsableSense, parseSenses } from "../../lib/dict/core";
import { lookupWord } from "../../lib/dict/lookup";
import { CONTEXT_SENSE_SYSTEM, contextSenseMessage, parseContextSense } from "../../lib/dict/aiSense";
import { callAI, mapAiHelperError, AI_HELPER_MAX_TOKENS } from "../../lib/ai/client";
import { getSavedTier, AUTH_CHANGED_EVENT } from "../../lib/AuthContext";
import { adoptDictEntry, getCard, getVocabAccountKey } from "../../lib/vocab/vocabStore";
import { reinsertAfterGap } from "../../lib/vocab/reinsert";
import { SESSION_WINDOW_MS } from "../../lib/vocab/reviewSave";
import ReviewSummary from "./ReviewSummary";
import { SpellingAnswer, SpellingInput } from "./SpellingBoxes";
import { formatTyped, lettersOf, spellingCorrect } from "../../lib/vocab/spelling";
import { SEGMENT_SIZE, SegmentCheckpoint } from "./SegmentCheckpoint";
import { reviewCardStyle, reviewKbd as kbd, reviewMenuButton as menuBtn } from "./reviewPresentation";
import { buildReviewSummary, pickStats, senseOf } from "../../lib/vocab/reviewSummary";

/**
 * 一场复习。
 *
 * 五条硬规矩，每条都有出处（见 docs/vocab-srs-research.md）：
 *
 *  1. 先回想、后翻面，且必须点一次才翻。被动重读几乎不产生长期记忆：
 *     同样学完，之后继续被测试的词一周后能回忆 80%，只重看的只有 36%
 *     （Karpicke & Roediger 2008, Science）。这一点的量级远大于调度算法的优化空间。
 *  2. 主卡型是原句里高亮认词：给完整原句、目标词高亮，回忆它在这里是什么意思。
 *     不再挖空填词 —— 考场上要的是「看到词想起词义」（和 TOEFL 词汇题同形），
 *     而挖空卡正面挂着音标等于已经把词形给了，真实句子的空位又不唯一，
 *     它从头到尾没要求过词义提取。语境提升理解，**提取**才提升留存
 *     （den Broek 2018/2022），所以语境留下，提取的目标换成词义。
 *     要会写的词进入 review 后，认词选「记得」还要写出拼写，拼对才算记得
 *     （book.needsSpelling）。不再一上来就冷考拼写：先认词，词义和拼写两个信号分得开。
 *  3. 只有两个评分键：忘了 / 记得。Anki 官方 FAQ：FSRS 对「主要用 Again/Good」
 *     的用户预测更准；而「忘了却按 Hard」是官方点名唯一会毁掉排期的习惯。
 *     四档的信息增益小于它引入的自评噪声，对我们这种顺手收藏进来的普通用户尤其如此。
 *  4. 不显示下次间隔。看见间隔，用户就会用「我想多久再看到它」而不是
 *     「我记得多牢」来评分。
 *  5. 当天第一遍就答对 → 今天过；没答对 → 隔开（至少 10 张）回来，当天累计答对
 *     3 次才过（srs.learningSteps）。答对过的词当天再问只是在点按钮（线上日志：
 *     当天回访 397 次只错 1 次、中位 2.1 秒），时间留给隔天复习更值
 *     （Vaughn, Dunlosky & Rawson 2016）；答错的词才需要当天补够 3 次
 *     （Rawson & Dunlosky 2011）。连刷是集中练习，制造的是流畅性错觉（Kornell 2009），
 *     所以回插仍要隔开。
 */

const ACCENT = "#0891B2";
const ACCENT_SOFT = "#ECFEFF";

/** 重新插队至少隔这么多张 —— 刚看完答案立刻再问，考的是短时记忆，不是记忆。 */
const REINSERT_GAP = 10;
/** 一个词在一场里最多出现几次：失手 1 次 + 累计答对 3 次 = 4，再留两次给中途又错。
 *  到顶还没过的词留在学习中，下次（多半是明天）第一遍答对就过。 */
const MAX_APPEARANCES = 6;

const DIRECTION_META = {
  context: { label: "认词", tip: "这个词在这句里是什么意思" },
  recognize: { label: "认词", tip: "这个词什么意思" },
};
/** 认词选了「记得」之后弹出的拼写步骤。 */
const SPELL_META = { label: "拼写", tip: "认得了，再写出它的英文拼写" };

/** 把句子里的目标词标出来。匹配不到就原样返回。 */
function highlight(sentence, word) {
  if (!sentence) return null;
  if (!word) return sentence;
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re;
  try {
    re = new RegExp(`(\\b${esc}\\w*\\b)`, "ig");
  } catch {
    return sentence;
  }
  const parts = sentence.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} style={{ color: ACCENT, fontWeight: 800 }}>{part}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/**
 * 背面的「词典」区：把这个词的全部释义按词性铺开。
 *
 * 主释义回答的是「它在这句里什么意思」，这一块回答另外两个问题 ——
 * 它还能当别的词性用吗、那个看不懂的 [计] 到底是什么。只在背面出现：
 * 正面给了释义这张卡就没有提取可言。
 *
 * 三种状态：
 *  - 卡上释义太薄、这次现查到了（filling）：整条词典释义摆在这儿，
 *    同一次里 adoptDictEntry 已经把它顶成主释义，所以下一次进来走第三种。
 *  - 顶替过的卡：主释义已经是整条词典释义了，这里只剩「原形是谁」要交代。
 *  - 用户点过义项的卡：主释义是那一条，这里摆整条 defFull 当参照。
 */
function DictPanel({ card, extra, mainDef }) {
  const filling = needsDictFill(card) && !!extra && !!extra.t;
  // 释义讲的是原形（varying → vary）时必须说清楚，否则用户会以为
  // 这些词性和音标属于卡面上那个词形。
  const lemma = filling
    ? (extra.word && extra.word !== card.word ? { word: extra.word, p: extra.p } : null)
    : (card.lemma ? { word: card.lemma, p: "" } : null);
  // 卡上那条整释义和主释义一字不差时就别重复摆一遍了
  const body = filling ? (extra.t !== mainDef ? extra.t : "")
    : (card.defFull && card.defFull !== mainDef ? card.defFull : "");
  const hasBody = !!body && parseSenses(body).length > 0;
  if (!hasBody && !lemma) return null;
  return (
    <div style={{
      marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${C.bdrSubtle}`,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        marginBottom: hasBody ? 8 : 0,
      }}>
        <span style={{
          fontSize: 10, color: C.t3, background: C.bdrSubtle,
          borderRadius: 5, padding: "1px 6px", fontWeight: 700,
        }}>
          词典
        </span>
        {lemma && (
          <>
            <span style={{ fontSize: 12, color: C.t2 }}>
              原形 <strong style={{ color: C.t1 }}>{lemma.word}</strong>
            </span>
            {lemma.p && (
              <span style={{ fontSize: 12, color: C.t3, fontFamily: "'Courier New', monospace" }}>
                /{lemma.p}/
              </span>
            )}
            <SpeakButton word={lemma.word} size={22} />
          </>
        )}
        {filling && extra.g && (
          <span style={{
            fontSize: 10, color: "#3f7a5c", background: "#e8f5ee",
            borderRadius: 5, padding: "1px 6px", fontWeight: 600,
          }}>
            {extra.g}
          </span>
        )}
      </div>
      {hasBody && <DictSenses text={body} />}
    </div>
  );
}

function WordLine({ card, size = 30 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ fontSize: size, fontWeight: 800, color: C.t1, letterSpacing: -0.5, wordBreak: "break-word" }}>
        {card.display || card.word}
      </span>
      {card.phonetic && (
        <span style={{ fontSize: 13, color: C.t3, fontFamily: "'Courier New', monospace" }}>
          /{card.phonetic}/
        </span>
      )}
      <SpeakButton word={card.display || card.word} size={30} />
    </div>
  );
}



export function VocabReview({
  initialQueue, onGrade, onUndo, onSetProductive, onSuspend, onEditDefinition, onExit,
  accountKey = getVocabAccountKey(),
  // 从存档继续时带进来的上一段统计；没有就是全新一场
  resume = null,
  // 每过完一段 / 整场结束时通知外面落存档、清存档（外面不接就不存）
  onCheckpoint, onFinish,
  // 单词本当前的整体统计，结算页拿它和开场时对比出「预计记得 96 → 104」
  statsNow = null,
  // 结算页下半截的「接下来」：{ nextTask, tomorrow, onStartNext, onExportWords }
  summaryExtras = null,
}) {
  // 一场复习的全部「会因评分而变」的状态收在一个对象里：
  // 撤销就是把上一份整个换回来，不用逐项倒推。
  const [sess, setSess] = useState(() => ({
    queue: initialQueue || [],
    pos: 0,
    // 队列在本场内是活的（答错的卡会回插），进度条分母用「初始张数」会跳；
    // 用已答次数 /（已答 + 剩余）才稳。
    answered: resume?.answered || 0,
    tally: { again: resume?.tally?.again || 0, good: resume?.tally?.good || 0 },
    first: resume?.first || {}, // 词 -> 第一次被问时是否想起来
    seen: resume?.seen || {}, // 词 -> 这一场里已经出现了几次
    lost: resume?.lost || [],
    segment: [], // 当前这一段评过的 { word, good, n }
    segNo: resume?.segNo || 0,
    checkpoint: false,
    resumed: !!resume,
    endedAt: null,
  }));
  // 每次评分前压一份快照；过了存档点清空（那一刻已经落盘，不再允许回头改）
  const [history, setHistory] = useState([]);
  const [revealed, setRevealed] = useState(false);
  // 拼写步骤：null = 还在认词；input = 正在写；result = 已核对，看结果
  const [spellStage, setSpellStage] = useState(null);
  const [spelling, setSpelling] = useState("");
  const [spellingResult, setSpellingResult] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState(null);
  // 当前题型/已做出的拼写结果保持不变；逐词设置在下次出现时生效。
  const [productiveOverrides, setProductiveOverrides] = useState({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const aiRequestRef = useRef(0);
  const [notice, setNotice] = useState("");
  const [segDurMs, setSegDurMs] = useState(0);
  const [startStats] = useState(() => resume?.startStats || pickStats(statsNow));
  // 评过分的词的卡面（结算页/段小结要显示词形和释义）
  const infoRef = useRef(new Map());
  const startedAtRef = useRef(Date.now() - (resume?.elapsedMs || 0));
  const segStartRef = useRef(Date.now());
  // 这张卡是什么时候显示出来的 —— 存进日志，留给以后用反应时间做隐式分档
  const shownAtRef = useRef(Date.now());
  const spellingRef = useRef(null);
  // 卡上释义太薄时现查到的词条（见 needsDictFill）。只查当前这一张：
  // 一个分片一百多 KB，把整队列的首字母都预热一遍在移动网络上不划算，
  // 而真正需要补的卡是少数（绝大多数卡是从义项 chips 点着收藏的，词性本来就全）。
  const [extra, setExtra] = useState(null);

  const { queue, pos, tally } = sess;
  const card = queue[pos] || null;
  const extraEntry = extra && card && extra.forWord === card.word ? extra.entry : null;
  const definitionSentence = card?.reviewMode === "listening" ? card.listeningContext?.text || "" : activeSentence(card) || "";
  const contextDef = definitionForContext(card, definitionSentence);
  const mainDef = hasUsableSense(contextDef) ? contextDef
    : (extraEntry && hasUsableSense(extraEntry.t) ? extraEntry.t : "");
  // 认词正面用「保留目标词的原句」，拼写步骤用「挖了空的原句」。
  const context = useMemo(() => (card ? contextSentence(card) : null), [card]);
  const cloze = useMemo(() => (card ? clozeSentence(card) : null), [card]);
  // 背面高亮的例句要和正面用的是同一句（池里轮到第二句时不能翻面又跳回主句）。
  const shownSentence = useMemo(() => (card ? activeSentence(card) || card.sentence : ""), [card]);
  const tier = typeof window !== "undefined" ? getSavedTier() : null;
  const canGenerateDefinition = (tier === "pro" || tier === "legacy") && !!shownSentence?.trim();
  const mode = useMemo(() => (card ? cardDirection(card) : "recognize"), [card]);
  // 这一次选「记得」后要不要拼：按卡进队列时的状态定，本场改「要会写」开关下次才生效。
  const spellingOn = useMemo(() => (card ? needsSpelling(card) : false), [card]);
  // 拼写格子按词条摆；卡面写法只差大小写时（Renaissance）用卡面写法显示答案
  const answerWord = card ? (lettersOf(card.display) === lettersOf(card.word) ? card.display : card.word) : "";
  // 「填在原句的空里」只在挖得出空的时候成立，否则退回独立一行
  const inlineSpelling = !!cloze;
  // A user-edited meaning may include the English answer; conceal it on spelling fronts.
  const spellingDef = card?.word ? mainDef.replace(new RegExp(`\\b${card.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*\\b`, "gi"), "____") : mainDef;
  const productiveOn = card
    ? (productiveOverrides[card.word] ?? (card.productive !== false))
    : true;
  const productiveChangedForThisCard = card && productiveOn !== (card.productive !== false);

  const finished = pos >= queue.length;
  const remaining = Math.max(0, queue.length - pos);
  const timesSeen = card ? sess.seen[card.word] || 0 : 0;
  const canUndo = !!onUndo && history.length > 0 && !sess.checkpoint;

  useEffect(() => {
    shownAtRef.current = Date.now();
  }, [pos]);

  useEffect(() => {
    aiRequestRef.current += 1;
    setMenuOpen(false);
    setEditing(false);
    setEditError("");
    setAiGenerating(false);
  }, [pos, card?.word, accountKey, shownSentence]);

  useEffect(() => {
    const invalidate = () => {
      if (getVocabAccountKey() === accountKey) return;
      aiRequestRef.current += 1;
      setAiGenerating(false);
      setEditing(false);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, invalidate);
    return () => {
      aiRequestRef.current += 1;
      window.removeEventListener(AUTH_CHANGED_EVENT, invalidate);
    };
  }, [accountKey]);

  // 存档小结开着时不能抢焦点：输入框一聚焦，空格就打进了它背后的输入框，
  // 小结的「继续」按钮永远等不到键盘。小结关掉后依赖变化，焦点再回到输入框。
  useEffect(() => {
    if (spellStage === "input" && !sess.checkpoint) spellingRef.current?.focus();
  }, [pos, spellStage, sess.checkpoint]);

  const checkSpelling = useCallback((e) => {
    e.preventDefault();
    if (!card || !spelling.trim() || spellStage !== "input") return;
    const result = spellingCorrect(spelling, card.word) ? "correct" : "incorrect";
    if (retrying) setRetryResult(result);
    else setSpellingResult(result);
    setSpellStage("result");
  }, [card, spelling, spellStage, retrying]);

  const giveUpSpelling = useCallback(() => {
    if (retrying) setRetryResult("skipped");
    else setSpellingResult("skipped");
    setSpellStage("result");
  }, [retrying]);

  const retrySpelling = useCallback(() => {
    setRetrying(true);
    setRetryResult(null);
    setSpelling("");
    setSpellStage("input");
  }, []);

  const toggleProductive = useCallback((event) => {
    event.stopPropagation();
    if (!card || !onSetProductive || getVocabAccountKey() !== accountKey) return;
    const updated = onSetProductive(card.word, !productiveOn);
    if (updated) {
      setProductiveOverrides((prev) => ({ ...prev, [card.word]: updated.productive !== false }));
    }
  }, [accountKey, card, onSetProductive, productiveOn]);

  const resetFace = useCallback((nextRevealed = false) => {
    setRevealed(nextRevealed);
    setSpellStage(null);
    setSpelling("");
    setSpellingResult(null);
    setRetrying(false);
    setRetryResult(null);
    setMenuOpen(false);
    setEditing(false);
    setNotice("");
  }, []);

  const fillWord = card && needsDictFill(card) ? card.word : "";
  useEffect(() => {
    setExtra(null);
    if (!fillWord) return undefined;
    let alive = true;
    // 查不到、断网、词库没收录都当作没有补充：这一块只是锦上添花，
    // 失败时背面照常显示卡上存的那条释义。
    lookupWord(fillWord)
      .then((e) => {
        if (!e || !e.t) return;
        if (alive) setExtra({ forWord: fillWord, entry: e });
        // 顺手写回卡片：这张卡的主释义本来就是「词典整条」（用户没点过义项），
        // 换成查得到的那一条才是它该有的样子。写回之后列表页、别的设备、
        // 下一次复习都不用再查（needsDictFill 从此为 false）。
        // 卸载了也照写 —— 修复本身是对的，不该因为用户正好翻页就丢掉。
        if (getVocabAccountKey() === accountKey) adoptDictEntry(fillWord, e, new Date(), accountKey);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [accountKey, fillWord]);

  const grade = useCallback(
    (rating) => {
      if (!card || sess.checkpoint || getVocabAccountKey() !== accountKey) return;
      const updated = onGrade(card.word, rating, Date.now() - shownAtRef.current);
      if (!updated) return;
      const good = rating !== RATING.AGAIN;
      infoRef.current.set(card.word, card);
      const times = (sess.seen[card.word] || 0) + 1;
      const nextQueue = reinsertAfterGap(sess.queue, sess.pos, updated, times, {
        gap: REINSERT_GAP, maxAppearances: MAX_APPEARANCES, windowMs: SESSION_WINDOW_MS,
      });
      const nextPos = sess.pos + 1;
      const done = nextPos >= nextQueue.length;
      const segment = [...sess.segment, { word: card.word, good, n: times }];
      const hit = !done && segment.length >= SEGMENT_SIZE;
      const next = {
        ...sess,
        queue: nextQueue,
        pos: nextPos,
        answered: sess.answered + 1,
        tally: { again: sess.tally.again + (good ? 0 : 1), good: sess.tally.good + (good ? 1 : 0) },
        first: card.word in sess.first ? sess.first : { ...sess.first, [card.word]: good },
        seen: { ...sess.seen, [card.word]: times },
        lost: !good && !sess.lost.includes(card.word) ? [...sess.lost, card.word] : sess.lost,
        segment,
        segNo: hit ? sess.segNo + 1 : sess.segNo,
        checkpoint: hit,
        endedAt: done ? Date.now() : null,
      };
      setHistory(hit || done ? [] : [...history, sess]);
      setSess(next);
      resetFace(false);
      if (hit) {
        setSegDurMs(Date.now() - segStartRef.current);
        onCheckpoint?.({
          words: nextQueue.slice(nextPos).map((c) => c.word),
          answered: next.answered, tally: next.tally, first: next.first, seen: next.seen, lost: next.lost,
          segNo: next.segNo, elapsedMs: Date.now() - startedAtRef.current, startStats,
        });
      }
      if (done) onFinish?.();
    },
    [accountKey, card, history, onCheckpoint, onFinish, onGrade, resetFace, sess, startStats],
  );

  const continueSegment = useCallback(() => {
    segStartRef.current = Date.now();
    shownAtRef.current = Date.now();
    setSess((s) => ({ ...s, checkpoint: false, segment: [], resumed: false }));
  }, []);

  /** 撤销上一张：评分写回的调度状态和日志一并退回，再把那张卡原样摆回来重答。 */
  const undo = useCallback(() => {
    if (!canUndo || getVocabAccountKey() !== accountKey) return;
    const prev = history[history.length - 1];
    const prevCard = prev.queue[prev.pos];
    if (!prevCard || !onUndo(prevCard.word)) return;
    setHistory(history.slice(0, -1));
    setSess(prev);
    // 摆回「已翻面、还没选」：直接重新选；要拼写的话选「记得」后从空输入框重新拼，不带旧结果
    resetFace(true);
  }, [accountKey, canUndo, history, onUndo, resetFace]);

  const suspendWord = useCallback(() => {
    if (!card || !onSuspend || getVocabAccountKey() !== accountKey) return;
    if (!onSuspend(card.word)) return;
    // 当前这张不评分直接跳过；本场后面回插的同词也一并拿掉
    const nextQueue = sess.queue.filter((c, i) => i < sess.pos || c.word !== card.word);
    const done = sess.pos >= nextQueue.length;
    setHistory([]);
    setSess({ ...sess, queue: nextQueue, endedAt: done ? Date.now() : null });
    resetFace(false);
    setNotice(`已暂停「${card.display || card.word}」，可在词库里恢复。`);
    if (done) onFinish?.();
  }, [accountKey, card, onFinish, onSuspend, resetFace, sess]);

  const openEditor = useCallback(() => {
    aiRequestRef.current += 1;
    setAiGenerating(false);
    setEditText(mainDef || card?.def || "");
    setEditError("");
    setEditing(true);
    setMenuOpen(false);
  }, [card, mainDef]);

  const closeEditor = useCallback(() => {
    aiRequestRef.current += 1;
    setAiGenerating(false);
    setEditing(false);
    setEditError("");
  }, []);

  const generateDefinition = useCallback(async () => {
    if (!card || !canGenerateDefinition || aiGenerating || getVocabAccountKey() !== accountKey) return;
    const request = ++aiRequestRef.current;
    const current = () => request === aiRequestRef.current && getVocabAccountKey() === accountKey;
    setAiGenerating(true);
    setEditError("");
    try {
      const message = contextSenseMessage(card.display || card.word, shownSentence,
        card.defFull || card.baseDef || extraEntry?.t || card.def);
      const raw = await callAI(CONTEXT_SENSE_SYSTEM, message, AI_HELPER_MAX_TOKENS, 60000, 0.3);
      if (!current()) return;
      const { sense } = parseContextSense(raw);
      if (!sense) {
        setEditError("AI 这次没返回可用的短释义，请重试。");
        return;
      }
      setEditText(sense);
    } catch (error) {
      if (current()) setEditError(mapAiHelperError(error));
    } finally {
      if (current()) setAiGenerating(false);
    }
  }, [accountKey, aiGenerating, canGenerateDefinition, card, extraEntry, shownSentence]);

  const saveEdit = useCallback((e) => {
    e.preventDefault();
    if (!card || !onEditDefinition || aiGenerating || getVocabAccountKey() !== accountKey) return;
    try {
      const updated = onEditDefinition(card.word, editText);
      if (!updated) { setEditError("没能保存：这个词可能已被移除。"); return; }
      const patch = {
        def: updated.def, defFull: updated.defFull, baseDef: updated.baseDef, contextSenses: updated.contextSenses,
        definitionLocked: updated.definitionLocked, definitionUpdatedAt: updated.definitionUpdatedAt,
        contextSenseResetAt: updated.contextSenseResetAt,
      };
      setSess((s) => ({ ...s, queue: s.queue.map((c) => (c.word === card.word ? { ...c, ...patch } : c)) }));
      closeEditor();
    } catch (error) {
      setEditError(error?.message || "没能保存，请稍后重试。");
    }
  }, [accountKey, aiGenerating, card, closeEditor, editText, onEditDefinition]);

  /** 认词选「记得」：要会写的词先弹拼写，拼对才算；其余直接记得。 */
  const remember = useCallback(() => {
    if (spellingOn) setSpellStage("input");
    else grade(RATING.GOOD);
  }, [grade, spellingOn]);

  // 认词翻面自评；选「记得」的要会写词，还得写出拼写或明确选择「想不起来」。
  const gradeRef = useRef(grade);
  gradeRef.current = grade;
  const rememberRef = useRef(remember);
  rememberRef.current = remember;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const continueRef = useRef(continueSegment);
  continueRef.current = continueSegment;
  const checkpointRef = useRef(sess.checkpoint);
  checkpointRef.current = sess.checkpoint;
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;
  const spellStageRef = useRef(spellStage);
  spellStageRef.current = spellStage;
  const spellingResultRef = useRef(spellingResult);
  spellingResultRef.current = spellingResult;
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Esc / Z 对按钮没有原生含义，焦点停在按钮上（比如刚点开 ⋯ 菜单）也要生效；
      // 空格/回车则留给聚焦的按钮自己去点，免得一次按键触发两件事。
      if (e.key === "Escape") { setMenuOpen(false); return; }
      if (!checkpointRef.current && (e.key === "z" || e.key === "Z")) { e.preventDefault(); undoRef.current(); return; }
      if (e.target && e.target.tagName === "BUTTON") return;
      if (checkpointRef.current) {
        if (e.key === " " || e.key === "Enter") { e.preventDefault(); continueRef.current(); }
        return;
      }
      if (spellStageRef.current) {
        // 拼写中：按键交给输入框（焦点不在框里时不替用户做决定）；看结果时空格/回车进下一词
        if (spellStageRef.current === "result" && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          gradeRef.current(spellingResultRef.current === "correct" ? RATING.GOOD : RATING.AGAIN);
        }
        return;
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!revealedRef.current) setRevealed(true);
        else rememberRef.current();
        return;
      }
      if (!revealedRef.current) return;
      if (e.key === "1") {
        e.preventDefault();
        gradeRef.current(RATING.AGAIN);
      } else if (e.key === "2") {
        e.preventDefault();
        rememberRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (finished) {
    const summary = buildReviewSummary({
      first: sess.first, tally, lost: sess.lost,
      infoFor: (word) => infoRef.current.get(word) || getCard(word),
      senseFor: (info) => senseOf(info, activeSentence(info)),
      startedAt: startedAtRef.current, endedAt: sess.endedAt, startStats, statsNow,
    });
    return (
      <ReviewSummary
        summary={summary}
        nextTask={summaryExtras?.nextTask}
        tomorrow={summaryExtras?.tomorrow}
        onStartNext={summaryExtras?.onStartNext}
        onExportWords={summaryExtras?.onExportWords}
        onExit={onExit}
      />
    );
  }

  if (!card) return null;

  const dirMeta = spellStage ? SPELL_META : DIRECTION_META[mode] || DIRECTION_META.recognize;
  const progress = sess.answered + remaining > 0 ? sess.answered / (sess.answered + remaining) : 0;
  const segmentRows = sess.segment.map((g) => {
    const info = infoRef.current.get(g.word);
    return { ...g, display: info?.display || g.word, sense: info ? senseOf(info, activeSentence(info)) : "" };
  });

  return (
    <div>
      {/* 进度 */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <button
          onClick={onExit}
          style={{
            border: `1px solid ${C.bdr}`, background: "#fff", color: C.t2, borderRadius: 8,
            padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: FONT, flexShrink: 0,
          }}
        >
          ← 退出
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.t1, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              阅读复习
              <span style={{ fontWeight: 500, color: C.t3 }}>已答 {sess.answered} · 剩 {remaining}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.t2, background: "#f7faf9", border: "1px solid #ebf0ed", borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap" }}>
                本段 {sess.segment.length} / {SEGMENT_SIZE}
              </span>
              {sess.resumed && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "#087355", background: "#ECFDF5", border: "1px solid #D1FAE5", borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap" }}>
                  已从存档继续 · 第 {sess.segNo + 1} 段
                </span>
              )}
            </span>
            <span style={{ display: "flex", gap: 10, fontSize: 11, fontWeight: 700 }}>
              <span style={{ color: "#0d9668" }}>记得 {tally.good}</span>
              <span style={{ color: "#dc2626" }}>忘了 {tally.again}</span>
            </span>
          </div>
          <div style={{ height: 6, background: C.bdrSubtle, borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${Math.round(progress * 100)}%`, height: "100%", background: ACCENT, transition: "width .25s" }} />
          </div>
        </div>
      </div>

      {/* 卡片 */}
      <div
        onClick={() => {
          if (menuOpen) setMenuOpen(false);
          else if (!spellStage && !revealed && !editing) setRevealed(true);
        }}
        style={{
          ...reviewCardStyle,
          cursor: !spellStage && !revealed ? "pointer" : "default",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 11, fontWeight: 700, color: ACCENT, background: ACCENT_SOFT,
            border: "1px solid #a5e8f0", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap",
          }}>
            {dirMeta.label}
          </span>
          <span style={{ fontSize: 11, color: C.t3 }}>{dirMeta.tip}</span>
          {card.state === STATE.NEW && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "#087355", background: "#ECFDF5", border: "1px solid #D1FAE5", borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>
              新词
            </span>
          )}
          {timesSeen > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "#B45309", background: "#FFFBEB", border: "1px solid #f3d4a2", borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>
              再次出现 · 第 {timesSeen + 1} 次
            </span>
          )}
          {/* 来源不只是信息展示：情境线索本身就是有效的提取线索 */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: C.t3 }}>
              {sourceLabel(card)}
              {card.tag ? ` · ${card.tag}` : ""}
            </span>
            <button
              type="button"
              aria-label="更多操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(event) => { event.stopPropagation(); setMenuOpen((open) => !open); }}
              style={{
                width: 28, height: 28, display: "grid", placeItems: "center", padding: 0,
                border: `1px solid ${C.bdr}`, borderRadius: 7, background: "#fff", color: C.t2,
                fontSize: 17, lineHeight: 1, cursor: "pointer", fontFamily: FONT,
              }}
            >
              ⋯
            </button>
          </div>
        </div>

        {menuOpen && (
          <div
            role="menu"
            aria-label={`${card.display || card.word} 的操作`}
            onClick={(event) => event.stopPropagation()}
            style={{
              position: "absolute", top: 62, right: 20, zIndex: 5, width: 208, background: "#fff",
              border: `1px solid ${C.bdr}`, borderRadius: 10, boxShadow: "0 10px 30px rgba(15,23,42,0.14)", padding: 6,
            }}
          >
            <button
              type="button"
              role="switch"
              aria-checked={productiveOn}
              aria-label={`${card.display || card.word}需要会写`}
              onClick={toggleProductive}
              title={productiveOn ? "改为只需认得，下次出现时生效" : "改为要会写，下次出现时生效"}
              style={menuBtn}
            >
              要会写
              <span style={{ fontSize: 11, fontWeight: 700, color: productiveOn ? ACCENT : C.t3 }}>{productiveOn ? "开" : "关"}</span>
            </button>
            {onEditDefinition && <button type="button" role="menuitem" onClick={openEditor} style={menuBtn}>编辑释义</button>}
            {onSuspend && <button type="button" role="menuitem" onClick={suspendWord} style={menuBtn}>暂停复习这个词</button>}
            <div style={{ height: 1, background: C.bdrSubtle, margin: 4 }} />
            <div style={{ padding: "4px 10px 6px", fontSize: 10, color: C.t3, lineHeight: 1.5 }}>
              改动下次出现时生效，本次仍按当前题型计分。
            </div>
          </div>
        )}

        {productiveChangedForThisCard && (
          <div role="status" style={{ fontSize: 11, color: C.t2, marginBottom: 12 }}>
            已改为「{productiveOn ? "要会写" : "只需认得"}」，下次出现时生效；本次仍按当前题型计分。
          </div>
        )}
        {notice && <div style={{ fontSize: 11, color: C.t2, marginBottom: 12 }}>{notice}</div>}

        {editing && (
          <form
            onSubmit={saveEdit}
            onClick={(event) => event.stopPropagation()}
            style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: C.bg, border: `1px solid ${C.bdrSubtle}` }}
          >
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.t2, marginBottom: 6 }}>
              编辑释义
              <textarea
                aria-label="编辑释义"
                value={editText}
                disabled={aiGenerating}
                onChange={(event) => setEditText(event.target.value)}
                rows={2}
                maxLength={300}
                autoFocus
                style={{
                  display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, border: `1px solid ${C.bdr}`,
                  borderRadius: 8, padding: "8px 10px", fontSize: 14, color: C.t1, fontFamily: FONT, resize: "vertical",
                }}
              />
            </label>
            {editError && <p role="alert" style={{ margin: "0 0 8px", fontSize: 12, color: "#b91c1c" }}>{editError}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" onClick={generateDefinition} disabled={!canGenerateDefinition || aiGenerating}
                title={!shownSentence?.trim() ? "这个词没有原句语境" : tier !== "pro" && tier !== "legacy" ? "AI 释义需 Pro" : "根据当前原句生成短释义"}
                style={{ border: `1px solid ${ACCENT}`, background: "#fff", color: ACCENT, borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: canGenerateDefinition && !aiGenerating ? "pointer" : "default", opacity: canGenerateDefinition && !aiGenerating ? 1 : 0.5, fontFamily: FONT }}>
                {aiGenerating ? "AI 生成中…" : "AI 生成释义"}
              </button>
              <button type="button" onClick={closeEditor} style={{ border: `1px solid ${C.bdr}`, background: "#fff", color: C.t2, borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: FONT }}>取消</button>
              <button type="submit" disabled={!editText.trim() || aiGenerating} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 7, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: editText.trim() && !aiGenerating ? "pointer" : "default", opacity: editText.trim() && !aiGenerating ? 1 : 0.5, fontFamily: FONT }}>保存</button>
            </div>
          </form>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* ── 正面 ── */}
          {/* context：原句照抄、目标词高亮，问的是「它在这里什么意思」。
              正面刻意不给释义 —— 释义就是答案，给了这张卡就没有提取可言。 */}
          {!spellStage && mode === "context" && (
            <>
              <div style={{ fontSize: 17, color: C.t1, lineHeight: 2 }}>
                {highlight(context, card.word)}
              </div>
              <div style={{ marginTop: 14 }}>
                <WordLine card={card} size={22} />
              </div>
            </>
          )}

          {!spellStage && mode === "recognize" && <WordLine card={card} size={34} />}

          {/* 拼写步骤：认词选了「记得」才来。词和原句都收起来，只给释义 + 挖空句。 */}
          {spellStage && (
            <>
              <DefLine
                text={spellingDef}
                style={{ fontSize: 17, color: C.t1, lineHeight: 1.8, fontWeight: 600 }}
              />
              {cloze && (
                <div style={{ marginTop: 12, fontSize: inlineSpelling ? 16 : 13, color: C.t2, lineHeight: inlineSpelling ? 2.2 : 1.9, background: C.bg, borderRadius: 10, padding: inlineSpelling ? "10px 16px" : "9px 13px" }}>
                  {cloze.split(/(_+)/).map((part, i) => i % 2 === 1
                    ? (inlineSpelling && spellStage === "input"
                      ? (
                        <SpellingInput
                          key={i} inline word={answerWord} value={spelling} onChange={setSpelling}
                          onSubmit={checkSpelling} inputRef={spellingRef} ghost={lettersOf(card.word).charAt(0)}
                        />
                      )
                      : <span key={i} aria-label="空格" style={{ display: "inline-block", width: "2.4em", height: "0.9em", margin: "0 3px", borderBottom: `2px solid ${ACCENT}`, verticalAlign: "-0.1em" }} />)
                    : part)}
                </div>
              )}
              {retrying && spellStage === "input" && (
                <div style={{ marginTop: 16, fontSize: 13, color: ACCENT, fontWeight: 700 }}>
                  首字母提示：{card.word.trim().charAt(0)}
                </div>
              )}
              {spellStage === "input" && (
                <form onSubmit={checkSpelling} style={{ marginTop: retrying ? 12 : 20 }}>
                  {!inlineSpelling && (
                    <SpellingInput
                      word={answerWord}
                      value={spelling}
                      onChange={setSpelling}
                      inputRef={spellingRef}
                      ghost={lettersOf(card.word).charAt(0)}
                    />
                  )}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: C.t3 }}>
                      已填 <strong style={{ color: C.t2 }}>{[...spelling].length}</strong> / {[...lettersOf(card.word)].length} 个字母 · 回车核对
                    </span>
                    <button
                      type="submit"
                      disabled={!spelling}
                      style={{
                        border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 14,
                        fontWeight: 700, fontFamily: FONT, background: ACCENT, color: "#fff",
                        cursor: spelling ? "pointer" : "default", opacity: spelling ? 1 : 0.45,
                      }}
                    >
                      核对拼写
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {/* ── 背面 ── */}
          {(spellStage === "result" || (revealed && !spellStage)) && (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.bdrSubtle}` }}>
              {/* context 卡的正面已经有词、音标和整句了，背面只补那个缺的答案：释义。 */}
              {!spellStage && mode === "context" ? (
                <>
                  <DefLine
                    text={mainDef}
                    style={{ fontSize: 15, color: C.t1, lineHeight: 1.9, fontWeight: 600 }}
                  />
                  <DictPanel card={card} extra={extraEntry} mainDef={mainDef} />
                </>
              ) : (
                <>
                  {spellStage === "result" && (
                    <div role="status" style={{ fontSize: 13, fontWeight: 700, color: (retrying ? retryResult : spellingResult) === "correct" ? "#0d9668" : "#dc2626", marginBottom: 10 }}>
                      {retrying
                        ? retryResult === "correct" ? "这次拼对了，本次仍按没拼对计" : retryResult === "incorrect" ? `这次写的是 ${formatTyped(spelling, answerWord)}，正确拼写是：` : "这次没写出来，正确拼写是："
                        : spellingResult === "correct" ? "拼写正确" : spellingResult === "incorrect" ? `你写的是 ${formatTyped(spelling, answerWord)}，正确拼写是：` : "这次没写出来，正确拼写是："}
                    </div>
                  )}
                  {spellStage === "result" && (
                    <>
                      <SpellingAnswer word={answerWord} typed={spelling} result={retrying ? retryResult : spellingResult} />
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                        {card.phonetic && (
                          <span style={{ fontSize: 13, color: C.t3, fontFamily: "'Courier New', monospace" }}>/{card.phonetic}/</span>
                        )}
                        <SpeakButton word={card.display || card.word} size={28} />
                      </div>
                    </>
                  )}
                  {mainDef && (
                    <DefLine
                      text={mainDef}
                      style={{
                        fontSize: 14, color: C.t1, lineHeight: 1.9,
                        marginTop: spellStage === "result" ? 10 : 0,
                      }}
                    />
                  )}
                  <DictPanel card={card} extra={extraEntry} mainDef={mainDef} />
                  {shownSentence && (
                    <div style={{
                      marginTop: 12, fontSize: 13, color: C.t2, lineHeight: 1.9,
                      background: C.bg, borderRadius: 10, padding: "10px 14px",
                      borderLeft: `3px solid ${ACCENT}`,
                    }}>
                      {highlight(shownSentence, card.word)}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 操作区 —— 两个键，不显示下次间隔 */}
      <div style={{ marginTop: 16 }}>
        {spellStage === "input" ? (
          <button
            onClick={giveUpSpelling}
            style={{
              width: "100%", border: `1px solid ${C.bdr}`, background: "#fff", color: C.t2,
              borderRadius: 12, padding: "12px 0", fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: FONT,
            }}
          >
            想不起来，显示答案
          </button>
        ) : spellStage === "result" ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {spellingResult !== "correct" && (
              <button
                type="button"
                onClick={retrySpelling}
                style={{
                  flex: "1 1 160px", border: `1px solid ${ACCENT}`, background: "#fff", color: ACCENT,
                  borderRadius: 12, padding: "15px 10px", fontSize: 14, fontWeight: 700,
                  cursor: "pointer", fontFamily: FONT,
                }}
              >
                再拼一次（提示首字母）
              </button>
            )}
            <button
              onClick={() => grade(spellingResult === "correct" ? RATING.GOOD : RATING.AGAIN)}
              style={{
                flex: "1 1 220px", border: "none", background: ACCENT, color: "#fff",
                borderRadius: 12, padding: "15px 10px", fontSize: 15, fontWeight: 700,
                cursor: "pointer", fontFamily: FONT,
              }}
            >
              {spellingResult === "correct" ? "拼对了，下一词" : "没拼对，下一词"}
            </button>
          </div>
        ) : !revealed ? (
          <button
            onClick={() => setRevealed(true)}
            style={{
              width: "100%", border: "none", background: ACCENT, color: "#fff",
              borderRadius: 12, padding: "15px 0", fontSize: 15, fontWeight: 700,
              cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            显示答案 <span style={kbd("#fff", "rgba(255,255,255,.5)")}>空格</span>
          </button>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
            <button
              onClick={() => grade(RATING.AGAIN)}
              style={{
                border: "1px solid #fecaca", background: "#fef2f2", color: "#dc2626",
                borderRadius: 12, padding: "15px 4px", cursor: "pointer", fontFamily: FONT,
                fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              忘了 <span style={kbd("#dc2626", "#fecaca")}>1</span>
            </button>
            <button
              onClick={remember}
              style={{
                border: "1px solid #a7f3d0", background: "#ecfdf5", color: "#0d9668",
                borderRadius: 12, padding: "15px 4px", cursor: "pointer", fontFamily: FONT,
                fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {spellingOn ? "记得，去拼写" : "记得"} <span style={kbd("#0d9668", "#a7f3d0")}>2 / 空格</span>
            </button>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          {onUndo ? (
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              style={{
                border: 0, background: "none", padding: "4px 0", fontSize: 12, fontWeight: 700, fontFamily: FONT,
                color: canUndo ? C.t2 : "#c5cfc9", cursor: canUndo ? "pointer" : "default",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              ↶ 撤销上一张
              <span style={{ fontSize: 10, fontWeight: 700, border: `1px solid ${C.bdr}`, borderRadius: 4, padding: "0 5px", lineHeight: "16px", color: C.t3 }}>Z</span>
            </button>
          ) : <span />}
          <span style={{ fontSize: 11, color: C.t3, lineHeight: 1.7, textAlign: "right", flex: 1, minWidth: 240 }}>
            {spellStage === "result"
              ? retrying ? "再拼一次只作巩固，本次仍按首次拼写结果排期。" : "拼对才算记得；拼错或想不起来算没记住，要再累计答对 3 次才过。"
              : spellStage === "input"
                ? retrying ? "根据首字母提示，再写一次完整单词。" : "这个词要会写：写出完整拼写再核对；不会写也可以显示答案。"
              : revealed
                ? spellingOn ? "按你刚才想起来的情况选；选「记得」后还要写出拼写，拼对才算。" : "按你刚才「想起来的难易」评，不是按「想隔多久再见到它」。"
                : "先在心里说出它的意思再翻面 —— 想不起来的那几秒，才是真正在记东西。"}
          </span>
        </div>
      </div>

      {sess.checkpoint && (
        <SegmentCheckpoint
          segNo={sess.segNo}
          rows={segmentRows}
          good={sess.segment.filter((g) => g.good).length}
          again={sess.segment.filter((g) => !g.good).length}
          durationMs={segDurMs}
          saved={!!onCheckpoint}
          onContinue={continueSegment}
          onPause={onExit}
        />
      )}
    </div>
  );
}
