"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";
// Icon / IconBadge / PressButton 复用右栏现有的设计语言（同一份实现，不另抄一遍）。
import { Icon, IconBadge, PressButton } from "./StudyPlanColumn";
import {
  DAILY_TASKS_UPDATED_EVENT, DAILY_TASK_GROUPS, DAILY_TASK_TYPES,
  MAX_DAILY_TARGET, MAX_DAILY_TASKS,
  clearDailyTasks, hasDailyTasks, loadDailyTasks, saveDailyTasks, summarizeDailyTasks,
} from "../../lib/dailyTasks";
import { getSavedTier, AUTH_CHANGED_EVENT } from "../../lib/AuthContext";

/**
 * 今日任务卡：用户自己设定「每天某题型练几次」，这里显示今日完成进度，供自我监督。
 * 数据只在本地（lib/dailyTasks.js），计数口径 = 一条练习记录算 1 次，与首页打卡同日历口径。
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
              {summary.completed}/{summary.total}
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
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {summary.items.map((item) => (
              <TaskRow
                key={item.key} item={item} showPro={!isPro && item.pro}
                t1={t1} t3={t3} barTrack={barTrack}
              />
            ))}
          </div>

          {summary.allComplete && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${hairline}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 11, fontWeight: 700, color: T.primary }}>
              <Icon name="check" color={T.primary} size={11} />
              今日任务全部达标
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

function TaskRow({ item, showPro, t1, t3, barTrack }) {
  const pct = item.target > 0 ? Math.max(0, Math.min(1, item.done / item.target)) : 0;
  return (
    <Link
      href={item.href}
      title={`去练习 · ${item.label}`}
      style={{ display: "block", textDecoration: "none", color: "inherit" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: t1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.label}
          {showPro && (
            <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, color: T.amber, border: `1px solid ${T.amber}55`, borderRadius: 5, padding: "0 3px", verticalAlign: "middle" }}>
              Pro
            </span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0, fontSize: 11, fontWeight: 700, color: item.complete ? T.primary : t3, fontVariantNumeric: "tabular-nums" }}>
          {item.complete && <Icon name="check" color={T.primary} size={10} />}
          {item.shown}/{item.target}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: barTrack, overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)" }}>
        <div style={{
          width: `${pct * 100}%`, height: "100%", borderRadius: 99,
          background: item.complete ? `linear-gradient(90deg, ${T.cyan}, ${T.primary})` : `linear-gradient(90deg, ${T.primaryMist}, ${T.primary})`,
          transition: "width .7s cubic-bezier(.25,1,.5,1)",
        }} />
      </div>
    </Link>
  );
}

/* ── 每日任务编辑弹窗（portal 到 body：本项目的 fadeUp 动画会给祖先留下 transform，
      fixed 浮层若留在树里会被那个包含块困住错位，GoalEditor 同理） ── */
function DailyTasksEditor({ tasks, isPro, onSave, onClear, onClose }) {
  const [draft, setDraft] = useState(() => {
    const m = {};
    for (const t of tasks || []) m[t.key] = t.target;
    return m;
  });
  const [hint, setHint] = useState("");

  const selectedCount = Object.values(draft).filter((n) => n > 0).length;

  const step = (key, delta) => {
    setDraft((prev) => {
      const cur = prev[key] || 0;
      const next = Math.max(0, Math.min(MAX_DAILY_TARGET, cur + delta));
      if (next === cur) return prev;
      if (cur === 0 && next > 0) {
        const count = Object.values(prev).filter((n) => n > 0).length;
        if (count >= MAX_DAILY_TASKS) {
          setHint(`最多只能同时盯 ${MAX_DAILY_TASKS} 项，先去掉一项再加`);
          return prev;
        }
      }
      setHint("");
      const copy = { ...prev };
      if (next === 0) delete copy[key]; else copy[key] = next;
      return copy;
    });
  };

  const save = () => {
    const next = DAILY_TASK_TYPES
      .filter((t) => (draft[t.key] || 0) > 0)
      .map((t) => ({ key: t.key, target: draft[t.key] }));
    onSave(next);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", WebkitBackdropFilter: "blur(4px)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "22px 22px 18px", width: 348, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 56px rgba(0,0,0,0.2)", fontFamily: HOME_FONT, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
          <div style={{ width: 28, height: 28, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: T.primarySoft, border: `1px solid ${T.primaryMist}` }}>
            <Icon name="list" color={T.primary} size={15} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1A2420" }}>设置每日任务</div>
        </div>
        <div style={{ fontSize: 12, color: "#5A6B62", marginBottom: 14, lineHeight: 1.5 }}>
          给每个题型定一个每天的练习次数（一次 = 一组/一篇）。最多 {MAX_DAILY_TASKS} 项，已选 {selectedCount} 项。
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -4px", padding: "0 4px" }}>
          {DAILY_TASK_GROUPS.map((group) => {
            const types = DAILY_TASK_TYPES.filter((t) => t.group === group);
            if (types.length === 0) return null;
            return (
              <div key={group} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94A39A", marginBottom: 6, letterSpacing: 0.5 }}>{group}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {types.map((t) => {
                    const n = draft[t.key] || 0;
                    const on = n > 0;
                    return (
                      <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 11, border: `1px solid ${on ? T.primary : "#E4EAE6"}`, background: on ? T.primarySoft : "#fff" }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: on ? 700 : 500, color: on ? "#1A2420" : "#5A6B62", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.label}
                          {!isPro && t.pro && (
                            <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, color: T.amber, border: `1px solid ${T.amber}55`, borderRadius: 5, padding: "0 3px", verticalAlign: "middle" }}>Pro</span>
                          )}
                        </span>
                        <StepBtn label="减少" onClick={() => step(t.key, -1)} disabled={n <= 0}>−</StepBtn>
                        <span style={{ width: 20, textAlign: "center", fontSize: 13, fontWeight: 700, color: on ? T.primaryDeep : "#B7C2BB", fontVariantNumeric: "tabular-nums" }}>{n}</span>
                        <StepBtn label="增加" onClick={() => step(t.key, 1)} disabled={n >= MAX_DAILY_TARGET}>+</StepBtn>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {hint && (
          <div style={{ fontSize: 12, color: "#B0654E", fontWeight: 600, marginTop: 4 }}>{hint}</div>
        )}

        <PressButton onClick={save} bg={T.primary} edge={T.primaryDeep} style={{ width: "100%", marginTop: 14, padding: "12px 0", fontSize: 14 }}>保存</PressButton>
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
