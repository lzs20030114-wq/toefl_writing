"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";
// Icon / IconBadge / PressButton 复用右栏现有的设计语言（同一份实现，不另抄一遍）。
import { Icon, IconBadge, PressButton } from "./StudyPlanColumn";
import {
  DAILY_TASKS_UPDATED_EVENT, DAILY_TASK_GROUPS, DAILY_TASK_TYPES, DAILY_TASK_FREQS,
  FREQ_DAILY, MAX_DAILY_TARGET, MAX_DAILY_TASKS, MAX_TASK_KEYS,
  clearDailyTasks, getDailyTaskType, getFreqMeta, hasDailyTasks,
  loadDailyTasks, makeTaskId, saveDailyTasks, summarizeDailyTasks,
} from "../../lib/dailyTasks";
import { getSavedTier, AUTH_CHANGED_EVENT } from "../../lib/AuthContext";

/**
 * 今日任务卡：用户自己设定「每天 / 隔天 / 每周 某题型（或两个题型任选其一）练几次」，
 * 这里显示今日（或本周）完成进度，供自我监督。
 * 数据只在本地（lib/dailyTasks.js），计数口径 = 一条练习记录算 1 次。
 */
export const DAILY_TASKS_MOBILE_OPEN_KEY = "toefl-daily-tasks-mobile-open";

export function DailyTasksCard({ userCode, isChallenge, sessions, modernCard, fadeIn, now, variant = "desktop" }) {
  const [state, setState] = useState(EMPTY_STATE);
  const [editorOpen, setEditorOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [sourceChoice, setSourceChoice] = useState(null);
  const [isPro, setIsPro] = useState(true); // 默认当 Pro，避免首帧闪一排 Pro 角标

  useEffect(() => {
    const refresh = () => setState(loadDailyTasks(userCode));
    refresh();
    window.addEventListener(DAILY_TASKS_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(DAILY_TASKS_UPDATED_EVENT, refresh);
  }, [userCode]);

  useEffect(() => {
    const readTier = () => {
      const tier = getSavedTier();
      setIsPro(tier === "pro" || tier === "legacy");
    };
    readTier();
    window.addEventListener(AUTH_CHANGED_EVENT, readTier);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, readTier);
  }, []);

  const summary = useMemo(
    () => summarizeDailyTasks(state.tasks, sessions, now),
    [state.tasks, sessions, now]
  );

  const t1 = isChallenge ? CH.t1 : T.t1;
  const t2 = isChallenge ? CH.t2 : T.t2;
  const t3 = isChallenge ? CH.t2 : T.t3;
  const tRest = isChallenge ? "rgba(255,255,255,0.32)" : "#AEBAB3"; // 休息日的静音字色（不用 opacity 叠字）
  const hairline = isChallenge ? CH.cardBorder : T.bdrSubtle;
  const barTrack = isChallenge ? "rgba(255,255,255,0.08)" : "#ECF1EE";
  const configured = hasDailyTasks(state);

  const editorPortal = editorOpen && typeof document !== "undefined" && createPortal(
    <DailyTasksEditor
      tasks={state.tasks}
      isPro={isPro}
      onSave={(next) => { setState(saveDailyTasks(userCode, next)); setEditorOpen(false); }}
      onClear={() => { setState(clearDailyTasks(userCode)); setEditorOpen(false); }}
      onClose={() => setEditorOpen(false)}
    />,
    document.body
  );
  const sourcePortal = sourceChoice && typeof document !== "undefined" && createPortal(
    <PracticeSourcePicker choice={sourceChoice} isPro={isPro} onClose={() => setSourceChoice(null)} />,
    document.body
  );

  // 手机端：紧凑变体（默认收起 + 总进度条）。数据/汇总/编辑弹窗与桌面完全同一套。
  if (variant === "mobile") {
    return (
      <>
        <MobileDailyTasks
          summary={summary} configured={configured} isChallenge={isChallenge}
          t1={t1} t2={t2} t3={t3} tRest={tRest} barTrack={barTrack}
          onEdit={() => setEditorOpen(true)}
          onChooseSource={setSourceChoice}
        />
        {editorPortal}
        {sourcePortal}
      </>
    );
  }

  return (
    <div style={{ ...modernCard("15px 16px 14px"), ...fadeIn(180) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: configured && !desktopOpen ? 10 : 12 }}>
        <button
          type="button" onClick={() => setDesktopOpen((open) => !open)}
          aria-label={`${desktopOpen ? "收起" : "展开"}今日任务`} aria-expanded={desktopOpen}
          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, padding: 0, border: 0, background: "transparent", cursor: "pointer", fontFamily: HOME_FONT, textAlign: "left" }}
        >
          <IconBadge name="list" isChallenge={isChallenge} />
          <span style={{ fontSize: 14, fontWeight: 700, color: t1, flex: 1 }}>今日任务</span>
        </button>
        {configured && (
          <>
            <span style={{ fontSize: 12, fontWeight: 700, color: summary.allComplete ? T.primary : t2, fontVariantNumeric: "tabular-nums" }}>
              {summary.allRest ? "休息日" : `${summary.completeCount}/${summary.dueCount}`}
            </span>
            <button
              onClick={() => setEditorOpen(true)} title="编辑每日任务"
              style={{ border: "none", background: "transparent", color: t3, padding: "3px 2px 3px 5px", cursor: "pointer", display: "flex", alignItems: "center", transition: "color .15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = T.primary; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = t3; }}
            >
              <Icon name="edit" color="currentColor" size={13} />
            </button>
          </>
        )}
        <button
          type="button" onClick={() => setDesktopOpen((open) => !open)}
          aria-label={`${desktopOpen ? "收起" : "展开"}今日任务`} aria-expanded={desktopOpen}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 26, border: 0, background: "transparent", cursor: "pointer", padding: 0 }}
        >
          <Chevron open={desktopOpen} color={t3} />
        </button>
      </div>

      {configured && !desktopOpen && (
        <div role="progressbar" aria-label="今日任务总进度" aria-valuemin={0} aria-valuemax={Math.max(1, summary.dueCount)} aria-valuenow={summary.completeCount}
          style={{ height: 8, borderRadius: 99, background: barTrack, overflow: "hidden" }}>
          <div style={{ width: `${summary.dueCount ? summary.completeCount / summary.dueCount * 100 : 0}%`, height: "100%", borderRadius: 99, background: `linear-gradient(90deg, ${T.cyan}, ${T.primary})`, transition: "width .7s cubic-bezier(.25,1,.5,1)" }} />
        </div>
      )}

      {!configured && !desktopOpen && (
        <button type="button" onClick={() => setEditorOpen(true)} style={{ width: "100%", border: `1px dashed ${T.primaryMist}`, borderRadius: 9, padding: "7px 0", background: "transparent", color: T.primary, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: HOME_FONT }}>+ 设置每日任务</button>
      )}

      {desktopOpen && (!configured ? (
        <div style={{ textAlign: "center", padding: "4px 2px 2px" }}>
          <div style={{ width: 46, height: 46, borderRadius: 15, margin: "0 auto 11px", display: "flex", alignItems: "center", justifyContent: "center", background: isChallenge ? "rgba(13,150,104,0.12)" : T.primarySoft, border: `1px solid ${isChallenge ? "rgba(13,150,104,0.22)" : T.primaryMist}` }}>
            <Icon name="list" color={T.primary} size={22} />
          </div>
          <div style={{ fontSize: 12, color: t2, lineHeight: 1.65, marginBottom: 13 }}>
            给自己定每天练几次，<br />完成进度一目了然。
          </div>
          <PressButton onClick={() => setEditorOpen(true)} bg={T.primary} edge={T.primaryDeep} style={{ width: "100%", padding: "10px 0", fontSize: 13 }}>
            设置每日任务
          </PressButton>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {summary.items.map((item) => (
              <TaskRow
                key={item.id} item={item} onChooseSource={setSourceChoice}
                t1={t1} t3={t3} tRest={tRest} barTrack={barTrack}
              />
            ))}
          </div>

          {(summary.allComplete || summary.allRest) && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${hairline}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 11, fontWeight: 700, color: summary.allComplete ? T.primary : t3 }}>
              {summary.allComplete ? (
                <>
                  <Icon name="check" color={T.primary} size={11} />
                  今日任务全部达标
                </>
              ) : (
                "今天是休息日"
              )}
            </div>
          )}
        </>
      ))}

      {editorPortal}
      {sourcePortal}
    </div>
  );
}

const EMPTY_STATE = { tasks: [], updatedAt: null };

function Chevron({ open, color }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .25s ease" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/**
 * 手机端紧凑变体：外观与手机首页「用户状态条」同一语言（T.card + 1px T.bdr + 圆角 12）。
 * 头部整行可点切换展开/收起，头部下方常驻一条总进度条（已达标应练数 / 应练数）。
 * 展开状态存 localStorage，下次进来保持；展开动画用 grid-template-rows 0fr↔1fr，不量高度。
 */
function MobileDailyTasks({ summary, configured, isChallenge, t1, t2, t3, tRest, barTrack, onEdit, onChooseSource }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DAILY_TASKS_MOBILE_OPEN_KEY) === "1") setOpen(true);
    } catch { /* fail-open：读不到就保持收起 */ }
  }, []);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(DAILY_TASKS_MOBILE_OPEN_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  const shell = {
    marginBottom: 16,
    background: isChallenge ? CH.card : T.card,
    border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`,
    borderRadius: 12,
    fontFamily: HOME_FONT,
    overflow: "hidden",
  };

  // 还没设任务：只给一条细行，别在手机首页顶一张大空态卡
  if (!configured) {
    return (
      <div
        onClick={onEdit} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit(); } }}
        style={{ ...shell, display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", minHeight: 44, cursor: "pointer", touchAction: "manipulation" }}
      >
        <IconBadge name="list" isChallenge={isChallenge} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: t1 }}>给自己定个每日任务</span>
        <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: T.primary }}>设置 ›</span>
      </div>
    );
  }

  const totalPct = summary.dueCount > 0 ? summary.completeCount / summary.dueCount : 0;

  return (
    <div style={shell}>
      <div
        onClick={toggle} role="button" tabIndex={0} aria-expanded={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
        style={{ padding: "10px 14px 11px", cursor: "pointer", touchAction: "manipulation" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 36 }}>
          <IconBadge name="list" isChallenge={isChallenge} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: t1 }}>今日任务</span>
          {summary.allRest ? (
            <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: t3 }}>休息日</span>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              {summary.allComplete && <Icon name="check" color={T.primary} size={12} />}
              <span style={{ fontSize: 13, fontWeight: 700, color: summary.allComplete ? T.primary : t2, fontVariantNumeric: "tabular-nums" }}>
                {summary.completeCount}/{summary.dueCount}
              </span>
            </span>
          )}
          <Chevron open={open} color={t3} />
        </div>

        {/* 总进度条：应练任务里已达标的比例；全休息日画空轨 */}
        <div style={{ marginTop: 8, height: 5, borderRadius: 99, background: barTrack, overflow: "hidden" }}>
          <div style={{
            width: `${(summary.allRest ? 0 : totalPct) * 100}%`, height: "100%", borderRadius: 99,
            background: summary.allComplete ? `linear-gradient(90deg, ${T.cyan}, ${T.primary})` : `linear-gradient(90deg, ${T.primaryMist}, ${T.primary})`,
            transition: "width .7s cubic-bezier(.25,1,.5,1)",
          }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows .28s ease" }}>
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div style={{ padding: "2px 14px 10px" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {summary.items.map((item) => (
                <TaskRow
                  key={item.id} item={item} onChooseSource={onChooseSource}
                  t1={t1} t3={t3} tRest={tRest} barTrack={barTrack}
                  nameSize={13} rowPad="8px 0"
                />
              ))}
            </div>
            <button
              onClick={onEdit}
              style={{
                width: "100%", marginTop: 8, minHeight: 36, padding: "9px 0",
                fontSize: 13, fontWeight: 700, color: T.primary, background: "transparent",
                border: `1px solid ${isChallenge ? "rgba(13,150,104,0.4)" : T.primaryMist}`,
                borderRadius: 10, cursor: "pointer", fontFamily: HOME_FONT, touchAction: "manipulation",
              }}
            >
              编辑任务
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProTag() {
  return (
    <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: T.amber, border: `1px solid ${T.amber}55`, borderRadius: 5, padding: "0 3px", verticalAlign: "middle" }}>
      Pro
    </span>
  );
}

/**
 * 任务行。nameSize / rowPad 默认值 = 桌面右栏的原样（手机端才传大一号字 + 撑触控高度）。
 */
function TaskRow({ item, onChooseSource, t1, t3, tRest, barTrack, nameSize = 12, rowPad = null }) {
  const rest = item.restToday;
  const nameColor = rest ? tRest : t1;
  const pct = rest ? 0 : (item.target > 0 ? Math.max(0, Math.min(1, item.done / item.target)) : 0);
  const badge = getFreqMeta(item.freq).badge;
  const dual = item.keys.length > 1;
  const choose = (index) => onChooseSource({ key: item.keys[index], label: item.labels[index], aiHref: item.hrefs[index] });

  const nameStyle = {
    fontSize: nameSize, fontWeight: 600, color: nameColor, textDecoration: "none",
    whiteSpace: "nowrap", // 题型名不许从词中间断开，二选一只在「或」处换行
    touchAction: "manipulation",
    ...(rowPad ? { display: "inline-block", padding: "2px 0" } : null), // 手机上把链接热区撑高一点
  };

  const label = dual ? (
    // 二选一：先选题型，再选题目来源。
    <span style={{ display: "inline", lineHeight: 1.5 }}>
      {item.keys.map((k, i) => (
        <span key={k}>
          {i > 0 && <span style={{ color: t3, margin: "0 4px", fontSize: 11 }}>或</span>}
          <button type="button" onClick={() => choose(i)} aria-label={`选择${item.labels[i]}的题目来源`}
            style={{ ...nameStyle, padding: rowPad ? "2px 0" : 0, border: 0, background: "transparent", fontFamily: HOME_FONT, cursor: "pointer" }}>
            {item.labels[i]}
          </button>
        </span>
      ))}
    </span>
  ) : (
    // 卡片行不挂 Pro 角标（任务是用户自己设的，角标只在编辑弹窗里提示），省得把标签挤折行
    <span style={{ display: "inline", lineHeight: 1.5 }}>
      <span style={nameStyle}>{item.labels[0]}</span>
    </span>
  );

  const right = (
    <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginLeft: 8, fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
      {badge && <span style={{ fontSize: 10, fontWeight: 600, color: tRest }}>{badge}</span>}
      {rest ? (
        <span style={{ color: tRest }}>今日休息</span>
      ) : (
        <>
          {item.complete && <Icon name="check" color={T.primary} size={10} />}
          <span style={{ color: item.complete ? T.primary : t3 }}>{item.shown}/{item.target}</span>
        </>
      )}
    </span>
  );

  const bar = (
    <div style={{ height: 6, borderRadius: 99, background: barTrack, overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)" }}>
      <div style={{
        width: `${pct * 100}%`, height: "100%", borderRadius: 99,
        background: item.complete ? `linear-gradient(90deg, ${T.cyan}, ${T.primary})` : `linear-gradient(90deg, ${T.primaryMist}, ${T.primary})`,
        transition: "width .7s cubic-bezier(.25,1,.5,1)",
      }} />
    </div>
  );

  const head = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4, marginBottom: 5 }}>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {right}
    </div>
  );

  const wrap = rowPad ? { padding: rowPad } : null;

  // 单题型整行可点；二选一分别点题型名。
  if (dual) {
    return <div style={wrap}>{head}{bar}</div>;
  }
  return (
    <button type="button" onClick={() => choose(0)} aria-label={`选择${item.labels[0]}的题目来源`}
      style={{ display: "block", width: "100%", padding: 0, border: 0, background: "transparent", textAlign: "left", fontFamily: HOME_FONT, cursor: "pointer", touchAction: "manipulation", ...wrap }}
    >
      {head}
      {bar}
    </button>
  );
}

function PracticeSourcePicker({ choice, isPro, onClose }) {
  const firstOption = useRef(null);
  const isMock = choice.key === "mock";
  const realHref = isMock ? "/?section=real-bank" : `/real-bank?type=${encodeURIComponent(choice.key)}`;

  useEffect(() => {
    const previousFocus = document.activeElement;
    firstOption.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [onClose]);

  const optionStyle = (accent, soft) => ({
    display: "block", padding: "13px 14px", borderRadius: 12, border: `1px solid ${accent}44`,
    background: soft, color: accent, textDecoration: "none", touchAction: "manipulation",
  });

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,0.4)", WebkitBackdropFilter: "blur(4px)", backdropFilter: "blur(4px)" }}>
      <div role="dialog" aria-modal="true" aria-labelledby="daily-task-source-title" onClick={(event) => event.stopPropagation()}
        style={{ width: 360, maxWidth: "100%", boxSizing: "border-box", padding: 20, borderRadius: 18, background: "#fff", boxShadow: "0 20px 56px rgba(0,0,0,0.2)", fontFamily: HOME_FONT }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="daily-task-source-title" style={{ fontSize: 16, fontWeight: 700, color: "#1A2420" }}>练习{choice.label}</div>
            <div style={{ marginTop: 4, fontSize: 12, color: "#5A6B62" }}>选择题目来源</div>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭题目来源选择"
            style={{ width: 28, height: 28, border: 0, borderRadius: 8, background: "#F2F5F3", color: "#5A6B62", fontSize: 19, lineHeight: 1, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ display: "grid", gap: 9, marginTop: 18 }}>
          <Link ref={firstOption} href={choice.aiHref} style={optionStyle(T.primaryDeep, T.primarySoft)}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>AI出题 →</span>
            <span style={{ display: "block", marginTop: 3, fontSize: 11, color: "#5A6B62" }}>进入{choice.label}常规练习</span>
          </Link>
          <Link href={realHref} style={optionStyle("#B45309", "#FFF7ED")}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>真题专区 {!isPro && <span style={{ fontSize: 10 }}>· Pro</span>} →</span>
            <span style={{ display: "block", marginTop: 3, fontSize: 11, color: "#7C6A54" }}>
              {isMock ? "进入真题专区选择题型" : `查看${choice.label}真题`}
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ── 每日任务编辑弹窗（任务列表式；portal 到 body：本项目的 fadeUp 动画会给祖先留下
      transform，fixed 浮层若留在树里会被那个包含块困住错位，GoalEditor 同理） ── */
function DailyTasksEditor({ tasks, isPro, onSave, onClear, onClose }) {
  const [draft, setDraft] = useState(() => (tasks || []).map((t) => ({ ...t, keys: [...t.keys] })));
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState([]);
  const [hint, setHint] = useState("");

  const sigOf = (keys, freq) => `${[...keys].sort().join("|")}@${freq}`;
  const full = draft.length >= MAX_DAILY_TASKS;

  const setFreq = (id, freq) => {
    setDraft((prev) => {
      const target = prev.find((t) => t.id === id);
      if (!target || target.freq === freq) return prev;
      if (prev.some((t) => t.id !== id && sigOf(t.keys, t.freq) === sigOf(target.keys, freq))) {
        setHint("已经有一条一模一样的任务了，换个频率或先删掉那条");
        return prev;
      }
      setHint("");
      return prev.map((t) => (t.id === id ? { ...t, freq } : t));
    });
  };

  const stepTarget = (id, delta) => {
    setHint("");
    setDraft((prev) => prev.map((t) => (
      t.id === id ? { ...t, target: Math.max(1, Math.min(MAX_DAILY_TARGET, t.target + delta)) } : t
    )));
  };

  const removeTask = (id) => {
    setHint("");
    setDraft((prev) => prev.filter((t) => t.id !== id));
  };

  const togglePick = (key) => {
    setHint("");
    setPick((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= MAX_TASK_KEYS) return [...prev.slice(1), key]; // 第 3 个替换掉最早选的
      return [...prev, key];
    });
  };

  const confirmAdd = () => {
    if (pick.length === 0) return;
    if (full) { setHint(`最多只能同时盯 ${MAX_DAILY_TASKS} 项`); return; }
    if (draft.some((t) => sigOf(t.keys, t.freq) === sigOf(pick, FREQ_DAILY))) {
      setHint("这条任务已经在列表里了");
      return;
    }
    let id = makeTaskId(pick, FREQ_DAILY);
    if (draft.some((t) => t.id === id)) {
      let n = 2;
      while (draft.some((t) => t.id === `${id}#${n}`)) n += 1;
      id = `${id}#${n}`;
    }
    setDraft((prev) => [...prev, { id, keys: [...pick], target: 1, freq: FREQ_DAILY }]);
    setPick([]);
    setAdding(false);
    setHint("");
  };

  const pickSummary = pick.length === 0
    ? "先选 1 个题型；选 2 个就是「任选其一」。"
    : pick.length === 1
      ? `每次练${getDailyTaskType(pick[0]).label}`
      : `${getDailyTaskType(pick[0]).label} 或 ${getDailyTaskType(pick[1]).label}，练哪个都算`;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", WebkitBackdropFilter: "blur(4px)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "22px 22px 18px", width: 360, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 56px rgba(0,0,0,0.2)", fontFamily: HOME_FONT, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
          <div style={{ width: 28, height: 28, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: T.primarySoft, border: `1px solid ${T.primaryMist}` }}>
            <Icon name="list" color={T.primary} size={15} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1A2420" }}>设置每日任务</div>
        </div>
        <div style={{ fontSize: 12, color: "#5A6B62", marginBottom: 14, lineHeight: 1.5 }}>
          每条任务可以是一个题型，也可以是两个题型任选其一；频率能设成每天、隔天或每周几次（一次 = 一组/一篇）。最多 {MAX_DAILY_TASKS} 条，已有 {draft.length} 条。
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -4px", padding: "0 4px" }}>
          {draft.length === 0 && !adding && (
            <div style={{ fontSize: 12, color: "#94A39A", textAlign: "center", padding: "14px 0 16px", lineHeight: 1.6 }}>
              还没有任务，点下面的「+ 添加任务」开始。
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {draft.map((task) => {
              const meta = getFreqMeta(task.freq);
              const labels = task.keys.map((k) => getDailyTaskType(k));
              return (
                <div key={task.id} style={{ border: "1px solid #E4EAE6", borderRadius: 12, padding: "9px 10px 10px", background: "#FBFDFC" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 8 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: "#1A2420", lineHeight: 1.45 }}>
                      {labels.map((tp, i) => (
                        <span key={tp.key}>
                          {i > 0 && <span style={{ color: "#94A39A", margin: "0 3px" }}>/</span>}
                          {tp.label}
                          {!isPro && tp.pro && <ProTag />}
                        </span>
                      ))}
                      {labels.length > 1 && (
                        <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 600, color: "#94A39A" }}>任选</span>
                      )}
                    </span>
                    <button
                      onClick={() => removeTask(task.id)} aria-label="删除任务" title="删除任务"
                      style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 9, border: "1px solid #E4EAE6", background: "#fff", color: "#94A39A", fontSize: 16, lineHeight: 1, cursor: "pointer", fontFamily: HOME_FONT, display: "flex", alignItems: "center", justifyContent: "center", touchAction: "manipulation" }}
                    >
                      ×
                    </button>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ display: "inline-flex", background: "#F1F5F3", borderRadius: 999, padding: 2, gap: 2 }}>
                      {DAILY_TASK_FREQS.map((f) => {
                        const on = task.freq === f.key;
                        return (
                          <button
                            key={f.key} onClick={() => setFreq(task.id, f.key)}
                            style={{ border: "none", borderRadius: 999, padding: "7px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: HOME_FONT, transition: "all .15s", background: on ? "#fff" : "transparent", color: on ? T.primaryDeep : "#5A6B62", boxShadow: on ? "0 1px 3px rgba(0,0,0,0.1)" : "none", touchAction: "manipulation" }}
                          >
                            {f.label}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                      <StepBtn label="减少" onClick={() => stepTarget(task.id, -1)} disabled={task.target <= 1}>−</StepBtn>
                      <span style={{ width: 18, textAlign: "center", fontSize: 13, fontWeight: 700, color: T.primaryDeep, fontVariantNumeric: "tabular-nums" }}>{task.target}</span>
                      <StepBtn label="增加" onClick={() => stepTarget(task.id, 1)} disabled={task.target >= MAX_DAILY_TARGET}>+</StepBtn>
                      <span style={{ fontSize: 11, color: "#94A39A", fontWeight: 600 }}>{meta.unitLabel}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {adding ? (
            <div
              // 选择区展开在滚动区底部，任务一多就在折叠线以下：挂载时自己滚进视野
              ref={(el) => { if (el && !el.dataset.shown) { el.dataset.shown = "1"; requestAnimationFrame(() => el.scrollIntoView?.({ block: "start" })); } }}
              style={{ marginTop: 10, border: `1px solid ${T.primaryMist}`, borderRadius: 12, padding: "10px 10px 12px", background: T.primarySoft }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1A2420", marginBottom: 8 }}>选题型（最多 2 个 = 任选其一）</div>
              {DAILY_TASK_GROUPS.map((group) => {
                const types = DAILY_TASK_TYPES.filter((t) => t.group === group);
                if (types.length === 0) return null;
                return (
                  <div key={group} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#94A39A", marginBottom: 5, letterSpacing: 0.5 }}>{group}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {types.map((tp) => {
                        const on = pick.includes(tp.key);
                        return (
                          <button
                            key={tp.key} onClick={() => togglePick(tp.key)}
                            style={{ border: `1px solid ${on ? T.primary : "#DDE5DF"}`, background: on ? T.primary : "#fff", color: on ? "#fff" : "#39473F", borderRadius: 999, padding: "7px 12px", fontSize: 12, fontWeight: on ? 700 : 500, cursor: "pointer", fontFamily: HOME_FONT, transition: "all .12s", touchAction: "manipulation" }}
                          >
                            {tp.label}
                            {!isPro && tp.pro && (
                              <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: on ? "#fff" : T.amber }}>Pro</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: 11, color: "#5A6B62", lineHeight: 1.5, margin: "8px 0 10px" }}>{pickSummary}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <PressButton onClick={confirmAdd} bg={pick.length ? T.primary : "#C9D3CD"} edge={pick.length ? T.primaryDeep : "#AEBAB3"} style={{ flex: 1, padding: "9px 0", fontSize: 13 }}>
                  添加
                </PressButton>
                <button
                  onClick={() => { setAdding(false); setPick([]); setHint(""); }}
                  style={{ padding: "9px 14px", fontSize: 13, fontWeight: 600, color: "#5A6B62", background: "#fff", border: "1px solid #DDE5DF", borderRadius: 14, cursor: "pointer", fontFamily: HOME_FONT }}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { if (full) { setHint(`最多只能同时盯 ${MAX_DAILY_TASKS} 项，先删一条再加`); return; } setHint(""); setAdding(true); }}
              style={{ width: "100%", marginTop: 10, padding: "9px 0", fontSize: 13, fontWeight: 700, borderRadius: 11, cursor: full ? "default" : "pointer", fontFamily: HOME_FONT, color: full ? "#B7C2BB" : T.primary, background: "transparent", border: `1.5px dashed ${full ? "#E4EAE6" : T.primaryMist}` }}
            >
              + 添加任务
            </button>
          )}
        </div>

        {hint && (
          <div style={{ fontSize: 12, color: "#B0654E", fontWeight: 600, marginTop: 8, lineHeight: 1.4 }}>{hint}</div>
        )}

        <PressButton onClick={() => onSave(draft)} bg={T.primary} edge={T.primaryDeep} style={{ width: "100%", marginTop: 14, padding: "12px 0", fontSize: 14 }}>保存</PressButton>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
          <button onClick={onClear} style={{ border: "none", background: "none", color: "#B0654E", fontSize: 12, cursor: "pointer", fontFamily: HOME_FONT, padding: "9px 8px", margin: "-7px -8px", touchAction: "manipulation", opacity: 0.8 }}>清空任务</button>
          <button onClick={onClose} style={{ border: "none", background: "none", color: "#5A6B62", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: HOME_FONT, padding: "9px 8px", margin: "-7px -8px", touchAction: "manipulation" }}>取消</button>
        </div>
      </div>
    </div>
  );
}

function StepBtn({ onClick, disabled, label, children }) {
  return (
    <button
      onClick={onClick} disabled={disabled} aria-label={label}
      style={{
        // 32px 是手指能稳稳点到的下限（手机端同一个弹窗，不分叉）
        width: 32, height: 32, flexShrink: 0, borderRadius: 9, cursor: disabled ? "default" : "pointer",
        border: `1px solid ${disabled ? "#EDF1EE" : "#DDE5DF"}`, background: "#fff",
        color: disabled ? "#C9D3CD" : "#39473F", fontSize: 16, fontWeight: 700, lineHeight: 1,
        fontFamily: HOME_FONT, display: "flex", alignItems: "center", justifyContent: "center",
        touchAction: "manipulation",
      }}
    >
      {children}
    </button>
  );
}
