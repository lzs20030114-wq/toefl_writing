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
  filterUnits,
  pickUnits,
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

async function resolveBsQuestions(briefs) {
  const out = { questions: [], keyByQid: {}, missing: [] };
  if (!briefs || briefs.length === 0) return out;
  const byId = new Map();
  const all = [];
  try {
    const mod = await import("../../data/buildSentence/questions.json");
    const data = mod.default || mod;
    (data.question_sets || []).forEach((s) => (s.questions || []).forEach((q) => { all.push(q); byId.set(String(q.id), q); }));
  } catch {}
  if (briefs.some((b) => String(b.qid || "").startsWith("real_"))) {
    try {
      const { getRealBSQuestions } = await import("../../lib/realBank");
      getRealBSQuestions().forEach((q) => { all.push(q); byId.set(String(q.id), q); });
    } catch {}
  }
  if (briefs.some((b) => String(b.qid || "").startsWith("usr_"))) {
    try {
      const { fetchPersonalBank } = await import("../../lib/userBank/personalBank");
      const rows = await fetchPersonalBank("build");
      (rows || []).forEach((q) => { all.push(q); byId.set(String(q.id), q); });
    } catch {}
  }
  const used = new Set();
  for (const b of briefs) {
    let q = b.qid ? byId.get(String(b.qid)) : null;
    // qid 曾被复用（2026-06-17 换库：旧 ets_s1..29 退役，新 ets_s21+ 同名）→ 题面对不上就当已下线
    if (q && norm(q.prompt) !== norm(b.prompt)) q = null;
    if (!q && !b.qid) {
      q = all.find((x) => norm(x.prompt) === norm(b.prompt) && norm(x.answer) === norm(b.correctAnswer)) || null;
    }
    if (!q || used.has(String(q.id))) {
      if (!q) out.missing.push(b.key);
      continue;
    }
    used.add(String(q.id));
    out.questions.push(stripSource(q));
    out.keyByQid[String(q.id)] = b.key;
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

function DrillSetup({ pool, ready, isPro, pinnedKey, onStart, initialConfig }) {
  const examAudio = useExamAudio();
  const units = useMemo(() => buildUnits(pool), [pool]);
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

  if (!ready) {
    return <SurfaceCard style={{ padding: "48px 24px", textAlign: "center", color: C.t3, fontSize: 13 }}>正在整理错题...</SurfaceCard>;
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

function DrillStage({ stage, index, count, onComplete, onExit }) {
  const last = index === count - 1;
  const nextLabel = last ? "查看统计 →" : `下一组（${index + 2}/${count}）→`;
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
        nextLabel={nextLabel}
      />
    );
  }
  if (stage.kind === "ctw") {
    return <CTWTask item={stage.item} isPractice onComplete={onComplete} onExit={onExit} nextLabel={nextLabel} />;
  }
  if (stage.kind === "rdl") {
    return (
      <RDLTask
        item={stage.item}
        isPractice
        title={stage.title}
        section={section}
        onComplete={onComplete}
        onExit={onExit}
        nextLabel={nextLabel}
      />
    );
  }
  if (stage.kind === "lcr") {
    return <LCRTask batchItems={stage.items} isPractice onComplete={onComplete} onExit={onExit} nextLabel={nextLabel} />;
  }
  return (
    <ListeningMCQTask
      item={stage.item}
      taskType={stage.subtype}
      isPractice
      title={stage.title}
      section={section}
      onComplete={onComplete}
      onExit={onExit}
      nextLabel={nextLabel}
    />
  );
}

/* ── 报告页 ── */

function DrillReport({ report, pool, onAgain }) {
  const ai = useMistakeAi();
  const cards = pool.cards || {};
  const wrong = report.results.filter((r) => !r.correct).map((r) => cards[r.key]).filter(Boolean);
  const right = report.results.filter((r) => r.correct).map((r) => cards[r.key]).filter(Boolean);
  const [toRemove, setToRemove] = useState(() => new Set(right.map((c) => c.key)));
  const [removedCount, setRemovedCount] = useState(0);
  const s = report.summary;
  const gp = useMemo(() => {
    const f = {};
    wrong.filter((c) => c.subject === "bs").forEach((c) => (c.brief?.grammar_points || []).forEach((g) => { f[g] = (f[g] || 0) + 1; }));
    return Object.entries(f).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [wrong]);

  return (
    <div data-testid="drill-report">
      <SurfaceCard style={{ padding: "20px 22px", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: C.t2, marginBottom: 10 }}>练错题统计{report.partial ? "（中途退出，只统计做完的组）" : ""}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
          {[
            { label: "题数", value: s.total },
            { label: "答对", value: s.correct, color: C.green },
            { label: "正确率", value: `${pct(s.correct, s.total)}%`, color: pct(s.correct, s.total) >= 80 ? C.green : pct(s.correct, s.total) >= 50 ? "#d97706" : C.red },
            { label: "用时", value: formatDuration(report.durationSec) },
          ].map((x) => (
            <div key={x.label}>
              <div style={{ fontSize: 24, fontWeight: 800, color: x.color || C.t1, fontVariantNumeric: "tabular-nums" }}>{x.value}</div>
              <div style={{ fontSize: 12, color: C.t3 }}>{x.label}</div>
            </div>
          ))}
        </div>
        {Object.keys(s.byType).length > 0 && (
          <div style={{ marginTop: 16, borderTop: `1px solid ${C.bdrSubtle}`, paddingTop: 12 }}>
            {DRILL_TYPES.filter((t) => s.byType[t.id]).map((t) => {
              const b = s.byType[t.id];
              const p = pct(b.correct, b.total);
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", fontSize: 13 }}>
                  <span style={{ width: 80, color: C.t2, flexShrink: 0 }}>{t.label}</span>
                  <div style={{ flex: 1, minWidth: 0, height: 10, background: C.bg, borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ width: `${p}%`, height: "100%", background: p >= 80 ? C.green : p >= 50 ? "#f59e0b" : "#ef4444", borderRadius: 999 }} />
                  </div>
                  <span style={{ width: 92, textAlign: "right", color: C.t1, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{b.correct}/{b.total} · {p}%</span>
                </div>
              );
            })}
          </div>
        )}
        {gp.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: C.t2 }}>
            拼句仍然出错的语法点：{gp.map(([g, n]) => `${translateGrammarPoint(g)}${n > 1 ? ` ×${n}` : ""}`).join("、")}
          </div>
        )}
        {report.missing > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#92400e" }}>
            有 {report.missing} 道拼句原题已经下线（题库换代），这次没法重做，错题本里仍保留。
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <button type="button" onClick={onAgain} data-testid="drill-again" style={{ border: "none", background: "#E11D48", color: "#fff", borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            同条件再抽一组
          </button>
          <Link href="/?section=mistakes" style={{ border: `1px solid ${C.bdr}`, background: "#fff", color: C.t1, borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
            返回错题本
          </Link>
        </div>
      </SurfaceCard>

      {right.length > 0 && (
        <SurfaceCard style={{ padding: "16px 18px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.t1 }}>这次做对的 {right.length} 题</span>
            <span style={{ fontSize: 12, color: C.t3 }}>觉得已经掌握了，可以移出错题本（之后再错会自动回来）</span>
          </div>
          {removedCount > 0 ? (
            <div style={{ fontSize: 13, color: C.green }}>已移出 {removedCount} 题。</div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                {right.map((c) => (
                  <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.t1, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={toRemove.has(c.key)}
                      onChange={() => {
                        const n = new Set(toRemove);
                        if (n.has(c.key)) n.delete(c.key); else n.add(c.key);
                        setToRemove(n);
                      }}
                    />
                    <span style={{ fontSize: 11, color: C.t3, flexShrink: 0 }}>{SUBTYPE_META[c.subtype]?.label}</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.subject === "bs" ? c.brief?.correctAnswer : (c.brief?.stem || c.brief?.correctAnswer)}
                    </span>
                  </label>
                ))}
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

      {wrong.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", margin: "6px 0 10px" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.t1 }}>仍然错的 {wrong.length} 题</span>
            <span style={{ fontSize: 12, color: C.t3 }}>卡片里是错题本记下的原错答；这次怎么答的，在每组做完的结果页里看</span>
          </div>
          {wrong.map((c) => (
            <MistakeItemCard key={c.key} card={c} items={pool.items} ai={ai} showMeta={false} />
          ))}
        </>
      )}
    </div>
  );
}

/* ── 主组件 ── */

function DrillInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pinnedKey = searchParams.get("key");
  const { pool, ready } = useMistakePool({ derive: true });
  const [isPro, setIsPro] = useState(false);
  const [phase, setPhase] = useState("setup"); // setup | loading | running | report
  const [run, setRun] = useState(null); // { stages, unitIds, config, idx, done[], results{}, startedAt, elapsedBefore, missing }
  const [report, setReport] = useState(null);
  const [lastConfig, setLastConfig] = useState(null);
  const [setupNonce, setSetupNonce] = useState(0);
  const runRef = useRef(null);
  runRef.current = run;

  useEffect(() => {
    const tier = getSavedTier();
    setIsPro(tier === "pro" || tier === "legacy");
  }, []);

  const handleStart = useCallback(async (units, config, { resume } = {}) => {
    setPhase("loading");
    setLastConfig(config);
    let stages = buildStages(units, pool);
    let missing = 0;
    const bsIdx = stages.findIndex((s) => s.kind === "bs");
    if (bsIdx >= 0) {
      const r = await resolveBsQuestions(stages[bsIdx].briefs);
      missing = r.missing.length;
      if (r.questions.length > 0) stages[bsIdx] = { ...stages[bsIdx], questions: r.questions, keyByQid: r.keyByQid };
      else stages = stages.filter((_, i) => i !== bsIdx);
    }
    if (stages.length === 0) {
      setPhase("setup");
      window.alert(missing > 0 ? "选中的拼句原题都已下线，没法重做。" : "没有可以重做的题。");
      return;
    }
    const startIdx = resume ? Math.min(resume.stageIndex || 0, stages.length - 1) : 0;
    setRun({
      stages,
      unitIds: units.map((u) => u.id),
      config,
      idx: startIdx,
      done: stages.map((_, i) => i < startIdx),
      results: resume?.results || {},
      startedAt: Date.now(),
      elapsedBefore: resume?.elapsedSec || 0,
      missing,
    });
    setPhase("running");
    window.scrollTo(0, 0);
  }, [pool]);

  const finish = useCallback((r, partial) => {
    const results = Object.entries(r.results).map(([key, correct]) => ({ key, correct }));
    const summary = summarizeDrill(results, pool.cards);
    const durationSec = Math.round((Date.now() - r.startedAt) / 1000) + (r.elapsedBefore || 0);
    if (results.length > 0) {
      recordDrill(results, { total: summary.total, correct: summary.correct, durationSec, byType: summary.byType, config: r.config });
    }
    clearProgress();
    setReport({ results, summary, durationSec, missing: r.missing, partial });
    setRun(null);
    setPhase(results.length > 0 ? "report" : "setup");
    window.scrollTo(0, 0);
  }, [pool]);

  const handleStageComplete = useCallback((result) => {
    const r = runRef.current;
    if (!r) return;
    const stage = r.stages[r.idx];
    const scored = scoreStage(stage, result);
    const results = { ...r.results };
    scored.forEach((x) => { results[x.key] = x.correct; });
    const done = r.done.slice();
    done[r.idx] = true;
    setRun({ ...r, results, done });
  }, []);

  const handleStageExit = useCallback(() => {
    const r = runRef.current;
    if (!r) return;
    if (r.done[r.idx]) {
      const nextIdx = r.idx + 1;
      if (nextIdx >= r.stages.length) {
        finish(r, false);
        return;
      }
      const elapsedSec = Math.round((Date.now() - r.startedAt) / 1000) + (r.elapsedBefore || 0);
      saveProgress({ unitIds: r.unitIds, stageIndex: nextIdx, stageCount: r.stages.length, results: r.results, elapsedSec });
      setRun({ ...r, idx: nextIdx });
      window.scrollTo(0, 0);
      return;
    }
    const anyDone = r.done.some(Boolean);
    const ok = typeof window.confirm === "function"
      ? window.confirm(anyDone ? "退出练错题？已经做完的组会计入统计。" : "退出练错题？这组还没提交，不会计入。")
      : true;
    if (!ok) return;
    if (anyDone) finish(r, true);
    else {
      setRun(null);
      setPhase("setup");
    }
  }, [finish]);

  if (phase === "running" && run) {
    const stage = run.stages[run.idx];
    return (
      <DrillStage
        key={`${run.idx}-${stage.kind}`}
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
            <h1 style={{ fontSize: 20, fontWeight: 800, color: C.t1, margin: 0 }}>{phase === "report" ? "练错题 · 统计报告" : "练错题"}</h1>
            <div style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>从错题本里抽题集中重做，做完出统计报告</div>
          </div>
          <button
            type="button"
            onClick={() => router.push("/?section=mistakes")}
            style={{ background: "none", border: `1px solid ${C.bdr}`, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, color: C.t2, cursor: "pointer", flexShrink: 0, fontFamily: "inherit" }}
          >
            返回错题本
          </button>
        </div>
        {phase === "loading" ? (
          <SurfaceCard style={{ padding: "48px 24px", textAlign: "center", color: C.t3, fontSize: 13 }}>正在准备题目...</SurfaceCard>
        ) : phase === "report" && report ? (
          <DrillReport
            report={report}
            pool={pool}
            onAgain={() => { setReport(null); setPhase("setup"); setSetupNonce(setupNonce + 1); window.scrollTo(0, 0); }}
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
