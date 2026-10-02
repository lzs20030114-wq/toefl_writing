"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { C, FONT } from "../shared/ui";
import { RATING } from "../../lib/vocab/srs";
import { sameOriginAudio } from "../../lib/listening/audioSrc";
import { SENTENCE_SEEK_LEAD_SEC } from "../../lib/listening/sentenceTimings";
import { canSpeak, cancelSpeakWord, speakWord } from "../../lib/audio/speakWord";
import { definitionForContext } from "../../lib/vocab/book";
import { humanizeDef } from "../../lib/dict/core";
import { getCard, getVocabAccountKey } from "../../lib/vocab/vocabStore";
import { reinsertAfterGap } from "../../lib/vocab/reinsert";
import { buildReviewSummary, pickStats, senseOf } from "../../lib/vocab/reviewSummary";
import ReviewSummary, { LISTENING_LABELS } from "./ReviewSummary";
import { LISTENING_SEGMENT_LABELS, SEGMENT_SIZE, SegmentCheckpoint } from "./SegmentCheckpoint";

const SESSION_WINDOW_MS = 30 * 60 * 1000;
const REINSERT_GAP = 10;
const MAX_APPEARANCES = 4;
/** 撤销栈深度，和 vocabStore 里保留的评分前快照数一致（超出的撤销外面也撤不动）。 */
const UNDO_DEPTH = 30;
const buttonStyle = { border: `1px solid ${C.bdr}`, borderRadius: 10, padding: "11px 16px", background: "#fff", color: C.t1, fontFamily: FONT, fontWeight: 700, cursor: "pointer" };

export function ListeningVocabReview({
  initialQueue, onGrade, onUndo, onExit, accountKey = getVocabAccountKey(),
  // 从存档继续时带进来的上一段统计；没有就是全新一场（存档的读写与恢复见 lib/vocab/reviewSave.js）
  resume = null,
  // 每过完一段 / 整场结束时通知外面落存档、清存档（外面不接就不存）
  onCheckpoint, onFinish,
  // 单词本当前的整体统计，结算页拿它和开场时对比出「预计记得 96 → 104」
  statsNow = null,
  // 结算页下半截的「接下来」：{ nextTask, tomorrow, onStartNext, onExportWords }
  summaryExtras = null,
}) {
  // 会因评分而变的状态收在一个对象里，撤销就是整个换回上一份（做法同 VocabReview）。
  const [sess, setSess] = useState(() => ({
    queue: initialQueue || [], pos: 0, answered: resume?.answered || 0,
    tally: { good: resume?.tally?.good || 0, again: resume?.tally?.again || 0 },
    first: resume?.first || {}, seen: resume?.seen || {}, lost: resume?.lost || [],
    segment: [], // 当前这一段评过的 { word, good, n }
    segNo: resume?.segNo || 0, checkpoint: false, resumed: !!resume, endedAt: null,
  }));
  const [history, setHistory] = useState([]);
  const [heard, setHeard] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [status, setStatus] = useState("");
  const [playing, setPlaying] = useState(false);
  const [startStats] = useState(() => resume?.startStats || pickStats(statsNow));
  const [segDurMs, setSegDurMs] = useState(0);
  const audioRef = useRef(null);
  const timerRef = useRef(null);
  const rafRef = useRef(null);
  const tokenRef = useRef(0);
  const infoRef = useRef(new Map());
  const startedAtRef = useRef(Date.now() - (resume?.elapsedMs || 0));
  const segStartRef = useRef(Date.now());
  const shownAtRef = useRef(Date.now());
  const { queue, pos } = sess;
  const card = queue[pos];
  const context = card?.listeningContext;
  const hasSentenceAudio = !!context?.audioUrl && Number.isFinite(context.start) && Number.isFinite(context.end) && context.end > context.start;

  const stop = useCallback(() => {
    tokenRef.current += 1;
    clearTimeout(timerRef.current);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (audioRef.current) {
      audioRef.current.onloadedmetadata = null;
      audioRef.current.onplaying = null;
      audioRef.current.onerror = null;
      audioRef.current.ontimeupdate = null;
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current.removeAttribute?.("src");
      audioRef.current.load?.();
      audioRef.current = null;
    }
    cancelSpeakWord();
    setPlaying(false);
  }, []);

  useEffect(() => () => {
    tokenRef.current += 1;
    clearTimeout(timerRef.current);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; audioRef.current = null; }
    cancelSpeakWord();
  }, []);

  const play = useCallback(() => {
    if (!card || sess.checkpoint) return;
    stop();
    const token = tokenRef.current;
    setStatus("");
    setPlaying(true);
    const live = () => tokenRef.current === token;
    const wordSound = (fallback = false) => {
      if (!live()) return;
      if (!canSpeak()) { setPlaying(false); setStatus("此设备无法播放音频，请重试或跳过这张卡。"); return; }
      if (fallback) setStatus("原句音频不可用，改播单词发音。");
      const started = speakWord(card.display || card.word, {
        onStart: () => { if (live()) setStatus(fallback ? "正在播放单词发音。" : "正在播放单词发音。"); },
        onEnd: () => { if (live()) { setHeard(true); setPlaying(false); setStatus(""); } },
        onError: () => { if (live()) { setPlaying(false); setStatus("单词发音失败，请重试或跳过这张卡。"); } },
        onDone: () => { if (live()) setPlaying(false); },
      });
      if (!started) { setPlaying(false); setStatus("此设备无法播放单词发音，请重试或跳过这张卡。"); }
    };
    if (!hasSentenceAudio) { wordSound(); return; }
    try {
      const audio = new Audio(sameOriginAudio(context.audioUrl));
      audioRef.current = audio;
      let fallbackStarted = false;
      let audioStarted = false;
      let done = false;
      const clearAudio = () => {
        clearTimeout(timerRef.current);
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        audio.onloadedmetadata = null;
        audio.onplaying = null;
        audio.onerror = null;
        audio.ontimeupdate = null;
        audio.onended = null;
        audio.pause();
        if (audioRef.current === audio) audioRef.current = null;
      };
      const fallback = () => {
        if (!live() || fallbackStarted || done) return;
        fallbackStarted = true;
        clearAudio();
        wordSound(true);
      };
      const finish = () => {
        if (!live() || fallbackStarted || done) return;
        done = true;
        clearAudio();
        setPlaying(false);
        if (audioStarted) { setHeard(true); setStatus(""); }
        else wordSound(true);
      };
      const checkEnd = () => {
        if (!live() || fallbackStarted || done) return;
        if (audio.currentTime >= context.end) { finish(); return; }
        if (audio.ended) { fallback(); return; }
        rafRef.current = requestAnimationFrame(checkEnd);
      };
      audio.onloadedmetadata = () => {
        if (!live() || fallbackStarted || done) return;
        try { audio.currentTime = Math.max(0, context.start - SENTENCE_SEEK_LEAD_SEC); } catch { fallback(); return; }
        Promise.resolve(audio.play()).catch(fallback);
      };
      audio.onplaying = () => { if (live() && !fallbackStarted && !done) { audioStarted = true; clearTimeout(timerRef.current); setStatus("正在播放原句。"); if (rafRef.current == null) rafRef.current = requestAnimationFrame(checkEnd); } };
      audio.onerror = fallback;
      audio.ontimeupdate = () => { if (audio.currentTime >= context.end) finish(); };
      audio.onended = () => { if (audioStarted && audio.currentTime >= context.end) finish(); else fallback(); };
      timerRef.current = setTimeout(fallback, 15000);
      audio.load();
    } catch { wordSound(true); }
  }, [card, context, hasSentenceAudio, sess.checkpoint, stop]);

  const resetCardUi = useCallback((nextHeard = false) => {
    stop();
    setHeard(nextHeard);
    setRevealed(nextHeard);
    setStatus("");
    shownAtRef.current = Date.now();
  }, [stop]);

  /** 跳过：不评分，只往后翻一张（队列走完也算结束）。 */
  const skip = () => {
    if (sess.checkpoint) return;
    const done = sess.pos + 1 >= sess.queue.length;
    resetCardUi(false);
    setSess({ ...sess, pos: sess.pos + 1, endedAt: done ? Date.now() : null });
    if (done) onFinish?.();
  };

  const grade = (rating) => {
    if (!card || sess.checkpoint || !heard || !revealed || getVocabAccountKey() !== accountKey) return;
    const updated = onGrade(card.word, rating, Date.now() - shownAtRef.current, "listening");
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
      tally: { good: sess.tally.good + (good ? 1 : 0), again: sess.tally.again + (good ? 0 : 1) },
      first: card.word in sess.first ? sess.first : { ...sess.first, [card.word]: good },
      seen: { ...sess.seen, [card.word]: times },
      lost: !good && !sess.lost.includes(card.word) ? [...sess.lost, card.word] : sess.lost,
      segment,
      segNo: hit ? sess.segNo + 1 : sess.segNo,
      checkpoint: hit,
      endedAt: done ? Date.now() : null,
    };
    // 过了存档点就清掉撤销栈：那一刻已经落盘，不再允许回头改
    setHistory(hit || done ? [] : (h) => [...h, sess].slice(-UNDO_DEPTH));
    setSess(next);
    resetCardUi(false);
    if (hit) {
      setSegDurMs(Date.now() - segStartRef.current);
      onCheckpoint?.({
        words: nextQueue.slice(nextPos).map((c) => c.word),
        answered: next.answered, tally: next.tally, first: next.first, seen: next.seen, lost: next.lost,
        segNo: next.segNo, elapsedMs: Date.now() - startedAtRef.current, startStats,
      });
    }
    if (done) onFinish?.();
  };

  const continueSegment = useCallback(() => {
    segStartRef.current = Date.now();
    shownAtRef.current = Date.now();
    setSess((s) => ({ ...s, checkpoint: false, segment: [], resumed: false }));
  }, []);

  /**
   * 撤销上一张评分：外面把调度状态和日志退回后，界面摆回那张卡「已听过、已翻面」的样子，
   * 不用再听一遍就能直接重新选（那句刚刚才听过，再听只是白费一次提取）。
   */
  const undo = useCallback(() => {
    if (!onUndo || !history.length || sess.checkpoint || getVocabAccountKey() !== accountKey) return;
    const prev = history[history.length - 1];
    const prevCard = prev.queue[prev.pos];
    if (!prevCard || !onUndo(prevCard.word)) return;
    setHistory(history.slice(0, -1));
    setSess(prev);
    resetCardUi(true);
  }, [accountKey, history, onUndo, resetCardUi, sess.checkpoint]);

  const undoRef = useRef(undo);
  undoRef.current = undo;
  const continueRef = useRef(continueSegment);
  continueRef.current = continueSegment;
  const checkpointRef = useRef(sess.checkpoint);
  checkpointRef.current = sess.checkpoint;
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "z" || e.key === "Z") { e.preventDefault(); undoRef.current(); return; }
      // 存档小结开着时空格/回车 = 继续下一段（焦点在按钮上就留给按钮自己点）
      if (checkpointRef.current && (e.key === " " || e.key === "Enter") && !(e.target && e.target.tagName === "BUTTON")) {
        e.preventDefault();
        continueRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!card) {
    // 整轮都是跳过、一张没评：没有可复盘的内容，给个简短收尾
    if (!Object.keys(sess.first).length) return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <h2>这一轮听力复习完成</h2>
        <button type="button" style={buttonStyle} onClick={onExit}>返回单词本</button>
      </div>
    );
    const summary = buildReviewSummary({
      first: sess.first, tally: sess.tally, lost: sess.lost,
      infoFor: (word) => infoRef.current.get(word) || getCard(word),
      senseFor: (info) => senseOf(info, info.listeningContext?.text),
      startedAt: startedAtRef.current, endedAt: sess.endedAt, startStats, statsNow,
    });
    return (
      <ReviewSummary
        summary={summary} labels={LISTENING_LABELS}
        nextTask={summaryExtras?.nextTask} tomorrow={summaryExtras?.tomorrow}
        onStartNext={summaryExtras?.onStartNext} onExportWords={summaryExtras?.onExportWords}
        onExit={onExit}
      />
    );
  }

  return (
    <div style={{ maxWidth: 620, margin: "24px auto", fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: C.t2, fontSize: 13 }}>听力复习 · {pos + 1} / {queue.length}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.t2, background: "#f7faf9", border: "1px solid #ebf0ed", borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap" }}>
            本段 {sess.segment.length} / {SEGMENT_SIZE}
          </span>
          {sess.resumed && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "#087355", background: "#ECFDF5", border: "1px solid #D1FAE5", borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap" }}>
              已从存档继续 · 第 {sess.segNo + 1} 段
            </span>
          )}
        </div>
        <button type="button" style={buttonStyle} onClick={() => { stop(); onExit(); }}>退出复习</button>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.bdr}`, borderRadius: 16, padding: 24, minHeight: 260 }}>
        <div style={{ color: C.t2, fontSize: 13, marginBottom: 18 }}>
          {hasSentenceAudio ? "先听懂这句话，再翻面核对收藏的词。" : "听单词发音，想一想它的意思。"}
        </div>
        <button type="button" style={{ ...buttonStyle, background: "#0891B2", color: "#fff", border: "none" }} onClick={play}>
          {playing ? "重新播放" : hasSentenceAudio ? "播放原句" : "播放单词发音"}
        </button>
        {playing && <button type="button" style={{ ...buttonStyle, marginLeft: 8 }} onClick={() => { stop(); setStatus("已暂停；请重新播放完整音频后再看答案。"); }}>暂停播放</button>}
        {status && <p role="status" style={{ color: "#b45309", fontSize: 13 }}>{status}</p>}
        {heard && !revealed && <div style={{ marginTop: 22 }}><button type="button" style={buttonStyle} onClick={() => setRevealed(true)}>显示答案</button></div>}
        {revealed && heard && (
          <div style={{ marginTop: 24, borderTop: `1px solid ${C.bdr}`, paddingTop: 18 }}>
            <div style={{ fontSize: 25, fontWeight: 800, color: C.t1 }}>{card.display || card.word}</div>
            {card.phonetic && <div style={{ color: C.t2 }}>/{card.phonetic}/</div>}
            <div style={{ marginTop: 8, color: C.t1 }}>{humanizeDef(definitionForContext(card, hasSentenceAudio ? context.text : ""))}</div>
            {(context?.text || card.sentence) && <p style={{ color: C.t2, lineHeight: 1.7 }}>原句：{context?.text || card.sentence}</p>}
            <p style={{ color: C.t2, fontSize: 12 }}>翻面前已听出这个词并理解其意思，才选“听懂了”。</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" style={buttonStyle} onClick={() => grade(RATING.AGAIN)}>没听懂</button>
              <button type="button" style={{ ...buttonStyle, background: "#0891B2", color: "#fff", border: "none" }} onClick={() => grade(RATING.GOOD)}>听懂了</button>
            </div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" style={buttonStyle} onClick={skip}>跳过这张卡</button>
        {onUndo && (
          <button
            type="button"
            onClick={undo}
            disabled={!history.length}
            style={{
              border: 0, background: "none", padding: "4px 0", fontSize: 12, fontWeight: 700, fontFamily: FONT,
              color: history.length ? C.t2 : "#c5cfc9", cursor: history.length ? "pointer" : "default",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            ↶ 撤销上一张
            <span style={{ fontSize: 10, fontWeight: 700, border: `1px solid ${C.bdr}`, borderRadius: 4, padding: "0 5px", lineHeight: "16px", color: C.t3 }}>Z</span>
          </button>
        )}
      </div>
      {sess.checkpoint && (
        <SegmentCheckpoint
          segNo={sess.segNo}
          rows={sess.segment.map((g) => {
            const info = infoRef.current.get(g.word);
            return { ...g, display: info?.display || g.word, sense: info ? senseOf(info, info.listeningContext?.text) : "" };
          })}
          good={sess.segment.filter((g) => g.good).length}
          again={sess.segment.filter((g) => !g.good).length}
          durationMs={segDurMs}
          saved={!!onCheckpoint}
          labels={LISTENING_SEGMENT_LABELS}
          onContinue={continueSegment}
          onPause={() => { stop(); onExit(); }}
        />
      )}
    </div>
  );
}
