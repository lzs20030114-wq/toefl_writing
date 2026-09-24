"use client";

import { useState, useEffect, useMemo } from "react";
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
export function DailyTasksCard({ userCode, isChallenge, sessions, modernCard, fadeIn, now }) {
  const [state, setState] = useState(EMPTY_STATE);
  const [editorOpen, setEditorOpen] = useState(false);
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

  return (
    <div style={{ ...modernCard("15px 16px 14px"), ...fadeIn(180) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: configured ? 10 : 12 }}>
        <IconBadge name="list" isChallenge={isChallenge} />
        <span style={{ fontSize: 14, fontWeight: 700, color: t1, flex: 1 }}>今日任务</span>
        {configured && (
          <>
            <span style={{ fontSize: 12, fontWeight: 700, color: summary.allComplete ? T.primary : t2, fontVariantNumeric: "tabular-nums" }}>
              {summary.completeCount}/{summary.dueCount}
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
      </div>

      {!configured ? (
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
                key={item.id} item={item} isPro={isPro}
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
      )}

      {editorOpen && createPortal(
        <DailyTasksEditor
          tasks={state.tasks}
          isPro={isPro}
          onSave={(next) => { setState(saveDailyTasks(userCode, next)); setEditorOpen(false); }}
          onClear={() => { setState(clearDailyTasks(userCode)); setEditorOpen(false); }}
          onClose={() => setEditorOpen(false)}
        />,
        document.body
      )}
    </div>
  );
}

const EMPTY_STATE = { tasks: [], updatedAt: null };

function ProTag() {
  return (
    <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: T.amber, border: `1px solid ${T.amber}55`, borderRadius: 5, padding: "0 3px", verticalAlign: "middle" }}>
      Pro
    </span>
  );
}

function TaskRow({ item, isPro, t1, t3, tRest, barTrack }) {
  const rest = item.restToday;
  const nameColor = rest ? tRest : t1;
  const pct = rest ? 0 : (item.target > 0 ? Math.max(0, Math.min(1, item.done / item.target)) : 0);
  const badge = getFreqMeta(item.freq).badge;
  const dual = item.keys.length > 1;

  const nameStyle = {
    fontSize: 12, fontWeight: 600, color: nameColor, textDecoration: "none",
    whiteSpace: "nowrap", // 题型名不许从词中间断开，二选一只在「或」处换行
  };

  const label = dual ? (
    // 二选一：两个名字各自是独立链接，248px 栏宽放不下时允许换到第二行
    <span style={{ display: "inline", lineHeight: 1.5 }}>
      {item.keys.map((k, i) => (
        <span key={k}>
          {i > 0 && <span style={{ color: t3, margin: "0 4px", fontSize: 11 }}>或</span>}
          <Link href={item.hrefs[i]} title={`去练习 · ${item.labels[i]}`} style={nameStyle}>
            {item.labels[i]}
          </Link>
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

  // 单题型：整行都是链接（一期行为）。二选一：名字各自成链，整行不再是单一链接。
  if (dual) {
    return <div>{head}{bar}</div>;
  }
  return (
    <Link href={item.hrefs[0]} title={`去练习 · ${item.labels[0]}`} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
      {head}
      {bar}
    </Link>
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
                      style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 7, border: "1px solid #E4EAE6", background: "#fff", color: "#94A39A", fontSize: 13, lineHeight: 1, cursor: "pointer", fontFamily: HOME_FONT, display: "flex", alignItems: "center", justifyContent: "center" }}
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
                            style={{ border: "none", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: HOME_FONT, transition: "all .15s", background: on ? "#fff" : "transparent", color: on ? T.primaryDeep : "#5A6B62", boxShadow: on ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}
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
                            style={{ border: `1px solid ${on ? T.primary : "#DDE5DF"}`, background: on ? T.primary : "#fff", color: on ? "#fff" : "#39473F", borderRadius: 999, padding: "5px 11px", fontSize: 12, fontWeight: on ? 700 : 500, cursor: "pointer", fontFamily: HOME_FONT, transition: "all .12s" }}
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
          <button onClick={onClear} style={{ border: "none", background: "none", color: "#B0654E", fontSize: 12, cursor: "pointer", fontFamily: HOME_FONT, padding: "2px 0", opacity: 0.8 }}>清空任务</button>
          <button onClick={onClose} style={{ border: "none", background: "none", color: "#5A6B62", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: HOME_FONT, padding: "2px 0" }}>取消</button>
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
        width: 24, height: 24, flexShrink: 0, borderRadius: 8, cursor: disabled ? "default" : "pointer",
        border: `1px solid ${disabled ? "#EDF1EE" : "#DDE5DF"}`, background: "#fff",
        color: disabled ? "#C9D3CD" : "#39473F", fontSize: 15, fontWeight: 700, lineHeight: 1,
        fontFamily: HOME_FONT, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}
