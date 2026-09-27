"use client";
import { useRef, useState } from "react";
import { C, FONT, SurfaceCard } from "../shared/ui";
import { HOME_FONT, HOME_TOKENS } from "../home/theme";
import { HomeCollapse } from "../home/HomeCollapse";
import { SpeakButton } from "../shared/SpeakButton";
import { callAI } from "../../lib/ai/client";
import { getSavedCode } from "../../lib/AuthContext";
import { getCard, isSaved, saveWord } from "../../lib/vocab/vocabStore";
import { buildRootPrompts, normalizeRoot, parseRootResult } from "../../lib/vocab/rootExplorer";

const ACCENT = HOME_TOKENS.primary;
const CACHE_KEY = "toefl-root-explorer-v1";
const CACHE_AGE_MS = 30 * 86400000;

function readCached(root) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    const entry = all[root];
    if (Date.now() - entry?.at > CACHE_AGE_MS) return null;
    return parseRootResult(JSON.stringify(entry.result), root);
  } catch { return null; }
}

function writeCached(result) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    all[result.root] = { at: Date.now(), result };
    const recent = Object.entries(all)
      .filter(([, entry]) => Date.now() - entry?.at <= CACHE_AGE_MS)
      .sort((a, b) => b[1].at - a[1].at).slice(0, 30);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(recent)));
  } catch { /* 缓存失败不影响查词 */ }
}

function errorMessage(error) {
  if (error?.code === "DAILY_LIMIT") return "今天的 AI 使用次数已用完，明天再试。";
  if (error?.status === 403) return "请先登录，再使用 AI 查词根。";
  if (error?.status === 429) return "查询太频繁了，请稍后再试。";
  if (error?.message === "API timeout") return "查询超时，请重试。";
  return error?.message?.startsWith("API error") ? "AI 暂时不可用，请稍后重试。" : (error?.message || "查询失败，请重试。");
}

export default function RootExplorer({ compact = false }) {
  const font = compact ? HOME_FONT : FONT;
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [savedWords, setSavedWords] = useState({});
  const [reviewModes, setReviewModes] = useState({});
  const [expanded, setExpanded] = useState(true);
  const requestId = useRef(0);

  function changeInput(event) {
    requestId.current += 1;
    setInput(event.target.value);
    setPending(false);
    setError("");
    setResult(null);
    setFromCache(false);
    setExpanded(true);
  }

  async function search(event) {
    event.preventDefault();
    if (pending) return;
    const currentRequest = ++requestId.current;
    setError("");
    setResult(null);
    setFromCache(false);
    setExpanded(true);
    const root = normalizeRoot(input);
    if (!root) {
      setError("请输入 2–20 个英文字母，例如 organ、struct。暂不支持空格或斜杠。");
      return;
    }
    const cached = readCached(root);
    if (cached) {
      setResult(cached);
      setFromCache(true);
      return;
    }
    if (!getSavedCode()) {
      setError("请先登录，再使用 AI 查词根。");
      return;
    }
    setPending(true);
    setResult(null);
    try {
      const { system, message } = buildRootPrompts(root);
      const content = await callAI(system, message, 5000, 150000, 0.1);
      const parsed = parseRootResult(content, root);
      writeCached(parsed);
      if (requestId.current === currentRequest) setResult(parsed);
    } catch (e) {
      if (requestId.current === currentRequest) setError(errorMessage(e));
    } finally {
      if (requestId.current === currentRequest) setPending(false);
    }
  }

  function addWord(item) {
    const saved = saveWord({
      word: item.word,
      display: item.word,
      def: `${item.partOfSpeech} ${item.meaning}`,
      defFull: `${item.partOfSpeech} ${item.meaning}`,
      tag: `词根 ${result.root}`,
      source: "root-explorer",
      reviewMode: reviewModes[item.word] || "reading",
    });
    if (saved) setSavedWords((prev) => ({ ...prev, [item.word]: true }));
  }

  return (
    <>
    <style jsx global>{`@media (prefers-reduced-motion: reduce) { .root-explorer-card .home-collapse-panel, .root-explorer-card .home-collapse-panel > div { transition-duration: 0.01ms !important; } }`}</style>
    <SurfaceCard className="root-explorer-card" style={{ padding: compact ? "14px 13px" : "18px 20px", marginBottom: compact ? 0 : 14, minWidth: 0, maxWidth: "100%", boxSizing: "border-box", background: HOME_TOKENS.card, borderColor: HOME_TOKENS.bdr, borderRadius: 13, fontFamily: font }}>
      <div style={{ fontSize: compact ? 14 : 16, fontWeight: 800, color: HOME_TOKENS.t1 }}>词根查询</div>
      {!compact && <div style={{ fontSize: 12, color: HOME_TOKENS.t2, lineHeight: 1.7, marginTop: 4 }}>
        输入一个词根或词族核心，AI 会整理备考相关词的词性、意思、构词和区别。
      </div>}
      <form onSubmit={search} style={{ display: "flex", gap: 7, marginTop: compact ? 10 : 13, flexWrap: compact ? "nowrap" : "wrap", minWidth: 0 }}>
        <input
          aria-label="输入词根"
          value={input}
          onChange={changeInput}
          placeholder={compact ? "例如 organ" : "例如 organ、struct、spect"}
          maxLength={20}
          autoComplete="off"
          style={{ flex: compact ? "1 1 0" : "1 1 210px", minWidth: 0, width: compact ? 0 : undefined, boxSizing: "border-box", padding: compact ? "8px 9px" : "9px 12px", border: `1px solid ${HOME_TOKENS.bdr}`, borderRadius: 9, fontSize: compact ? 12 : 14, fontFamily: font }}
        />
        <button type="submit" disabled={pending} style={{ flexShrink: 0, border: 0, borderRadius: 9, padding: compact ? "8px 9px" : "9px 18px", background: pending ? HOME_TOKENS.t3 : ACCENT, color: "#fff", fontSize: compact ? 11 : 14, fontWeight: 700, cursor: pending ? "default" : "pointer", fontFamily: font }}>
          {pending ? "整理中…" : "查词根"}
        </button>
      </form>
      {result && <button type="button" aria-expanded={expanded} aria-controls="root-explorer-results" onClick={() => setExpanded((value) => !value)} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 12, border: 0, background: "transparent", color: ACCENT, fontSize: 12, fontWeight: 700, textAlign: "left", cursor: "pointer", padding: 0, fontFamily: font }}>
        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{result.root} · {result.words.length} 个词</span><span aria-hidden="true">{expanded ? "收起⌃" : "展开⌄"}</span>
      </button>}
      <HomeCollapse open={Boolean(pending || error || (result && expanded))} id="root-explorer-results" label="词根查询结果">
        {pending && <div role="status" style={{ color: HOME_TOKENS.t2, fontSize: 12, marginTop: 12 }}>正在整理词族，请稍候…</div>}
        {error && <div role="alert" style={{ color: C.red, fontSize: 12, lineHeight: 1.6, marginTop: 12, overflowWrap: "anywhere" }}>{error}</div>}
        {result && (
        <div style={{ marginTop: 12, minWidth: 0, overflowWrap: "anywhere" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 19, color: C.t1 }}>{result.root}</strong>
            {result.rootMeaning && <span style={{ fontSize: 13, color: C.t2 }}>{result.rootMeaning}</span>}
            {fromCache && <span style={{ fontSize: 11, color: C.t3 }}>已保存的查询</span>}
          </div>
          {result.memoryTip && <div style={{ fontSize: 12, color: C.t2, marginTop: 5 }}>记忆提示：{result.memoryTip}</div>}
          <div style={{ fontSize: 11, color: C.t3, marginTop: 7 }}>由 AI 筛选整理，非 ETS 官方高频词表；词义请结合语境核对。</div>
          <div role={compact ? "region" : undefined} aria-label={compact ? "词族词条" : undefined} tabIndex={compact ? 0 : undefined} style={{ display: "grid", gridTemplateColumns: compact ? "minmax(0, 1fr)" : "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 10, marginTop: 13, minWidth: 0, maxHeight: compact ? "min(52vh, 480px)" : undefined, overflowY: compact ? "auto" : undefined, overscrollBehaviorY: compact ? "contain" : undefined }}>
            {result.words.map((item) => {
              const saved = savedWords[item.word] || isSaved(item.word);
              return (
                <div key={item.word} style={{ border: `1px solid ${HOME_TOKENS.bdrSubtle}`, borderRadius: 10, padding: compact ? "10px 9px" : "12px 13px", minWidth: 0, overflowWrap: "anywhere" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 15, color: C.t1, overflowWrap: "anywhere" }}>{item.word}</strong>
                    <SpeakButton word={item.word} size={26} title={`朗读 ${item.word}`} />
                    <span style={{ color: ACCENT, fontSize: 11, fontWeight: 700 }}>{item.partOfSpeech}</span>
                    <button type="button" onClick={() => addWord(item)} disabled={saved} style={{ marginLeft: "auto", border: `1px solid ${saved ? C.bdr : ACCENT}`, background: saved ? C.bdrSubtle : HOME_TOKENS.primarySoft, color: saved ? C.t3 : ACCENT, borderRadius: 7, padding: "3px 8px", fontSize: 11, fontFamily: font, cursor: saved ? "default" : "pointer" }}>
                      {saved ? "已收藏" : "收藏"}
                    </button>
                  </div>
                  <div role="group" aria-label={`${item.word} 复习类型`} style={{ display: "flex", gap: 5, marginTop: 5 }}>
                      {[["reading", "阅读词"], ["listening", "听力词"]].map(([mode, label]) => (
                        <button key={mode} type="button" aria-pressed={(reviewModes[item.word] || getCard(item.word)?.reviewMode || "reading") === mode}
                          onClick={() => {
                            setReviewModes((prev) => ({ ...prev, [item.word]: mode }));
                            const existing = getCard(item.word);
                            if (existing) saveWord({ ...existing, reviewMode: mode });
                          }}
                          style={{ border: `1px solid ${(reviewModes[item.word] || getCard(item.word)?.reviewMode || "reading") === mode ? ACCENT : C.bdr}`, background: (reviewModes[item.word] || getCard(item.word)?.reviewMode || "reading") === mode ? HOME_TOKENS.primarySoft : "#fff", color: C.t2, borderRadius: 999, padding: "2px 8px", fontSize: 11, fontFamily: font, cursor: "pointer" }}>
                          {label}
                        </button>
                      ))}
                  </div>
                  <div style={{ color: C.t1, fontSize: 13, marginTop: 5 }}>{item.meaning}</div>
                  <div style={{ color: C.t2, fontSize: 11.5, lineHeight: 1.6, marginTop: 6 }}>构词：{item.formation}</div>
                  <div style={{ color: C.t2, fontSize: 11.5, lineHeight: 1.6, marginTop: 3 }}>区别：{item.difference}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </HomeCollapse>
    </SurfaceCard>
    </>
  );
}
