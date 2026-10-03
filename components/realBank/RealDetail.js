"use client";
// 「真题练习记录」详情页（设计稿「真题练习记录 优化版」· 详情）：主从布局。
//   左：可收起的「练习明细」列表（当前条高亮，点任一条直接切换）；
//   右：头部（返回 / 题型 / 来源分档 / 得分环 / 再练 / 删除）→ 编号导航（每道题一个色块，点了展开并定位）
//        → 吸顶筛选条（全部 / 错题 / 答对 · 全部展开 / 收起 · 上一条 / 下一条）→ 逐题回顾正文。
// 正文按题型分发给 review/ 下的组件；真题模考是「题组列表 → 点进某一组 = 同一套详情」。
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ModeChip } from "../shared/ui";
import { REAL_SUBTYPE_META, realScoreColor } from "../../lib/realBankHistory";
import { buildMockTasks, formatHM, formatMD, whenLabel } from "../../lib/realBankReview";
import { ACCENT, describeEntry, retryHref } from "./realBankMeta";
import { IconBox, LV, ScoreRing, TierBadge, hoverStyle } from "./realBankUi";
import { scrollToKey } from "./review/shared";
import { CtwReview } from "./review/CtwReview";
import { McqReview } from "./review/McqReview";
import { BsReview } from "./review/BsReview";
import { InterviewReview, RepeatReview } from "./review/SpeakingReview";
import { UnscoredReport, WritingReport } from "./review/WritingReview";

const A = ACCENT.color;
const FILTER_KINDS = ["ctw", "mcq", "bs", "repeat", "interview"];

function initialOpen(model, vid, focus) {
  if (model.kind === "mock" || model.kind === "writing" || model.kind === "unscored") return {};
  const first = focus != null ? focus : (model.units.find((u) => u.lv !== "ok") || {}).idx;
  return first != null ? { [`${vid}:${first}`]: true } : {};
}

function Rail({ navList, models, current, index, min, onToggle, onOpenEntry }) {
  return (
    <aside data-testid="real-rail" style={{ width: min ? 58 : 248, flexShrink: 0, position: "sticky", top: 76, background: "#fff", border: "1px solid #dde5df", borderRadius: 14, overflow: "hidden", transition: "width .25s cubic-bezier(0.25,1,0.5,1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 10px 8px 14px", borderBottom: "1px solid #ebf0ed" }}>
        {!min ? <><span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>练习明细</span><span style={{ fontSize: 11, color: "#94a39a" }}>{navList.length}</span></> : null}
        <button type="button" onClick={onToggle} title={min ? "展开列表" : "收起列表"} aria-label={min ? "展开列表" : "收起列表"}
          style={{ marginLeft: "auto", width: 26, height: 26, borderRadius: 7, border: "1px solid #ebf0ed", background: "#fff", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: min ? "rotate(180deg)" : "none" }} aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5" stroke="#5a6b62" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <div style={{ maxHeight: "calc(100vh - 150px)", overflow: "auto", padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
        {navList.map((e) => {
          const info = describeEntry(e, index);
          const m = models.get(e.sourceIndex);
          const on = e.sourceIndex === current;
          const sc = realScoreColor(m.score.pct, "#94a39a");
          return (
            <button key={e.sourceIndex} type="button" onClick={() => onOpenEntry(e)} title={info.meta.label} aria-current={on ? "true" : undefined}
              style={{ position: "relative", display: "flex", alignItems: "center", gap: 9, padding: "7px 8px", borderRadius: 9, border: "none", background: on ? ACCENT.soft : "transparent", cursor: "pointer", textAlign: "left", minWidth: 0, fontFamily: "inherit" }}
              {...hoverStyle({ background: on ? ACCENT.soft : "#f4f7f5" })}>
              <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, background: on ? A : "transparent" }} />
              <span style={{ width: 28, height: 28, borderRadius: 8, background: `${info.meta.color}14`, color: info.meta.color, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{info.meta.icon}</span>
              {!min ? (
                <>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12, fontWeight: on ? 750 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#1a2420" }}>{info.meta.label}</span>
                    <span style={{ display: "block", fontSize: 10.5, color: "#94a39a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{whenLabel(e.session.date)} · {info.subtitle}</span>
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 750, color: sc, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{m.score.label}</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function MockTaskList({ tasks, note, onOpen }) {
  return (
    <div data-testid="real-mock-review" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12.5, color: "#5a6b62", lineHeight: 1.6, padding: "10px 12px", background: "#fafbfa", border: "1px solid #ebf0ed", borderRadius: 10 }}>{note}</div>
      {tasks.map((t, i) => {
        const tm = REAL_SUBTYPE_META[t.type] || { icon: "•", color: "#5a6b62", label: t.type };
        const sc = realScoreColor(t.model.score.pct, "#5a6b62");
        const dots = t.model.kind === "writing" || t.model.kind === "unscored" ? [] : t.model.units;
        return (
          <button key={i} type="button" onClick={() => onOpen(i)}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", border: "1px solid #ebf0ed", borderRadius: 12, background: "#fff", cursor: "pointer", textAlign: "left", flexWrap: "wrap", fontFamily: "inherit" }}
            {...hoverStyle({ borderColor: "#dde5df", background: "#fcfdfc" })}>
            <span style={{ width: 24, height: 24, borderRadius: 7, background: "#f3f6f4", color: "#5a6b62", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{i + 1}</span>
            <IconBox meta={tm} size={32} radius={9} />
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{tm.label}</span>
                {t.task?.module ? <span style={{ display: "inline-flex", padding: "1px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700, color: "#3B82F6", background: "#EFF6FF" }}>M{t.task.module}</span> : null}
                {t.itemId ? <span style={{ fontSize: 10.5, color: "#94a39a", fontFamily: "'Courier New',monospace" }}>{t.itemId}</span> : null}
              </div>
              {t.task?.topic || t.task?.title ? <div style={{ fontSize: 11.5, color: "#5a6b62", marginTop: 2 }}>{t.task.topic || t.task.title}</div> : null}
            </div>
            <div style={{ display: "flex", gap: 2 }} aria-hidden="true">
              {dots.slice(0, 14).map((u, k) => <span key={k} style={{ width: 6, height: 16, borderRadius: 2, background: LV[u.lv].c + (u.lv === "ok" ? "99" : "") }} />)}
            </div>
            <span style={{ minWidth: 48, textAlign: "center", fontSize: 13, fontWeight: 750, color: sc, background: `${sc}12`, padding: "3px 10px", borderRadius: 8, fontVariantNumeric: "tabular-nums" }}>{t.model.score.label}</span>
            <span style={{ fontSize: 12, color: A, fontWeight: 700, whiteSpace: "nowrap" }}>逐题回顾 →</span>
          </button>
        );
      })}
    </div>
  );
}

function DetailMain({ entry, navList, models, index, wide, initialFocus, onOpenEntry, onBack, onDelete, rescoring, rescoreError, canRescoreEntry, onRescore }) {
  const record = entry.session;
  const recordModel = models.get(entry.sourceIndex);
  const isMock = recordModel.kind === "mock";
  const mockTasks = useMemo(() => (isMock ? buildMockTasks(record) : []), [isMock, record]);

  const [task, setTask] = useState(() => (isMock && initialFocus != null && mockTasks[initialFocus] ? initialFocus : null));
  const inTask = isMock && task != null && !!mockTasks[task];
  const cur = inTask
    ? { session: mockTasks[task].session, subtype: mockTasks[task].type, model: mockTasks[task].model, task: mockTasks[task] }
    : { session: record, subtype: entry.subtype, model: recordModel, task: null };
  const vid = inTask ? `${entry.sourceIndex}-t${task}` : `${entry.sourceIndex}`;
  const model = cur.model;
  const kind = model.kind;

  const [filter, setFilter] = useState("all");
  const [open, setOpenMap] = useState(() => {
    if (isMock && initialFocus != null && mockTasks[initialFocus]) {
      const m = mockTasks[initialFocus].model;
      return initialOpen(m, `${entry.sourceIndex}-t${initialFocus}`, null);
    }
    return initialOpen(recordModel, `${entry.sourceIndex}`, initialFocus);
  });
  const [confirmDel, setConfirmDel] = useState(false);
  const [wfocus, setWfocus] = useState(() => (recordModel.kind === "writing" && initialFocus != null ? { id: `err${initialFocus}`, nonce: 1 } : null));

  React.useEffect(() => {
    if (initialFocus != null && !isMock && FILTER_KINDS.includes(recordModel.kind)) scrollToKey(`${entry.sourceIndex}:${initialFocus}`);
    // 只在进入这条记录时定位一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pass = (u) => filter === "all" || (filter === "wrong" ? u.lv !== "ok" : u.lv === "ok");
  const ctx = {
    wide, pass,
    emptyText: filter === "wrong" ? "这一项全部达标，没有需要回看的题。" : "没有符合筛选的题目。",
    isOpen: (i) => !!open[`${vid}:${i}`],
    toggle: (i) => setOpenMap((o) => ({ ...o, [`${vid}:${i}`]: !o[`${vid}:${i}`] })),
    setOpen: (i, v) => setOpenMap((o) => ({ ...o, [`${vid}:${i}`]: v })),
  };

  const meta = REAL_SUBTYPE_META[cur.subtype] || REAL_SUBTYPE_META[entry.subtype];
  const info = describeEntry(entry, index);
  const d = new Date(record.date);
  const speaking = kind === "repeat" || kind === "interview";
  const okN = model.units.filter((u) => u.lv === "ok").length;
  const badN = model.units.length - okN;
  const hasFilter = FILTER_KINDS.includes(kind);
  const sc = realScoreColor(model.score.pct, "#5a6b62");
  const metaParts = [`练习于 ${formatMD(d)} ${formatHM(d)}`];
  if (info.examDate) metaParts.push(`考试日期 ${info.examDate}`);
  if (!inTask && info.duration) metaParts.push(`用时 ${info.duration}`);
  const itemId = inTask ? cur.task.itemId : info.itemId;
  if (itemId) metaParts.push(itemId);
  const subtitle = inTask ? String(cur.task.task?.topic || cur.task.task?.title || "") : info.subtitle;

  let stats = "";
  let navHint = "点编号直接展开并定位";
  if (kind === "writing") {
    const score = Number(cur.session.details?.feedback?.score);
    const b6 = Math.round(Math.min(6, Math.max(1, score + 1)) * 2) / 2;
    stats = `AI 评分 ${score}/5 · 换算 ${b6}/6 · ${model.units.length} 处批注`;
    navHint = "点编号定位到原文批注";
  } else if (kind === "mock") {
    stats = `原始分 ${model.score.label} · ${model.units.length} 个题组`;
    navHint = "点题组进入逐题回顾";
  } else if (kind === "repeat") {
    const items = cur.session.details?.items || [];
    stats = `录制 ${items.filter((x) => x.recorded).length}/${items.length} 句 · 达标 ${okN}`;
  } else if (kind === "interview") {
    const items = cur.session.details?.items || [];
    stats = `回答 ${items.filter((x) => x.recorded).length}/${items.length} 题 · 平均 ${cur.session.details?.averageScore ?? "—"}/5`;
  } else if (kind !== "unscored") {
    stats = `答对 ${okN} · 答错 ${badN}`;
  }

  function goUnit(u) {
    if (kind === "writing") { setWfocus((f) => ({ id: `err${u.idx}`, nonce: (f?.nonce || 0) + 1 })); return; }
    if (kind === "mock") { openTask(u.idx); return; }
    if (!pass(u)) setFilter("all");
    ctx.setOpen(u.idx, true);
    scrollToKey(`${vid}:${u.idx}`);
  }
  function openTask(i) {
    const t = mockTasks[i];
    if (!t) return;
    const f = t.model.units.find((u) => u.lv !== "ok");
    setTask(i);
    setFilter("all");
    setOpenMap(f ? { [`${entry.sourceIndex}-t${i}:${f.idx}`]: true } : {});
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  }

  const navIdx = navList.findIndex((e) => e.sourceIndex === entry.sourceIndex);
  const prev = navList[navIdx - 1];
  const next = navList[navIdx + 1];
  const visible = model.units.filter(pass);
  const seen = Array.isArray(record.details?.seenItemIds) ? record.details.seenItemIds.length : 0;
  const mockNote = `已展示 ${seen || mockTasks.length} 个完整题组／单题；原始分 ${recordModel.score.label}。本站 1–6 分为未经 ETS 等值的模考估分。`;
  const bodyTitle = kind === "writing" ? "批改报告" : kind === "unscored" ? "作答记录" : kind === "mock" ? "题组列表 · 点任一组逐题回顾" : "逐题回顾";

  const segs = [["all", "全部", model.units.length], ["wrong", speaking ? "待提高" : "错题", badN], ["right", speaking ? "达标" : "答对", okN]];
  const segStyle = (k) => {
    const on = filter === k;
    return {
      background: on ? (k === "wrong" ? LV.bad.soft : k === "right" ? LV.ok.soft : "#1a2420") : "transparent",
      color: on ? (k === "wrong" ? LV.bad.c : k === "right" ? LV.ok.c : "#fff") : "#5a6b62",
    };
  };

  const rescoreKey = entry.sourceIndex;
  return (
    <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12, animation: "rbSlideIn .32s cubic-bezier(0.16,1,0.3,1) both" }}>
      <section data-testid="real-session-detail" style={{ background: "#fff", border: "1px solid #dde5df", borderRadius: 14, padding: "16px 20px" }}>
        {inTask ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, fontSize: 12 }}>
            <button type="button" onClick={() => { setTask(null); setOpenMap({}); setFilter("all"); }} style={{ border: "none", background: "none", padding: 0, color: A, fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>‹ {describeEntry(entry, index).meta.label}</button>
            <span style={{ color: "#c5cfc9" }}>/</span>
            <span style={{ color: "#5a6b62" }}>第 {task + 1} 题组 · {meta.short}</span>
          </div>
        ) : null}
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <button type="button" onClick={onBack}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "1px solid #dde5df", background: "#fff", color: "#5a6b62", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            {...hoverStyle({ background: "#f7faf9" })}>← 返回列表</button>
          <IconBox meta={meta} size={40} radius={11} />
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: -.3 }}>{meta.label}</span>
              {!inTask ? <TierBadge tier={info.tier} label={info.tierLabel} /> : null}
              {!inTask && !isMock ? <ModeChip mode={record.mode} /> : null}
              {inTask && cur.task.task?.module ? <span style={{ display: "inline-flex", padding: "1px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700, lineHeight: 1.5, color: "#3B82F6", background: "#EFF6FF" }}>M{cur.task.task.module}</span> : null}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4, fontSize: 11.5, color: "#94a39a", fontVariantNumeric: "tabular-nums" }}>
              <span>{metaParts.join(" · ")}</span>
              {subtitle ? <span style={{ color: "#5a6b62" }}>{subtitle}</span> : null}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <ScoreRing pct={model.score.pct} label={model.score.label} color={sc} size={56} />
            <Link href={retryHref(entry)} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${A}55`, background: ACCENT.soft, color: A, fontSize: 12, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>再练一套</Link>
            {!inTask && !confirmDel ? (
              <button type="button" onClick={() => setConfirmDel(true)} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #dde5df", background: "#fff", color: "#94a39a", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }} {...hoverStyle({ color: "#dc2626", borderColor: "#fecaca" })}>删除</button>
            ) : null}
            {!inTask && confirmDel ? (
              <span style={{ display: "inline-flex", gap: 6 }}>
                <button type="button" onClick={() => onDelete(entry)} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>确认删除</button>
                <button type="button" onClick={() => setConfirmDel(false)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #dde5df", background: "#fff", color: "#5a6b62", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>取消</button>
              </span>
            ) : null}
          </div>
        </div>
        {stats ? (
          <div data-testid="real-unit-nav" style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #ebf0ed", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "#5a6b62", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{stats}</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {model.units.map((u) => {
                const L = kind === "writing" ? (u.level === "red" ? (String(u.errorType).toLowerCase() === "spelling" ? { c: "#7c3aed", bg: "#f5f3ff" } : { c: "#E11D48", bg: "#fff1f2" }) : u.level === "orange" ? { c: "#d97706", bg: "#fffbeb" } : { c: "#0891B2", bg: "#ecfeff" }) : LV[u.lv];
                const on = kind === "writing" ? wfocus?.id === `err${u.idx}` : kind === "mock" ? false : ctx.isOpen(u.idx);
                return (
                  <button key={u.idx} type="button" data-error-token="true" onClick={() => goUnit(u)} title={kind === "writing" ? `${u.label}：${u.text}` : u.hint}
                    style={{ minWidth: 26, height: 26, padding: "0 6px", borderRadius: 7, border: `1.5px solid ${on ? L.c : "transparent"}`, background: L.bg, color: L.c, fontSize: 11, fontWeight: 800, cursor: "pointer", fontVariantNumeric: "tabular-nums", fontFamily: "inherit" }}
                    {...hoverStyle({ filter: "brightness(0.96)" })}>{u.n}</button>
                );
              })}
            </div>
            <span style={{ marginLeft: "auto", fontSize: 10.5, color: "#94a39a" }}>{navHint}</span>
          </div>
        ) : null}
      </section>

      <div style={{ position: "sticky", top: 56, zIndex: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0", background: "#F4F7F5" }}>
        {hasFilter ? (
          <>
            <div role="tablist" style={{ display: "inline-flex", gap: 3, padding: 3, background: "#fff", border: "1px solid #dde5df", borderRadius: 999 }}>
              {segs.map(([k, label, n]) => (
                <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                  style={{ border: "none", borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", ...segStyle(k) }}>
                  {label} <span style={{ fontVariantNumeric: "tabular-nums", opacity: .75 }}>{n}</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setOpenMap((o) => { const x = { ...o }; visible.forEach((u) => { x[`${vid}:${u.idx}`] = true; }); return x; })}
              style={{ padding: "6px 11px", borderRadius: 8, border: "1px solid #dde5df", background: "#fff", color: "#5a6b62", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }} {...hoverStyle({ color: "#1a2420" })}>全部展开</button>
            <button type="button" onClick={() => setOpenMap({})}
              style={{ padding: "6px 11px", borderRadius: 8, border: "1px solid #dde5df", background: "#fff", color: "#5a6b62", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }} {...hoverStyle({ color: "#1a2420" })}>全部收起</button>
          </>
        ) : <span style={{ fontSize: 12, fontWeight: 700, color: "#5a6b62" }}>{bodyTitle}</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" onClick={() => prev && onOpenEntry(prev)} disabled={!prev}
            style={{ padding: "6px 11px", borderRadius: 8, border: "1px solid #dde5df", background: "#fff", color: prev ? "#5a6b62" : "#c5cfc9", fontSize: 12, fontWeight: 600, cursor: prev ? "pointer" : "default", fontFamily: "inherit" }}>‹ 上一条</button>
          <button type="button" onClick={() => next && onOpenEntry(next)} disabled={!next}
            style={{ padding: "6px 11px", borderRadius: 8, border: "1px solid #dde5df", background: "#fff", color: next ? "#5a6b62" : "#c5cfc9", fontSize: 12, fontWeight: 600, cursor: next ? "pointer" : "default", fontFamily: "inherit" }}>下一条 ›</button>
        </div>
      </div>

      <section style={{ background: "#fff", border: "1px solid #dde5df", borderRadius: 14, padding: "18px 20px" }}>
        {hasFilter ? <div style={{ fontSize: 12, fontWeight: 700, color: "#5a6b62", marginBottom: 12, letterSpacing: ".02em" }}>{bodyTitle}</div> : null}
        {kind === "ctw" ? <CtwReview session={cur.session} model={model} vid={vid} ctx={ctx} /> : null}
        {kind === "mcq" ? <McqReview session={cur.session} subtype={cur.subtype} model={model} vid={vid} ctx={ctx} /> : null}
        {kind === "bs" ? <BsReview session={cur.session} model={model} vid={vid} ctx={ctx} /> : null}
        {kind === "repeat" ? <RepeatReview session={cur.session} model={model} vid={vid} ctx={ctx} /> : null}
        {kind === "interview" ? <InterviewReview session={cur.session} model={model} vid={vid} ctx={ctx} /> : null}
        {kind === "writing" ? <WritingReport session={cur.session} color={meta.color} focus={wfocus} onBack={inTask ? () => setTask(null) : onBack} /> : null}
        {kind === "unscored" ? (
          <UnscoredReport session={cur.session} canRetry={!inTask && canRescoreEntry(entry)} rescoring={rescoring[rescoreKey] === "loading"} error={rescoreError[rescoreKey] || ""} onRescore={() => onRescore(entry)} />
        ) : null}
        {kind === "mock" ? <MockTaskList tasks={mockTasks} note={mockNote} onOpen={openTask} /> : null}
        {!kind ? <div style={{ fontSize: 12, color: "#94a39a" }}>这条记录缺少可展示的详情。</div> : null}
      </section>
    </main>
  );
}

export function RealDetail({ entry, navList, models, index, wide, railMin, onToggleRail, initialFocus, onOpenEntry, onBack, onDelete, rescoring, rescoreError, canRescoreEntry, onRescore }) {
  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
      {wide ? <Rail navList={navList} models={models} current={entry.sourceIndex} index={index} min={railMin} onToggle={onToggleRail} onOpenEntry={onOpenEntry} /> : null}
      <DetailMain key={entry.sourceIndex} entry={entry} navList={navList} models={models} index={index} wide={wide} initialFocus={initialFocus}
        onOpenEntry={onOpenEntry} onBack={onBack} onDelete={onDelete} rescoring={rescoring} rescoreError={rescoreError}
        canRescoreEntry={canRescoreEntry} onRescore={onRescore} />
    </div>
  );
}

