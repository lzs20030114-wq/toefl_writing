"use client";
import { useEffect, useRef, useState } from "react";
import { HOME_FONT } from "../home/theme";
import { HomeCollapse } from "../home/HomeCollapse";
import { SpeakButton } from "../shared/SpeakButton";
import { callAI } from "../../lib/ai/client";
import { AUTH_CHANGED_EVENT, getSavedCode } from "../../lib/AuthContext";
import { getCard, getVocabAccountKey, getVocabStorageStatus, loadBook, saveWord, writeBook, VOCAB_UPDATED_EVENT } from "../../lib/vocab/vocabStore";
import { normalizeCard } from "../../lib/vocab/book";
import { validateVocabularyEntry } from "../../lib/vocab/importVocabulary";
import { VOCAB_CARD_MAX_BYTES, vocabularyCardBytes } from "../../lib/vocab/syncLimits";
import { normalizeMeaningQuery, buildMeaningPrompts, parseMeaningResult, meaningWordEntry, readMeaningHistory, readMeaningCached, cacheMeaningResult } from "../../lib/vocab/meaningExplorer";
import styles from "./RootExplorer.module.css";
import extra from "./MeaningExplorer.module.css";

function errorMessage(error) {
  if (["DAILY_LIMIT", "PRO_DAILY_CAP"].includes(error?.code)) return "今天的 AI 使用次数已用完，明天再试。";
  if ([401, 403].includes(error?.status)) return "请先登录，再使用 AI 中文找词。";
  if (error?.status === 429) return "查询太频繁了，请稍后再试。";
  if (/timeout|超时/i.test(error?.message || "")) return "查询超时，请重试。";
  return "AI 暂时不可用，请稍后重试。";
}

// 只记当前查看的查询，结果仍从有期限、已校验的账户缓存读取。
function selectedKey(account) { return `toefl-meaning-selected::${account}`; }
function rememberSelection(account, query) {
  try { sessionStorage.setItem(selectedKey(account), query); } catch {}
}
function selectedResult(account, recent) {
  try {
    const query = sessionStorage.getItem(selectedKey(account));
    return recent.find((entry) => entry.result.query === query)?.result || recent[0]?.result || null;
  } catch { return recent[0]?.result || null; }
}

export default function MeaningExplorer({ onStudyGroup, accountKey, ready = true }) {
  const [account, setAccount] = useState(() => accountKey || getVocabAccountKey());
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [groupMode, setGroupMode] = useState("reading");
  const [, refresh] = useState(0);
  const requestId = useRef(0);
  const mounted = useRef(true);
  const panelRef = useRef(null);
  const current = () => mounted.current && ready && account === getVocabAccountKey() && (!accountKey || account === accountKey);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestId.current += 1; };
  }, []);
  useEffect(() => {
    function update() {
      const next = accountKey || getVocabAccountKey();
      if (next !== account || getVocabAccountKey() !== account) { requestId.current += 1; setPending(false); setResult(null); setError(""); setNotice(""); }
      setAccount(next);
      refresh((v) => v + 1);
    }
    window.addEventListener(VOCAB_UPDATED_EVENT, update);
    window.addEventListener(AUTH_CHANGED_EVENT, update);
    window.addEventListener("storage", update);
    update();
    return () => {
      window.removeEventListener(VOCAB_UPDATED_EVENT, update);
      window.removeEventListener(AUTH_CHANGED_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [accountKey, account]);
  useEffect(() => {
    requestId.current += 1;
    setPending(false); setNotice(""); setError("");
    const recent = ready && account === getVocabAccountKey() ? readMeaningHistory(account) : [];
    const selected = selectedResult(account, recent);
    setHistory(recent);
    setResult(selected);
    setInput(selected?.query || "");
    setFromCache(Boolean(selected));
  }, [account, ready]);

  function changeInput(event) {
    setInput(event.target.value); setError("");
    requestId.current += 1; setPending(false);
  }
  async function search(event) {
    event.preventDefault();
    if (!current() || pending) return;
    const query = normalizeMeaningQuery(input);
    setError(""); setNotice(""); setExpanded(true);
    if (!query) { setError("请输入 1–30 个字符的中文词或短语，例如 妨碍、坚持、重要。"); return; }
    const cached = readMeaningCached(query, account);
    if (cached) { setResult(cached); setFromCache(true); rememberSelection(account, cached.query); return; }
    if (!getSavedCode()) { setError("请先登录，再使用 AI 中文找词。"); return; }
    const id = ++requestId.current;
    const requestAccount = account;
    const valid = () => mounted.current && id === requestId.current && requestAccount === getVocabAccountKey();
    setResult(null); setFromCache(false); setPending(true);
    try {
      const { system, message } = buildMeaningPrompts(query);
      const raw = await callAI(system, message, 6000, 150000, 0.1);
      if (!valid()) return;
      const parsed = parseMeaningResult(raw, query);
      if (!valid()) return;
      setResult(parsed);
      rememberSelection(requestAccount, parsed.query);
      if (!cacheMeaningResult(requestAccount, parsed)) setNotice("本次查询尚未保存到本地，关闭页面后可能丢失。");
      setHistory(readMeaningHistory(requestAccount));
    } catch (e) { if (valid()) setError(errorMessage(e)); }
    finally { if (valid()) setPending(false); }
  }
  function saveCandidates(items) {
    if (!current()) { setNotice("账号已变化，请在当前账号重新打开查询。"); return false; }
    const entries = items.filter((item) => !getCard(item.word)).map((item) => meaningWordEntry(item, result.query, groupMode));
    for (const entry of entries) {
      if (validateVocabularyEntry(entry) || vocabularyCardBytes(normalizeCard(entry)) > VOCAB_CARD_MAX_BYTES) {
        setNotice("词条内容过长或不完整，尚未收藏本组新词。请重新查询。"); return false;
      }
    }
    // 配额失败后，getCard 可读到内存副本；重试写整个现有快照，不重新收藏或改变卡片。
    if (!getVocabStorageStatus().persisted && current()) writeBook(loadBook());
    for (const entry of entries) {
      if (!current() || !saveWord(entry)) { setNotice("收藏未完成，请重试。"); return false; }
    }
    refresh((v) => v + 1);
    if (!getVocabStorageStatus().persisted) { setNotice("本地存储空间不足，收藏暂存在本次页面内，尚未可靠保存；请释放空间后重试。"); return false; }
    setNotice(entries.length ? `已收藏 ${entries.length} 个新词，已有词保留原设置。` : "这些词已在单词本中，保留原设置。");
    return true;
  }
  function study() {
    if (!saveCandidates(result.words) || !current()) return;
    const outcome = onStudyGroup?.({ words: result.words.map((item) => item.word), mode: groupMode, account, query: result.query });
    if (!outcome?.started) setNotice(outcome?.reason || "本组暂无可复习的词，词条可能已暂停或账号已变化。");
  }
  function showRecent(entry) {
    if (!current()) return;
    requestId.current += 1; setPending(false); setError(""); setNotice("");
    setInput(entry.result.query); setResult(entry.result); setFromCache(true); setExpanded(true);
    rememberSelection(account, entry.result.query);
  }
  const subtitle = result ? <><b>{result.query}</b> · {result.words.length} 个英文表达</> : "从中文意思出发，比较英文表达的场景和区别";
  return <section ref={panelRef} className={styles.panel} aria-labelledby="meaning-explorer-title" style={{ fontFamily: HOME_FONT }}>
    <div className={styles.bar}>
      <span className={styles.mark} aria-hidden="true">意</span>
      <div className={styles.title}><h2 id="meaning-explorer-title">中文找词</h2><div className={styles.subtitle}>{subtitle}</div></div>
      <form className={styles.search} onSubmit={search}>
        <div className={styles.field}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input aria-label="输入中文词或短语" placeholder="例如 妨碍、坚持、重要" value={input}
            onChange={changeInput} maxLength={30} autoComplete="off" />
        </div>
        <button className={styles.submit} disabled={pending || !ready}>{pending ? "整理中…" : "找英文表达"}</button>
      </form>
      {result && <button className={styles.toggle} type="button" aria-expanded={expanded} aria-controls="meaning-explorer-results" onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : "展开"}</button>}
    </div>
    {history.length > 0 && <div className={extra.recent} aria-label="最近中文查询"><span>最近查询</span>{history.map((entry) => <button key={entry.result.query} type="button" onClick={() => showRecent(entry)}>{entry.result.query}</button>)}</div>}
    <HomeCollapse open={Boolean(pending || error || (result && expanded))} id="meaning-explorer-results" label="中文找词结果"><div className={styles.body}>
      {pending && <div role="status" className={styles.status}>正在整理英文表达，请稍候…</div>}
      {error && <div role="alert" className={styles.error}>{error}</div>}
      {notice && <div role="status" className={styles.status}>{notice}</div>}
      {result && <>
        <div className={styles.summary}>
          <div className={styles.rootWord}>{result.query}</div>
          <div className={styles.info}>
            <div className={styles.rootMeaning}>{result.summary}</div>
            {result.memoryTip && <div className={styles.tip}><b>记忆提示</b>{result.memoryTip}</div>}
            <div className={styles.note}>AI 整理{fromCache && <span className={styles.cached}>已保存的查询</span>}</div>
          </div>
        </div>
        <div className={extra.actions}>
          <div className={styles.modes} role="group" aria-label="本组复习类型">
            {[["reading", "阅读词"], ["listening", "听力词"]].map(([mode, label]) => (
              <button type="button" key={mode} aria-pressed={groupMode === mode}
                onClick={() => setGroupMode(mode)}>{label}</button>
            ))}
          </div>
          <button type="button" className={styles.save} onClick={() => saveCandidates(result.words)}>整组收藏</button>
          <button type="button" className={styles.submit} onClick={study}>一起背</button>
        </div>
        <div className={styles.grid}>
          {result.words.map((item) => (
            <article key={item.word} className={styles.word} aria-label={item.word}>
              <div className={styles.wordHead}>
                <strong>{item.word}</strong>
                <SpeakButton word={item.word} size={24} title={`朗读 ${item.word}`} />
                <span className={styles.pos}>{item.partOfSpeech}</span>
              </div>
              <div className={styles.wordMeaning}>{item.meaning}</div>
              <dl className={styles.facts}>
                <dt>场景</dt><dd>{item.usage}</dd>
                <dt>区别</dt><dd>{item.difference}</dd>
                <dt>搭配</dt><dd>{Array.isArray(item.collocations) ? item.collocations.join("；") : item.collocations}</dd>
              </dl>
              <div className={extra.example}>
                <div lang="en">{item.example}</div><div>{item.translation}</div>
              </div>
              <div className={styles.wordFoot}>
                <button type="button" className={styles.save} disabled={!current() || Boolean(getCard(item.word))}
                  onClick={() => saveCandidates([item])}>{getCard(item.word) ? "✓ 已收藏" : "☆ 收藏"}</button>
              </div>
            </article>
          ))}
        </div>
        <button type="button" className={styles.collapseBottom} aria-controls="meaning-explorer-results" onClick={() => { setExpanded(false); panelRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }); }}>收起 {result.query} 词组</button>
      </>}
    </div></HomeCollapse>
  </section>;
}
