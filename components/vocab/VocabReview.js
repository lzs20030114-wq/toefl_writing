"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FONT } from "../shared/ui";
import { RATING } from "../../lib/vocab/srs";
import { cardDirection, clozeSentence, contextSentence, sourceLabel } from "../../lib/vocab/book";
import { SpeakButton } from "../shared/SpeakButton";

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

export function VocabReview({ initialQueue, onGrade, onExit }) {
  const [queue, setQueue] = useState(() => initialQueue || []);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [tally, setTally] = useState({ again: 0, good: 0 });
  // 队列在本场内是活的（答错的卡会回插），进度条分母用「初始张数」会跳；
  // 用已答次数 /（已答 + 剩余）才稳。
  const [answered, setAnswered] = useState(0);
  // 每个词在这一场里已经出现了几次
  const seenRef = useRef(new Map());
  // 这张卡是什么时候显示出来的 —— 存进日志，留给以后用反应时间做隐式分档
  const shownAtRef = useRef(Date.now());

  const card = queue[pos] || null;
  // context 卡正面用「保留目标词的原句」，recall 卡正面用「挖了空的原句」。
  const context = useMemo(() => (card ? contextSentence(card) : null), [card]);
  const cloze = useMemo(() => (card ? clozeSentence(card) : null), [card]);
  const mode = useMemo(() => (card ? cardDirection(card) : "recognize"), [card]);

  const finished = pos >= queue.length;
  const remaining = Math.max(0, queue.length - pos);

  useEffect(() => {
    shownAtRef.current = Date.now();
  }, [pos]);

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
      setPos((p) => p + 1);
    },
    [card, onGrade, pos],
  );

  // 键盘：空格先翻面，翻完再按空格 = 记得；1 = 忘了，2 = 记得。
  const gradeRef = useRef(grade);
  gradeRef.current = grade;
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
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
        onClick={() => !revealed && setRevealed(true)}
        style={{
          background: "#fff", border: `1px solid ${C.bdr}`, borderRadius: 16,
          boxShadow: C.shadow, padding: "28px 24px", minHeight: 250,
          display: "flex", flexDirection: "column",
          cursor: revealed ? "default" : "pointer",
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
          <span style={{ fontSize: 10, color: C.t3, marginLeft: "auto" }}>
            {sourceLabel(card)}
            {card.tag ? ` · ${card.tag}` : ""}
          </span>
        </div>

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
              <div style={{ fontSize: 17, color: C.t1, lineHeight: 1.8, whiteSpace: "pre-wrap", fontWeight: 600 }}>
                {card.def || "（这个词收藏时没有释义）"}
              </div>
              {cloze && (
                <div style={{ marginTop: 12, fontSize: 13, color: C.t2, lineHeight: 1.9, background: C.bg, borderRadius: 8, padding: "9px 13px" }}>
                  {cloze}
                </div>
              )}
            </>
          )}

          {/* ── 背面 ── */}
          {revealed && (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.bdrSubtle}` }}>
              {/* context 卡的正面已经有词、音标和整句了，背面只补那个缺的答案：释义。 */}
              {mode === "context" ? (
                <div style={{ fontSize: 15, color: C.t1, lineHeight: 1.9, whiteSpace: "pre-wrap", fontWeight: 600 }}>
                  {card.def || "（这个词收藏时没有释义）"}
                </div>
              ) : (
                <>
                  {mode !== "recognize" && <WordLine card={card} size={28} />}
                  {card.def && (
                    <div style={{
                      fontSize: 14, color: C.t1, lineHeight: 1.9, whiteSpace: "pre-wrap",
                      marginTop: mode === "recognize" ? 0 : 10,
                    }}>
                      {card.def}
                    </div>
                  )}
                  {card.sentence && (
                    <div style={{
                      marginTop: 12, fontSize: 13, color: C.t2, lineHeight: 1.9,
                      background: C.bg, borderRadius: 10, padding: "10px 14px",
                      borderLeft: `3px solid ${ACCENT}`,
                    }}>
                      {highlight(card.sentence, card.word)}
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
        {!revealed ? (
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
          {revealed
            ? "按你刚才「想起来的难易」评，不是按「想隔多久再见到它」。"
            : mode === "recall"
              ? "先在心里把这个词拼出来再翻面 —— 想不起来的那几秒，才是真正在记东西。"
              : "先在心里说出它的意思再翻面 —— 想不起来的那几秒，才是真正在记东西。"}
        </div>
      </div>
    </div>
  );
}
