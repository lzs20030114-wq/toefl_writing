"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";
import {
  loadStudyPlan, saveStudyPlan, clearStudyPlan, hasGoal,
  STUDY_PLAN_UPDATED_EVENT,
} from "../../lib/studyPlan";
import {
  buildPracticeMap, computeStreak, daysUntil, buildMonthGrid, buildHeatmapColumns,
  toLocalDateKey, startOfDay,
} from "../../lib/studyStreak";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const WD_FULL = ["日", "一", "二", "三", "四", "五", "六"];
// 新托福写作分制：1.0–6.0（0.5 一档）。目标常见区间用 chip，当前水平用全量 select。
const TARGET_PRESETS = [4, 4.5, 5, 5.5, 6];
const BAND_OPTIONS = [6, 5.5, 5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1];
const fmtBand = (v) => Number(v).toFixed(1);
const HEATMAP_WEEKS = 12;
// 火焰阶位：连续打卡达到 min 天即点亮该色温。颜色随连胜升温/变稀有（橙→红→品红→紫→蓝→传奇金）。
// 先上线的极简「火苗」版：只用颜色 + 里程碑天数体现成长，不设段位名。
// （连续打卡「树苗成长」形态后续单独设计）
// flame = 火焰图标渐变（上→下），block = 卡片底色渐变，glow = 阴影色。
const FLAME_TIERS = [
  { min: 1,   flame: ["#FFD27A", "#FF9A3D"], block: ["#FFA64D", "#F2702E"], glow: "rgba(242,112,46,0.42)" },
  { min: 3,   flame: ["#FFC56B", "#FF7A2E"], block: ["#FF8A3C", "#EA5A1E"], glow: "rgba(234,90,30,0.44)" },
  { min: 7,   flame: ["#FFB152", "#FF5A2C"], block: ["#FF6E37", "#DE3F16"], glow: "rgba(222,63,22,0.46)" },
  { min: 14,  flame: ["#FF9A5C", "#FF3B47"], block: ["#FF5747", "#D8243A"], glow: "rgba(216,36,58,0.47)" },
  { min: 30,  flame: ["#FF7E70", "#F0264E"], block: ["#F3454F", "#C11743"], glow: "rgba(193,23,67,0.48)" },
  { min: 50,  flame: ["#FF7AB0", "#E5359B"], block: ["#F2479E", "#C21E7E"], glow: "rgba(194,30,126,0.50)" },
  { min: 100, flame: ["#E08CFF", "#A23BFF"], block: ["#C45BF0", "#8A2BE2"], glow: "rgba(138,43,226,0.50)" },
  { min: 200, flame: ["#8FC2FF", "#4B6BFF"], block: ["#5B8BF0", "#2E4BD8"], glow: "rgba(46,75,216,0.50)" },
  { min: 365, flame: ["#FFE9A0", "#FFB23D"], block: ["#FFC94D", "#FF8A00"], glow: "rgba(255,170,40,0.55)", legendary: true },
];

function flameTierFor(streak) {
  let tier = FLAME_TIERS[0];
  for (const t of FLAME_TIERS) if (streak >= t.min) tier = t;
  return tier;
}
function nextMilestone(streak) {
  return FLAME_TIERS.find((t) => t.min > streak) || null;
}

function countdownTone(days) {
  if (days == null || days < 0) return T.t3;
  if (days <= 3) return T.rose;
  if (days <= 7) return T.amber;
  return T.primary;
}

function pep(days) {
  if (days == null) return "";
  if (days < 0) return "这场考试已结束，设定新目标继续前进。";
  if (days === 0) return "今天就是考试日，全力以赴！";
  if (days === 1) return "明天就考试了，做最后的检查。";
  if (days <= 7) return "冲刺阶段，保持手感最关键。";
  if (days <= 30) return "稳扎稳打，每天进步一点点。";
  return "时间还充裕，先养成每日练习的习惯吧。";
}

function shortExamDate(examDateStr) {
  const [y, m, d] = (examDateStr || "").split("-").map(Number);
  if (!y || !m || !d) return { md: "", wd: "" };
  const date = new Date(y, m - 1, d);
  return { md: `${m}月${d}日`, wd: `周${WD_FULL[date.getDay()]}` };
}

function heatColor(count, isChallenge) {
  if (count <= 0) return { bg: isChallenge ? "rgba(255,255,255,0.05)" : "#EBF0ED", fg: null };
  if (count === 1) return { bg: T.primaryMist, fg: T.primaryDeep };
  if (count === 2) return { bg: T.primary, fg: "#fff" };
  return { bg: T.primaryDeep, fg: "#fff" };
}

function Icon({ name, color, size = 14 }) {
  const c = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
  if (name === "flame") return (<svg {...c}><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></svg>);
  if (name === "flag") return (<svg {...c}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>);
  if (name === "edit") return (<svg {...c}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>);
  if (name === "check") return (<svg {...c} strokeWidth="3.2"><polyline points="20 6 9 17 4 12" /></svg>);
  return null;
}

/* 火苗主图标：渐变填充火焰 + 提亮内焰。grad=[顶,底]；id 需唯一，避免 <defs> 渐变冲突 */
function Flame({ size = 44, grad = ["#FFD27A", "#FF7A2E"], id = "sp-flame" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ filter: "drop-shadow(0 3px 5px rgba(150,40,0,0.42))" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={grad[0]} />
          <stop offset="100%" stopColor={grad[1]} />
        </linearGradient>
      </defs>
      <path d="M12 2.5 C14.5 6.5 17.5 9.5 17.5 13.6 A5.5 5.5 0 0 1 6.5 13.6 C6.5 11 8 9.5 8.8 8 C9.2 9.6 10.2 9.8 10.6 8.4 C11.1 6.6 10.3 4.8 12 2.5 Z" fill={`url(#${id})`} />
      <path d="M12 11 C13.2 13 14 14.3 14 16 A2 2 0 0 1 10 16 C10 14.3 10.8 13 12 11 Z" fill="rgba(255,255,255,0.5)" />
    </svg>
  );
}

function IconBadge({ name, isChallenge, tint, soft, border }) {
  return (
    <div style={{
      width: 26, height: 26, borderRadius: 8, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: soft || (isChallenge ? "rgba(13,150,104,0.16)" : T.primarySoft),
      border: `1px solid ${border || (isChallenge ? "rgba(13,150,104,0.28)" : T.primaryMist)}`,
    }}>
      <Icon name={name} color={tint || T.primary} />
    </div>
  );
}

/* 多邻国式 3D 可按压按钮：底部深色边，按下陷入 */
function PressButton({ onClick, bg, edge, color = "#fff", style, children, title }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={onClick} title={title}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        border: "none", borderRadius: 14, background: bg, color, fontFamily: HOME_FONT, fontWeight: 800, cursor: "pointer",
        boxShadow: pressed ? `0 1px 0 ${edge}` : `0 4px 0 ${edge}`,
        transform: pressed ? "translateY(3px)" : "translateY(0)",
        transition: "transform .07s ease, box-shadow .07s ease",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function ProgressRing({ size, stroke, progress, color, track, children }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, progress)) * circ;
  return (
    <div style={{ position: "relative", width: size, height: size, margin: "0 auto" }}>
      <svg width={size} height={size} style={{ display: "block", transform: "rotate(-90deg)" }}>
        <defs>
          <linearGradient id="sp-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#sp-ring-grad)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} style={{ transition: "stroke-dasharray .7s cubic-bezier(.25,1,.5,1)" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>{children}</div>
    </div>
  );
}

export function StudyPlanColumn({ userCode, isChallenge, sessions, bestMock, sideCard, fadeIn }) {
  const [plan, setPlan] = useState(EMPTY_PLAN);
  const [editorOpen, setEditorOpen] = useState(false);
  const [calView, setCalView] = useState("week"); // week | month | heat
  const now = useMemo(() => new Date(), []);
  const [view, setView] = useState(() => ({ y: now.getFullYear(), m: now.getMonth() }));

  useEffect(() => {
    const refresh = () => setPlan(loadStudyPlan(userCode));
    refresh();
    window.addEventListener(STUDY_PLAN_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(STUDY_PLAN_UPDATED_EVENT, refresh);
  }, [userCode]);

  const practiceMap = useMemo(() => buildPracticeMap(sessions), [sessions]);
  const { streak, practicedToday } = useMemo(() => computeStreak(practiceMap, now), [practiceMap, now]);
  const days = daysUntil(plan.examDate, now);
  const tone = countdownTone(days);
  const goalSet = hasGoal(plan);

  const t1 = isChallenge ? CH.t1 : T.t1;
  const t2 = isChallenge ? CH.t2 : T.t2;
  const t3 = isChallenge ? CH.t2 : T.t3;
  const subBg = isChallenge ? "rgba(255,255,255,0.04)" : T.bgSoft;
  const hairline = isChallenge ? CH.cardBorder : T.bdrSubtle;
  const ringTrack = isChallenge ? "rgba(255,255,255,0.08)" : "#ECF1EE";
  const modernCard = (pad) => sideCard({ padding: pad, borderRadius: 18, boxShadow: isChallenge ? "none" : "0 2px 12px rgba(10,40,25,0.06)" });

  const ringProgress = useMemo(() => {
    if (days == null || days < 0) return 0;
    if (days === 0) return 0.02;
    const start = plan.createdAt ? new Date(plan.createdAt) : now;
    const total = daysUntil(plan.examDate, start);
    const denom = total && total > 0 ? total : 90;
    return Math.max(0, Math.min(1, days / denom));
  }, [days, plan.examDate, plan.createdAt, now]);

  const currentMonthCount = useMemo(() => {
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-`;
    let c = 0;
    for (const k of practiceMap.keys()) if (k.startsWith(ym)) c += 1;
    return c;
  }, [practiceMap, now]);
  const totalCount = practiceMap.size;

  // 进度条「当前分」：手动填写优先，否则取最佳模考 band（真实练习数据驱动）
  const effectiveCurrent = plan.currentScore != null
    ? plan.currentScore
    : (Number.isFinite(bestMock) ? Math.max(1, Math.min(6, bestMock)) : null);
  const currentLabel = plan.currentScore != null ? "当前" : "最佳模考";

  const todayKey = toLocalDateKey(now);
  const examKey = plan.examDate || "";
  const exDate = shortExamDate(plan.examDate);

  return (
    <div
      className="home-study-col"
      style={{
        width: 248, minWidth: 248, flexShrink: 0,
        display: "flex", flexDirection: "column", gap: 10,
        position: "sticky", top: 80, alignSelf: "flex-start",
        fontFamily: HOME_FONT,
      }}
    >
      {/* ══ 卡片一：备考目标 ══ */}
      <div style={{ ...modernCard("15px 16px 16px"), ...fadeIn(140) }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <IconBadge name="flag" isChallenge={isChallenge} />
          <span style={{ fontSize: 14, fontWeight: 800, color: t1, flex: 1 }}>备考目标</span>
          {goalSet && (
            <button
              onClick={() => setEditorOpen(true)} title="编辑目标"
              style={{ border: "none", background: "transparent", color: t3, padding: "3px 5px", cursor: "pointer", display: "flex", alignItems: "center", transition: "color .15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = T.primary; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = t3; }}
            >
              <Icon name="edit" color="currentColor" size={13} />
            </button>
          )}
        </div>

        {!goalSet ? (
          <div style={{ textAlign: "center", padding: "8px 4px 4px" }}>
            <div style={{ width: 50, height: 50, borderRadius: 16, margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center", background: isChallenge ? "rgba(13,150,104,0.12)" : T.primarySoft, border: `1px solid ${isChallenge ? "rgba(13,150,104,0.22)" : T.primaryMist}` }}>
              <Icon name="flag" color={T.primary} size={24} />
            </div>
            <div style={{ fontSize: 12.5, color: t2, lineHeight: 1.65, marginBottom: 14 }}>
              设置考试日期与目标分，<br />开启专属倒计时与每日督促。
            </div>
            <PressButton onClick={() => setEditorOpen(true)} bg={T.primary} edge={T.primaryDeep} style={{ width: "100%", padding: "11px 0", fontSize: 13.5 }}>
              设置目标
            </PressButton>
          </div>
        ) : (
          <>
            {plan.examDate && (
              <div style={{ position: "relative", padding: "4px 0 14px" }}>
                <div style={{ position: "absolute", top: 6, left: "50%", transform: "translateX(-50%)", width: 140, height: 140, borderRadius: "50%", background: `radial-gradient(circle, ${tone}16 0%, transparent 68%)`, pointerEvents: "none" }} />
                <ProgressRing size={134} stroke={9} progress={ringProgress} color={tone} track={`${tone}26`}>
                  {days < 0 ? (
                    <span style={{ fontSize: 17, fontWeight: 800, color: t3 }}>已结束</span>
                  ) : days === 0 ? (
                    <>
                      <span style={{ fontSize: 22, fontWeight: 800, color: tone }}>今天</span>
                      <span style={{ fontSize: 11, color: t3, fontWeight: 700 }}>考试日 🎉</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 10, color: t3, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>距考试</span>
                      <span style={{ fontSize: 48, fontWeight: 800, color: tone, lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: -1.5, marginTop: 1 }}>{days}</span>
                      <span style={{ fontSize: 12, color: t2, fontWeight: 800, marginTop: 1 }}>天</span>
                    </>
                  )}
                </ProgressRing>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <BentoTile label="考试日" subBg={subBg} hairline={hairline} t3={t3}>
                {plan.examDate ? (
                  <span style={{ fontSize: 14, fontWeight: 800, color: t1 }}>
                    {exDate.md}<span style={{ fontSize: 10.5, fontWeight: 600, color: t3, marginLeft: 3 }}>{exDate.wd}</span>
                  </span>
                ) : <span style={{ fontSize: 13, fontWeight: 700, color: t3 }}>未设置</span>}
              </BentoTile>
              <BentoTile label="目标分" subBg={subBg} hairline={hairline} t3={t3}>
                {plan.targetScore != null ? (
                  <span style={{ fontSize: 16, fontWeight: 800, color: T.primary, fontVariantNumeric: "tabular-nums" }}>
                    {fmtBand(plan.targetScore)}<span style={{ fontSize: 10.5, fontWeight: 600, color: t3, marginLeft: 2 }}>分</span>
                  </span>
                ) : <span style={{ fontSize: 13, fontWeight: 700, color: t3 }}>未设置</span>}
              </BentoTile>
            </div>

            {plan.targetScore != null && (
              effectiveCurrent != null ? (
                <ScoreProgress current={effectiveCurrent} target={plan.targetScore} label={currentLabel} t2={t2} t3={t3} ringTrack={ringTrack} />
              ) : (
                <button
                  onClick={() => setEditorOpen(true)}
                  style={{ width: "100%", marginTop: 9, padding: "8px 0", fontSize: 11.5, fontWeight: 700, color: T.primary, background: "transparent", border: `1.5px dashed ${isChallenge ? "rgba(13,150,104,0.4)" : T.primaryMist}`, borderRadius: 10, cursor: "pointer", fontFamily: HOME_FONT }}
                >
                  + 记录当前水平，追踪进步
                </button>
              )
            )}

            {pep(days) && (
              <div style={{ marginTop: 11, fontSize: 11.5, color: tone, fontWeight: 700, lineHeight: 1.5, textAlign: "center" }}>
                {pep(days)}
              </div>
            )}
          </>
        )}
      </div>

      {/* ══ 卡片二：学习打卡（多邻国式连胜） ══ */}
      <div style={{ ...modernCard("15px 16px 14px"), ...fadeIn(220) }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <IconBadge name="flame" isChallenge={isChallenge} tint="#F2702E" soft="rgba(242,112,46,0.14)" border="rgba(242,112,46,0.28)" />
          <span style={{ fontSize: 14, fontWeight: 800, color: t1, flex: 1 }}>学习打卡</span>
        </div>

        {/* 连胜火焰主视觉 */}
        <StreakHero streak={streak} isChallenge={isChallenge} t3={t3} />

        {/* 视图切换 */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 13, marginBottom: 11 }}>
          <div style={{ display: "inline-flex", background: subBg, border: `1px solid ${hairline}`, borderRadius: 999, padding: 3, gap: 2 }}>
            {[{ k: "week", l: "本周" }, { k: "month", l: "本月" }, { k: "heat", l: "热力" }].map((o) => {
              const sel = calView === o.k;
              return (
                <button
                  key={o.k}
                  onClick={() => setCalView(o.k)}
                  style={{ border: "none", borderRadius: 999, padding: "4px 13px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: HOME_FONT, transition: "all .15s", background: sel ? (isChallenge ? "rgba(13,150,104,0.22)" : "#fff") : "transparent", color: sel ? T.primary : t3, boxShadow: sel && !isChallenge ? "0 1px 4px rgba(0,0,0,0.1)" : "none" }}
                >
                  {o.l}
                </button>
              );
            })}
          </div>
        </div>

        {calView === "week" ? (
          <WeekStrip practiceMap={practiceMap} now={now} examKey={examKey} isChallenge={isChallenge} t2={t2} t3={t3} />
        ) : calView === "month" ? (
          <MonthView view={view} setView={setView} practiceMap={practiceMap} todayKey={todayKey} examKey={examKey} isChallenge={isChallenge} t1={t1} t2={t2} t3={t3} hairline={hairline} />
        ) : (
          <HeatmapView practiceMap={practiceMap} now={now} examKey={examKey} isChallenge={isChallenge} t2={t2} t3={t3} />
        )}

        {/* 今日状态 + 统计 */}
        <div style={{ marginTop: 13, paddingTop: 11, borderTop: `1px solid ${hairline}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: practicedToday ? T.primary : t3 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: practicedToday ? T.primary : "transparent", border: practicedToday ? "none" : `1.5px solid ${t3}`, flexShrink: 0 }} />
            {practicedToday ? "今日已打卡" : "今天还没练习"}
          </span>
          <span style={{ fontSize: 10.5, color: t3, fontVariantNumeric: "tabular-nums" }}>
            本月 {currentMonthCount} · 累计 {totalCount} 天
          </span>
        </div>
      </div>

      {editorOpen && createPortal(
        <GoalEditor
          plan={plan}
          onSave={(next) => { saveStudyPlan(userCode, next); setEditorOpen(false); }}
          onClear={() => { clearStudyPlan(userCode); setEditorOpen(false); }}
          onClose={() => setEditorOpen(false)}
        />,
        document.body
      )}
    </div>
  );
}

const EMPTY_PLAN = { examDate: null, targetScore: null, currentScore: null, createdAt: null, updatedAt: null };

function shiftMonth({ y, m }, delta) {
  const d = new Date(y, m + delta, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
}

/* 连续打卡火苗主视觉：火焰 + 连胜天数 + 下一里程碑进度 + 点火归零态 */
function StreakHero({ streak, isChallenge, t3 }) {
  // ── 归零态：火苗未点亮，邀请点火 ──
  if (streak <= 0) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 13, borderRadius: 16, padding: "13px 16px",
        background: isChallenge ? "rgba(242,112,46,0.10)" : "linear-gradient(135deg,#FFF3E8 0%,#FFE3CC 100%)",
        border: `1px dashed ${isChallenge ? "rgba(242,112,46,0.42)" : "#FFC79A"}`,
      }}>
        <div style={{ flexShrink: 0, opacity: 0.92 }}>
          <Flame size={34} grad={["#FFD27A", "#FF7A2E"]} id="sp-flame-zero" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: isChallenge ? CH.t1 : "#C2541E" }}>点燃今日的火苗</div>
          <div style={{ fontSize: 11, color: isChallenge ? t3 : "#B0703E", marginTop: 3, lineHeight: 1.4 }}>完成一组练习，点亮连续打卡 🔥</div>
        </div>
      </div>
    );
  }

  // ── 活跃态：当前连胜 + 下一里程碑进度 ──
  const tier = flameTierFor(streak);
  const next = nextMilestone(streak);
  const mPct = next ? Math.max(0.05, Math.min(1, (streak - tier.min) / (next.min - tier.min))) : 1;

  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, padding: "14px 16px", background: `linear-gradient(135deg, ${tier.block[0]} 0%, ${tier.block[1]} 100%)`, boxShadow: `0 5px 16px ${tier.glow}` }}>
      {/* 顶部柔光 */}
      <div style={{ position: "absolute", top: -34, left: -12, width: 130, height: 78, background: "radial-gradient(ellipse, rgba(255,255,255,0.42), transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 13 }}>
        <div style={{ flexShrink: 0 }}>
          <Flame size={44} grad={tier.flame} id="sp-flame-hero" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span style={{ fontSize: 34, fontWeight: 800, color: "#fff", lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: -1, textShadow: "0 1px 3px rgba(120,30,0,0.32)" }}>{streak}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>天</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.85)", marginLeft: 2 }}>连续打卡</span>
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "rgba(255,255,255,0.94)", marginTop: 5, lineHeight: 1.2, textShadow: "0 1px 2px rgba(120,30,0,0.22)" }}>
            {next ? "火苗正旺，别让它熄灭" : "🔥 传奇连胜，火苗不灭"}
          </div>
        </div>
      </div>
      {/* 下一里程碑进度（按天数，不设段位名） */}
      <div style={{ position: "relative", marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.94)", fontWeight: 700 }}>
            {next ? `🔥 再练 ${next.min - streak} 天满 ${next.min} 天` : "🔥 已达成 365 天里程碑"}
          </span>
          {next && <span style={{ fontSize: 10, color: "#fff", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{streak}/{next.min}</span>}
        </div>
        <div style={{ height: 6, borderRadius: 99, background: "rgba(255,255,255,0.32)", overflow: "hidden" }}>
          <div style={{ width: `${mPct * 100}%`, height: "100%", borderRadius: 99, background: "#fff", boxShadow: "0 0 6px rgba(255,255,255,0.55)", transition: "width .7s cubic-bezier(.25,1,.5,1)" }} />
        </div>
      </div>
    </div>
  );
}

/* 本周打卡条（多邻国 week strip） */
function WeekStrip({ practiceMap, now, examKey, isChallenge, t2, t3 }) {
  const week = useMemo(() => buildHeatmapColumns(practiceMap, now, 1)[0] || [], [practiceMap, now]);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5, padding: "2px 0" }}>
      {week.map((cell, i) => {
        const done = !cell.isFuture && cell.count > 0;
        const isExam = cell.key === examKey;
        const missed = !cell.isFuture && !cell.isToday && cell.count === 0;

        let circleBg = isChallenge ? "rgba(255,255,255,0.05)" : "#EEF2F0";
        let content = null;
        let numColor = cell.isFuture ? (isChallenge ? "rgba(255,255,255,0.2)" : "#C6D0CB") : (missed ? t3 : t2);
        let ring = "none";

        if (done) {
          circleBg = T.primary;
          content = <Icon name="check" color="#fff" size={13} />;
        } else if (cell.isToday) {
          circleBg = isChallenge ? "rgba(217,119,6,0.14)" : T.amberSoft;
          ring = `inset 0 0 0 2px ${T.amber}`;
          numColor = T.amber;
        }
        if (isExam) ring = `inset 0 0 0 2px ${T.rose}`;

        return (
          <div key={cell.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 9.5, color: t3, fontWeight: 600 }}>{WEEKDAYS[i]}</span>
            <div
              title={done ? `练习 ${cell.count} 次` : (isExam ? "考试日" : "")}
              style={{ width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: circleBg, boxShadow: ring, fontSize: 11, fontWeight: 700, color: numColor, fontVariantNumeric: "tabular-nums" }}
            >
              {content || cell.date.getDate()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BentoTile({ label, children, subBg, hairline, t3 }) {
  return (
    <div style={{ background: subBg, border: `1px solid ${hairline}`, borderRadius: 12, padding: "9px 11px", display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 10, color: t3, fontWeight: 600 }}>{label}</span>
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
    </div>
  );
}

function ScoreProgress({ current, target, label, t2, t3, ringTrack }) {
  const pct = target > 0 ? Math.max(0, Math.min(1, current / target)) : 0;
  const reached = current >= target;
  return (
    <div style={{ marginTop: 11 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ fontSize: 10.5, color: t3 }}>{label || "当前"} <b style={{ color: t2, fontSize: 12, fontWeight: 800 }}>{fmtBand(current)}</b></span>
        <span style={{ fontSize: 10.5, color: t3 }}>目标 <b style={{ color: T.primary, fontSize: 12, fontWeight: 800 }}>{fmtBand(target)}</b></span>
      </div>
      <div style={{ height: 9, borderRadius: 99, background: ringTrack, overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)" }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", borderRadius: 99, background: reached ? `linear-gradient(90deg, ${T.cyan}, ${T.primary})` : `linear-gradient(90deg, ${T.primaryMist}, ${T.primary})`, transition: "width .7s cubic-bezier(.25,1,.5,1)" }} />
      </div>
    </div>
  );
}

function MonthNavBtn({ dir, onClick, t2, hairline }) {
  return (
    <button
      onClick={onClick} aria-label={dir === "prev" ? "上个月" : "下个月"}
      style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${hairline}`, background: "transparent", color: t2, borderRadius: 7, cursor: "pointer", fontFamily: HOME_FONT, flexShrink: 0, transition: "background .15s" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = hairline; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {dir === "prev" ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
      </svg>
    </button>
  );
}

function MonthView({ view, setView, practiceMap, todayKey, examKey, isChallenge, t1, t2, t3, hairline }) {
  const weeks = useMemo(() => buildMonthGrid(view.y, view.m), [view]);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
        <MonthNavBtn dir="prev" t2={t2} hairline={hairline} onClick={() => setView(shiftMonth(view, -1))} />
        <span style={{ fontSize: 12, fontWeight: 700, color: t1, fontVariantNumeric: "tabular-nums" }}>{view.y} 年 {view.m + 1} 月</span>
        <MonthNavBtn dir="next" t2={t2} hairline={hairline} onClick={() => setView(shiftMonth(view, 1))} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 5 }}>
        {WEEKDAYS.map((w) => (<div key={w} style={{ textAlign: "center", fontSize: 10, color: t3, fontWeight: 600 }}>{w}</div>))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
            {week.map((cell, ci) => {
              const key = toLocalDateKey(cell.date);
              const count = practiceMap.get(key) || 0;
              const isToday = key === todayKey;
              const isExam = key === examKey;
              const practiced = count > 0 && cell.inMonth;
              const hc = heatColor(practiced ? count : 0, isChallenge);
              let bg = cell.inMonth ? hc.bg : "transparent";
              let color = practiced ? hc.fg : (cell.inMonth ? t2 : (isChallenge ? "rgba(255,255,255,0.14)" : "#CBD5D1"));
              let ring = "none";
              if (isExam) { ring = `inset 0 0 0 1.5px ${T.rose}`; if (!practiced) color = T.rose; }
              else if (isToday) { ring = `inset 0 0 0 1.5px ${practiced ? "rgba(255,255,255,0.85)" : T.primary}`; if (!practiced) color = T.primary; }
              return (
                <div key={ci} title={isExam ? "考试日" : (practiced ? `练习 ${count} 次` : "")} style={{ height: 27, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: practiced || isToday || isExam ? 700 : 500, background: bg, color, boxShadow: ring, fontVariantNumeric: "tabular-nums", opacity: cell.inMonth ? 1 : 0.5 }}>
                  {cell.date.getDate()}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

function HeatmapView({ practiceMap, now, examKey, isChallenge, t2, t3 }) {
  const columns = useMemo(() => buildHeatmapColumns(practiceMap, now, HEATMAP_WEEKS), [practiceMap, now]);
  const cells = useMemo(() => columns.flat(), [columns]);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
        <span style={{ fontSize: 11, color: t3, fontWeight: 600 }}>近 {HEATMAP_WEEKS} 周</span>
        <span style={{ fontSize: 10, color: t3 }}>每格 = 一天</span>
      </div>
      <div style={{ display: "grid", gridTemplateRows: "repeat(7, 14px)", gridAutoFlow: "column", gap: 3 }}>
        {cells.map((cell) => {
          const hc = heatColor(cell.isFuture ? 0 : cell.count, isChallenge);
          const isExam = cell.key === examKey;
          let ring = "none";
          if (isExam) ring = `inset 0 0 0 1.5px ${T.rose}`;
          else if (cell.isToday) ring = `inset 0 0 0 1.5px ${cell.count > 0 ? "rgba(255,255,255,0.85)" : T.primary}`;
          return (
            <div key={cell.key} title={cell.isFuture ? "" : (cell.count > 0 ? `${cell.key} · ${cell.count} 次` : cell.key)} style={{ borderRadius: 3.5, background: hc.bg, boxShadow: ring, opacity: cell.isFuture ? 0.35 : 1 }} />
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 9 }}>
        <span style={{ fontSize: 9.5, color: t3 }}>少</span>
        {[0, 1, 2, 3].map((n) => (<div key={n} style={{ width: 11, height: 11, borderRadius: 3, background: heatColor(n, isChallenge).bg }} />))}
        <span style={{ fontSize: 9.5, color: t3 }}>多</span>
      </div>
    </div>
  );
}

/* ── 目标编辑弹窗 ── */
function GoalEditor({ plan, onSave, onClear, onClose }) {
  const [examDate, setExamDate] = useState(plan.examDate || "");
  const [target, setTarget] = useState(plan.targetScore != null ? String(plan.targetScore) : "");
  const [current, setCurrent] = useState(plan.currentScore != null ? String(plan.currentScore) : "");
  const todayStr = toLocalDateKey(startOfDay(new Date()));

  const save = () => {
    const toBand = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? Math.max(1, Math.min(6, Math.round(n * 2) / 2)) : null; };
    onSave({ examDate: examDate || null, targetScore: toBand(target), currentScore: toBand(current) });
  };

  const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #DDE5DF", fontSize: 14, boxSizing: "border-box", fontFamily: HOME_FONT, outline: "none", color: "#1A2420", background: "#fff" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", WebkitBackdropFilter: "blur(4px)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "22px 22px 18px", width: 348, maxWidth: "100%", boxShadow: "0 20px 56px rgba(0,0,0,0.2)", fontFamily: HOME_FONT, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
          <div style={{ width: 28, height: 28, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: T.primarySoft, border: `1px solid ${T.primaryMist}` }}>
            <Icon name="flag" color={T.primary} size={15} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#1A2420" }}>设置备考目标</div>
        </div>
        <div style={{ fontSize: 12, color: "#5A6B62", marginBottom: 18, lineHeight: 1.5 }}>记录考试时间与目标分，主页会为你倒计时督促。</div>

        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A2420", marginBottom: 7 }}>考试日期</label>
        <input type="date" value={examDate} min={todayStr} onChange={(e) => setExamDate(e.target.value)} style={inputStyle} />

        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A2420", margin: "16px 0 8px" }}>
          目标分数 <span style={{ fontWeight: 500, color: "#94A39A" }}>（写作 · 满分 6.0）</span>
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          {TARGET_PRESETS.map((v) => {
            const active = Number(target) === v;
            return (<button key={v} onClick={() => setTarget(String(v))} style={{ flex: 1, padding: "9px 0", fontSize: 13, fontWeight: 800, borderRadius: 10, cursor: "pointer", fontFamily: HOME_FONT, border: `1px solid ${active ? T.primary : "#DDE5DF"}`, background: active ? T.primarySoft : "#fff", color: active ? T.primaryDeep : "#5A6B62", transition: "all .12s" }}>{fmtBand(v)}</button>);
          })}
        </div>

        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A2420", margin: "16px 0 7px" }}>
          当前水平 <span style={{ fontWeight: 500, color: "#94A39A" }}>（可选 · 留空则用最佳模考成绩）</span>
        </label>
        <select value={current} onChange={(e) => setCurrent(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
          <option value="">未设置</option>
          {BAND_OPTIONS.map((v) => (<option key={v} value={String(v)}>{fmtBand(v)} 分</option>))}
        </select>

        <PressButton onClick={save} bg={T.primary} edge={T.primaryDeep} style={{ width: "100%", marginTop: 20, padding: "12px 0", fontSize: 14.5 }}>保存</PressButton>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
          <button onClick={onClear} style={{ border: "none", background: "none", color: "#B0654E", fontSize: 12, cursor: "pointer", fontFamily: HOME_FONT, padding: "2px 0", opacity: 0.8 }}>清除目标</button>
          <button onClick={onClose} style={{ border: "none", background: "none", color: "#5A6B62", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: HOME_FONT, padding: "2px 0" }}>取消</button>
        </div>
      </div>
    </div>
  );
}
