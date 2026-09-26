"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FONT } from "../shared/ui";
import { RATING } from "../../lib/vocab/srs";
import { activeSentence, cardDirection, clozeSentence, contextSentence, needsDictFill, sourceLabel } from "../../lib/vocab/book";
import { SpeakButton } from "../shared/SpeakButton";
import { DefLine, DictSenses } from "../shared/DictSenses";
import { parseSenses } from "../../lib/dict/core";
import { lookupWord } from "../../lib/dict/lookup";
import { adoptDictEntry } from "../../lib/vocab/vocabStore";

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

/** 同一场里多久之内到期的卡要回到队尾再考一次（学习步骤就在这个窗口内）。 */
const SESSION_WINDOW_MS = 30 * 60 * 1000;
/** 重新插队至少隔这么多张 —— 刚看完答案立刻再问，考的是短时记忆，不是记忆。 */
const REINSERT_GAP = 10;
/** 一个词在一场里最多出现几次（学习步两步 = 首日 3 次提取，留一次余量给答错重来）。 */
const MAX_APPEARANCES = 4;

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
function DictPanel({ card, extra }) {
  const filling = needsDictFill(card) && !!extra && !!extra.t;
  // 释义讲的是原形（varying → vary）时必须说清楚，否则用户会以为
  // 这些词性和音标属于卡面上那个词形。
  const lemma = filling
    ? (extra.word && extra.word !== card.word ? { word: extra.word, p: extra.p } : null)
    : (card.lemma ? { word: card.lemma, p: "" } : null);
  // 卡上那条整释义和主释义一字不差时就别重复摆一遍了
  const body = filling ? extra.t : (card.defFull && card.defFull !== card.def ? card.defFull : "");
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

export function VocabReview({ initialQueue, onGrade, onSetProductive, onExit }) {
  const [queue, setQueue] = useState(() => initialQueue || []);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [spelling, setSpelling] = useState("");
  const [spellingResult, setSpellingResult] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState(null);
  // 当前题型/已做出的拼写结果保持不变；逐词设置在下次出现时生效。
  const [productiveOverrides, setProductiveOverrides] = useState({});
  const [tally, setTally] = useState({ again: 0, good: 0 });
  // 队列在本场内是活的（答错的卡会回插），进度条分母用「初始张数」会跳；
  // 用已答次数 /（已答 + 剩余）才稳。
  const [answered, setAnswered] = useState(0);
  // 每个词在这一场里已经出现了几次
  const seenRef = useRef(new Map());
  // 这张卡是什么时候显示出来的 —— 存进日志，留给以后用反应时间做隐式分档
  const shownAtRef = useRef(Date.now());
  const spellingRef = useRef(null);
  // 卡上释义太薄时现查到的词条（见 needsDictFill）。只查当前这一张：
  // 一个分片一百多 KB，把整队列的首字母都预热一遍在移动网络上不划算，
  // 而真正需要补的卡是少数（绝大多数卡是从义项 chips 点着收藏的，词性本来就全）。
  const [extra, setExtra] = useState(null);

  const card = queue[pos] || null;
  // context 卡正面用「保留目标词的原句」，recall 卡正面用「挖了空的原句」。
  const context = useMemo(() => (card ? contextSentence(card) : null), [card]);
  const cloze = useMemo(() => (card ? clozeSentence(card) : null), [card]);
  // 背面高亮的例句要和正面用的是同一句（池里轮到第二句时不能翻面又跳回主句）。
  const shownSentence = useMemo(() => (card ? activeSentence(card) || card.sentence : ""), [card]);
  const mode = useMemo(() => (card ? cardDirection(card) : "recognize"), [card]);
  const productiveOn = card
    ? (productiveOverrides[card.word] ?? (card.productive !== false))
    : true;
  const productiveChangedForThisCard = card && productiveOn !== (card.productive !== false);

  const finished = pos >= queue.length;
  const remaining = Math.max(0, queue.length - pos);

  useEffect(() => {
    shownAtRef.current = Date.now();
  }, [pos]);

  useEffect(() => {
    if (mode === "recall" && !revealed) spellingRef.current?.focus();
  }, [pos, mode, revealed]);

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
    if (!card || !onSetProductive) return;
    const updated = onSetProductive(card.word, !productiveOn);
    if (updated) {
      setProductiveOverrides((prev) => ({ ...prev, [card.word]: updated.productive !== false }));
    }
  }, [card, onSetProductive, productiveOn]);

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
        if (alive) setExtra(e);
        // 顺手写回卡片：这张卡的主释义本来就是「词典整条」（用户没点过义项），
        // 换成查得到的那一条才是它该有的样子。写回之后列表页、别的设备、
        // 下一次复习都不用再查（needsDictFill 从此为 false）。
        // 卸载了也照写 —— 修复本身是对的，不该因为用户正好翻页就丢掉。
        adoptDictEntry(fillWord, e);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fillWord]);

  const grade = useCallback(
    (rating) => {
      if (!card) return;
      const updated = onGrade(card.word, rating, Date.now() - shownAtRef.current);
      setTally((t) => ({
        again: t.again + (rating === RATING.AGAIN ? 1 : 0),
        good: t.good + (rating === RATING.AGAIN ? 0 : 1),
      }));
      setAnswered((n) => n + 1);

      const seen = seenRef.current;
      const times = (seen.get(card.word) || 0) + 1;
      seen.set(card.word, times);

      setQueue((q) => {
        if (!updated || times >= MAX_APPEARANCES) return q;
        const dueIn = new Date(updated.due).getTime() - Date.now();
        if (dueIn > SESSION_WINDOW_MS) return q;
        const next = [...q];
        next.splice(Math.min(next.length, pos + 1 + REINSERT_GAP), 0, updated);
        return next;
      });
      setRevealed(false);
      setSpelling("");
      setSpellingResult(null);
      setRetrying(false);
      setRetryResult(null);
      setPos((p) => p + 1);
    },
    [card, onGrade, pos],
  );

  // 认词卡沿用翻面自评；拼写卡必须先输入或明确选择「想不起来」。
  const gradeRef = useRef(grade);
  gradeRef.current = grade;
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const spellingResultRef = useRef(spellingResult);
  spellingResultRef.current = spellingResult;
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) return;
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
    const total = tally.again + tally.good;
    const words = seenRef.current.size;
    return (
      <div style={{ textAlign: "center", padding: "48px 20px" }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>🌿</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.t1, marginBottom: 6 }}>今天的词过完了</div>
        <div style={{ fontSize: 13, color: C.t2, marginBottom: 22 }}>
          过了 {words} 个词，共 {total} 次提问
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 24 }}>
          <div style={{ padding: "10px 20px", borderRadius: 10, background: "#ecfdf5", border: "1px solid #a7f3d0" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0d9668" }}>{tally.good}</div>
            <div style={{ fontSize: 11, color: C.t2, marginTop: 2 }}>记得</div>
          </div>
          <div style={{ padding: "10px 20px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#dc2626" }}>{tally.again}</div>
            <div style={{ fontSize: 11, color: C.t2, marginTop: 2 }}>忘了</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.t3, lineHeight: 1.8, maxWidth: 420, margin: "0 auto 22px" }}>
          今天学的新词，明天会再出现一次 —— 中间隔一觉，同样的练习量能记得更久。
          <br />
          别回头再刷一遍，那只会制造「我记住了」的错觉。
        </div>
        <button
          onClick={onExit}
          style={{
            border: "none", background: ACCENT, color: "#fff", borderRadius: 10,
            padding: "10px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
          }}
        >
          返回单词本
        </button>
      </div>
    );
  }

  if (!card) return null;

  const dirMeta = DIRECTION_META[mode] || DIRECTION_META.recognize;
  const progress = answered + remaining > 0 ? answered / (answered + remaining) : 0;

  return (
    <div>
      {/* 进度 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button
          onClick={onExit}
          style={{
            border: `1px solid ${C.bdr}`, background: "#fff", color: C.t2, borderRadius: 8,
            padding: "5px 12px", fontSize: 12, cursor: "pointer", fontFamily: FONT, flexShrink: 0,
          }}
        >
          ← 退出
        </button>
        <div style={{ flex: 1, minWidth: 0, height: 6, background: C.bdrSubtle, borderRadius: 999, overflow: "hidden" }}>
          <div style={{ width: `${Math.round(progress * 100)}%`, height: "100%", background: ACCENT, transition: "width .25s" }} />
        </div>
        <div style={{ fontSize: 12, color: C.t2, fontWeight: 700, flexShrink: 0 }}>剩 {remaining}</div>
      </div>

      {/* 卡片 */}
      <div
        onClick={() => mode !== "recall" && !revealed && setRevealed(true)}
        style={{
          background: "#fff", border: `1px solid ${C.bdr}`, borderRadius: 16,
          boxShadow: C.shadow, padding: "28px 24px", minHeight: 250,
          display: "flex", flexDirection: "column",
          cursor: mode !== "recall" && !revealed ? "pointer" : "default",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 11, fontWeight: 700, color: ACCENT, background: ACCENT_SOFT,
            border: "1px solid #a5e8f0", borderRadius: 999, padding: "2px 9px",
          }}>
            {dirMeta.label}
          </span>
          <span style={{ fontSize: 11, color: C.t3 }}>{dirMeta.tip}</span>
          {/* 来源不只是信息展示：情境线索本身就是有效的提取线索 */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: C.t3 }}>
              {sourceLabel(card)}
              {card.tag ? ` · ${card.tag}` : ""}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={productiveOn}
              aria-label={`${card.display || card.word}需要会写`}
              onClick={toggleProductive}
              title={productiveOn ? "改为只需认得，下次出现时生效" : "改为要会写，下次出现时生效"}
              style={{
                border: `1px solid ${productiveOn ? ACCENT : C.bdr}`,
                background: productiveOn ? ACCENT_SOFT : "#fff",
                color: productiveOn ? ACCENT : C.t2,
                borderRadius: 7, padding: "4px 9px", fontSize: 11,
                cursor: "pointer", fontFamily: FONT, fontWeight: 700,
              }}
            >
              {productiveOn ? "要会写" : "只需认得"}
            </button>
          </div>
        </div>

        {productiveChangedForThisCard && (
          <div role="status" style={{ fontSize: 11, color: C.t2, marginBottom: 12 }}>
            已改为「{productiveOn ? "要会写" : "只需认得"}」，下次出现时生效；本次仍按当前题型计分。
          </div>
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
                text={card.def}
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
                    text={card.def}
                    style={{ fontSize: 15, color: C.t1, lineHeight: 1.9, fontWeight: 600 }}
                  />
                  <DictPanel card={card} extra={extra} />
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
                  {card.def && (
                    <DefLine
                      text={card.def}
                      style={{
                        fontSize: 14, color: C.t1, lineHeight: 1.9,
                        marginTop: mode === "recognize" ? 0 : 10,
                      }}
                    />
                  )}
                  <DictPanel card={card} extra={extra} />
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
              cursor: "pointer", fontFamily: FONT,
            }}
          >
            显示答案 <span style={{ opacity: 0.7, fontWeight: 500, fontSize: 12 }}>（空格）</span>
          </button>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
            <button
              onClick={() => grade(RATING.AGAIN)}
              style={{
                border: "1px solid #fecaca", background: "#fef2f2", color: "#dc2626",
                borderRadius: 12, padding: "15px 4px", cursor: "pointer", fontFamily: FONT,
                fontSize: 16, fontWeight: 800,
              }}
            >
              忘了 <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.7 }}>1</span>
            </button>
            <button
              onClick={() => grade(RATING.GOOD)}
              style={{
                border: "1px solid #a7f3d0", background: "#ecfdf5", color: "#0d9668",
                borderRadius: 12, padding: "15px 4px", cursor: "pointer", fontFamily: FONT,
                fontSize: 16, fontWeight: 800,
              }}
            >
              记得 <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.7 }}>2 / 空格</span>
            </button>
          </div>
        )}
        <div style={{ fontSize: 11, color: C.t3, textAlign: "center", marginTop: 10, lineHeight: 1.7 }}>
          {mode === "recall"
            ? revealed
              ? retrying ? "再拼一次只作巩固，本次仍按首次拼写结果排期。" : "拼对算记得；拼错或想不起来算忘了。"
              : retrying ? "根据首字母提示，再写一次完整单词。" : "先写出完整单词再核对；不会写时也可以显示答案。"
            : revealed
              ? "按你刚才「想起来的难易」评，不是按「想隔多久再见到它」。"
              : "先在心里说出它的意思再翻面 —— 想不起来的那几秒，才是真正在记东西。"}
        </div>
      </div>
    </div>
  );
}
