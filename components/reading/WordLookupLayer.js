"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { lookupWord, normalizeWord, prefetchShards } from "../../lib/dict/lookup";
import { sentenceAround } from "../../lib/dict/core";
import { getSavedTier } from "../../lib/AuthContext";
import { callAI } from "../../lib/ai/client";

// 复盘时的划词小词典：把原文容器包一层，点词或划词就在词边上弹出释义。
//
// 之所以做成「包一层」而不是把每个词渲染成可点的 span：复盘页的原文有两种形态
// （CTW 是 passage.split(/\s+/) 后的 span 序列，RDL/模考是一整个文本节点），
// 用 Range 取词对两种形态都成立，也就不用动任何现有渲染代码。

const POP_W = 300;
const AI_CACHE_KEY = "dict-ai-explain-cache";
const MAX_AI_CACHE = 120;

const SYSTEM =
  "你是一位 TOEFL 阅读辅导老师。学生在复盘文章时查了一个词，请用中文简短说明（2-4 句）：" +
  "1）这个词在这一句里是哪个意思（词典可能列了多个义项，指出此处用的是哪个）；" +
  "2）如果它在学术阅读里有常见搭配、词根线索或易混词，点一句。" +
  "不要翻译整句，不要罗列所有义项，不要空话。";

const WORD_CHAR = /[A-Za-z0-9'’‐-]/;

function isWordChar(ch) {
  return WORD_CHAR.test(ch);
}

/** 点击位置 → 该处整个单词的 Range（点在空白或标点上则返回 null）。 */
function wordRangeFromPoint(x, y) {
  let range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }
  if (!range) return null;
  const node = range.startContainer;
  if (!node || node.nodeType !== 3) return null;

  const text = node.textContent || "";
  let i = range.startOffset;
  // 光标常落在词尾右侧（"cell|. "），往左退一格再判。
  if (i >= text.length || !isWordChar(text[i])) {
    if (i > 0 && isWordChar(text[i - 1])) i -= 1;
    else return null;
  }
  let s = i;
  let e = i;
  while (s > 0 && isWordChar(text[s - 1])) s -= 1;
  while (e < text.length && isWordChar(text[e])) e += 1;
  if (e <= s) return null;

  const r = document.createRange();
  r.setStart(node, s);
  r.setEnd(node, e);
  return r;
}

function loadAiCache() {
  try {
    return JSON.parse(localStorage.getItem(AI_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveAiCache(key, text) {
  try {
    const cache = loadAiCache();
    cache[key] = text;
    const keys = Object.keys(cache);
    if (keys.length > MAX_AI_CACHE) {
      keys.slice(0, keys.length - MAX_AI_CACHE).forEach((k) => delete cache[k]);
    }
    localStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

/**
 * 用法：<WordLookupLayer passage={passage}>…原文…</WordLookupLayer>
 * 带 data-no-dict 属性的子节点（例如 CTW 里点开解析的填空 chip）不触发查词。
 */
export function WordLookupLayer({ passage, children, style }) {
  const popRef = useRef(null);
  const [pop, setPop] = useState(null); // { word, rect, entry, loading, notFound }
  const [ai, setAi] = useState(null); // { loading, text, error }

  const tier = typeof window !== "undefined" ? getSavedTier() : null;
  const isPro = tier === "legacy" || tier === "pro";

  const close = useCallback(() => {
    setPop(null);
    setAi(null);
  }, []);

  // 文章用到哪些首字母就预热哪些分片，点词时不必等网络。
  useEffect(() => {
    if (!passage) return;
    const letters = new Set();
    const lower = String(passage).toLowerCase();
    for (const m of lower.matchAll(/\b[a-z]/g)) letters.add(m[0]);
    prefetchShards([...letters]);
  }, [passage]);

  const openFor = useCallback(async (raw, rect) => {
    const word = normalizeWord(raw);
    if (!word || !/[a-z]/.test(word)) return;
    setAi(null);
    setPop({ word, rect, entry: null, loading: true, notFound: false });
    const entry = await lookupWord(word);
    setPop((prev) =>
      prev && prev.word === word
        ? { ...prev, entry, loading: false, notFound: !entry }
        : prev
    );
  }, []);

  const handlePick = useCallback(
    (ev) => {
      if (ev.target && ev.target.closest && ev.target.closest("[data-no-dict]")) return;
      if (popRef.current && popRef.current.contains(ev.target)) return;

      const sel = window.getSelection();
      const picked = sel && !sel.isCollapsed ? sel.toString().trim() : "";
      if (picked) {
        // 划词：限制在一句以内，别把整段当词查
        if (picked.length > 60 || picked.split(/\s+/).length > 6) return;
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        openFor(picked, rect);
        return;
      }
      const r = wordRangeFromPoint(ev.clientX, ev.clientY);
      if (!r) {
        close();
        return;
      }
      openFor(r.toString(), r.getBoundingClientRect());
    },
    [openFor, close]
  );

  // 手指长按选词后 selection 要一拍才稳定
  const handleTouch = useCallback(
    (ev) => {
      const t = ev.changedTouches && ev.changedTouches[0];
      if (!t) return;
      const point = { target: ev.target, clientX: t.clientX, clientY: t.clientY };
      setTimeout(() => handlePick(point), 10);
    },
    [handlePick]
  );

  useEffect(() => {
    if (!pop) return undefined;
    const onDown = (e) => {
      if (!popRef.current || !popRef.current.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    // 页面一滚动，词的位置就变了，直接收起最省事
    const onScroll = () => close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [pop, close]);

  const askAi = useCallback(async () => {
    if (!pop) return;
    const sentence = sentenceAround(passage, pop.word) || pop.word;
    const key = `${pop.word}|||${sentence.slice(0, 80)}`;
    const cached = loadAiCache()[key];
    if (cached) {
      setAi({ loading: false, text: cached, error: null });
      return;
    }
    setAi({ loading: true, text: null, error: null });
    try {
      const message =
        `句子：${sentence}\n` +
        `学生查的词：${pop.word}\n` +
        (pop.entry && pop.entry.t
          ? `词典释义：${pop.entry.t.replace(/\n/g, "；")}`
          : "词典未收录这个词。");
      const text = await callAI(SYSTEM, message, 260, 60000, 0.3);
      saveAiCache(key, text);
      setAi({ loading: false, text, error: null });
    } catch (e) {
      setAi({ loading: false, text: null, error: e.message || "请求失败" });
    }
  }, [pop, passage]);

  // 贴在词的正下方；下方装不下就翻到上方，左右不越界。
  let popStyle = null;
  if (pop && pop.rect) {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const below = vh - pop.rect.bottom > 200;
    const left = Math.max(
      8,
      Math.min(pop.rect.left + pop.rect.width / 2 - POP_W / 2, vw - POP_W - 8)
    );
    popStyle = below
      ? { top: Math.round(pop.rect.bottom + 8), left: Math.round(left) }
      : { bottom: Math.round(vh - pop.rect.top + 8), left: Math.round(left) };
  }

  return (
    <div onMouseUp={handlePick} onTouchEnd={handleTouch} style={style}>
      {children}
      {pop && popStyle && (
        <div
          ref={popRef}
          onMouseUp={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            ...popStyle,
            width: POP_W,
            // 不加这行的话 padding 会撑出 POP_W，靠右边的词弹窗会溢出视口
            boxSizing: "border-box",
            maxHeight: 300,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #d8e0da",
            borderRadius: 12,
            boxShadow: "0 8px 28px rgba(15, 42, 30, 0.16)",
            padding: "12px 14px",
            zIndex: 4000,
            fontSize: 13,
            lineHeight: 1.6,
            color: "#22322a",
            cursor: "auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#14281e" }}>
              {(pop.entry && pop.entry.word) || pop.word}
            </span>
            {pop.entry && pop.entry.p && (
              <span
                style={{
                  fontSize: 12,
                  color: "#6b8078",
                  fontFamily: "'Courier New', monospace",
                }}
              >
                /{pop.entry.p}/
              </span>
            )}
            {pop.entry && pop.entry.g && (
              <span
                style={{
                  fontSize: 10,
                  color: "#3f7a5c",
                  background: "#e8f5ee",
                  borderRadius: 5,
                  padding: "1px 6px",
                  fontWeight: 600,
                }}
              >
                {pop.entry.g}
              </span>
            )}
            <button
              onClick={close}
              aria-label="关闭"
              style={{
                marginLeft: "auto",
                border: "none",
                background: "transparent",
                color: "#9aa8a1",
                fontSize: 16,
                cursor: "pointer",
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </div>

          {pop.loading && (
            <div style={{ marginTop: 8, color: "#8a9a92", fontSize: 12 }}>查询中…</div>
          )}
          {!pop.loading && pop.entry && pop.entry.t && (
            <div style={{ marginTop: 8, whiteSpace: "pre-wrap", color: "#31423a" }}>
              {pop.entry.t}
            </div>
          )}
          {!pop.loading && pop.notFound && (
            <div style={{ marginTop: 8, color: "#8a9a92", fontSize: 12 }}>
              词库里没有这个词{isPro ? "，可以让 AI 按上下文讲一下。" : "。"}
            </div>
          )}

          {isPro && !pop.loading && (
            <div style={{ marginTop: 10, borderTop: "1px solid #eef2ef", paddingTop: 8 }}>
              {ai && ai.text ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "#0c4a6e",
                    background: "#f0f9ff",
                    border: "1px solid #bae6fd",
                    borderRadius: 8,
                    padding: "8px 10px",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {ai.text}
                </div>
              ) : (
                <>
                  <button
                    onClick={askAi}
                    disabled={ai && ai.loading}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#fff",
                      background: ai && ai.loading ? "#9ca3af" : "#0284c7",
                      border: "none",
                      borderRadius: 6,
                      padding: "5px 12px",
                      cursor: ai && ai.loading ? "default" : "pointer",
                    }}
                  >
                    {ai && ai.loading ? "分析中…" : "讲讲这句里的用法"}
                  </button>
                  {ai && ai.error && (
                    <span style={{ fontSize: 11, color: "#E11D48", marginLeft: 8 }}>
                      {ai.error}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
