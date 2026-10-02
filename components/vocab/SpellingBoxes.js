"use client";
import { useEffect, useRef, useState } from "react";
import { C } from "../shared/ui";
import { missedLetters, sanitizeSpelling, spellingSlots } from "../../lib/vocab/spelling";

/**
 * 拼写下划线：按字母数一个字母一条下划线，敲的字母落在线上。
 *
 * 真正接键盘的是一个盖在上面、完全透明的 <input>：手机键盘、粘贴、退格、
 * 输入法都按原生输入框走，下划线只负责显示。不去逐格做 N 个 input —— 那样退格跨格、
 * 粘贴、手机键盘收起再弹起都要自己补，坑比收益大。
 */

const ACCENT = "#0891B2";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

/**
 * 两种摆法：INLINE 嵌在原句的空里（默认，读句子和拼写是同一个动作）；ROW 独立一行
 * （挖不出空时作答，以及核对后摆出正确拼写）。slot = 每格宽，size = 字号，lift = 字到线的距离。
 * 2026-10-02 对比过「独立一行等宽 / 独立一行衬线 / 填进原句」三版，用户选了填进原句；方块版被否。
 */
const INLINE = { font: MONO, size: 17, slot: 12, gap: 4, lift: 2, weight: 700, line: 1.5 };
const ROW = { font: MONO, size: 20, slot: 15, gap: 7, lift: 5, weight: 600, line: 2 };

const LINE = {
  empty: "#cfd8d3",
  filled: "#7d8f85",
  active: ACCENT,
  correct: "#10b981",
  missed: "#ef4444",
  plain: "#cfd8d3",
  answer: "#7dd3e3",
};
const INK = {
  empty: C.t1, filled: C.t1, active: C.t1, correct: "#047857", missed: "#dc2626", plain: C.t1, answer: C.t1,
};

const CARET_CSS = "@keyframes vocabSpellCaret{0%,49%{opacity:1}50%,100%{opacity:0}}";

/** 按容器宽度缩放：一行放得下就一行；放不下（手机上的超长词）就均匀分几行。 */
function useFit(slots, inline) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || inline) return undefined;
    const read = () => setWidth(el.clientWidth);
    read();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [inline]);
  const L = ROW;
  if (inline || !(width > 0)) return { ref, scale: 1, rowWidth: null };
  const n = slots.length;
  const unit = L.slot + L.gap;
  const need = n * L.slot + (n - 1) * L.gap;
  if (need <= width) return { ref, scale: 1, rowWidth: null };
  const min = 0.7;
  const scale1 = (width + L.gap) / (n * unit);
  if (scale1 >= min) return { ref, scale: scale1, rowWidth: null };
  const perRow = Math.ceil(n / Math.ceil(n / Math.max(1, Math.floor((width + L.gap) / (unit * min)))));
  const scale = Math.min(1, (width + L.gap) / (perRow * unit));
  return { ref, scale, rowWidth: perRow * unit * scale - L.gap * scale };
}

function Slot({ L, scale, ch, ghost, tone, caret, sep }) {
  const w = Math.round(L.slot * scale);
  const size = Math.round(L.size * scale);
  const h = Math.round(size * 1.15) + L.lift + L.line;
  if (sep) {
    return <span style={{ width: ch === " " ? Math.round(w * 0.7) : w, height: h, display: "inline-flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: L.lift + L.line, boxSizing: "border-box", fontFamily: L.font, fontSize: size, color: C.t3, lineHeight: 1 }}>{ch === " " ? "" : ch}</span>;
  }
  return (
    <span style={{ position: "relative", width: w, height: h, display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", flexShrink: 0 }}>
      <span style={{ fontFamily: L.font, fontSize: size, fontWeight: L.weight, lineHeight: 1, color: ch ? INK[tone] : "#c3cdc7", marginBottom: L.lift }}>
        {ch || ghost || " "}
      </span>
      <span style={{ width: "100%", height: L.line, borderRadius: L.line, background: LINE[tone], transition: "background-color .15s" }} />
      {caret && (
        <span style={{
          position: "absolute", left: "50%", bottom: L.lift + L.line + 1, width: 1.5, height: Math.round(size * 0.95),
          marginLeft: ch || ghost ? Math.round(w * 0.42) : -0.75, background: ACCENT, borderRadius: 1,
          animation: "vocabSpellCaret 1s infinite",
        }} />
      )}
    </span>
  );
}

function Slots({ slots, scale, rowWidth, inline, render }) {
  const L = inline ? INLINE : ROW;
  let n = 0;
  return (
    <span
      aria-hidden="true"
      style={{
        display: inline ? "inline-flex" : "flex", flexWrap: "wrap", alignItems: "flex-end",
        columnGap: Math.round(L.gap * scale), rowGap: 10, maxWidth: rowWidth ?? undefined,
        margin: inline ? "0 4px" : undefined,
      }}
    >
      {slots.map((slot, i) => (slot.letter
        ? <Slot key={i} L={L} scale={scale} {...render(n++, slot)} />
        : <Slot key={i} L={L} scale={scale} ch={slot.ch} sep />))}
    </span>
  );
}

/**
 * 作答用的下划线。value 只含字母（sanitizeSpelling 收拾过）。
 * ghost = 第一格浮出的提示字母；inline = 嵌在原句的空里（挖空句里那一段就是它）。
 */
export function SpellingInput({ word, value, onChange, onSubmit, inputRef, ghost = "", inline = false, label = "拼写英文单词" }) {
  const slots = spellingSlots(word);
  const { ref, scale, rowWidth } = useFit(slots, inline);
  const [focused, setFocused] = useState(false);
  const typed = [...value];
  const letterCount = slots.filter((slot) => slot.letter).length;
  // 透明输入框里点到中间会把光标放到中间去，而格子总是从左往右填 —— 光标钉在末尾，两边才对得上。
  const keepCaretAtEnd = (e) => {
    const end = e.target.value.length;
    if (e.target.selectionStart !== end || e.target.selectionEnd !== end) e.target.setSelectionRange(end, end);
  };
  const Wrap = inline ? "span" : "div";
  return (
    <Wrap ref={ref} style={{ position: "relative", display: inline ? "inline-block" : "block" }}>
      <style>{CARET_CSS}</style>
      <Slots
        slots={slots} scale={scale} rowWidth={rowWidth} inline={inline}
        render={(idx) => {
          const ch = typed[idx] || "";
          // 当前位置 = 下一个要填的格；填满了就停在最后一格（光标落在字母后面）
          const active = focused && idx === Math.min(typed.length, letterCount - 1);
          return { ch, ghost: idx === 0 ? ghost : "", tone: active ? "active" : ch ? "filled" : "empty", caret: active };
        }}
      />
      <input
        ref={inputRef}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(sanitizeSpelling(e.target.value, word))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSelect={keepCaretAtEnd}
        onKeyDown={(e) => { if (e.key === "Enter" && onSubmit) { e.preventDefault(); onSubmit(e); } }}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%", margin: 0, padding: 0, border: 0,
          opacity: 0, background: "transparent", color: "transparent", caretColor: "transparent",
          fontSize: 16, cursor: "text",
        }}
      />
    </Wrap>
  );
}

/**
 * 核对后的正确拼写：拼对整排绿；拼错时漏写 / 写错的那几个字母标红（按对齐算，见 missedLetters）；
 * 没写（想不起来）就中性色摆出来。
 */
export function SpellingAnswer({ word, typed, result }) {
  const slots = spellingSlots(word);
  const { ref, scale, rowWidth } = useFit(slots, false);
  const missed = result === "incorrect" ? missedLetters(typed, word) : [];
  return (
    <div ref={ref} role="group" aria-label={`正确拼写 ${word}`}>
      <Slots
        slots={slots} scale={scale} rowWidth={rowWidth}
        render={(idx, slot) => ({
          ch: slot.ch,
          tone: result === "correct" ? "correct" : result === "incorrect" ? (missed[idx] ? "missed" : "plain") : "answer",
        })}
      />
    </div>
  );
}
