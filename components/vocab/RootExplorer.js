"use client";
import { useState } from "react";
import { C, FONT, SurfaceCard } from "../shared/ui";
import { callAI } from "../../lib/ai/client";
import { getSavedCode } from "../../lib/AuthContext";
import { isSaved, saveWord } from "../../lib/vocab/vocabStore";
import { buildRootPrompts, normalizeRoot, parseRootResult } from "../../lib/vocab/rootExplorer";

const ACCENT = "#0891B2";
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

export default function RootExplorer() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [savedWords, setSavedWords] = useState({});

  async function search(event) {
    event.preventDefault();
    if (pending) return;
    setError("");
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
      setResult(parsed);
      setFromCache(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
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
    });
    if (saved) setSavedWords((prev) => ({ ...prev, [item.word]: true }));
  }

  return (
    <SurfaceCard style={{ padding: "18px 20px", marginBottom: 14 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: C.t1 }}>按词根找词</div>
      <div style={{ fontSize: 12, color: C.t2, lineHeight: 1.7, marginTop: 4 }}>
        输入一个词根或词族核心，AI 会整理备考相关词的词性、意思、构词和区别。
      </div>
      <form onSubmit={search} style={{ display: "flex", gap: 8, marginTop: 13, flexWrap: "wrap" }}>
        <input
          aria-label="输入词根"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="例如 organ、struct、spect"
          maxLength={20}
          autoComplete="off"
          style={{ flex: "1 1 210px", minWidth: 0, boxSizing: "border-box", padding: "9px 12px", border: `1px solid ${C.bdr}`, borderRadius: 9, fontSize: 14, fontFamily: FONT }}
        />
        <button type="submit" disabled={pending} style={{ border: 0, borderRadius: 9, padding: "9px 18px", background: pending ? C.t3 : ACCENT, color: "#fff", fontWeight: 700, cursor: pending ? "default" : "pointer", fontFamily: FONT }}>
          {pending ? "整理中…" : "查词根"}
        </button>
      </form>
      {error && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 10 }}>{error}</div>}
      {result && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 19, color: C.t1 }}>{result.root}</strong>
            {result.rootMeaning && <span style={{ fontSize: 13, color: C.t2 }}>{result.rootMeaning}</span>}
            {fromCache && <span style={{ fontSize: 11, color: C.t3 }}>已保存的查询</span>}
          </div>
          {result.memoryTip && <div style={{ fontSize: 12, color: C.t2, marginTop: 5 }}>记忆提示：{result.memoryTip}</div>}
          <div style={{ fontSize: 11, color: C.t3, marginTop: 7 }}>由 AI 筛选整理，非 ETS 官方高频词表；词义请结合语境核对。</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 10, marginTop: 13 }}>
            {result.words.map((item) => {
              const saved = savedWords[item.word] || isSaved(item.word);
              return (
                <div key={item.word} style={{ border: `1px solid ${C.bdrSubtle}`, borderRadius: 10, padding: "12px 13px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 15, color: C.t1, overflowWrap: "anywhere" }}>{item.word}</strong>
                    <span style={{ color: ACCENT, fontSize: 11, fontWeight: 700 }}>{item.partOfSpeech}</span>
                    <button type="button" onClick={() => addWord(item)} disabled={saved} style={{ marginLeft: "auto", border: `1px solid ${saved ? C.bdr : ACCENT}`, background: saved ? C.bdrSubtle : "#ECFEFF", color: saved ? C.t3 : ACCENT, borderRadius: 7, padding: "3px 8px", fontSize: 11, fontFamily: FONT, cursor: saved ? "default" : "pointer" }}>
                      {saved ? "已收藏" : "收藏"}
                    </button>
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
    </SurfaceCard>
  );
}
