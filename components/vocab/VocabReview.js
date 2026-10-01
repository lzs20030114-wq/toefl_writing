"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, FONT } from "../shared/ui";
import { RATING, STATE } from "../../lib/vocab/srs";
import { activeSentence, definitionForContext, cardDirection, clozeSentence, contextSentence, needsDictFill, sourceLabel } from "../../lib/vocab/book";
import { SpeakButton } from "../shared/SpeakButton";
import { DefLine, DictSenses } from "../shared/DictSenses";
import { hasUsableSense, humanizeDef, parseSenses } from "../../lib/dict/core";
import { lookupWord } from "../../lib/dict/lookup";
import { adoptDictEntry, getCard, getVocabAccountKey } from "../../lib/vocab/vocabStore";
import { reinsertAfterGap } from "../../lib/vocab/reinsert";
import { SESSION_WINDOW_MS } from "../../lib/vocab/reviewSave";
import ReviewSummary from "./ReviewSummary";

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
 *     进入 review 后的产出卡要求输入拼写，核对后按实际结果评分。
 *  3. 只有两个评分键：忘了 / 记得。Anki 官方 FAQ：FSRS 对「主要用 Again/Good」
 *     的用户预测更准；而「忘了却按 Hard」是官方点名唯一会毁掉排期的习惯。
 *     四档的信息增益小于它引入的自评噪声，对我们这种顺手收藏进来的普通用户尤其如此。
 *  4. 不显示下次间隔。看见间隔，用户就会用「我想多久再看到它」而不是
 *     「我记得多牢」来评分。
 *  5. 新词和忘掉的词首日隔开提取 3 次（学习步两步），一场里同一个词最多出现
 *     4 次，且中间至少隔 10 张。连刷是集中练习，制造的是流畅性错觉而不是记忆
 *     （Kornell 2009）；隔开的多次提取才有效，同场隔开提取 5–7 次显著优于
 *     1–3 次（Nakata 2017），而答对 3 次是性价比最高的那个门槛
 *     （Rawson & Dunlosky 2011）。
 */

const ACCENT = "#0891B2";
const ACCENT_SOFT = "#ECFEFF";

/** 重新插队至少隔这么多张 —— 刚看完答案立刻再问，考的是短时记忆，不是记忆。 */
const REINSERT_GAP = 10;
/** 一个词在一场里最多出现几次（学习步两步 = 首日 3 次提取，留一次余量给答错重来）。 */
const MAX_APPEARANCES = 4;
/** 每过这么多个词停一下：落一次存档、给一份小结，也给人一个自然的休息点。 */
const SEGMENT_SIZE = 10;

const DIRECTION_META = {
  context: { label: "认词", tip: "这个词在这句里是什么意思" },
  recognize: { label: "认词", tip: "这个词什么意思" },
  recall: { label: "拼写", tip: "这个意思用英文怎么说" },
};

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


const fmtDuration = (ms) => {
  const total = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(total / 60)} 分 ${String(total % 60).padStart(2, "0")} 秒`;
};
/** 列表/小结里给这个词配一行释义（优先「在原句里的那条」）。 */
const senseOf = (card) => humanizeDef(definitionForContext(card, activeSentence(card) || "") || card?.def || card?.defFull || "");
const pickStats = (stats) => (stats ? { knowledge: stats.knowledge || 0, mature: stats.mature || 0, learning: stats.learning || 0 } : null);

const kbd = (color, border) => ({
  fontSize: 11, fontWeight: 700, border: `1px solid ${border}`, borderRadius: 5,
  padding: "0 6px", lineHeight: "18px", color, background: "transparent",
});
const menuBtn = {
  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  padding: "8px 10px", borderRadius: 7, border: "none", background: "transparent", cursor: "pointer",
  fontSize: 13, fontWeight: 600, color: C.t1, fontFamily: FONT, textAlign: "left",
};

/** 每过完一段（10 个词）弹出的小结：这一段每个词记没记得、用了多久，可以休息退出，也可以继续。 */
function SegmentCheckpoint({ segNo, rows, good, again, durationMs, saved, onContinue, onPause }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: FONT,
    }}>
      <div role="dialog" aria-modal="true" aria-label={`第 ${segNo} 段复习完成`} style={{
        width: 560, maxWidth: "100%", maxHeight: "calc(100vh - 48px)", display: "flex", flexDirection: "column",
        background: "#fff", borderRadius: 16, boxShadow: "0 10px 40px rgba(0,0,0,0.12)", overflow: "hidden",
      }}>
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid #ebf0ed" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 10, letterSpacing: 0.3, color: C.t3, fontWeight: 700, whiteSpace: "nowrap" }}>第 {segNo} 段</span>
            {saved && (
              <span style={{ fontSize: 10, fontWeight: 700, color: "#087355", background: "#ECFDF5", border: "1px solid #D1FAE5", borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" }}>
                ✓ 已存档
              </span>
            )}
          </div>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.3, color: C.t1 }}>这 {SEGMENT_SIZE} 个词过完了</div>
          <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 12, color: C.t2, flexWrap: "wrap" }}>
            <span>本段用时 {fmtDuration(durationMs)}</span>
            <span style={{ color: "#0d9668", fontWeight: 700 }}>记得 {good}</span>
            <span style={{ color: "#dc2626", fontWeight: 700 }}>忘了 {again}</span>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {rows.map((r, i) => (
            <div key={`${r.word}-${i}`} style={{
              display: "grid", gridTemplateColumns: "minmax(0, .9fr) minmax(0, 1.3fr) auto", alignItems: "center",
              gap: 12, padding: "10px 24px", borderBottom: "1px solid #ebf0ed",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14, color: C.t1, overflowWrap: "anywhere" }}>{r.display}</strong>
                {r.n > 1 && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#B45309", background: "#FFFBEB", borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap" }}>
                    第 {r.n} 次
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: C.t2, lineHeight: 1.5, minWidth: 0, overflowWrap: "anywhere" }}>{r.sense}</div>
              <span style={{
                fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap",
                color: r.good ? "#0d9668" : "#dc2626", background: r.good ? "#ecfdf5" : "#fef2f2",
                border: `1px solid ${r.good ? "#a7f3d0" : "#fecaca"}`,
              }}>
                {r.good ? "记得" : "忘了"}
              </span>
            </div>
          ))}
        </div>
        <div style={{ padding: "14px 24px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 11, color: C.t3, lineHeight: 1.6 }}>
            忘了的词已排到后面，隔一会儿再考一次。
            {saved ? "现在退出也没关系，下次会从这个存档点接着复习。" : "现在退出也没关系，已评分的词都已计入进度。"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: 10 }}>
            <button type="button" onClick={onPause} style={{
              border: "1px solid #dde5df", background: "#fff", color: C.t2, borderRadius: 10, padding: "12px 0",
              fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
            }}>先休息，退出</button>
            <button type="button" autoFocus onClick={onContinue} style={{
              border: "none", background: ACCENT, color: "#fff", borderRadius: 10, padding: "12px 0", fontSize: 14,
              fontWeight: 700, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              继续下一段 <span style={kbd("#fff", "rgba(255,255,255,.5)")}>空格</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
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
  // context 卡正面用「保留目标词的原句」，recall 卡正面用「挖了空的原句」。
  const context = useMemo(() => (card ? contextSentence(card) : null), [card]);
  const cloze = useMemo(() => (card ? clozeSentence(card) : null), [card]);
  // 背面高亮的例句要和正面用的是同一句（池里轮到第二句时不能翻面又跳回主句）。
  const shownSentence = useMemo(() => (card ? activeSentence(card) || card.sentence : ""), [card]);
  const mode = useMemo(() => (card ? cardDirection(card) : "recognize"), [card]);
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
    setMenuOpen(false);
    setEditing(false);
    setEditError("");
  }, [pos, card?.word]);

  // 存档小结开着时不能抢焦点：下一张若是拼写卡，输入框一聚焦，空格就打进了它背后的输入框，
  // 小结的「继续」按钮永远等不到键盘。小结关掉后依赖变化，焦点再回到输入框。
  useEffect(() => {
    if (mode === "recall" && !revealed && !sess.checkpoint) spellingRef.current?.focus();
  }, [pos, mode, revealed, sess.checkpoint]);

  const checkSpelling = useCallback((e) => {
    e.preventDefault();
    if (!card || !spelling.trim() || revealed) return;
    const normalize = (value) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    const result = normalize(spelling) === normalize(card.word) ? "correct" : "incorrect";
    if (retrying) setRetryResult(result);
    else setSpellingResult(result);
    setRevealed(true);
  }, [card, spelling, revealed, retrying]);

  const retrySpelling = useCallback(() => {
    setRetrying(true);
    setRetryResult(null);
    setSpelling("");
    setRevealed(false);
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
    // 认词卡摆回「已翻面」，方便直接重新选；拼写卡得重新拼，不能带着旧结果
    resetFace(cardDirection(prevCard) !== "recall");
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
    setEditText(mainDef || card?.def || "");
    setEditError("");
    setEditing(true);
    setMenuOpen(false);
  }, [card, mainDef]);

  const saveEdit = useCallback((e) => {
    e.preventDefault();
    if (!card || !onEditDefinition || getVocabAccountKey() !== accountKey) return;
    try {
      const updated = onEditDefinition(card.word, editText);
      if (!updated) { setEditError("没能保存：这个词可能已被移除。"); return; }
      const patch = {
        def: updated.def, defFull: updated.defFull, baseDef: updated.baseDef, contextSenses: updated.contextSenses,
        definitionLocked: updated.definitionLocked, definitionUpdatedAt: updated.definitionUpdatedAt,
        contextSenseResetAt: updated.contextSenseResetAt,
      };
      setSess((s) => ({ ...s, queue: s.queue.map((c) => (c.word === card.word ? { ...c, ...patch } : c)) }));
      setEditing(false);
      setEditError("");
    } catch (error) {
      setEditError(error?.message || "没能保存，请稍后重试。");
    }
  }, [accountKey, card, editText, onEditDefinition]);

  // 认词卡沿用翻面自评；拼写卡必须先输入或明确选择「想不起来」。
  const gradeRef = useRef(grade);
  gradeRef.current = grade;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const continueRef = useRef(continueSegment);
  continueRef.current = continueSegment;
  const checkpointRef = useRef(sess.checkpoint);
  checkpointRef.current = sess.checkpoint;
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const spellingResultRef = useRef(spellingResult);
  spellingResultRef.current = spellingResult;
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { setMenuOpen(false); return; }
      if (checkpointRef.current) {
        if (e.key === " " || e.key === "Enter") { e.preventDefault(); continueRef.current(); }
        return;
      }
      if (e.key === "z" || e.key === "Z") { e.preventDefault(); undoRef.current(); return; }
      if (modeRef.current === "recall") {
        if (revealedRef.current && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          gradeRef.current(spellingResultRef.current === "correct" ? RATING.GOOD : RATING.AGAIN);
        }
        return;
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!revealedRef.current) setRevealed(true);
        else gradeRef.current(RATING.GOOD);
        return;
      }
      if (!revealedRef.current) return;
      if (e.key === "1") {
        e.preventDefault();
        gradeRef.current(RATING.AGAIN);
      } else if (e.key === "2") {
        e.preventDefault();
        gradeRef.current(RATING.GOOD);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (finished) {
    const words = Object.keys(sess.first).length;
    const firstGood = Object.values(sess.first).filter(Boolean).length;
    const lost = sess.lost.map((word) => {
      const info = infoRef.current.get(word) || getCard(word);
      return info ? { word, display: info.display || info.word, sense: senseOf(info) } : null;
    }).filter(Boolean);
    const change = (label, from, to, tone) => {
      const d = to - from;
      return { label, from, to, delta: d === 0 ? "±0" : d > 0 ? `+${d}` : `${d}`, color: d === 0 ? C.t3 : tone };
    };
    const changes = startStats && statsNow ? [
      change("预计记得", startStats.knowledge, statsNow.knowledge || 0, "#0d9668"),
      change("已记牢", startStats.mature, statsNow.mature || 0, "#0d9668"),
      change("学习中", startStats.learning, statsNow.learning || 0, ACCENT),
    ] : null;
    const summary = {
      duration: fmtDuration((sess.endedAt || Date.now()) - startedAtRef.current),
      words, asks: tally.good + tally.again, good: tally.good, again: tally.again,
      firstGood, firstRate: words ? Math.round((firstGood / words) * 100) : 0, lost, changes,
    };
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

  const dirMeta = DIRECTION_META[mode] || DIRECTION_META.recognize;
  const progress = sess.answered + remaining > 0 ? sess.answered / (sess.answered + remaining) : 0;
  const segmentRows = sess.segment.map((g) => {
    const info = infoRef.current.get(g.word);
    return { ...g, display: info?.display || g.word, sense: info ? senseOf(info) : "" };
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
          else if (mode !== "recall" && !revealed && !editing) setRevealed(true);
        }}
        style={{
          position: "relative", background: "#fff", border: `1px solid ${C.bdr}`, borderRadius: 16,
          boxShadow: C.shadow, padding: "28px 24px", minHeight: 250,
          display: "flex", flexDirection: "column",
          cursor: mode !== "recall" && !revealed ? "pointer" : "default",
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
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => { setEditing(false); setEditError(""); }} style={{ border: `1px solid ${C.bdr}`, background: "#fff", color: C.t2, borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: FONT }}>取消</button>
              <button type="submit" disabled={!editText.trim()} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 7, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: editText.trim() ? "pointer" : "default", opacity: editText.trim() ? 1 : 0.5, fontFamily: FONT }}>保存</button>
            </div>
          </form>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* ── 正面 ── */}
          {/* context：原句照抄、目标词高亮，问的是「它在这里什么意思」。
              正面刻意不给释义 —— 释义就是答案，给了这张卡就没有提取可言。 */}
          {mode === "context" && (
            <>
              <div style={{ fontSize: 17, color: C.t1, lineHeight: 2 }}>
                {highlight(context, card.word)}
              </div>
              <div style={{ marginTop: 14 }}>
                <WordLine card={card} size={22} />
              </div>
            </>
          )}

          {mode === "recognize" && <WordLine card={card} size={34} />}

          {mode === "recall" && (
            <>
              <DefLine
                text={spellingDef}
                style={{ fontSize: 17, color: C.t1, lineHeight: 1.8, fontWeight: 600 }}
              />
              {cloze && (
                <div style={{ marginTop: 12, fontSize: 13, color: C.t2, lineHeight: 1.9, background: C.bg, borderRadius: 8, padding: "9px 13px" }}>
                  {cloze.split(/(_+)/).map((part, i) => i % 2 === 1
                    ? <span key={i} style={{ letterSpacing: 2, fontFamily: "monospace" }}>{card.word.trim().charAt(0)}{part.slice(1)}</span>
                    : part)}
                </div>
              )}
              {retrying && !revealed && (
                <div style={{ marginTop: 16, fontSize: 13, color: ACCENT, fontWeight: 700 }}>
                  首字母提示：{card.word.trim().charAt(0)}
                </div>
              )}
              {!revealed && (
                <form onSubmit={checkSpelling} style={{ display: "flex", gap: 8, marginTop: retrying ? 10 : 18, flexWrap: "wrap" }}>
                  <input
                    ref={spellingRef}
                    aria-label="拼写英文单词"
                    value={spelling}
                    onChange={(e) => setSpelling(e.target.value)}
                    placeholder="在这里输入完整拼写"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={100}
                    style={{
                      flex: "1 1 220px", minWidth: 0, boxSizing: "border-box",
                      border: `1px solid ${C.bdr}`, borderRadius: 10, padding: "11px 13px",
                      fontSize: 16, color: C.t1, fontFamily: FONT,
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!spelling.trim()}
                    style={{
                      border: "none", borderRadius: 10, padding: "11px 18px", fontSize: 14,
                      fontWeight: 700, fontFamily: FONT, background: ACCENT, color: "#fff",
                      cursor: spelling.trim() ? "pointer" : "default", opacity: spelling.trim() ? 1 : 0.5,
                    }}
                  >
                    核对拼写
                  </button>
                </form>
              )}
            </>
          )}

          {/* ── 背面 ── */}
          {revealed && (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.bdrSubtle}` }}>
              {/* context 卡的正面已经有词、音标和整句了，背面只补那个缺的答案：释义。 */}
              {mode === "context" ? (
                <>
                  <DefLine
                    text={mainDef}
                    style={{ fontSize: 15, color: C.t1, lineHeight: 1.9, fontWeight: 600 }}
                  />
                  <DictPanel card={card} extra={extraEntry} mainDef={mainDef} />
                </>
              ) : (
                <>
                  {mode === "recall" && (
                    <div role="status" style={{ fontSize: 13, fontWeight: 700, color: (retrying ? retryResult : spellingResult) === "correct" ? "#0d9668" : "#dc2626", marginBottom: 10 }}>
                      {retrying
                        ? retryResult === "correct" ? "这次拼对了，首次结果仍按忘了计" : retryResult === "incorrect" ? `这次写的是 ${spelling}，正确拼写是：` : "这次没写出来，正确拼写是："
                        : spellingResult === "correct" ? "拼写正确" : spellingResult === "incorrect" ? `你写的是 ${spelling}，正确拼写是：` : "这次没写出来，正确拼写是："}
                    </div>
                  )}
                  {mode !== "recognize" && <WordLine card={card} size={28} />}
                  {mainDef && (
                    <DefLine
                      text={mainDef}
                      style={{
                        fontSize: 14, color: C.t1, lineHeight: 1.9,
                        marginTop: mode === "recognize" ? 0 : 10,
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
        {mode === "recall" && !revealed ? (
          <button
            onClick={() => { if (retrying) setRetryResult("skipped"); else setSpellingResult("skipped"); setRevealed(true); }}
            style={{
              width: "100%", border: `1px solid ${C.bdr}`, background: "#fff", color: C.t2,
              borderRadius: 12, padding: "12px 0", fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: FONT,
            }}
          >
            想不起来，显示答案
          </button>
        ) : mode === "recall" ? (
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
              {spellingResult === "correct" ? "记得，下一词" : "忘了，下一词"}
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
              onClick={() => grade(RATING.GOOD)}
              style={{
                border: "1px solid #a7f3d0", background: "#ecfdf5", color: "#0d9668",
                borderRadius: 12, padding: "15px 4px", cursor: "pointer", fontFamily: FONT,
                fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              记得 <span style={kbd("#0d9668", "#a7f3d0")}>2 / 空格</span>
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
            {mode === "recall"
              ? revealed
                ? retrying ? "再拼一次只作巩固，本次仍按首次拼写结果排期。" : "拼对算记得；拼错或想不起来算忘了。"
                : retrying ? "根据首字母提示，再写一次完整单词。" : "先写出完整单词再核对；不会写时也可以显示答案。"
              : revealed
                ? "按你刚才「想起来的难易」评，不是按「想隔多久再见到它」。"
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
