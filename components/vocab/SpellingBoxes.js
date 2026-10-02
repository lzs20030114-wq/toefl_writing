"use client";
import { useEffect, useRef, useState } from "react";
import { C, FONT } from "../shared/ui";
import { missedLetters, sanitizeSpelling, spellingSlots } from "../../lib/vocab/spelling";

/**
 * 拼写格子：按字母数一个字母一个格，敲的字母落在格子上。
 *
 * 真正接键盘的是一个盖在格子上面、完全透明的 <input>：手机键盘、粘贴、退格、
 * 输入法都按原生输入框走，格子只负责显示。不去逐格做 N 个 input —— 那样退格跨格、
 * 粘贴、手机键盘收起再弹起都要自己补，坑比收益大。
 */

const ACCENT = "#0891B2";
const ACCENT_SOFT = "#ECFEFF";
const GAP = 6;
const ROW_GAP = 8;
const MIN_BOX = 28;
const MAX_BOX = 44;
const SEP_W = 12;

const TONES = {
  empty: { border: C.bdr, bg: "#fff", color: C.t1 },
  filled: { border: "#9fb2a7", bg: "#fbfdfc", color: C.t1 },
  active: { border: ACCENT, bg: ACCENT_SOFT, color: C.t1 },
  correct: { border: "#6ee7b7", bg: "#ecfdf5", color: "#047857" },
  missed: { border: "#fca5a5", bg: "#fef2f2", color: "#dc2626" },
  plain: { border: C.bdr, bg: "#fff", color: C.t1 },
  answer: { border: "#a5e8f0", bg: ACCENT_SOFT, color: C.t1 },
};

/**
 * 按容器宽度算格子大小。一行放得下（格子不小于 MIN_BOX）就一行；放不下（手机上的长词、短语）
 * 就均匀分成几行（13 个字母在手机上是 7 + 6，不是 9 + 4），每行能用多大的格子就用多大。
 * 返回的 rowWidth 卡住每行个数，flex 换行才会落在均分的位置上。
 */
function useBoxSize(slots) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setWidth(el.clientWidth);
    read();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  if (!(width > 0)) return { ref, box: 40, rowWidth: null };
  const letters = slots.filter((s) => s.letter).length || 1;
  const seps = (slots.length - letters) * SEP_W;
  const oneRow = Math.floor((width - seps - (slots.length - 1) * GAP) / letters);
  if (oneRow >= MIN_BOX) return { ref, box: Math.min(MAX_BOX, oneRow), rowWidth: null };
  const perRowMax = Math.max(1, Math.floor((width + GAP) / (MIN_BOX + GAP)));
  const perRow = Math.ceil(slots.length / Math.ceil(slots.length / perRowMax));
  const box = Math.min(MAX_BOX, Math.floor((width - (perRow - 1) * GAP) / perRow));
  return { ref, box, rowWidth: perRow * box + (perRow - 1) * GAP };
}

function Box({ box, letter, tone, ghost, caret }) {
  const t = TONES[tone];
  return (
    <span
      style={{
        position: "relative", width: box, height: Math.round(box * 1.2), flexShrink: 0, boxSizing: "border-box",
        display: "grid", placeItems: "center", borderRadius: Math.round(box * 0.24),
        border: `${tone === "active" ? 2 : 1.5}px solid ${t.border}`, background: t.bg, color: t.color,
        boxShadow: tone === "active" ? "0 0 0 3px rgba(8,145,178,0.12)" : "none",
        fontSize: Math.round(box * 0.52), fontWeight: 700, fontFamily: FONT, lineHeight: 1,
        transition: "border-color .12s, background-color .12s, box-shadow .12s",
      }}
    >
      {letter || (ghost ? <span style={{ color: "#c5cfc9" }}>{ghost}</span> : null)}
      {caret && (
        <span style={{
          position: "absolute", left: "50%", bottom: Math.round(box * 0.18), width: Math.round(box * 0.36), height: 2,
          marginLeft: -Math.round(box * 0.18), borderRadius: 2, background: ACCENT,
        }} />
      )}
    </span>
  );
}

function Separator({ ch, box }) {
  return (
    <span style={{
      width: SEP_W, height: Math.round(box * 1.2), flexShrink: 0, display: "grid", placeItems: "center",
      color: C.t3, fontSize: Math.round(box * 0.5), fontWeight: 700, fontFamily: FONT,
    }}>
      {ch === " " ? "" : ch}
    </span>
  );
}

const rowStyle = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: `${ROW_GAP}px ${GAP}px` };

/** 作答用的格子。value 只含字母（sanitizeSpelling 收拾过），ghost 是「再拼一次」时第一格的提示字母。 */
export function SpellingInput({ word, value, onChange, inputRef, ghost = "", label = "拼写英文单词" }) {
  const slots = spellingSlots(word);
  const { ref, box, rowWidth } = useBoxSize(slots);
  const [focused, setFocused] = useState(false);
  const typed = [...value];
  let n = 0;
  // 透明输入框里点到中间会把光标放到中间去，而格子总是从左往右填 —— 光标钉在末尾，两边才对得上。
  const keepCaretAtEnd = (e) => {
    const end = e.target.value.length;
    if (e.target.selectionStart !== end || e.target.selectionEnd !== end) e.target.setSelectionRange(end, end);
  };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div aria-hidden="true" style={{ ...rowStyle, maxWidth: rowWidth ?? undefined }}>
        {slots.map((slot, i) => {
          if (!slot.letter) return <Separator key={i} ch={slot.ch} box={box} />;
          const idx = n++;
          const letter = typed[idx] || "";
          const active = focused && idx === typed.length;
          return (
            <Box
              key={i} box={box} letter={letter} caret={active}
              tone={active ? "active" : letter ? "filled" : "empty"}
              ghost={idx === 0 ? ghost : ""}
            />
          );
        })}
      </div>
      <input
        ref={inputRef}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(sanitizeSpelling(e.target.value, word))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSelect={keepCaretAtEnd}
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
    </div>
  );
}

/**
 * 核对后的正确拼写：拼对整排绿；拼错时漏写 / 写错的那几个字母标红（按对齐算，见 missedLetters）；
 * 没写（想不起来）就整排中性色摆出来。
 */
export function SpellingAnswer({ word, typed, result }) {
  const slots = spellingSlots(word);
  const { ref, box, rowWidth } = useBoxSize(slots);
  const missed = result === "incorrect" ? missedLetters(typed, word) : [];
  let n = 0;
  return (
    <div ref={ref}>
      <div role="group" aria-label={`正确拼写 ${word}`} style={{ ...rowStyle, maxWidth: rowWidth ?? undefined }}>
        {slots.map((slot, i) => {
          if (!slot.letter) return <Separator key={i} ch={slot.ch} box={box} />;
          const idx = n++;
          const tone = result === "correct" ? "correct" : result === "incorrect" ? (missed[idx] ? "missed" : "plain") : "answer";
          return <Box key={i} box={box} letter={slot.ch} tone={tone} />;
        })}
      </div>
    </div>
  );
}
