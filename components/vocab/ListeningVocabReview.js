"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { C, FONT } from "../shared/ui";
import { RATING, STATE } from "../../lib/vocab/srs";
import { canSpeak, cancelSpeakWord, speakWord } from "../../lib/audio/speakWord";
import { definitionForContext, sourceLabel } from "../../lib/vocab/book";
import { DefLine } from "../shared/DictSenses";
import { getCard, getVocabAccountKey } from "../../lib/vocab/vocabStore";
import { reinsertAfterGap } from "../../lib/vocab/reinsert";
import { buildReviewSummary, pickStats, senseOf } from "../../lib/vocab/reviewSummary";
import ReviewSummary, { LISTENING_LABELS } from "./ReviewSummary";
import { LISTENING_SEGMENT_LABELS, SEGMENT_SIZE, SegmentCheckpoint } from "./SegmentCheckpoint";

import { reviewCardStyle, reviewKbd as kbd, reviewMenuButton as menuBtn } from "./reviewPresentation";

const SESSION_WINDOW_MS = 30 * 60 * 1000;
const REINSERT_GAP = 10;
/** 失手 1 次 + 累计答对 3 次 = 4，再留两次给中途又错（同阅读复习，见 srs.learningSteps）。 */
const MAX_APPEARANCES = 6;
/** 撤销栈深度，和 vocabStore 里保留的评分前快照数一致（超出的撤销外面也撤不动）。 */
const UNDO_DEPTH = 30;
const buttonStyle = { border: `1px solid ${C.bdr}`, borderRadius: 10, padding: "11px 16px", background: "#fff", color: C.t1, fontFamily: FONT, fontWeight: 700, cursor: "pointer" };

export function ListeningVocabReview({
  initialQueue, onGrade, onUndo, onSuspend, onEditDefinition, onExit, accountKey = getVocabAccountKey(),
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState("");
  const [heard, setHeard] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [status, setStatus] = useState("");
  const [playing, setPlaying] = useState(false);
  const [startStats] = useState(() => resume?.startStats || pickStats(statsNow));
  const [segDurMs, setSegDurMs] = useState(0);
  const tokenRef = useRef(0);
  const infoRef = useRef(new Map());
  const startedAtRef = useRef(Date.now() - (resume?.elapsedMs || 0));
  const segStartRef = useRef(Date.now());
  const shownAtRef = useRef(Date.now());
  const { queue, pos } = sess;
  const card = queue[pos];
  const context = card?.listeningContext;

  const stop = useCallback(() => {
    tokenRef.current += 1;
    cancelSpeakWord();
    setPlaying(false);
  }, []);

  useEffect(() => () => {
    tokenRef.current += 1;
    cancelSpeakWord();
  }, []);

  const play = useCallback(() => {
    if (!card || sess.checkpoint) return;
    stop();
    const token = tokenRef.current;
    const live = () => tokenRef.current === token;
    // A failed or cancelled attempt must never unlock an answer via a late onEnd.
    let failed = false;
    setStatus("");
    if (!canSpeak()) { setStatus("此设备无法播放单词发音，请重试或跳过这张卡。"); return; }
    setPlaying(true);
    const started = speakWord(card.display || card.word, {
      onStart: () => { if (live() && !failed) setStatus("正在播放单词发音。"); },
      onEnd: () => { if (live() && !failed) { setHeard(true); setPlaying(false); setStatus(""); } },
      onError: () => { if (live()) { failed = true; setPlaying(false); setStatus("单词发音失败，请点击播放或按空格重试，或跳过这张卡。"); } },
      onDone: () => { if (live()) setPlaying(false); },
    });
    if (!started) { failed = true; setPlaying(false); setStatus("此设备无法播放单词发音，请重试或跳过这张卡。"); }
  }, [card, sess.checkpoint, stop]);

  // Only a new question (position or checkpoint continuation) starts playback.
  // Answer reveal, rerenders and undo restoration must not replay.
  const [autoRevision, setAutoRevision] = useState(0);
  const playbackRef = useRef(null);
  playbackRef.current = { play, canAutoPlay: !!card && !revealed };
  useEffect(() => {
    const playback = playbackRef.current;
    if (!sess.checkpoint && playback.canAutoPlay) playback.play();
  }, [pos, sess.checkpoint, autoRevision]);

  const resetCardUi = useCallback((nextHeard = false) => {
    stop();
    setMenuOpen(false);
    setEditing(false);
    setEditError("");
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
    if (!card || sess.checkpoint || editing || menuOpen || !heard || !revealed || getVocabAccountKey() !== accountKey) return;
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

  const suspendWord = () => {
    if (!card || sess.checkpoint || !onSuspend || getVocabAccountKey() !== accountKey || !onSuspend(card.word)) return;
    const nextQueue = sess.queue.filter((entry, i) => i < pos || entry.word !== card.word);
    const done = pos >= nextQueue.length;
    setHistory([]);
    setSess({ ...sess, queue: nextQueue, endedAt: done ? Date.now() : null });
    resetCardUi(false);
    if (done) onFinish?.();
    // The next question can occupy the same position after removal.
    if (!done) setAutoRevision((n) => n + 1);
  };
  const saveEdit = (event) => {
    event.preventDefault();
    if (!card || !onEditDefinition || getVocabAccountKey() !== accountKey) return;
    try {
      const updated = onEditDefinition(card.word, editText);
      if (!updated) { setEditError("没能保存：这个词可能已被移除。"); return; }
      const fields = ["def", "defFull", "baseDef", "contextSenses", "definitionLocked", "definitionUpdatedAt", "contextSenseResetAt"];
      const patch = Object.fromEntries(fields.map((key) => [key, updated[key]]));
      setSess((prev) => ({ ...prev, queue: prev.queue.map((entry) => entry.word === card.word ? { ...entry, ...patch } : entry) }));
      setEditing(false);
    } catch (error) { setEditError(error?.message || "没能保存，请稍后重试。"); }
  };

  const actionRef = useRef(null);
  actionRef.current = { undo, continueSegment, play, grade, card, heard, revealed, checkpoint: sess.checkpoint, editing, menuOpen };
  useEffect(() => {
    const onKey = (e) => {
      const target = e.target;
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      const action = actionRef.current;
      if (!action.card) return;
      const button = target?.closest?.("button");
      if (action.editing) return;
      if (e.key === "Escape") { setMenuOpen(false); return; }
      if (action.checkpoint) {
        if (!button && (e.key === " " || e.key === "Enter")) { e.preventDefault(); action.continueSegment(); }
        return;
      }
      if (e.key === " " || e.code === "Space") { e.preventDefault(); action.play(); return; }
      if (action.menuOpen) return;
      if (e.key.toLowerCase() === "z") { e.preventDefault(); action.undo(); return; }
      if (button && e.key === "Enter") return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (!action.revealed) { if (action.heard) setRevealed(true); }
        else action.grade(RATING.GOOD);
      } else if (action.revealed && (e.key === "1" || e.key === "2")) {
        e.preventDefault(); action.grade(e.key === "1" ? RATING.AGAIN : RATING.GOOD);
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

  const remaining = Math.max(0, queue.length - pos);
  const progress = sess.answered / (sess.answered + remaining || 1);
  const timesSeen = sess.seen[card.word] || 0;
  const reveal = () => {
    if (menuOpen) setMenuOpen(false);
    else if (heard && !sess.checkpoint && !editing) setRevealed(true);
  };
  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <button type="button" aria-label="退出复习" onClick={() => { stop(); onExit(); }} style={{ border: `1px solid ${C.bdr}`, background: "#fff", color: C.t2, borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: FONT, flexShrink: 0 }}>← 退出</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.t1, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {LISTENING_LABELS.kind}
              <span style={{ fontWeight: 500, color: C.t3 }}>已答 {sess.answered} · 剩 {remaining}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.t2, background: "#f7faf9", border: "1px solid #ebf0ed", borderRadius: 5, padding: "1px 6px" }}>本段 {sess.segment.length} / {SEGMENT_SIZE}</span>
              {sess.resumed && <span style={{ fontSize: 10, fontWeight: 700, color: "#087355", background: "#ECFDF5", border: "1px solid #D1FAE5", borderRadius: 5, padding: "1px 6px" }}>已从存档继续 · 第 {sess.segNo + 1} 段</span>}
            </span>
            <span style={{ display: "flex", gap: 10, fontSize: 11, fontWeight: 700 }}>
              <span style={{ color: "#0d9668" }}>{LISTENING_LABELS.good} {sess.tally.good}</span>
              <span style={{ color: "#dc2626" }}>{LISTENING_LABELS.again} {sess.tally.again}</span>
            </span>
          </div>
          <div role="progressbar" aria-label="听力复习进度" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, background: C.bdrSubtle, borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${Math.round(progress * 100)}%`, height: "100%", background: "#0891B2", transition: "width .25s" }} />
          </div>
        </div>
      </div>
      <div onClick={reveal} style={{ ...reviewCardStyle, cursor: heard && !revealed ? "pointer" : "default" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#0891B2", background: "#ECFEFF", border: "1px solid #a5e8f0", borderRadius: 999, padding: "2px 9px" }}>听词</span>
          <span style={{ fontSize: 11, color: C.t3 }}>听发音，回想词义</span>
          {card.state === STATE.NEW && <span style={{ fontSize: 10, fontWeight: 700, color: "#087355", background: "#ECFDF5", border: "1px solid #D1FAE5", borderRadius: 999, padding: "1px 7px" }}>新词</span>}
          {timesSeen > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: "#B45309", background: "#FFFBEB", border: "1px solid #f3d4a2", borderRadius: 999, padding: "1px 7px" }}>再次出现 · 第 {timesSeen + 1} 次</span>}
          <span style={{ marginLeft: "auto", fontSize: 10, color: C.t3 }}>{sourceLabel(card)}{card.tag ? ` · ${card.tag}` : ""}</span>
          {(onSuspend || (revealed && onEditDefinition)) && <button type="button" aria-label="更多操作" aria-haspopup="menu" aria-expanded={menuOpen} onClick={(e) => { e.stopPropagation(); setMenuOpen((open) => !open); }} style={{ width: 28, height: 28, border: `1px solid ${C.bdr}`, borderRadius: 7, background: "#fff", color: C.t2, cursor: "pointer" }}>⋯</button>}

        </div>
        {menuOpen && <div role="menu" aria-label="单词操作" onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 62, right: 20, zIndex: 5, width: 208, maxWidth: "calc(100% - 40px)", background: "#fff", border: `1px solid ${C.bdr}`, borderRadius: 10, boxShadow: C.shadow, padding: 6 }}>
          {revealed && onEditDefinition && <button type="button" role="menuitem" style={menuBtn} onClick={() => { setMenuOpen(false); setEditText(definitionForContext(card, context?.text || "")); setEditError(""); setEditing(true); }}>编辑释义</button>}
          {onSuspend && <button type="button" role="menuitem" style={menuBtn} onClick={suspendWord}>暂停复习这个词</button>}
        </div>}
        {editing && <form onSubmit={saveEdit} onClick={(e) => e.stopPropagation()} style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: C.bg, border: `1px solid ${C.bdrSubtle}` }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.t2 }}>编辑释义<textarea aria-label="编辑释义" value={editText} onChange={(e) => setEditText(e.target.value)} rows={2} maxLength={300} autoFocus style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, border: `1px solid ${C.bdr}`, borderRadius: 8, padding: "8px 10px", fontFamily: FONT }} /></label>
          {editError && <p role="alert">{editError}</p>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}><button type="button" style={buttonStyle} onClick={() => setEditing(false)}>取消</button><button type="submit" style={buttonStyle} disabled={!editText.trim()}>保存</button></div>
        </form>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" aria-label="播放单词发音" style={{ ...buttonStyle, background: "#0891B2", color: "#fff", border: "none" }} onClick={play}>{playing ? "重新播放" : "播放单词发音"} <span style={kbd("#fff", "rgba(255,255,255,.5)")}>空格</span></button>
            {playing && <button type="button" style={buttonStyle} onClick={() => { stop(); setStatus("已暂停；请重新播放完整单词发音后再看答案。"); }}>暂停播放</button>}
          </div>
          {status && <p role="status" style={{ color: "#b45309", fontSize: 13 }}>{status}</p>}
          {revealed && heard && <div style={{ marginTop: 18, borderTop: `1px solid ${C.bdrSubtle}`, paddingTop: 16 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 34, fontWeight: 800, color: C.t1, letterSpacing: -0.5, wordBreak: "break-word" }}>{card.display || card.word}</span>
              {card.phonetic && <span style={{ fontSize: 13, color: C.t3, fontFamily: "'Courier New', monospace" }}>/{card.phonetic}/</span>}
            </div>
            <DefLine text={definitionForContext(card, context?.text || "")} style={{ marginTop: 10, color: C.t1, fontSize: 14, lineHeight: 1.9 }} />
          </div>}
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        {!revealed ? (heard ? <button type="button" aria-label="显示答案" onClick={reveal} style={{ width: "100%", border: "none", background: "#0891B2", color: "#fff", borderRadius: 12, padding: "15px 0", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>显示答案 <span style={kbd("#fff", "rgba(255,255,255,.5)")}>Enter</span></button> : <div style={{ padding: "15px 0", textAlign: "center", color: C.t3, fontSize: 13 }}>完整听完后，点击卡片或按 Enter 翻面</div>) : <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
          <button type="button" aria-label="没听懂" onClick={() => grade(RATING.AGAIN)} style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#dc2626", borderRadius: 12, padding: "15px 4px", cursor: "pointer", fontFamily: FONT, fontSize: 16, fontWeight: 800 }}>{LISTENING_LABELS.again} <span style={kbd("#dc2626", "#fecaca")}>1</span></button>
          <button type="button" aria-label="听懂了" onClick={() => grade(RATING.GOOD)} style={{ border: "1px solid #a7f3d0", background: "#ecfdf5", color: "#0d9668", borderRadius: 12, padding: "15px 4px", cursor: "pointer", fontFamily: FONT, fontSize: 16, fontWeight: 800 }}>{LISTENING_LABELS.good} <span style={kbd("#0d9668", "#a7f3d0")}>2 / Enter</span></button>
        </div>}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          {onUndo && <button type="button" onClick={undo} disabled={!history.length || sess.checkpoint} style={{ border: 0, background: "none", padding: "4px 0", fontSize: 12, fontWeight: 700, fontFamily: FONT, color: history.length ? C.t2 : "#c5cfc9", cursor: history.length ? "pointer" : "default" }}>↶ 撤销上一张 <span style={kbd(C.t3, C.bdr)}>Z</span></button>}
          <button type="button" onClick={skip} style={{ border: 0, background: "none", padding: "4px 0", fontSize: 12, color: C.t2, cursor: "pointer", fontFamily: FONT }}>跳过这张卡</button>
          <span style={{ fontSize: 11, color: C.t3, lineHeight: 1.7, flex: "1 1 240px", textAlign: "right" }}>{revealed ? "翻面前已听出这个词并理解其意思，才选“听懂了”。" : "先在心里回想词义，再翻面；空格可随时重播。"}</span>
        </div>
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
