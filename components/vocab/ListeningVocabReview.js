"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { C, FONT } from "../shared/ui";
import { RATING } from "../../lib/vocab/srs";
import { sameOriginAudio } from "../../lib/listening/audioSrc";
import { SENTENCE_SEEK_LEAD_SEC } from "../../lib/listening/sentenceTimings";
import { canSpeak, cancelSpeakWord, speakWord } from "../../lib/audio/speakWord";
import { humanizeDef } from "../../lib/dict/core";

const SESSION_WINDOW_MS = 30 * 60 * 1000;
const REINSERT_GAP = 10;
const MAX_APPEARANCES = 4;
const buttonStyle = { border: `1px solid ${C.bdr}`, borderRadius: 10, padding: "11px 16px", background: "#fff", color: C.t1, fontFamily: FONT, fontWeight: 700, cursor: "pointer" };

export function ListeningVocabReview({ initialQueue, onGrade, onExit }) {
  const [queue, setQueue] = useState(() => initialQueue || []);
  const [pos, setPos] = useState(0);
  const [heard, setHeard] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [status, setStatus] = useState("");
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);
  const timerRef = useRef(null);
  const rafRef = useRef(null);
  const tokenRef = useRef(0);
  const seenRef = useRef(new Map());
  const shownAtRef = useRef(Date.now());
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
    if (!card) return;
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
  }, [card, context, hasSentenceAudio, stop]);

  const next = useCallback(() => {
    stop();
    setHeard(false);
    setRevealed(false);
    setStatus("");
    shownAtRef.current = Date.now();
    setPos((p) => p + 1);
  }, [stop]);

  const grade = (rating) => {
    if (!card || !heard || !revealed) return;
    const updated = onGrade(card.word, rating, Date.now() - shownAtRef.current, "listening");
    const seen = seenRef.current;
    const times = (seen.get(card.word) || 0) + 1;
    seen.set(card.word, times);
    setQueue((q) => {
      if (!updated || times >= MAX_APPEARANCES) return q;
      const dueIn = new Date(updated.due).getTime() - Date.now();
      if (!Number.isFinite(dueIn) || dueIn > SESSION_WINDOW_MS) return q;
      const copy = [...q];
      copy.splice(Math.min(copy.length, pos + 1 + REINSERT_GAP), 0, updated);
      return copy;
    });
    next();
  };

  if (!card) return (
    <div style={{ padding: 24, textAlign: "center" }}>
      <h2>听力复习结束</h2>
      <button type="button" style={buttonStyle} onClick={onExit}>返回单词本</button>
    </div>
  );

  return (
    <div style={{ maxWidth: 620, margin: "24px auto", fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <span style={{ color: C.t2, fontSize: 13 }}>听力复习 · {pos + 1} / {queue.length}</span>
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
            <div style={{ marginTop: 8, color: C.t1 }}>{humanizeDef(card.def || "")}</div>
            {(context?.text || card.sentence) && <p style={{ color: C.t2, lineHeight: 1.7 }}>原句：{context?.text || card.sentence}</p>}
            <p style={{ color: C.t2, fontSize: 12 }}>翻面前已听出这个词并理解其意思，才选“听懂了”。</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" style={buttonStyle} onClick={() => grade(RATING.AGAIN)}>没听懂</button>
              <button type="button" style={{ ...buttonStyle, background: "#0891B2", color: "#fff", border: "none" }} onClick={() => grade(RATING.GOOD)}>听懂了</button>
            </div>
          </div>
        )}
      </div>
      <button type="button" style={{ ...buttonStyle, marginTop: 12 }} onClick={next}>跳过这张卡</button>
    </div>
  );
}
