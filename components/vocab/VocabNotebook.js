"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageShell } from "../shared/ui";
import { SpeakButton } from "../shared/SpeakButton";
import { HOME_FONT } from "../home/theme";
import { useVocabBook } from "./useVocabBook";
import { VocabReview } from "./VocabReview";
import { ListeningVocabReview } from "./ListeningVocabReview";
import { STATE, currentRetrievability, isDue } from "../../lib/vocab/srs";
import { MATURE_DAYS, sortByUrgency, reviewCard } from "../../lib/vocab/book";
import { humanizeDef } from "../../lib/dict/core";
import RootExplorer from "./RootExplorer";
import DailyQuotaCard from "./DailyQuotaCard";
import styles from "./VocabNotebook.module.css";

const PAGE_SIZE = 60;
const FILTERS = [
  ["all", "全部状态"], ["due", "今天要复习"], ["new", "还没开始"],
  ["learning", "学习中"], ["mature", "已记牢"],
];

function stateLabel(card, now) {
  if (card.state === STATE.NEW) return "未开始";
  if (card.state === STATE.LEARNING || card.state === STATE.RELEARNING) return "学习中";
  if ((card.scheduledDays || 0) >= MATURE_DAYS) return "已记牢";
  if (isDue(card, now)) return "待复习";
  return "复习中";
}
function dueLabel(card, now) {
  if (card.state === STATE.NEW) return "等待放出";
  const ms = new Date(card.due).getTime() - now.getTime();
  if (ms <= 0) return "现在";
  const days = ms / 86400000;
  if (days < 1) return `${Math.max(1, Math.round(ms / 60000))} 分钟后`;
  if (days < 31) return `${Math.round(days)} 天后`;
  return `${Math.round(days / 30)} 个月后`;
}

function TaskCard({ mode, stat, ready, deferred, onStart }) {
  const listening = mode === "listening";
  const name = listening ? "听力复习" : "阅读复习";
  const todo = stat?.todo || 0;
  const due = stat?.dueReview || 0;
  const fresh = stat?.newToday || 0;
  return <button type="button" className={`${styles.task} ${listening ? styles.listening : ""}`}
    disabled={!ready || !todo} onClick={() => onStart(mode)}
    aria-label={`${name}，今天 ${ready ? todo : "加载中"} 个词`}>
    <span className={styles.taskNumber}>{ready ? todo : "—"}<small>词</small></span>
    <span className={styles.taskBody}>
      <span className={styles.taskEyebrow}>VOCAB REVIEW</span>
      <strong>{name}</strong>
      <span>{ready ? (todo ? `到期 ${Math.max(0, due - deferred)} · 新词 ${fresh}` : "今天暂无待复习的词") : "正在读取词库…"}</span>
      {deferred > 0 && <span className={styles.deferred}>另有 {deferred} 个到期词顺延到明天</span>}
    </span>
    <span className={styles.taskAction}>{todo ? "开始复习" : "暂无任务"}<span aria-hidden="true">›</span></span>
  </button>;
}

function WordRow({ card, now, open, onToggle, onReviewMode, onProductive, onReset, onRemove }) {
  const name = card.display || card.word;
  const r = currentRetrievability(card, now);
  const productive = card.productive !== false;
  const mode = card.reviewMode || "reading";
  const actionId = `vn-actions-${encodeURIComponent(card.word)}`;
  return <div className={styles.wordRow} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { onToggle(null); event.stopPropagation(); }
  }}>
    <div className={styles.wordMain}>
      <div className={styles.wordLine}><strong>{name}</strong><SpeakButton word={name} size={26} /></div>
      {card.phonetic && <div className={styles.phonetic}>/{card.phonetic}/</div>}
      <div className={styles.wordMeta}>
        下次 {dueLabel(card, now)}
        {card.reps > 0 && ` · 复习 ${card.reps} 次`}
        {card.lapses > 0 && ` · 忘过 ${card.lapses} 次`}
        {r != null && ` · 此刻记得 ${Math.round(r * 100)}%`}
        {card.sentences?.length > 0 && ` · ${card.sentences.length + 1} 句语境`}
      </div>
    </div>
    <div className={styles.meaning}>{card.def ? humanizeDef(card.def) : "暂无释义"}</div>
    <span className={styles.status}>{stateLabel(card, now)}</span>
    <button type="button" className={styles.more} aria-label={`${name} 更多操作`} aria-expanded={open}
      aria-controls={actionId} onClick={() => onToggle(open ? null : card.word)}>⋯</button>
    {open && <div id={actionId} className={styles.actions} role="group" aria-label={`${name} 操作`}>
      <label>复习类型 <select aria-label={`${name}复习类型`} value={mode}
        onChange={(event) => onReviewMode(card.word, event.target.value)}>
        <option value="reading">阅读词</option><option value="listening">听力词</option>
      </select></label>
      {mode === "reading" && <button type="button" role="switch" aria-checked={productive}
        aria-label={`${name}需要会写`} onClick={() => onProductive(card.word, !productive)}>
        {productive ? "✓ 要会写" : "只需认得"}</button>}
      {card.reps > 0 && <button type="button" onClick={() => { onReset(card.word); onToggle(null); }}>重学</button>}
      <button type="button" onClick={() => { onRemove(card.word); onToggle(null); }}>移除</button>
    </div>}
  </div>;
}

export default function VocabNotebook({ onBack, sidebar, embedded = false }) {
  const { cards, stats, statsByMode, limits, setLimits, ready, isLoggedIn,
    makeQueue, grade, remove, reset, setProductive, setReviewMode, schedule } = useVocabBook();
  const [queue, setQueue] = useState(null);
  const [reviewingMode, setReviewingMode] = useState("reading");
  const [listMode, setListMode] = useState("all");
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openWord, setOpenWord] = useState(null);
  const listRef = useRef(null);
  const now = useMemo(() => new Date(), [cards]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    let out = sortByUrgency(cards.filter((c) => listMode === "all" || (c.reviewMode || "reading") === listMode).map((card) => reviewCard(card)), now);
    if (filter === "due") out = out.filter((c) => c.state !== STATE.NEW && isDue(c, now));
    else if (filter === "new") out = out.filter((c) => c.state === STATE.NEW);
    else if (filter === "learning") out = out.filter((c) => c.state === STATE.LEARNING || c.state === STATE.RELEARNING);
    else if (filter === "mature") out = out.filter((c) => (c.scheduledDays || 0) >= MATURE_DAYS);
    if (kw) out = out.filter((c) => c.word.includes(kw) || (c.def || "").toLowerCase().includes(kw));
    return out;
  }, [cards, filter, listMode, q, now]);
  const resetListView = () => {
    setShown(PAGE_SIZE);
    setOpenWord(null);
    if (listRef.current) listRef.current.scrollTop = 0;
  };
  const startReview = (mode) => {
    const next = makeQueue(mode);
    if (!next.length) return;
    setReviewingMode(mode);
    setQueue(next);
  };

  if (queue) {
    const review = reviewingMode === "listening"
    ? <ListeningVocabReview initialQueue={queue} onGrade={grade} onExit={() => setQueue(null)} />
    : <VocabReview initialQueue={queue} onGrade={(word, rating, durationMs) => grade(word, rating, durationMs, "reading")}
      onSetProductive={setProductive} onExit={() => setQueue(null)} />;
    return embedded ? <div className={styles.embeddedReview}>{review}</div> : <PageShell narrow>{review}</PageShell>;
  }

  const reading = statsByMode?.reading || stats;
  const listening = statsByMode?.listening || { todo: 0, dueReview: 0, newToday: 0 };
  const deferred = (stat) => limits.maxReviews > 0 ? Math.max(0, (stat?.dueReview || 0) - limits.maxReviews) : 0;

  return <div className={`${styles.page} ${embedded ? styles.embedded : ""}`} style={{ fontFamily: HOME_FONT }}>
    {!embedded && <header className={styles.topbar}><div className={styles.brand}><span className={styles.brandMark}>T</span><strong>TreePractice</strong><span className={styles.brandSub}>TOEFL 备考</span></div></header>}
    <div className={`${styles.shell} ${!sidebar || embedded ? styles.noSidebar : ""}`}>
      {!embedded && sidebar && <nav className={styles.sidebar} aria-label="主导航">{sidebar}</nav>}
      <main className={styles.main}>
        <div className={styles.heading}><div><h1>单词本</h1><p>收藏练习中的生词，按记忆情况安排复习。</p></div>
          {onBack && <button type="button" className={styles.back} onClick={onBack}>← 返回</button>}</div>
        <div className={styles.tasks}>
          <TaskCard mode="reading" stat={reading} ready={ready} deferred={deferred(reading)} onStart={startReview} />
          <TaskCard mode="listening" stat={listening} ready={ready} deferred={deferred(listening)} onStart={startReview} />
        </div>
        {ready && schedule.sprint && <div className={styles.notice}><strong>考前冲刺档已开启：</strong>距考试不到 10 天，目标留存率从 90% 提到 95%，复习间隔也压在考试日之前。</div>}
        {!isLoggedIn && ready && cards.length > 0 && <div className={styles.notice}>当前没登录，单词只保存在这台设备的浏览器中；登录后会同步到账号。</div>}
        <section className={styles.card} aria-labelledby="vn-library-title">
          <div className={styles.libraryHead}><h2 id="vn-library-title">我的词库 <span>{ready ? stats.total : "—"}</span></h2>
            <input value={q} onChange={(event) => { setQ(event.target.value); resetListView(); }}
              placeholder="搜索单词或释义" aria-label="搜索单词或释义" /></div>
          <div className={styles.filters}><div className={styles.segments} role="group" aria-label="词表类型">
            {[["all", "全部"], ["reading", "阅读"], ["listening", "听力"]].map(([mode, label]) =>
              <button key={mode} type="button" aria-pressed={listMode === mode}
                onClick={() => { setListMode(mode); resetListView(); }}>{label}</button>)}</div>
            <select value={filter} aria-label="状态筛选" onChange={(event) => { setFilter(event.target.value); resetListView(); }}>
              {FILTERS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
            </select></div>
          <div ref={listRef} className={styles.scrollList} tabIndex={0} role="region" aria-label="词库列表">
            {!ready ? <div className={styles.empty}>正在读取词库…</div>
              : cards.length === 0 ? <div className={styles.empty}><strong>单词本还是空的</strong><p>在阅读练习记录中划选生词，打开词典后点击「收藏到单词本」。</p><Link href="/reading/progress">去阅读练习记录</Link></div>
                : list.length === 0 ? <div className={styles.empty}>这一类里还没有词</div>
                  : list.slice(0, shown).map((card) => <WordRow key={card.word} card={card} now={now}
                    open={openWord === card.word} onToggle={setOpenWord} onReviewMode={setReviewMode}
                    onProductive={setProductive} onReset={reset} onRemove={remove} />)}
            {list.length > shown && <button className={styles.showMore} type="button"
              onClick={() => setShown((value) => value + PAGE_SIZE)}>还有 {list.length - shown} 个，继续显示</button>}
          </div>
          <div className={styles.listFoot}>显示 {Math.min(shown, list.length)} / {list.length} 词 · 阅读词默认要求会写，听力词只考听懂</div>
        </section>
      </main>
      <aside className={styles.right} aria-label="单词本工具">
        <section className={`${styles.card} ${styles.sideCard}`}><h2>学习概览</h2><div className={styles.stats}>
          {[[ready ? stats.total : "—", "已收藏"], [ready ? stats.knowledge : "—", "预计记得"],
            [ready ? stats.learning : "—", "学习中"], [ready ? stats.mature : "—", "已记牢"]].map(([value, label]) =>
            <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
          <p className={styles.explain}>“预计记得”是复习模型的估计，不等于完成率。</p></section>
        <DailyQuotaCard limits={limits} setLimits={setLimits} />
        <RootExplorer compact />
        <section className={`${styles.card} ${styles.sideCard}`}><h2>如何添加词</h2>
          <p className={styles.help}>阅读练习中划选生词，点击“收藏到单词本”。收藏后会出现在这里。</p></section>
      </aside>
    </div>
  </div>;
}
