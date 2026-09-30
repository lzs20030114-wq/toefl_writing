"use client";
import { useRef, useState } from "react";
import { HOME_FONT } from "../home/theme";
import { HomeCollapse } from "../home/HomeCollapse";
import { SpeakButton } from "../shared/SpeakButton";
import { callAI } from "../../lib/ai/client";
import { getSavedCode } from "../../lib/AuthContext";
import { getCard, isSaved, saveWord } from "../../lib/vocab/vocabStore";
import { buildRootPrompts, normalizeRoot, parseRootResult } from "../../lib/vocab/rootExplorer";
import styles from "./RootExplorer.module.css";

const CACHE_KEY = "toefl-root-explorer-v1";
const CACHE_AGE_MS = 30 * 86400000;
const REVIEW_MODES = [["reading", "阅读词"], ["listening", "听力词"]];

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

// 单词本主栏里的折叠面板：收起时只剩标题 + 输入框一条细栏，展开后词条按主栏宽度排列，不再有内层滚动。
export default function RootExplorer() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [savedWords, setSavedWords] = useState({});
  const [reviewModes, setReviewModes] = useState({});
  const [expanded, setExpanded] = useState(true);
  const requestId = useRef(0);
  const panelRef = useRef(null);

  // 改输入只作废进行中的请求；已有结果留到下一次查询再换，面板不随每次按键收起。
  function changeInput(event) {
    setInput(event.target.value);
    setError("");
    if (pending) {
      requestId.current += 1;
      setPending(false);
    }
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

  // 底部的收起钮：结果很长时不用滚回顶部，收起后把视口带回面板顶部。
  function collapseFromBottom() {
    setExpanded(false);
    panelRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }

  const modeOf = (word) => reviewModes[word] || getCard(word)?.reviewMode || "reading";

  function chooseMode(word, mode) {
    setReviewModes((prev) => ({ ...prev, [word]: mode }));
    const existing = getCard(word);
    if (existing) saveWord({ ...existing, reviewMode: mode });
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

  const subtitle = result
    ? <><b>{result.root}</b> · {result.words.length} 个词{result.rootMeaning ? ` · ${result.rootMeaning}` : ""}</>
    : pending ? "正在整理词族…" : "输入词根，AI 整理同族词的词性、构词和区别";

  return (
    <section ref={panelRef} className={styles.panel} aria-labelledby="root-explorer-title" style={{ fontFamily: HOME_FONT }}>
      <div className={styles.bar}>
        <span className={styles.mark} aria-hidden="true">根</span>
        <div className={styles.title}>
          <h2 id="root-explorer-title">词根查询</h2>
          <div className={styles.subtitle}>{subtitle}</div>
        </div>
        <form className={styles.search} onSubmit={search}>
          <div className={styles.field}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input aria-label="输入词根" value={input} onChange={changeInput}
              placeholder="例如 organ、struct、spect" maxLength={20} autoComplete="off" spellCheck={false} />
          </div>
          <button type="submit" className={styles.submit} disabled={pending}>{pending ? "整理中…" : "查词根"}</button>
        </form>
        {result && <button type="button" className={styles.toggle} aria-expanded={expanded}
          aria-controls="root-explorer-results" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起" : "展开"}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
        </button>}
      </div>
      <HomeCollapse open={Boolean(pending || error || (result && expanded))} id="root-explorer-results" label="词根查询结果">
        <div className={styles.body}>
          {pending && <>
            <div role="status" className={styles.status}>正在整理词族，请稍候…</div>
            <div className={styles.grid} aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className={styles.skeleton} />)}</div>
          </>}
          {error && <div role="alert" className={styles.error}>{error}</div>}
          {result && <>
            <div className={styles.summary}>
              <div className={styles.rootWord}>{result.root}</div>
              <div className={styles.info}>
                {result.rootMeaning && <div className={styles.rootMeaning}>{result.rootMeaning}</div>}
                {result.memoryTip && <div className={styles.tip}><b>记忆提示</b>{result.memoryTip}</div>}
                <div className={styles.note}>
                  由 AI 筛选整理，非 ETS 官方高频词表；词义请结合语境核对。
                  {fromCache && <span className={styles.cached}>已保存的查询</span>}
                </div>
              </div>
            </div>
            <div className={styles.grid}>
              {result.words.map((item) => {
                const saved = savedWords[item.word] || isSaved(item.word);
                const mode = modeOf(item.word);
                return (
                  <article key={item.word} className={styles.word} aria-label={item.word}>
                    <div className={styles.wordHead}>
                      <strong>{item.word}</strong>
                      <SpeakButton word={item.word} size={24} title={`朗读 ${item.word}`} />
                      <span className={styles.pos}>{item.partOfSpeech}</span>
                    </div>
                    <div className={styles.wordMeaning}>{item.meaning}</div>
                    <dl className={styles.facts}>
                      <dt>构词</dt><dd>{item.formation}</dd>
                      <dt>区别</dt><dd>{item.difference}</dd>
                    </dl>
                    <div className={styles.wordFoot}>
                      <div role="group" aria-label={`${item.word} 复习类型`} className={styles.modes}>
                        {REVIEW_MODES.map(([value, label]) => (
                          <button key={value} type="button" aria-pressed={mode === value}
                            onClick={() => chooseMode(item.word, value)}>{label}</button>
                        ))}
                      </div>
                      <button type="button" className={styles.save} onClick={() => addWord(item)} disabled={saved}>
                        <span aria-hidden="true">{saved ? "✓" : "☆"}</span>{saved ? "已收藏" : "收藏"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            <button type="button" className={styles.collapseBottom} aria-controls="root-explorer-results"
              onClick={collapseFromBottom}>
              收起 {result.root} 词族
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
            </button>
          </>}
        </div>
      </HomeCollapse>
    </section>
  );
}
