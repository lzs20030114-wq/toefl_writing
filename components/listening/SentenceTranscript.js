"use client";
import { useMemo, useState } from "react";
import { C, FONT } from "../shared/ui";
import { normalizeSentenceTimings } from "../../lib/listening/sentenceTimings";

// 听力复盘的原文渲染：有句级时间戳（docs/listening-sentence-timings.md）时每句是可点的
// span，点一句 → 调用方让播放器只放那一句（AudioPlayer.playRange）；没有时间戳就退回
// 原来的整段文字 / 对话气泡，行为与改造前完全一样。
//
// 手势约定（与包在外面的 WordLookupLayer 划词词典共存）：
//   · 点句子 = 播放这一句。句子 span 在 mouseup / touchend 上截住事件，词典就不会
//     把这一下当成「点词查词」；
//   · 划词 / 双击选中一个词 = 查词。有选区时句子不截事件、也不播放，事件照常冒到词典。
// 渲染的是存好的句子列表（text 随时间戳一起存），**不在前端重新切句**——两套切法一有
// 出入，句子和音频就错位。

const ACCENT = { color: "#8B5CF6", soft: "#F3E8FF", edge: "#DDD6FE" };

function hasTextSelection() {
  if (typeof window === "undefined" || !window.getSelection) return false;
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && String(sel).trim().length > 0;
}

/** 当前播放位置落在哪一句（start ≤ t < end）；不在任何一句里返回 -1。 */
export function activeSentenceIndex(timings, time) {
  const list = normalizeSentenceTimings(timings);
  if (!list || !Number.isFinite(time)) return -1;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.start != null && time >= s.start && time < s.end) return i;
  }
  return -1;
}

function Sentence({ s, index, active, onPick }) {
  const [hover, setHover] = useState(false);
  const playable = s.start != null && typeof onPick === "function";
  // 有选区（划词 / 双击选词）时不截事件，让外层词典接手；否则截住，免得一点两响。
  const guard = (e) => { if (!hasTextSelection()) e.stopPropagation(); };
  const pick = () => { if (playable && !hasTextSelection()) onPick(index, s); };
  return (
    <span
      data-sentence-index={index}
      data-sentence-playable={playable ? "1" : "0"}
      role={playable ? "button" : undefined}
      tabIndex={playable ? 0 : undefined}
      aria-label={playable ? "播放这一句" : undefined}
      aria-pressed={playable ? active : undefined}
      title={playable ? "点击播放这一句" : undefined}
      onMouseUp={playable ? guard : undefined}
      onTouchEnd={playable ? guard : undefined}
      onClick={playable ? pick : undefined}
      onKeyDown={playable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(index, s); } } : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: playable ? "pointer" : "default",
        borderRadius: 4,
        padding: "1px 2px",
        margin: "0 -2px",
        background: active ? ACCENT.soft : hover && playable ? "#F5F3FF" : "transparent",
        boxShadow: active ? `inset 0 -2px 0 ${ACCENT.color}` : "none",
        color: playable ? "inherit" : C.t3,
        transition: "background 0.15s ease",
        outline: "none",
      }}
    >
      {s.text}
    </span>
  );
}

/**
 * Props
 *  - timings: item.sentence_timings（可为空）
 *  - transcript: 整段原文（没有时间戳时的退路；paragraph 变体）
 *  - conversation: [{speaker, text}]（没有时间戳时的退路；turns 变体）
 *  - variant: "paragraph"（通知 / 讲座）| "turns"（对话气泡）
 *  - activeIndex: 正在播放的句子下标（高亮）
 *  - onPick(index, sentence): 点了某一句
 */
export function SentenceTranscript({ timings, transcript, conversation, variant = "paragraph", activeIndex = -1, onPick }) {
  const list = useMemo(() => normalizeSentenceTimings(timings), [timings]);
  const groups = useMemo(() => {
    if (!list || variant !== "turns") return null;
    // 按 turn 分组（缺 turn 时按 speaker 变化分组），保持原顺序。
    const out = [];
    list.forEach((s, i) => {
      const prev = out[out.length - 1];
      const key = Number.isInteger(s.turn) ? s.turn : (prev && prev.speaker === s.speaker ? prev.key : out.length);
      if (prev && prev.key === key) prev.items.push({ s, i });
      else out.push({ key, speaker: s.speaker || "", items: [{ s, i }] });
    });
    return out;
  }, [list, variant]);

  const hint = list ? (
    <div style={{ fontSize: 11, color: C.t3, marginTop: 6, fontStyle: "normal", fontFamily: FONT }}>
      点句子播放该句 · 划词或双击查词
    </div>
  ) : null;

  if (variant === "turns") {
    const turns = Array.isArray(conversation) ? conversation : [];
    const bubbles = groups
      ? groups.map((g, gi) => ({ key: g.key, speaker: g.speaker, index: gi, content: g.items.map(({ s, i }) => (
          <Sentence key={i} s={s} index={i} active={i === activeIndex} onPick={onPick} />
        )).reduce((acc, el, k) => (k ? [...acc, " ", el] : [el]), []) }))
      : turns.map((t, i) => ({ key: i, speaker: t.speaker || t.name || "", index: i, content: t.text || t.content || "" }));
    if (!bubbles.length) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {bubbles.map((b) => {
          const isLeft = (Number.isInteger(b.key) ? b.key : b.index) % 2 === 0;
          const speaker = b.speaker || (isLeft ? "Speaker A" : "Speaker B");
          return (
            <div key={b.key} style={{ display: "flex", flexDirection: "column", alignItems: isLeft ? "flex-start" : "flex-end" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: isLeft ? "#6366F1" : "#0891B2", marginBottom: 2, paddingLeft: isLeft ? 8 : 0, paddingRight: isLeft ? 0 : 8 }}>
                {speaker}
              </div>
              <div style={{
                maxWidth: "85%", fontSize: 12, lineHeight: 1.6, color: C.t1,
                padding: "8px 12px", borderRadius: 12,
                borderTopLeftRadius: isLeft ? 4 : 12,
                borderTopRightRadius: isLeft ? 12 : 4,
                background: isLeft ? "#F3E8FF" : "#ECFEFF",
                border: `1px solid ${isLeft ? "#DDD6FE" : "#CFFAFE"}`,
              }}>
                {b.content}
              </div>
            </div>
          );
        })}
        {hint}
      </div>
    );
  }

  if (!list) return transcript ? <>{transcript}</> : null;
  return (
    <>
      {list.map((s, i) => (
        <span key={i}>
          {i > 0 ? " " : null}
          <Sentence s={s} index={i} active={i === activeIndex} onPick={onPick} />
        </span>
      ))}
      {hint}
    </>
  );
}
