"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { C, FONT, PageShell, SurfaceCard } from "../shared/ui";
import { getSavedTier } from "../../lib/AuthContext";
import { PRACTICE_MODE } from "../../lib/practiceMode";
import { translateGrammarPoint } from "../../lib/utils";
import { BuildSentenceTask } from "../buildSentence/BuildSentenceTask";
import { CTWTask } from "../reading/CTWTask";
import { RDLTask } from "../reading/RDLTask";
import { LCRTask } from "../listening/LCRTask";
import { ListeningMCQTask } from "../listening/ListeningMCQTask";
import { ExamAudioProvider, useExamAudio } from "../shared/ExamAudioProvider";
import { useMistakePool } from "./useMistakePool";
import { MistakeItemCard, useMistakeAi } from "./MistakeCardView";
import { getMistakeAccountKey, recordDrill, removeCards } from "../../lib/mistakes/pool";
import { SUBJECT_META, SUBTYPE_META } from "../../lib/mistakes/extract";
import {
  DRILL_COUNTS,
  DRILL_ORDERS,
  DRILL_SOURCES,
  DRILL_TYPES,
  buildStages,
  buildUnits,
  classifyDrill,
  filterUnits,
  pickUnits,
  restrictUnits,
  scoreStage,
  summarizeDrill,
  unitsQuestionCount,
} from "../../lib/mistakes/drill";
import { formatDuration, pct } from "../../lib/mistakes/format";

// 练错题（/mistake-drill）：选题型 / 来源 / 数量 → 依次做每一组 → 统计报告。
//
// 硬约束（CLAUDE.md「真题答题页 = 常规练习答题页」同理）：答题阶段直接渲染各科现成任务组件，
// 不套任何额外外壳；「第 N / M 组」只出现在组件自带的顶栏文字、组间按钮与报告页。
// 不写练习历史（persistSession=false / 不调 saveSess）、不写已练集合（recordGroupDone=false / 不调 addDoneIds）：
// 否则会被每日任务、进度图、错题本自己重复计数。结果只回写错题池的 lastDrill + 一条练习日志。

const PROGRESS_KEY = "toefl-mistake-drill-progress-v1";

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function progressKey() {
  const acc = getMistakeAccountKey();
  return `${PROGRESS_KEY}::${acc === "guest" ? "guest" : `user:${acc}`}`;
}

function loadProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(progressKey()) || "null");
    if (!raw || raw.day !== todayKey() || !Array.isArray(raw.unitIds)) return null;
    return raw;
  } catch {
    return null;
  }
}

function saveProgress(p) {
  try { localStorage.setItem(progressKey(), JSON.stringify({ ...p, day: todayKey() })); } catch {}
}

function clearProgress() {
  try { localStorage.removeItem(progressKey()); } catch {}
}

/* ── 拼句按 qid 回查原题（只在本路由动态加载题库） ── */

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function stripSource(q) {
  const { __sourceSetId, __sourceGroupId, ...rest } = q || {};
  return rest;
}

/**
 * 拼句错题只记了 qid + 题面，没记词块，重做要回题库找原题。
 * qid 不可靠：题库维护会重排（scripts/ops/full-audit-cleanup.mjs 按位置重写 id）、删题，
 * 同一个 id 可能已经指向另一道题。所以先按 qid 找、题面对得上才认；对不上就按「题面 + 答案」在全库里找。
 * 返回 { byKey: { 卡 key → 原题 }, missing: [找不到的卡 key] }。同一道原题只给一张卡（老的哈希卡与新的 qid 卡可能重复）。
 */
export async function resolveBsQuestions(briefs) {
  const out = { byKey: {}, missing: [] };
  if (!briefs || briefs.length === 0) return out;
  const byId = new Map();
  const all = [];
  const add = (q) => { if (q && q.id != null) { all.push(q); byId.set(String(q.id), q); } };
  try {
    const mod = await import("../../data/buildSentence/questions.json");
    const data = mod.default || mod;
    (data.question_sets || []).forEach((set) => (set.questions || []).forEach(add));
  } catch {}
  if (briefs.some((b) => String(b.qid || "").startsWith("real_"))) {
    try {
      const { getRealBSQuestions } = await import("../../lib/realBank");
      getRealBSQuestions().forEach(add);
    } catch {}
  }
  if (briefs.some((b) => String(b.qid || "").startsWith("usr_"))) {
    try {
      const { fetchPersonalBank } = await import("../../lib/userBank/personalBank");
      ((await fetchPersonalBank("build")) || []).forEach(add);
    } catch {}
  }
  const byContent = new Map();
  for (const q of all) {
    const k = `${norm(q.prompt)}|${norm(q.answer)}`;
    if (!byContent.has(k)) byContent.set(k, q);
  }
  const used = new Set();
  for (const b of briefs) {
    let q = b.qid ? byId.get(String(b.qid)) : null;
    if (q && norm(q.prompt) !== norm(b.prompt)) q = null;
    if (!q) q = byContent.get(`${norm(b.prompt)}|${norm(b.correctAnswer)}`) || null;
    if (!q || used.has(String(q.id))) {
      out.missing.push(b.key);
      continue;
    }
    used.add(String(q.id));
    out.byKey[b.key] = stripSource(q);
  }
  return out;
}

/* ── 小零件 ── */

function Chip({ active, disabled, onClick, children, title }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-pressed={active}
      disabled={disabled}
      title={title}
      style={{
        border: `1px solid ${active ? "#E11D48" : C.bdr}`,
        background: active ? "#FFF1F2" : disabled ? "#f8fafc" : "#fff",
        color: disabled ? C.t3 : active ? "#be123c" : C.t2,
        borderRadius: 10,
        padding: "8px 12px",
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function SectionTitle({ n, children, sub }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "4px 0 10px" }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: "#E11D48" }}>{n}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: C.t1 }}>{children}</span>
      {sub && <span style={{ fontSize: 12, color: C.t3 }}>{sub}</span>}
    </div>
  );
}

const SECONDS_PER = { bs: 45, lcr: 30, ctw: 150, rdl: 70, ap: 80, la: 80, lc: 80, lat: 90 };

function estimateMinutes(units) {
  let s = 0;
  for (const u of units) {
    if (u.subtype === "ctw") s += SECONDS_PER.ctw;
    else if (u.subtype === "bs" || u.subtype === "lcr") s += SECONDS_PER[u.subtype];
    else s += 90 + u.size * (SECONDS_PER[u.subtype] || 70);
  }
  return Math.max(1, Math.round(s / 60));
}

function unitTitle(u, pool) {
  const card = pool.cards?.[u.cardKeys[0]];
  if (u.subtype === "bs") return card?.brief?.correctAnswer || card?.brief?.prompt || "拼句";
  if (u.subtype === "lcr") return card?.brief?.stem || "听力应答";
  const it = pool.items?.[u.itemKey];
  return it?.topic || SUBTYPE_META[u.subtype]?.long || u.subtype;
}

/* ── 选题页 ── */

function DrillSetup({ pool, ready, isPro, pinnedKey, onStart, initialConfig, bsCheck }) {
  const examAudio = useExamAudio();
  const units = useMemo(() => buildUnits(pool, { blockedKeys: bsCheck.missing }), [pool, bsCheck.missing]);
  const [types, setTypes] = useState(() => initialConfig?.types || null);
  const [source, setSource] = useState(initialConfig?.source || "all");
  const [count, setCount] = useState(initialConfig?.count ?? 10);
  const [order, setOrder] = useState(initialConfig?.order || "random");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9) + 1);
  const [excluded, setExcluded] = useState(() => new Set());
  const [pinned, setPinned] = useState(pinnedKey || null);
  const [resume, setResume] = useState(null);

  useEffect(() => { setResume(loadProgress()); }, []);

  const typeStats = useMemo(() => {
    const st = {};
    for (const t of DRILL_TYPES) {
      const list = units.filter((u) => u.type === t.id && u.available);
      st[t.id] = { units: list.length, questions: unitsQuestionCount(list) };
    }
    return st;
  }, [units]);

  const allowedType = useCallback((t) => (!t.pro || isPro) && typeStats[t.id]?.units > 0, [isPro, typeStats]);

  // 默认勾上所有能练的题型
  const effectiveTypes = useMemo(() => {
    if (types) return types.filter((id) => allowedType(DRILL_TYPES.find((t) => t.id === id)));
    return DRILL_TYPES.filter(allowedType).map((t) => t.id);
  }, [types, allowedType]);

  const pinnedUnit = useMemo(() => {
    if (!pinned) return null;
    return units.find((u) => u.cardKeys.includes(pinned) || u.id === pinned) || null;
  }, [pinned, units]);
  const pinnedLocked = pinnedUnit && DRILL_TYPES.find((t) => t.id === pinnedUnit.type)?.pro && !isPro;

  const candidates = useMemo(() => filterUnits(units, { types: effectiveTypes, source }), [units, effectiveTypes, source]);
  const picked = useMemo(() => {
    if (pinnedUnit) return pinnedUnit.available && !pinnedLocked ? [pinnedUnit] : [];
    return pickUnits(candidates.filter((u) => !excluded.has(u.id)), { count, order, seed });
  }, [pinnedUnit, pinnedLocked, candidates, excluded, count, order, seed]);

  const sourceCounts = useMemo(() => {
    const out = {};
    DRILL_SOURCES.forEach((s) => { out[s.id] = unitsQuestionCount(filterUnits(units, { types: effectiveTypes, source: s.id })); });
    return out;
  }, [units, effectiveTypes]);

  const toggleType = (id) => {
    const cur = new Set(effectiveTypes);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    setTypes([...cur]);
    setExcluded(new Set());
  };

  const questionCount = unitsQuestionCount(picked);
  const lockedTypes = DRILL_TYPES.filter((t) => t.pro && !isPro && typeStats[t.id]?.units > 0);

  const start = (units2, extra = {}) => {
    try { examAudio?.controller?.unlock?.(); } catch {}
    onStart(units2, { types: effectiveTypes, source, count, order }, extra);
  };

  if (!ready || bsCheck.loading) {
    return <SurfaceCard style={{ padding: "48px 24px", textAlign: "center", color: C.t3, fontSize: 13 }}>{ready ? "正在核对拼句原题..." : "正在整理错题..."}</SurfaceCard>;
  }

  if (units.length === 0) {
    return (
      <SurfaceCard style={{ padding: "40px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 6 }}>错题本里还没有错题</div>
        <div style={{ fontSize: 13, color: C.t3, marginBottom: 16 }}>先去做几套拼句 / 阅读 / 听力练习，答错的题会自动收进错题本。</div>
        <Link href="/" style={{ color: "#E11D48", fontWeight: 700, fontSize: 13 }}>回首页做练习 →</Link>
      </SurfaceCard>
    );
  }

  const resumable = resume && !pinned ? resume : null;

  return (
    <>
      {resumable && (
        <SurfaceCard style={{ padding: "14px 16px", marginBottom: 14, borderColor: "#fecdd3" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.t1 }}>
              今天有一次练错题没做完：已完成 {resumable.stageIndex} / {resumable.stageCount} 组
            </div>
            <button type="button" onClick={() => { clearProgress(); setResume(null); }} style={{ border: `1px solid ${C.bdr}`, background: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, cursor: "pointer", color: C.t2, fontFamily: "inherit" }}>放弃</button>
            <button
              type="button"
              onClick={() => {
                const byId = new Map(units.map((u) => [u.id, u]));
                const list = resumable.unitIds.map((id) => byId.get(id)).filter(Boolean);
                if (list.length === 0) { clearProgress(); setResume(null); return; }
                start(list, { resume: resumable });
              }}
              style={{ border: "none", background: "#E11D48", color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
            >
              继续做
            </button>
          </div>
        </SurfaceCard>
      )}

      {pinnedUnit ? (
        <SurfaceCard style={{ padding: "16px 18px", marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: C.t2, marginBottom: 6 }}>只练这一{DRILL_TYPES.find((t) => t.id === pinnedUnit.type)?.unit === "篇" ? "篇" : "题"}：</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.t1 }}>{SUBTYPE_META[pinnedUnit.subtype]?.label} · {unitTitle(pinnedUnit, pool)}</div>
          {pinnedLocked && <div style={{ marginTop: 8, fontSize: 12.5, color: "#92400e" }}>阅读 / 听力练习是 Pro 功能，升级后可以重做这篇。</div>}
          {!pinnedUnit.available && <div style={{ marginTop: 8, fontSize: 12.5, color: "#92400e" }}>这道题的原文没有保存下来（老记录或存储空间不足时会精简），没法重做。</div>}
          <button type="button" onClick={() => setPinned(null)} style={{ marginTop: 10, border: "none", background: "none", color: "#E11D48", fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
            改成按条件抽题 →
          </button>
        </SurfaceCard>
      ) : (
        <>
          <SurfaceCard style={{ padding: "16px 18px", marginBottom: 12 }}>
            <SectionTitle n="1" sub="可多选">练哪些题型</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 8 }}>
              {DRILL_TYPES.map((t) => {
                const st = typeStats[t.id];
                const locked = t.pro && !isPro;
                const disabled = locked || !st || st.units === 0;
                return (
                  <Chip key={t.id} active={!disabled && effectiveTypes.includes(t.id)} disabled={disabled} onClick={() => toggleType(t.id)} title={t.hint}>
                    <div style={{ fontWeight: 700 }}>{t.label}{locked ? " · Pro" : ""}</div>
                    <div style={{ fontSize: 11.5, marginTop: 2, color: C.t3 }}>
                      {st && st.units > 0 ? (t.unit === "篇" ? `${st.units} 篇 · ${st.questions} ${t.id === "ctw" ? "空" : "题"}` : `${st.questions} 题`) : "暂无错题"}
                    </div>
                  </Chip>
                );
              })}
            </div>
            {bsCheck.missing.size > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: C.t3 }}>另有 {bsCheck.missing.size} 道拼句的原题已从题库下线（题库换代），没法重做，不参与抽题；错题本里仍保留。</div>
            )}
            {lockedTypes.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: C.t3 }}>阅读 / 听力练习是 Pro 功能，错题仍可在错题本里查看。</div>
            )}
          </SurfaceCard>

          <SurfaceCard style={{ padding: "16px 18px", marginBottom: 12 }}>
            <SectionTitle n="2">从哪些错题里抽</SectionTitle>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {DRILL_SOURCES.map((s) => (
                <Chip key={s.id} active={source === s.id} disabled={sourceCounts[s.id] === 0 && source !== s.id} onClick={() => { setSource(s.id); setExcluded(new Set()); }}>
                  {s.label} <span style={{ color: C.t3, fontWeight: 500 }}>{sourceCounts[s.id]}</span>
                </Chip>
              ))}
            </div>
          </SurfaceCard>

          <SurfaceCard style={{ padding: "16px 18px", marginBottom: 12 }}>
            <SectionTitle n="3" sub="阅读 / 听力按篇抽，整篇不拆，题数可能略多">抽多少</SectionTitle>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {DRILL_COUNTS.map((n) => (
                <Chip key={n} active={count === n} onClick={() => { setCount(n); setExcluded(new Set()); }}>{n === 0 ? "全部" : `${n} 题`}</Chip>
              ))}
              <span style={{ flex: 1 }} />
              <select
                value={order}
                onChange={(e) => setOrder(e.target.value)}
                aria-label="抽题顺序"
                style={{ fontSize: 13, border: `1px solid ${C.bdr}`, borderRadius: 8, padding: "7px 10px", background: "#fff", color: C.t2, fontFamily: "inherit" }}
              >
                {DRILL_ORDERS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          </SurfaceCard>
        </>
      )}

      <SurfaceCard style={{ padding: "16px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.t1 }}>本次练习</span>
          <span style={{ fontSize: 12.5, color: C.t2 }}>{questionCount} 题 · 约 {picked.length > 0 ? estimateMinutes(picked) : 0} 分钟</span>
          {!pinnedUnit && order === "random" && candidates.length > picked.length && (
            <button type="button" onClick={() => { setSeed(seed + 1); setExcluded(new Set()); }} style={{ marginLeft: "auto", border: `1px solid ${C.bdr}`, background: "#fff", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: C.t2, cursor: "pointer", fontFamily: "inherit" }}>
              换一批
            </button>
          )}
        </div>
        {picked.length === 0 ? (
          <div style={{ fontSize: 13, color: C.t3, padding: "8px 0" }}>当前条件下没有可练的错题，换个题型或来源试试。</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
            {picked.map((u) => {
              const subj = SUBJECT_META[SUBTYPE_META[u.subtype]?.subject] || SUBJECT_META.bs;
              return (
                <div key={u.id} data-testid="drill-preview-row" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "5px 2px", borderBottom: `1px solid ${C.bdrSubtle}` }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: subj.color, background: subj.soft, borderRadius: 999, padding: "1px 7px", flexShrink: 0 }}>{SUBTYPE_META[u.subtype]?.label}</span>
                  <span style={{ flex: 1, minWidth: 0, color: C.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{unitTitle(u, pool)}</span>
                  {u.size > 1 && <span style={{ color: C.t3, flexShrink: 0 }}>{u.size} {u.subtype === "ctw" ? "空" : "题"}</span>}
                  {u.wrongCount > 1 && <span style={{ color: "#b91c1c", flexShrink: 0 }}>错 {u.wrongCount} 次</span>}
                  {!pinnedUnit && (
                    <button type="button" aria-label="这题不练" title="这题不练" onClick={() => setExcluded(new Set([...excluded, u.id]))} style={{ border: "none", background: "none", color: C.t3, cursor: "pointer", fontSize: 14, padding: "0 4px", flexShrink: 0 }}>×</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <button
          type="button"
          data-testid="drill-start"
          disabled={picked.length === 0}
          onClick={() => start(picked)}
          style={{
            marginTop: 14, width: "100%",
            border: "none", borderRadius: 10, padding: "12px 0",
            background: picked.length === 0 ? "#cbd5e1" : "#E11D48",
            color: "#fff", fontSize: 15, fontWeight: 700,
            cursor: picked.length === 0 ? "not-allowed" : "pointer", fontFamily: "inherit",
          }}
        >
          开始练习
        </button>
      </SurfaceCard>
    </>
  );
}

/* ── 答题：依次渲染每一组 ── */

// 各组件交卷时 onComplete 一到就切走（下一组的衔接卡 / 结算页），所以不会出现各科自己的练习结算页
// （Band、答对题数那一套对一组自选错题没有意义）；这一次怎么答的统一在练错题结算页里逐题看。
function DrillStage({ stage, index, count, onComplete, onExit }) {
  const section = `练错题 · 第 ${index + 1}/${count} 组`;
  if (stage.kind === "bs") {
    return (
      <BuildSentenceTask
        questions={stage.questions}
        practiceMode={PRACTICE_MODE.PRACTICE}
        persistSession={false}
        recordGroupDone={false}
        autoStartOnMount
        onComplete={onComplete}
        onExit={onExit}
      />
    );
  }
  if (stage.kind === "ctw") {
    return <CTWTask item={stage.item} isPractice onComplete={onComplete} onExit={onExit} />;
  }
  if (stage.kind === "rdl") {
    return <RDLTask item={stage.item} isPractice title={stage.title} section={section} onComplete={onComplete} onExit={onExit} />;
  }
  if (stage.kind === "lcr") {
    return <LCRTask batchItems={stage.items} isPractice onComplete={onComplete} onExit={onExit} />;
  }
  return <ListeningMCQTask item={stage.item} taskType={stage.subtype} isPractice title={stage.title} section={section} onComplete={onComplete} onExit={onExit} />;
}

function stageSize(stage) {
  return (stage.cardKeys || []).length;
}

function stageDesc(stage) {
  const n = stageSize(stage);
  if (stage.kind === "ctw") return `${stage.label} · 1 篇 ${n} 空`;
  if (stage.kind === "rdl" || stage.kind === "listen") return `${stage.label} · 1 篇 ${n} 题`;
  return `${stage.label} · ${n} 题`;
}

/** 组与组之间的衔接卡：不是答题页，可以放进度。也顺带给听力组一个用户手势去解锁音频。 */
function DrillBetween({ run, onContinue, onFinish }) {
  const examAudio = useExamAudio();
  const done = run.stages[run.idx];
  const next = run.stages[run.idx + 1];
  const doneFixed = (done.cardKeys || []).filter((k) => run.results[k]?.correct).length;
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <PageShell narrow>
        <SurfaceCard style={{ padding: "26px 24px", marginTop: 40 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
            {run.stages.map((st, i) => (
              <div key={i} style={{ flex: 1, height: 6, borderRadius: 999, background: i <= run.idx ? "#E11D48" : C.bdrSubtle }} />
            ))}
          </div>
          <div style={{ fontSize: 12.5, color: C.t3 }}>第 {run.idx + 1} / {run.stages.length} 组完成</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.t1, margin: "6px 0 4px" }}>
            {stageDesc(done)}：纠正了 {doneFixed} / {stageSize(done)}
          </div>
          <div style={{ fontSize: 13, color: C.t2, marginBottom: 20 }}>逐题对照放在最后的结算页里一起看。</div>
          <div style={{ fontSize: 12.5, color: C.t3, marginBottom: 6 }}>下一组</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 18 }}>{stageDesc(next)}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              data-testid="drill-continue"
              onClick={() => {
                try { examAudio?.controller?.unlock?.(); } catch {}
                onContinue();
              }}
              style={{ border: "none", background: "#E11D48", color: "#fff", borderRadius: 10, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
            >
              继续第 {run.idx + 2} 组 →
            </button>
            <button
              type="button"
              onClick={onFinish}
              style={{ border: `1px solid ${C.bdr}`, background: "#fff", color: C.t2, borderRadius: 10, padding: "11px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              先到这，看结算
            </button>
          </div>
        </SurfaceCard>
      </PageShell>
    </div>
  );
}

/* ── 结算页 ── */

// 练错题的结算页回答的是三个问题（不是常规练习的「答对几题 / Band」）：
//   1. 这组错题我纠正了几道？            → 主数字「纠正了 x / n」
//   2. 哪些还没拿下，是不是又犯了同一个错？ → 没拿下的排最前，标「和上次错得一样」/「换了个错法」，并排给出这次和上次的答案
//   3. 接下来做什么？                    → 再练没拿下的 / 同条件再抽一组 / 纠正了的移出错题本
function attemptCard(card, r) {
  const brief = { ...(card.brief || {}) };
  if (card.subject === "bs" || card.subtype === "ctw") brief.userAnswer = r.answer || "";
  else {
    brief.selected = r.selected ?? null;
    brief.userAnswer = r.answer || "";
  }
  return { ...card, brief };
}

function Pill({ children, color, bg }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color, background: bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{children}</span>;
}

function DrillReport({ report, pool, onAgain, onRetryStill }) {
  const ai = useMistakeAi();
  const cards = useMemo(() => pool.cards || {}, [pool.cards]);
  const { fixed, still, sameMistake, unanswered, changed } = useMemo(() => classifyDrill(report.results, cards), [report.results, cards]);
  const total = fixed.length + still.length;
  const [toRemove, setToRemove] = useState(() => new Set(fixed.map((x) => x.card.key)));
  const [removedCount, setRemovedCount] = useState(0);
  const [showFixed, setShowFixed] = useState(false);
  const byType = useMemo(() => summarizeDrill(report.results, cards).byType, [report.results, cards]);
  const stillGrammar = useMemo(() => {
    const f = {};
    still.filter((x) => x.card.subject === "bs").forEach((x) => (x.card.brief?.grammar_points || []).forEach((g) => { f[g] = (f[g] || 0) + 1; }));
    return Object.entries(f).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [still]);
  const p = pct(fixed.length, total);
  const allFixed = total > 0 && still.length === 0;

  return (
    <div data-testid="drill-report">
      <SurfaceCard style={{ padding: "22px 24px", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: C.t2 }}>
          这组错题{report.partial ? `（中途结束，做完了 ${report.doneStages}/${report.stageCount} 组）` : ""}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "6px 0 10px", flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.t1 }}>纠正了</span>
          <span data-testid="drill-fixed" style={{ fontSize: 40, fontWeight: 800, color: allFixed ? C.green : C.t1, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
            {fixed.length}
            <span style={{ fontSize: 22, color: C.t3, fontWeight: 700 }}> / {total}</span>
          </span>
          <span style={{ fontSize: 13, color: C.t3 }}>用时 {formatDuration(report.durationSec)}</span>
        </div>
        <div style={{ height: 10, background: "#fee2e2", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ width: `${p}%`, height: "100%", background: C.green, borderRadius: 999 }} />
        </div>
        <div style={{ fontSize: 13.5, color: C.t1, marginTop: 12, lineHeight: 1.7 }}>
          {allFixed ? (
            "这组错题这次全部做对了。觉得已经掌握的话，可以把它们移出错题本。"
          ) : (
            <>
              还有 <b style={{ color: C.red }}>{still.length}</b> 道没拿下：
              {[
                sameMistake > 0 ? `${sameMistake} 道和上次错得一模一样` : null,
                changed > 0 ? `${changed} 道换了个错法` : null,
                unanswered > 0 ? `${unanswered} 道没作答` : null,
              ].filter(Boolean).join("，")}。
              {sameMistake > 0 && <span style={{ color: C.t2 }}> 错得一样的不是手滑，是同一个误解没解开，先弄懂这几道。</span>}
            </>
          )}
        </div>
        {Object.keys(byType).length > 1 && (
          <div style={{ marginTop: 14, borderTop: `1px solid ${C.bdrSubtle}`, paddingTop: 10 }}>
            {DRILL_TYPES.filter((t) => byType[t.id]).map((t) => {
              const b = byType[t.id];
              const tp = pct(b.correct, b.total);
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0", fontSize: 13 }}>
                  <span style={{ width: 80, color: C.t2, flexShrink: 0 }}>{t.label}</span>
                  <div style={{ flex: 1, minWidth: 0, height: 8, background: "#fee2e2", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ width: `${tp}%`, height: "100%", background: C.green, borderRadius: 999 }} />
                  </div>
                  <span style={{ width: 110, textAlign: "right", color: C.t1, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>纠正 {b.correct}/{b.total}</span>
                </div>
              );
            })}
          </div>
        )}
        {stillGrammar.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: C.t2 }}>
            拼句里还没拿下的语法点：{stillGrammar.map(([g, n]) => `${translateGrammarPoint(g)}${n > 1 ? ` ×${n}` : ""}`).join("、")}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          {still.length > 0 && (
            <button type="button" data-testid="drill-retry-still" onClick={() => onRetryStill(still.map((x) => x.card.key))} style={{ border: "none", background: "#E11D48", color: "#fff", borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              再练没拿下的 {still.length} 题
            </button>
          )}
          <button type="button" onClick={onAgain} data-testid="drill-again" style={{ border: `1px solid ${still.length > 0 ? C.bdr : "#E11D48"}`, background: still.length > 0 ? "#fff" : "#E11D48", color: still.length > 0 ? C.t1 : "#fff", borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            同条件再抽一组
          </button>
          <Link href="/?section=mistakes" style={{ border: `1px solid ${C.bdr}`, background: "#fff", color: C.t2, borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
            返回错题本
          </Link>
        </div>
      </SurfaceCard>

      {still.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", margin: "8px 0 10px" }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.t1 }}>没拿下的 {still.length} 题</span>
            <span style={{ fontSize: 12, color: C.t3 }}>卡片里的「你的答案」是这一次的；下面一行是错题本记的上一次</span>
          </div>
          {still.map(({ card, r, same, blank }) => (
            <MistakeItemCard
              key={card.key}
              card={attemptCard(card, r)}
              items={pool.items}
              ai={ai}
              showMeta={false}
              resultTag={
                <>
                  {blank ? <Pill color={C.t2} bg="#f1f5f9">没作答</Pill> : same ? <Pill color="#b91c1c" bg="#fef2f2">和上次错得一样</Pill> : <Pill color="#b45309" bg="#fffbeb">换了个错法</Pill>}
                  {(card.wrongCount || 1) >= 2 && <Pill color={C.t2} bg="#f1f5f9">之前已错 {card.wrongCount} 次</Pill>}
                </>
              }
              extra={
                <div style={{ fontSize: 12.5, color: C.t3, marginBottom: 8 }}>
                  上一次你的答案：<span style={{ color: C.t2 }}>{card.brief?.userAnswer || "(未作答)"}</span>
                </div>
              }
            />
          ))}
        </>
      )}

      {fixed.length > 0 && (
        <SurfaceCard style={{ padding: "16px 18px", margin: "8px 0 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.t1 }}>这次纠正的 {fixed.length} 题</span>
            <span style={{ fontSize: 12, color: C.t3 }}>勾选的会移出错题本（以后再错会自动回来）</span>
          </div>
          {removedCount > 0 ? (
            <div style={{ fontSize: 13, color: C.green }}>已移出 {removedCount} 题。</div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                {(showFixed ? fixed : fixed.slice(0, 8)).map(({ card }) => (
                  <label key={card.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.t1, cursor: "pointer", minWidth: 0 }}>
                    <input
                      type="checkbox"
                      checked={toRemove.has(card.key)}
                      onChange={() => {
                        const n = new Set(toRemove);
                        if (n.has(card.key)) n.delete(card.key); else n.add(card.key);
                        setToRemove(n);
                      }}
                    />
                    <span style={{ fontSize: 11, color: C.t3, flexShrink: 0 }}>{SUBTYPE_META[card.subtype]?.label}</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {card.subject === "bs" ? card.brief?.correctAnswer : (card.brief?.stem || card.brief?.correctAnswer)}
                    </span>
                    {(card.wrongCount || 1) >= 2 && <span style={{ fontSize: 11, color: C.t3, flexShrink: 0 }}>之前错 {card.wrongCount} 次</span>}
                  </label>
                ))}
                {fixed.length > 8 && !showFixed && (
                  <button type="button" onClick={() => setShowFixed(true)} style={{ alignSelf: "flex-start", border: "none", background: "none", color: "#E11D48", fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
                    展开全部 {fixed.length} 题
                  </button>
                )}
              </div>
              <button
                type="button"
                disabled={toRemove.size === 0}
                onClick={() => { removeCards([...toRemove]); setRemovedCount(toRemove.size); }}
                style={{ border: `1px solid ${C.bdr}`, background: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, color: toRemove.size === 0 ? C.t3 : C.t1, cursor: toRemove.size === 0 ? "not-allowed" : "pointer", fontFamily: "inherit" }}
              >
                把勾选的 {toRemove.size} 题移出错题本
              </button>
            </>
          )}
        </SurfaceCard>
      )}
    </div>
  );
}

/* ── 主组件 ── */

function bsBriefs(pool) {
  return Object.values(pool.cards || {})
    .filter((c) => c && !c.deletedAt && c.subtype === "bs")
    .map((c) => ({ key: c.key, ...(c.brief || {}) }));
}

function DrillInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pinnedKey = searchParams.get("key");
  const { pool, ready } = useMistakePool({ derive: true });
  const [isPro, setIsPro] = useState(false);
  const [phase, setPhase] = useState("setup"); // setup | running | report
  const [run, setRun] = useState(null); // { stages, unitIds, config, idx, between, results{key:{correct,answer,selected}}, startedAt, elapsedBefore }
  const [report, setReport] = useState(null);
  const [lastConfig, setLastConfig] = useState(null);
  const [setupNonce, setSetupNonce] = useState(0);
  const [bsCheck, setBsCheck] = useState({ loading: true, sig: null, byKey: {}, missing: new Set() });
  const runRef = useRef(null);
  runRef.current = run;

  useEffect(() => {
    const tier = getSavedTier();
    setIsPro(tier === "pro" || tier === "legacy");
  }, []);

  // 拼句错题先核对原题还在不在，再进抽题范围（否则「抽 10 题」会在开做时悄悄少几道）
  useEffect(() => {
    if (!ready) return;
    const briefs = bsBriefs(pool);
    const sig = briefs.map((b) => b.key).sort().join(",");
    if (sig === bsCheck.sig) return;
    let alive = true;
    if (briefs.length === 0) {
      setBsCheck({ loading: false, sig, byKey: {}, missing: new Set() });
      return undefined;
    }
    setBsCheck((cur) => ({ ...cur, loading: cur.sig == null }));
    resolveBsQuestions(briefs).then((r) => {
      if (alive) setBsCheck({ loading: false, sig, byKey: r.byKey, missing: new Set(r.missing) });
    });
    return () => { alive = false; };
  }, [ready, pool, bsCheck.sig]);

  const handleStart = useCallback((units, config, { resume } = {}) => {
    if (config) setLastConfig(config);
    const stages = buildStages(units, pool, { bsQuestions: bsCheck.byKey });
    if (stages.length === 0) {
      window.alert("没有可以重做的题。");
      return;
    }
    const startIdx = resume ? Math.min(resume.stageIndex || 0, stages.length - 1) : 0;
    setRun({
      stages,
      unitIds: units.map((u) => u.id),
      config: config || lastConfig,
      idx: startIdx,
      between: false,
      results: resume?.results || {},
      startedAt: Date.now(),
      elapsedBefore: resume?.elapsedSec || 0,
    });
    setReport(null);
    setPhase("running");
    window.scrollTo(0, 0);
  }, [pool, bsCheck.byKey, lastConfig]);

  const finish = useCallback((r, partial) => {
    const results = Object.entries(r.results).map(([key, v]) => (typeof v === "object" && v ? { key, ...v } : { key, correct: !!v, answer: "", selected: null }));
    const summary = summarizeDrill(results, pool.cards);
    const durationSec = Math.round((Date.now() - r.startedAt) / 1000) + (r.elapsedBefore || 0);
    if (results.length > 0) {
      recordDrill(results.map(({ key, correct }) => ({ key, correct })), { total: summary.total, correct: summary.correct, durationSec, byType: summary.byType, config: r.config });
    }
    clearProgress();
    const doneStages = r.stages.filter((st) => (st.cardKeys || []).some((k) => k in r.results)).length;
    setReport({ results, durationSec, partial, stageCount: r.stages.length, doneStages });
    setRun(null);
    setPhase(results.length > 0 ? "report" : "setup");
    window.scrollTo(0, 0);
  }, [pool]);

  const handleStageComplete = useCallback((result) => {
    const r = runRef.current;
    if (!r || r.between) return;
    const scored = scoreStage(r.stages[r.idx], result);
    const results = { ...r.results };
    scored.forEach((x) => { results[x.key] = { correct: x.correct, answer: x.answer, selected: x.selected }; });
    const next = { ...r, results };
    if (r.idx >= r.stages.length - 1) {
      finish(next, false);
      return;
    }
    const elapsedSec = Math.round((Date.now() - r.startedAt) / 1000) + (r.elapsedBefore || 0);
    saveProgress({ unitIds: r.unitIds, stageIndex: r.idx + 1, stageCount: r.stages.length, results, elapsedSec });
    setRun({ ...next, between: true });
    window.scrollTo(0, 0);
  }, [finish]);

  const handleContinue = useCallback(() => {
    const r = runRef.current;
    if (!r) return;
    setRun({ ...r, idx: r.idx + 1, between: false });
    window.scrollTo(0, 0);
  }, []);

  const handleStageExit = useCallback(() => {
    const r = runRef.current;
    if (!r) return;
    const anyDone = Object.keys(r.results).length > 0;
    const ok = typeof window.confirm === "function"
      ? window.confirm(anyDone ? "退出练错题？已经做完的组会计入结算。" : "退出练错题？这组还没交卷，不会计入。")
      : true;
    if (!ok) return;
    if (anyDone) finish(r, true);
    else {
      clearProgress();
      setRun(null);
      setPhase("setup");
    }
  }, [finish]);

  const retryStill = useCallback((keys) => {
    const units = restrictUnits(buildUnits(pool, { blockedKeys: bsCheck.missing }), keys);
    handleStart(units, lastConfig);
  }, [pool, bsCheck.missing, handleStart, lastConfig]);

  if (phase === "running" && run) {
    if (run.between) {
      return <DrillBetween run={run} onContinue={handleContinue} onFinish={() => finish(run, true)} />;
    }
    const stage = run.stages[run.idx];
    return (
      <DrillStage
        key={`${run.idx}-${stage.kind}-${run.startedAt}`}
        stage={stage}
        index={run.idx}
        count={run.stages.length}
        onComplete={handleStageComplete}
        onExit={handleStageExit}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <PageShell narrow>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: C.t1, margin: 0 }}>{phase === "report" ? "练错题 · 结算" : "练错题"}</h1>
            <div style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>从错题本里抽题集中重做，做完看哪些纠正了、哪些还没拿下</div>
          </div>
          <button
            type="button"
            onClick={() => router.push("/?section=mistakes")}
            style={{ background: "none", border: `1px solid ${C.bdr}`, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, color: C.t2, cursor: "pointer", flexShrink: 0, fontFamily: "inherit" }}
          >
            返回错题本
          </button>
        </div>
        {phase === "report" && report ? (
          <DrillReport
            report={report}
            pool={pool}
            onAgain={() => { setReport(null); setPhase("setup"); setSetupNonce(setupNonce + 1); window.scrollTo(0, 0); }}
            onRetryStill={retryStill}
          />
        ) : (
          <DrillSetup
            key={setupNonce}
            pool={pool}
            ready={ready}
            isPro={isPro}
            pinnedKey={setupNonce === 0 ? pinnedKey : null}
            initialConfig={lastConfig}
            onStart={handleStart}
            bsCheck={bsCheck}
          />
        )}
      </PageShell>
    </div>
  );
}

export default function MistakeDrill() {
  return (
    <ExamAudioProvider>
      <DrillInner />
    </ExamAudioProvider>
  );
}
