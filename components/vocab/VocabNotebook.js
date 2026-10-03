"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageShell } from "../shared/ui";
import { SpeakButton } from "../shared/SpeakButton";
import { HOME_FONT } from "../home/theme";
import { useVocabBook } from "./useVocabBook";
import { VocabReview } from "./VocabReview";
import { ListeningVocabReview } from "./ListeningVocabReview";
import { STATE, currentRetrievability, isDue } from "../../lib/vocab/srs";
import { SORT_OPTIONS, cardStage, estimateMinutes, isLeech, reviewCard, sortCards } from "../../lib/vocab/book";
import { humanizeDef } from "../../lib/dict/core";
import { clearReviewSave, readReviewSave, resumableQueue, writeReviewSave } from "../../lib/vocab/reviewSave";
import RootExplorer from "./RootExplorer";
import DailyQuotaCard from "./DailyQuotaCard";
import VocabImportDialog from "./VocabImportDialog";
import VocabExportDialog from "./VocabExportDialog";
import { getVocabAccountKey } from "../../lib/vocab/vocabStore";
import styles from "./VocabNotebook.module.css";

const PAGE_SIZE = 60;
const num = (value) => (Number.isFinite(value) ? value : 0);
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 列表上状态徽章的配色：待复习（已到期）单独成一档，其余跟 cardStage 走。 */
const STAGE_STYLE = {
  due: { label: "待复习", fg: "#B45309", bg: "#FFFBEB", bd: "#F3D4A2" },
  learning: { label: "学习中", fg: "#0891B2", bg: "#ECFEFF", bd: "#A5E8F0" },
  review: { label: "复习中", fg: "#5a6b62", bg: "#fff", bd: "#dde5df" },
  mature: { label: "已记牢", fg: "#087355", bg: "#ECFDF5", bd: "#A7F3D0" },
  new: { label: "未开始", fg: "#94a39a", bg: "#F7FAF9", bd: "#dde5df" },
  paused: { label: "已暂停", fg: "#94a39a", bg: "#F7FAF9", bd: "#dde5df" },
};
const FILTERS = [
  ["all", "全部"], ["due", "今天要复习"], ["learning", "学习中"], ["leech", "易忘"], ["mature", "已记牢"], ["new", "未开始"],
];
const DIST = [
  ["new", "未开始", "#DDE5DF", "new"], ["learning", "学习中", "#0891B2", "learning"],
  ["review", "复习中", "#A7F3D0", "all"], ["mature", "已记牢", "#0D9668", "mature"], ["paused", "已暂停", "#C5CFC9", "paused"],
];

function stageKey(card, now) {
  const stage = cardStage(card);
  return stage === "review" && isDue(card, now) ? "due" : stage;
}
function matches(id, card, now) {
  if (id === "all") return true;
  if (id === "paused") return !!card.suspended;
  if (id === "leech") return isLeech(card);
  if (id === "due") return !card.suspended && card.state !== STATE.NEW && isDue(card, now);
  return cardStage(card) === id;
}
function dueLabel(card, now) {
  if (card.suspended) return "已暂停";
  if (card.state === STATE.NEW) return "等待放出";
  const ms = new Date(card.due).getTime() - now.getTime();
  if (ms <= 0) return "现在";
  const days = ms / 86400000;
  if (days < 1) return `${Math.max(1, Math.round(ms / 60000))} 分钟后`;
  if (days < 31) return `${Math.round(days)} 天后`;
  return `${Math.round(days / 30)} 个月后`;
}
const dayLabel = (key, index) => {
  if (index === 0) return "今天";
  const [y, m, d] = key.split("-").map(Number);
  return `周${WEEKDAYS[new Date(y, m - 1, d).getDay()]}`;
};

/** 把例句里的目标词标出来；匹配不到就原样返回。 */
function Highlighted({ sentence, word }) {
  if (!sentence) return null;
  let re;
  try { re = new RegExp(`(\\b${String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*\\b)`, "ig"); } catch { return sentence; }
  return sentence.split(re).map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

function WordRow({ card, now, open, onToggle, onReviewMode, onProductive, onReset, onRemove, onSuspend, onEditDef, selecting, selected, onSelect }) {
  const name = card.display || card.word;
  const r = currentRetrievability(card, now);
  const productive = card.productive !== false;
  const mode = card.reviewMode || "reading";
  const key = stageKey(card, now);
  const badge = STAGE_STYLE[key];
  const actionId = `vn-actions-${encodeURIComponent(card.word)}`;
  const due = dueLabel(card, now);
  const memPct = r == null ? null : Math.round(r * 100);
  const memColor = memPct != null && memPct < 70 ? "#D97706" : "#0D9668";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (!open) { setEditing(false); setError(""); } }, [open]);
  const saveEdit = (event) => {
    event.preventDefault();
    try {
      if (!onEditDef(card.word, draft)) { setError("没能保存：这个词可能已被移除。"); return; }
      setEditing(false);
      setError("");
    } catch (e) { setError(e?.message || "没能保存，请稍后重试。"); }
  };
  return <div className={styles.rowWrap} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { onToggle(null); event.stopPropagation(); }
  }}>
    <div className={`${styles.wordRow} ${selecting ? styles.selectingRow : ""}`}>
      {selecting && <input className={styles.wordSelect} type="checkbox" aria-label={`选择 ${name}`} checked={selected} onChange={() => onSelect(card.word)} />}
      <div className={styles.wordMain}>
        <div className={styles.wordLine}>
          <strong>{name}</strong><SpeakButton word={name} size={24} />
          <span className={styles.tag} style={{ color: badge.fg, background: badge.bg, borderColor: badge.bd }}>{badge.label}</span>
          {mode === "listening" && <span className={`${styles.tag} ${styles.tagListening}`}>听力</span>}
          {isLeech(card) && <span className={`${styles.tag} ${styles.tagLeech}`}>易忘 · 忘过 {card.lapses} 次</span>}
        </div>
        {card.phonetic && <div className={styles.phonetic}>/{card.phonetic}/</div>}
        <div className={styles.mobileMeta}>
          下次 {due}{memPct != null && ` · 此刻记得 ${memPct}%`}
        </div>
      </div>
      <div className={styles.meaning}>{card.def ? humanizeDef(card.def) : "暂无释义"}</div>
      <div className={styles.memory}>
        {memPct != null ? <>
          <strong style={{ color: memColor }}>{memPct}%</strong>
          <div className={styles.bar} role="img" aria-label={`此刻记得 ${memPct}%`}><div style={{ width: `${memPct}%`, background: memColor }} /></div>
        </> : <span className={styles.memoryNone}>未学</span>}
      </div>
      <span className={`${styles.due} ${due === "现在" ? styles.dueNow : ""}`}>{due}</span>
      <button type="button" className={styles.more} aria-label={`${name} 更多操作`} aria-expanded={open}
        aria-controls={actionId} onClick={() => onToggle(open ? null : card.word)}>⋯</button>
    </div>
    {open && <div id={actionId} className={styles.detail} role="group" aria-label={`${name} 操作`}>
      {card.sentence && <div className={styles.context}><em>语境</em><Highlighted sentence={card.sentence} word={card.word} /></div>}
      {editing ? <form className={styles.editForm} onSubmit={saveEdit}>
        <input aria-label={`${name}的释义`} value={draft} maxLength={300} autoFocus onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" disabled={!draft.trim()}>保存</button>
        <button type="button" onClick={() => { setEditing(false); setError(""); }}>取消</button>
        {error && <p role="alert">{error}</p>}
      </form> : <div className={styles.actions}>
        <label>复习类型 <select aria-label={`${name}复习类型`} value={mode}
          onChange={(event) => onReviewMode(card.word, event.target.value)}>
          <option value="reading">阅读词</option><option value="listening">听力词</option>
        </select></label>
        {mode === "reading" && <button type="button" role="switch" aria-checked={productive}
          aria-label={`${name}需要会写`} onClick={() => onProductive(card.word, !productive)}>
          {productive ? "✓ 要会写" : "只需认得"}</button>}
        {onEditDef && <button type="button" onClick={() => { setDraft(card.def || ""); setEditing(true); }}>编辑释义</button>}
        {card.reps > 0 && <button type="button" onClick={() => { onReset(card.word); onToggle(null); }}>重学</button>}
        {onSuspend && <button type="button" onClick={() => onSuspend(card.word, !card.suspended)}>{card.suspended ? "恢复复习" : "暂停复习"}</button>}
        <button type="button" onClick={() => { onRemove(card.word); onToggle(null); }}>移除</button>
        <small>
          {card.reps > 0 ? `复习 ${card.reps} 次` : "尚未复习"}
          {card.sentences?.length > 0 && ` · ${card.sentences.length + 1} 句语境`}
          {card.lapses > 0 && ` · 忘过 ${card.lapses} 次`}
        </small>
      </div>}
    </div>}
  </div>;
}

export default function VocabNotebook({ onBack, sidebar, embedded = false, onReviewingChange }) {
  const { cards, stats, statsByMode, forecast, limits, setLimits, ready, isLoggedIn, accountKey, storageStatus,
    makeQueue, grade, undo, suspend, editDef, remove, reset, setProductive, setReviewMode, schedule } = useVocabBook();
  const [queue, setQueue] = useState(null);
  useEffect(() => { setQueue(null); }, [accountKey]);
  // 复习（含结算页）期间告诉外层：可以收起侧栏进入专注模式；离开页面时一定还原。
  const reviewing = !!queue && queue.account === accountKey;
  useEffect(() => {
    onReviewingChange?.(reviewing);
    return () => onReviewingChange?.(false);
  }, [reviewing, onReviewingChange]);
  const [listMode, setListMode] = useState("all");
  const [filter, setFilter] = useState("all");
  const [sortKey, setSortKey] = useState("urgency");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openWord, setOpenWord] = useState(null);
  const listRef = useRef(null);
  const libraryRef = useRef(null);
  const quotaRef = useRef(null);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [saveTick, setSaveTick] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [selectedWords, setSelectedWords] = useState(() => new Set());
  const [dialog, setDialog] = useState(null);
  const [lostExport, setLostExport] = useState(null);
  const [selectionAccount, setSelectionAccount] = useState(accountKey);
  useEffect(() => { setSelectedWords(new Set()); setSelecting(false); setDialog(null); setLostExport(null); setSelectionAccount(accountKey); }, [accountKey]);
  useEffect(() => {
    const active = new Set(cards.map((card) => card.word));
    setSelectedWords((previous) => {
      const next = new Set([...previous].filter((word) => active.has(word)));
      return next.size === previous.size ? previous : next;
    });
  }, [cards]);
  const selectedCards = useMemo(() => selectionAccount === accountKey ? cards.filter((card) => selectedWords.has(card.word)) : [], [cards, selectedWords, selectionAccount, accountKey]);
  const toggleSelected = (word) => setSelectedWords((previous) => {
    const next = new Set(previous);
    if (next.has(word)) next.delete(word); else next.add(word);
    return next;
  });
  const now = useMemo(() => new Date(), [cards]); // eslint-disable-line react-hooks/exhaustive-deps

  const modeCards = useMemo(
    () => cards.filter((c) => listMode === "all" || (c.reviewMode || "reading") === listMode).map((card) => reviewCard(card)),
    [cards, listMode],
  );
  const counts = useMemo(() => {
    const out = { paused: 0 };
    for (const [id] of FILTERS) out[id] = modeCards.filter((card) => matches(id, card, now)).length;
    out.paused = modeCards.filter((card) => matches("paused", card, now)).length;
    return out;
  }, [modeCards, now]);
  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    let out = modeCards.filter((card) => matches(filter, card, now));
    if (kw) out = out.filter((c) => c.word.includes(kw) || (c.def || "").toLowerCase().includes(kw));
    return sortCards(out, sortKey, now);
  }, [modeCards, filter, q, sortKey, now]);
  const stageCounts = useMemo(() => {
    const out = { new: 0, learning: 0, review: 0, mature: 0, paused: 0 };
    for (const card of cards) out[cardStage(reviewCard(card))] += 1;
    return out;
  }, [cards]);

  // 阅读 / 听力复习各自的存档：只当天有效，且只留还值得问的词（见 resumableQueue）。
  const saves = useMemo(() => {
    const out = { reading: null, listening: null };
    if (!ready || !accountKey) return out;
    for (const mode of ["reading", "listening"]) {
      const save = readReviewSave(accountKey, mode, now);
      const resumable = save ? resumableQueue(save, cards, mode, now) : [];
      if (resumable.length) out[mode] = { save, queue: resumable };
    }
    return out;
  }, [ready, accountKey, cards, now, saveTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const readingSave = saves.reading;
  const listeningSave = saves.listening;

  const resetListView = () => {
    setShown(PAGE_SIZE);
    setOpenWord(null);
    if (listRef.current) listRef.current.scrollTop = 0;
  };
  const startReview = (mode, { resume = false } = {}) => {
    if (!ready || accountKey !== getVocabAccountKey()) return;
    const resumed = resume ? saves[mode] : null;
    const next = resumed ? resumed.queue : makeQueue(mode, accountKey);
    if (!next || !next.length) return;
    if (!resumed) clearReviewSave(accountKey, mode);
    setQueue({ cards: next, account: accountKey, mode, resume: resumed?.save || null, run: Date.now() });
  };
  const exitReview = () => { setQueue(null); setSaveTick((tick) => tick + 1); };
  const pickDist = (target) => {
    setListMode("all");
    setFilter(target);
    resetListView();
    libraryRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  const openQuota = () => {
    setQuotaOpen(true);
    quotaRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  };

  // 账号一变，旧队列在这一轮 render 就不可见，旧评分闭包也带原账号校验。
  if (accountKey && accountKey !== getVocabAccountKey()) {
    return <div className={styles.page} style={{ fontFamily: HOME_FONT }}>正在切换单词本…</div>;
  }

  const reading = statsByMode?.reading || stats || {};
  const listening = statsByMode?.listening || {};
  const tomorrow = forecast?.days?.[1];

  if (queue && queue.account === accountKey) {
    const account = queue.account;
    const review = queue.mode === "listening"
      ? <ListeningVocabReview key={`${account}:${queue.run}`} initialQueue={queue.cards} accountKey={account}
        resume={queue.resume} statsNow={stats}
        onGrade={(word, rating, durationMs) => grade(word, rating, durationMs, "listening", account)}
        onUndo={undo ? (word) => undo(word, "listening", account) : undefined}
        onSuspend={suspend ? (word) => (getVocabAccountKey() === account ? suspend(word, true) : null) : undefined}
        onEditDefinition={editDef ? (word, text) => (getVocabAccountKey() === account ? editDef(word, text) : null) : undefined}
        onCheckpoint={(state) => writeReviewSave(account, "listening", state)}
        onFinish={() => clearReviewSave(account, "listening")}
        summaryExtras={{
          // 听力练完，下一步是还没做完的阅读复习；有存档就接着存档做
          nextTask: { label: "阅读复习", todo: num(reading.todo), minutes: estimateMinutes(num(reading.todo)) },
          tomorrow: tomorrow ? { n: tomorrow.n, carried: tomorrow.carried } : null,
          onStartNext: () => startReview("reading", { resume: !!readingSave }),
          onExportWords: (words) => setLostExport({ words, account }),
        }}
        onExit={exitReview} />
      : <VocabReview key={`${account}:${queue.run}`} initialQueue={queue.cards} accountKey={account}
        resume={queue.resume} statsNow={stats}
        onGrade={(word, rating, durationMs) => grade(word, rating, durationMs, "reading", account)}
        onUndo={undo ? (word) => undo(word, "reading", account) : undefined}
        onSuspend={suspend ? (word) => (getVocabAccountKey() === account ? suspend(word, true) : null) : undefined}
        onEditDefinition={editDef ? (word, text) => (getVocabAccountKey() === account ? editDef(word, text) : null) : undefined}
        onSetProductive={(word, on) => getVocabAccountKey() === account ? setProductive(word, on) : null}
        onCheckpoint={(state) => writeReviewSave(account, "reading", state)}
        onFinish={() => clearReviewSave(account, "reading")}
        summaryExtras={{
          nextTask: { label: "听力复习", todo: num(listening.todo), minutes: estimateMinutes(num(listening.todo)) },
          tomorrow: tomorrow ? { n: tomorrow.n, carried: tomorrow.carried } : null,
          onStartNext: () => startReview("listening", { resume: !!listeningSave }),
          onExportWords: (words) => setLostExport({ words, account }),
        }}
        onExit={exitReview} />;
    const lostCards = lostExport && lostExport.account === accountKey ? cards.filter((card) => lostExport.words.includes(card.word)) : [];
    return <>
      {embedded ? <div className={styles.embeddedReview}>{review}</div> : <PageShell narrow>{review}</PageShell>}
      {lostCards.length > 0 && <VocabExportDialog key={accountKey} cards={lostCards} accountKey={accountKey} onClose={() => setLostExport(null)} />}
    </>;
  }

  const todo = num(stats?.todo);
  const todayTotal = num(stats?.todayTotal);
  const doneToday = num(stats?.doneToday);
  const readingTodo = num(reading.todo);
  const listeningTodo = num(listening.todo);
  const progressPct = todayTotal ? Math.min(100, Math.round((doneToday / todayTotal) * 100)) : 0;
  const readingCta = !ready ? "正在读取…"
    : readingSave ? `从存档继续 · 第 ${readingSave.save.answered + 1} 张起`
      : readingTodo && num(reading.doneToday) > 0 ? `继续阅读复习 · 剩 ${readingTodo}`
        : readingTodo ? "开始阅读复习" : "暂无任务";
  const listeningCta = !ready ? "正在读取…"
    : listeningSave ? `从存档继续 · 第 ${listeningSave.save.answered + 1} 张起`
      : listeningTodo && num(listening.doneToday) > 0 ? `继续听力复习 · 剩 ${listeningTodo}`
        : listeningTodo ? "开始听力复习" : "暂无任务";
  const saveRow = (mode, entry) => entry && <div className={styles.saveRow}>
    <span><em>存档</em><span>存档于第 {entry.save.segNo} 段结束（已答 {entry.save.answered} 张）· {new Date(entry.save.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span></span>
    <button type="button" onClick={() => { clearReviewSave(accountKey, mode); setSaveTick((tick) => tick + 1); }}>重新开始</button>
  </div>;
  const today = ready ? new Date() : null;
  const forecastDays = forecast?.days || [];
  const forecastMax = Math.max(1, ...forecastDays.map((d) => d.n));
  const dist = DIST.map(([id, label, color, target]) => ({ id, label, color, target, n: stageCounts[id] })).filter((d) => d.id !== "paused" || d.n > 0);
  const totalCards = cards.length;

  return <div className={`${styles.page} ${embedded ? styles.embedded : ""}`} style={{ fontFamily: HOME_FONT }}>
    {!embedded && <header className={styles.topbar}><div className={styles.brand}><span className={styles.brandMark}>T</span><strong>TreePractice</strong><span className={styles.brandSub}>TOEFL 备考</span></div></header>}
    <div className={`${styles.shell} ${!sidebar || embedded ? styles.noSidebar : ""}`}>
      {!embedded && sidebar && <nav className={styles.sidebar} aria-label="主导航">{sidebar}</nav>}
      <main className={styles.main}>
        <div className={styles.heading}><div><h1>单词本</h1><p>收藏练习中的生词，按记忆情况安排复习。</p></div>
          <div className={styles.headActions}>
            <button type="button" disabled={!ready} onClick={() => setDialog({ type: "import", account: accountKey })}>导入词表</button>
            <button type="button" disabled={!ready || !cards.length} aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setOpenWord(null); }}>{selecting ? "导出 PDF · 结束选择" : "导出 PDF"}</button>
            {onBack && <button type="button" className={styles.back} onClick={onBack}>← 返回</button>}
          </div></div>

        {ready && schedule?.sprint && <div className={styles.notice}><strong>考前冲刺档已开启：</strong>距考试不到 10 天，目标留存率从 90% 提到 95%，复习间隔也压在考试日之前。</div>}
        {!isLoggedIn && ready && cards.length > 0 && <div className={styles.notice}>当前没登录，单词只保存在这台设备的浏览器中；登录后会同步到账号。</div>}
        {ready && storageStatus && !storageStatus.persisted && <div className={styles.notice} role="alert">浏览器未能保存单词本改动；当前页面仍可暂时使用，关闭或刷新后可能丢失。请检查浏览器存储空间或权限。</div>}

        <section className={styles.hero} aria-labelledby="vn-today-title">
          <div className={styles.heroHead}>
            <div style={{ minWidth: 0 }}>
              <div className={styles.heroEyebrow}>TODAY{today && ` · ${today.getMonth() + 1} 月 ${today.getDate()} 日 周${WEEKDAYS[today.getDay()]}`}</div>
              <div className={styles.heroTitle}>
                <strong id="vn-today-title">{!ready ? "今日复习" : todayTotal ? `今日复习 ${todayTotal} 词` : "今天没有待复习的词"}</strong>
                {ready && todo > 0 && <span>预计约 {estimateMinutes(todo)} 分钟</span>}
                {ready && todayTotal > 0 && todo === 0 && <span>今天的任务完成了</span>}
              </div>
            </div>
            {ready && todayTotal > 0 && <div className={styles.heroProgress}>
              <div className={styles.heroProgressLabel}><span>今日进度</span><strong>{doneToday} / {todayTotal}</strong></div>
              <div className={styles.bar} role="progressbar" aria-label="今日进度" aria-valuemin={0} aria-valuemax={todayTotal} aria-valuenow={doneToday}><div style={{ width: `${progressPct}%` }} /></div>
            </div>}
          </div>
          <div className={styles.taskCols}>
            <div className={styles.taskCol}>
              <div className={styles.taskColHead}><strong>阅读复习</strong>{ready && readingTodo > 0 && <span>约 {estimateMinutes(readingTodo)} 分钟</span>}</div>
              <div className={styles.bigNum}><strong>{ready ? readingTodo : "—"}</strong><span>词待完成</span></div>
              <div className={styles.chips}>
                <span>到期 {num(reading.eligibleReview)}</span><span>新词 {num(reading.newToday)}</span><span>考拼写 {num(reading.spellingDue)}</span>
              </div>
              <button type="button" className={styles.cta} disabled={!ready || (!readingTodo && !readingSave)}
                onClick={() => startReview("reading", { resume: !!readingSave })}
                aria-label={`阅读复习，今天 ${ready ? readingTodo : "加载中"} 个词。${readingCta}`}>{readingCta}</button>
              {saveRow("reading", readingSave)}
            </div>
            <div className={`${styles.taskCol} ${styles.listening}`}>
              <div className={styles.taskColHead}><strong>听力复习</strong>{ready && listeningTodo > 0 && <span>约 {estimateMinutes(listeningTodo)} 分钟</span>}</div>
              <div className={styles.bigNum}><strong>{ready ? listeningTodo : "—"}</strong><span>词待完成</span></div>
              <div className={styles.chips}><span>到期 {num(listening.eligibleReview)}</span><span>新词 {num(listening.newToday)}</span></div>
              <button type="button" className={styles.cta} disabled={!ready || (!listeningTodo && !listeningSave)}
                onClick={() => startReview("listening", { resume: !!listeningSave })}
                aria-label={`听力复习，今天 ${ready ? listeningTodo : "加载中"} 个词。${listeningCta}`}>{listeningCta}</button>
              {saveRow("listening", listeningSave)}
            </div>
          </div>
          {ready && num(stats?.deferredReview) > 0 && <div className={styles.overflow}>
            <span>另有 {stats.deferredReview} 个到期词超出每日额度，顺延到明天。</span>
            <button type="button" onClick={openQuota}>调整额度 ›</button>
          </div>}
        </section>

        <RootExplorer />

        <section ref={libraryRef} className={`${styles.card} ${selecting ? styles.selecting : ""}`} aria-labelledby="vn-library-title">
          <div className={styles.libraryHead}><h2 id="vn-library-title">我的词库 <span>{ready ? num(stats?.total) : "—"}</span></h2>
            <div className={styles.libraryTools}>
              <input value={q} onChange={(event) => { setQ(event.target.value); resetListView(); }}
                placeholder="搜索单词或释义" aria-label="搜索单词或释义" />
              <select value={sortKey} aria-label="排序方式" onChange={(event) => { setSortKey(event.target.value); resetListView(); }}>
                {SORT_OPTIONS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
              </select>
            </div></div>
          <div className={styles.filters}>
            <div className={styles.segments} role="group" aria-label="词表类型">
              {[["all", "全部"], ["reading", "阅读"], ["listening", "听力"]].map(([mode, label]) =>
                <button key={mode} type="button" aria-pressed={listMode === mode}
                  onClick={() => { setListMode(mode); resetListView(); }}>{label}</button>)}</div>
            <hr aria-hidden="true" />
            <div className={styles.filterChips} role="group" aria-label="状态筛选">
              {[...FILTERS, ...(counts.paused > 0 || filter === "paused" ? [["paused", "已暂停"]] : [])].map(([id, label]) =>
                <button key={id} type="button" aria-pressed={filter === id}
                  onClick={() => { setFilter(id); resetListView(); }}>{label}<span>{counts[id]}</span></button>)}
            </div>
          </div>
          {selecting && <div className={styles.selectionBar} role="group" aria-label="导出单词选择">
            <strong aria-live="polite">已选 {selectedCards.length} 个词</strong>
            <button type="button" disabled={!list.length} onClick={() => setSelectedWords((previous) => new Set([...previous, ...list.map((card) => card.word)]))}>全选当前筛选（{list.length} 词）</button>
            <button type="button" disabled={!selectedCards.length} onClick={() => setSelectedWords(new Set())}>清空选择</button>
            <button type="button" className={styles.exportSelected} disabled={!selectedCards.length} onClick={() => setDialog({ type: "export", account: accountKey })}>预览并导出 {selectedCards.length} 词</button>
            <small>全选包含尚未显示的词；切换筛选会保留已选词。</small>
          </div>}
          <div className={styles.tableHead} aria-hidden="true">
            {selecting && <span />}<span>单词</span><span>释义</span><span>此刻记得</span><span>下次</span><span />
          </div>
          <div ref={listRef} className={styles.scrollList} tabIndex={0} role="region" aria-label="词库列表">
            {!ready ? <div className={styles.empty}>正在读取词库…</div>
              : cards.length === 0 ? <div className={styles.empty}><strong>单词本还是空的</strong><p>在阅读练习记录中划选生词，打开词典后点击「收藏到单词本」；也可以导入自己的词表。</p><Link href="/reading/progress">去阅读练习记录</Link></div>
                : list.length === 0 ? <div className={styles.empty}>这一类里还没有词</div>
                  : list.slice(0, shown).map((card) => <WordRow key={card.word} card={card} now={now}
                    open={openWord === card.word} onToggle={setOpenWord} onReviewMode={setReviewMode}
                    onProductive={setProductive} onReset={reset} onRemove={remove}
                    onSuspend={suspend} onEditDef={editDef}
                    selecting={selecting} selected={selectionAccount === accountKey && selectedWords.has(card.word)} onSelect={toggleSelected} />)}
            {list.length > shown && <button className={styles.showMore} type="button"
              onClick={() => setShown((value) => value + PAGE_SIZE)}>还有 {list.length - shown} 个，继续显示</button>}
          </div>
          <div className={styles.listFoot}>显示 {Math.min(shown, list.length)} / {list.length} 词 · 阅读词默认要求会写，听力词只考听懂 · “此刻记得”为复习模型估计</div>
        </section>
      </main>
      <aside className={styles.right} aria-label="单词本工具">
        <section className={`${styles.card} ${styles.sideCard}`}><h2>学习概览</h2>
          <div className={styles.stats}>
            <div><strong>{ready ? num(stats?.total) : "—"}</strong><span>已收藏</span></div>
            <div><strong>{ready ? num(stats?.knowledge) : "—"}</strong><span>预计记得</span></div>
          </div>
          {ready && totalCards > 0 && <>
            <div className={styles.distBar} aria-hidden="true">
              {dist.filter((d) => d.n > 0).map((d) => <div key={d.id} style={{ width: `${(d.n / totalCards) * 100}%`, background: d.color }} />)}
            </div>
            <div className={styles.distList}>
              {dist.map((d) => <button key={d.id} type="button" aria-label={`查看${d.label}的词，${d.n} 个`} onClick={() => pickDist(d.target)}>
                <i style={{ background: d.color }} /><span>{d.label}</span><strong>{d.n}</strong>
              </button>)}
            </div>
          </>}
          <p className={styles.explain}>“预计记得”是复习模型的估计，不等于完成率。</p></section>
        {forecastDays.length > 0 && <section className={`${styles.card} ${styles.sideCard}`} aria-label="未来 7 天">
          <div className={styles.sideHead}><h2>未来 7 天</h2><span>共 {forecast.total} 词</span></div>
          <div className={styles.forecastBars}>
            {forecastDays.map((d, i) => <div key={d.date} className={i === 0 ? styles.today : ""}>
              <span>{d.n}</span><i style={{ height: `${Math.max(2, Math.round((d.n / forecastMax) * 64))}px` }} />
            </div>)}
          </div>
          <div className={styles.forecastDays}>
            {forecastDays.map((d, i) => <span key={d.date} className={i === 0 ? styles.today : ""}>{dayLabel(d.date, i)}</span>)}
          </div>
          <p className={styles.explain}>按当前额度估算，含每日新词；每天完成当天的量就不会积压。</p>
        </section>}
        <div ref={quotaRef}><DailyQuotaCard limits={limits} setLimits={setLimits} open={quotaOpen} onOpenChange={setQuotaOpen} /></div>
      </aside>
    </div>
    {dialog?.type === "import" && dialog.account === accountKey && <VocabImportDialog key={accountKey} cards={cards} accountKey={accountKey} onClose={() => setDialog(null)} />}
    {dialog?.type === "export" && dialog.account === accountKey && <VocabExportDialog key={accountKey} cards={selectedCards} accountKey={accountKey} onClose={() => setDialog(null)} />}
  </div>;
}
