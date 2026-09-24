"use client";
import { useMemo, useState } from "react";
import { C, FONT } from "../shared/ui";
import { normalizeSentenceTimings } from "../../lib/listening/sentenceTimings";

// 听力复盘的原文渲染：有句级时间戳（docs/listening-sentence-timings.md）时每句前面多一个
// 小播放键，点它 → 调用方让播放器只放那一句（AudioPlayer.playRange）；没有时间戳就退回
// 原来的整段文字 / 对话气泡，行为与改造前完全一样。
//
// 手势约定（与包在外面的 WordLookupLayer 划词词典共存）：
//   · 播放键（data-no-dict）= 播放这一句，词典层会跳过它；
//   · 文字本身不接任何事件，单击查词、划词查词都原样冒泡给词典——听力原文和题干、
//     阅读复盘的查词手势这才是同一套（早先「点句子=播放」把单击查词吃掉了）。
// 渲染的是存好的句子列表（text 随时间戳一起存），**不在前端重新切句**——两套切法一有
// 出入，句子和音频就错位。

const ACCENT = { color: "#8B5CF6", soft: "#F3E8FF", edge: "#DDD6FE" };

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

/**
 * 点播某一句期间高亮该停在哪：播放头还在「这句的范围 + 一点过冲余量」里就钉在这一句，
 * 出了范围（用户点了继续 / 整段重播 / 拖走）返回 -1 交还给 activeSentenceIndex。
 * 要钉的原因：ASR 对齐出来的时间戳常见上一句 end === 下一句 start，刹车停在 end 后十几毫秒，
 * 播放头已经算进下一句，高亮会在停下的那一刻跳到没放的那句上。
 * pin = { index, start, end }（点播时记下）；没有点播过传 null。
 */
export function pinnedSentenceIndex(pin, time) {
  if (!pin || !Number.isFinite(time)) return -1;
  return time >= pin.start - 0.5 && time <= pin.end + 0.35 ? pin.index : -1;
}

/**
 * 第 index 句（体检 + 归一之后的那一份，与本组件渲染的是同一个列表）。
 * 调用方拿到词典弹窗里的句子下标后，用它换回 { start, end } 去 playRange。
 */
export function sentenceAt(timings, index) {
  const list = normalizeSentenceTimings(timings);
  return list && list[index] ? list[index] : null;
}

// 句首的小播放键。平时压到 0.8 不透明度（不抢正文），句子 hover / 键 focus / 正在放时才到满。
// 没用 @media (hover: none) 分档：全站是内联 style，为一个键引 CSS 文件不值，
// 何况 0.8 在触屏上本来就看得清。
function PlayKey({ active, hover, onClick }) {
  const [focus, setFocus] = useState(false);
  const strong = active || hover || focus;
  return (
    <button
      type="button"
      data-no-dict
      data-sentence-play="1"
      aria-label="播放这一句"
      title="播放这一句"
      onClick={onClick}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        padding: 0,
        marginRight: 3,
        verticalAlign: "-3px",
        borderRadius: "50%",
        border: `1px solid ${active ? ACCENT.color : ACCENT.edge}`,
        background: active ? ACCENT.color : "#fff",
        color: active ? "#fff" : ACCENT.color,
        opacity: strong ? 1 : 0.8,
        cursor: "pointer",
        lineHeight: 0,
        transition: "opacity 0.15s ease, background 0.15s ease",
      }}
    >
      {/* 项目没有图标库，三角直接内联 SVG；pointerEvents:none 让事件 target 稳定落在
          button 上（词典层是按 target.closest("[data-no-dict]") 放行的）。 */}
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" style={{ pointerEvents: "none" }}>
        <path d="M1.6 0.7 L7 4 L1.6 7.3 Z" fill="currentColor" />
      </svg>
    </button>
  );
}

function Sentence({ s, index, active, onPick }) {
  const [hover, setHover] = useState(false);
  const playable = s.start != null && typeof onPick === "function";
  // 键和句子首词包进一个 nowrap：原子行内元素（按钮）前后天然是断行点，不粘住的话键会孤零零
  // 留在上一行行尾、句子从下一行开头，看起来像是属于前一句。textContent 不变，查词照常。
  const text = String(s.text || "");
  const cut = text.search(/\s/);
  const head = cut === -1 ? text : text.slice(0, cut);
  const rest = cut === -1 ? "" : text.slice(cut);
  return (
    <span
      data-sentence-index={index}
      data-sentence-playable={playable ? "1" : "0"}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 4,
        padding: "1px 2px",
        margin: "0 -2px",
        background: active ? ACCENT.soft : "transparent",
        boxShadow: active ? `inset 0 -2px 0 ${ACCENT.color}` : "none",
        color: playable ? "inherit" : C.t3,
        transition: "background 0.15s ease",
      }}
    >
      {playable ? (
        <span style={{ whiteSpace: "nowrap" }}>
          <PlayKey active={active} hover={hover} onClick={() => onPick(index, s)} />
          {head}
        </span>
      ) : head}
      {rest}
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
 *  - onPick(index, sentence): 点了某一句的播放键
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
      点 ▶ 播放该句 · 点任意词查词典
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
