"use client";

import { useEffect, useMemo, useState } from "react";
import { isIapEnabledClient } from "../../lib/featureFlags";
import { loadHist, SESSION_STORE_EVENTS } from "../../lib/sessionStore";
import { formatMinutesLabel, getTaskTimeSeconds, normalizePracticeMode, PRACTICE_MODE, STANDARD_TIME_SECONDS } from "../../lib/practiceMode";
import { ChallengeEffects } from "./ChallengeEffects";
import { HomeLinkCard, HomeTaskCard } from "./HomeTaskCard";
import { HomeSidebar } from "./HomeSidebar";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_PAGE_CSS, HOME_TOKENS as T, TASK_ACCENTS } from "./theme";

const PRACTICE_TASKS = [
  { k: "build-sentence", modeKey: "build", n: "Task 1", t: "Build a Sentence", d: "Reorder words to form a grammatically correct response.", it: "10 questions" },
  { k: "email-writing", modeKey: "email", n: "Task 2", t: "Write an Email", d: "Respond appropriately to a workplace situation.", it: "80-120 words" },
  { k: "academic-writing", modeKey: "discussion", n: "Task 3", t: "Academic Discussion", d: "Respond to an academic discussion prompt.", it: "100+ words" },
];

const MOCK_TASK = {
  k: "mock-exam",
  n: "Full Writing Section",
  t: "Mock Exam Mode",
  d: "Task 1 + Task 2 + Task 3 in one sitting.",
  it: "Full section",
};

function parseJsonSafe(res) {
  return res.json().catch(() => ({}));
}

export default function HomePageClient({ userCode, onLogout }) {
  const [hoverKey, setHoverKey] = useState("");
  const [sessions, setSessions] = useState([]);
  const [mode, setMode] = useState(PRACTICE_MODE.STANDARD);
  const [crtFlash, setCrtFlash] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const [fbText, setFbText] = useState("");
  const [fbBusy, setFbBusy] = useState(false);
  const [fbSent, setFbSent] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState(null);
  const [copied, setCopied] = useState(false);
  const [logoutHover, setLogoutHover] = useState(false);

  const isChallenge = mode === PRACTICE_MODE.CHALLENGE;
  const iapEnabled = isIapEnabledClient();

  useEffect(() => {
    const refresh = () => setSessions(loadHist().sessions || []);
    refresh();
    window.addEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
  }, []);

  const { totalCount, weekCount, bestMock } = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const mockBands = sessions.filter((session) => session?.type === "mock" && Number.isFinite(session?.band)).map((session) => session.band);
    return {
      totalCount: sessions.length,
      weekCount: sessions.filter((session) => new Date(session?.date || 0).getTime() >= weekAgo).length,
      bestMock: mockBands.length > 0 ? Math.max(...mockBands) : null,
    };
  }, [sessions]);

  function switchMode(nextMode) {
    const normalized = normalizePracticeMode(nextMode);
    if (normalized === mode) return;
    setCrtFlash(true);
    setTimeout(() => {
      setMode(normalized);
      setShaking(true);
    }, 150);
    setTimeout(() => setCrtFlash(false), 400);
    setTimeout(() => setShaking(false), 600);
  }

  function copyCode() {
    if (!userCode || !navigator?.clipboard?.writeText) return;
    navigator.clipboard.writeText(userCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setFeedbackMsg({ ok: false, text: "无法访问剪贴板。" });
    });
  }

  async function submitFeedback() {
    const content = String(fbText || "").trim();
    if (!content || fbBusy || fbSent) return;
    setFbBusy(true);
    setFeedbackMsg(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode, content, page: "/" }),
      });
      const body = await parseJsonSafe(res);
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setFbText("");
      setFbSent(true);
      setFeedbackMsg({ ok: true, text: "反馈已提交。" });
      setTimeout(() => setFbSent(false), 2500);
    } catch (error) {
      setFeedbackMsg({ ok: false, text: error.message || String(error) });
    } finally {
      setFbBusy(false);
    }
  }

  const querySuffix = isChallenge ? "?mode=challenge" : "";
  const mockTotalSeconds = getTaskTimeSeconds("build", mode) + getTaskTimeSeconds("email", mode) + getTaskTimeSeconds("discussion", mode);
  const mockStandardSeconds = STANDARD_TIME_SECONDS.build + STANDARD_TIME_SECONDS.email + STANDARD_TIME_SECONDS.discussion;
  const fadeIn = (ms) => ({ animation: `fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) ${ms}ms both` });
  const sideCard = (extra = {}) => ({ background: isChallenge ? CH.card : T.card, border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`, borderRadius: 14, boxShadow: isChallenge ? "none" : T.shadow, overflow: "hidden", ...extra });

  const gridItems = [
    ...PRACTICE_TASKS.map((task, index) => ({
      k: task.k,
      href: `/${task.k}${querySuffix}`,
      acc: TASK_ACCENTS[index],
      n: task.n,
      t: task.t,
      d: task.d,
      it: task.it,
      timeLabel: formatMinutesLabel(getTaskTimeSeconds(task.modeKey, mode)),
      standardLabel: formatMinutesLabel(STANDARD_TIME_SECONDS[task.modeKey] || 0),
      isMock: false,
      delay: 190 + index * 70,
    })),
    {
      k: MOCK_TASK.k,
      href: `/${MOCK_TASK.k}${querySuffix}`,
      acc: { color: T.primary, soft: T.primarySoft },
      n: MOCK_TASK.n,
      t: MOCK_TASK.t,
      d: MOCK_TASK.d,
      it: MOCK_TASK.it,
      timeLabel: formatMinutesLabel(mockTotalSeconds),
      standardLabel: formatMinutesLabel(mockStandardSeconds),
      isMock: true,
      delay: 400,
    },
  ];

  return (
    <>
      <style>{HOME_PAGE_CSS}</style>
      <ChallengeEffects isChallenge={isChallenge} crtFlash={crtFlash} />

      <div style={{ minHeight: "100vh", background: isChallenge ? CH.bg : T.bg, fontFamily: HOME_FONT, position: "relative", zIndex: 3, animation: shaking ? "ch-screenShake .35s ease-out" : "none", transition: "background .3s ease" }}>
        {isChallenge ? (
          <div style={{ position: "sticky", top: 0, zIndex: 10, background: CH.nav, color: "#fff", padding: "0 36px", height: 52, display: "flex", alignItems: "center", borderBottom: `3px solid ${CH.navBorder}`, overflow: "hidden" }}>
            <span style={{ fontWeight: 700, fontSize: 15, position: "relative", zIndex: 1 }}>TOEFL iBT</span>
            <span style={{ opacity: 0.5, margin: "0 12px", position: "relative", zIndex: 1 }}>|</span>
            <span style={{ fontSize: 13, position: "relative", zIndex: 1 }}>写作部分 2026</span>
            <div style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: CH.accent, letterSpacing: 1, textTransform: "uppercase", position: "relative", zIndex: 1 }}>Challenge</div>
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,0.03) 2px,rgba(255,255,255,0.03) 4px)", zIndex: 0 }} />
            <div style={{ position: "absolute", top: 0, bottom: 0, width: "30%", background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)", animation: "ch-sweep 4s ease-in-out infinite", pointerEvents: "none", zIndex: 0 }} />
          </div>
        ) : (
          <div style={{ position: "sticky", top: 0, zIndex: 10, height: 52, display: "flex", alignItems: "center", padding: "0 36px", background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${T.bdrSubtle}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#087355,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 800 }}>T</span>
              </div>
              <span style={{ fontWeight: 700, fontSize: 15, color: T.t1 }}>TOEFL 写作</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.primary, background: T.primarySoft, border: `1px solid ${T.primaryMist}`, borderRadius: 5, padding: "1px 6px", letterSpacing: 0.3 }}>2026</span>
            </div>
            <div style={{ marginLeft: "auto", fontSize: 12, color: T.t3 }}>由 DeepSeek AI 提供支持</div>
          </div>
        )}

        {isChallenge ? (
          <div style={{ overflow: "hidden", background: "rgba(255,20,20,0.06)", borderBottom: "1px solid rgba(255,30,30,0.25)", padding: "5px 0" }}>
            <div style={{ display: "flex", whiteSpace: "nowrap", animation: "ch-ticker 25s linear infinite", fontSize: 11, fontWeight: 700, color: CH.accent, letterSpacing: 2, textTransform: "uppercase", fontFamily: "Consolas,monospace" }}>
              <span>Challenge mode active / Reduced time limits / Prove your skills under pressure / No mercy / Challenge mode active / Reduced time limits / Prove your skills under pressure / No mercy / </span>
            </div>
          </div>
        ) : null}

        <div className="home-shell" style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 36px 60px", display: "flex", gap: 28, alignItems: "flex-start" }}>
          <div className="home-layout" style={{ display: "flex", gap: 28, alignItems: "flex-start", width: "100%" }}>
            <HomeSidebar userCode={userCode} onLogout={onLogout} totalCount={totalCount} weekCount={weekCount} bestMock={bestMock} isChallenge={isChallenge} copied={copied} copyCode={copyCode} logoutHover={logoutHover} setLogoutHover={setLogoutHover} fbOpen={fbOpen} setFbOpen={setFbOpen} fbText={fbText} setFbText={setFbText} fbBusy={fbBusy} fbSent={fbSent} feedbackMsg={feedbackMsg} submitFeedback={submitFeedback} sideCard={sideCard} fadeIn={fadeIn} />

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ marginBottom: 16, ...fadeIn(50) }}>
                <h1 style={{ margin: "0 0 10px", fontSize: 30, fontWeight: 800, color: isChallenge ? CH.t1 : T.t1, letterSpacing: -0.5, lineHeight: 1.2 }}>
                  {isChallenge ? <>TOEFL iBT 写作 <span style={{ color: CH.accent }}>Challenge Mode</span></> : "TOEFL iBT 写作练习"}
                </h1>
                <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                  <p style={{ margin: 0, fontSize: 13, color: isChallenge ? CH.accent : T.t2, fontWeight: isChallenge ? 600 : 400 }}>
                    {isChallenge ? "在压力下证明你的水平。时间更短，要求更高。" : "提供 ETS 风格计时、AI 评分与三类写作任务练习。"}
                  </p>
                  <div style={{ display: "inline-flex", gap: 4, flexShrink: 0, background: isChallenge ? "rgba(255,255,255,0.05)" : T.card, border: `1px solid ${isChallenge ? "rgba(255,30,30,0.3)" : T.bdr}`, borderRadius: 999, padding: 4, boxShadow: T.shadow }}>
                    {[
                      { value: PRACTICE_MODE.STANDARD, label: "Standard" },
                      { value: PRACTICE_MODE.CHALLENGE, label: "Challenge" },
                    ].map((option) => {
                      const selected = mode === option.value;
                      const challengeOption = option.value === PRACTICE_MODE.CHALLENGE;
                      return <button key={option.value} onClick={() => switchMode(option.value)} style={{ border: "none", background: selected ? (challengeOption ? "rgba(255,30,30,0.18)" : "#fff") : "transparent", color: selected ? (challengeOption ? CH.accent : T.t1) : (isChallenge ? CH.t2 : T.t2), borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "all .15s", boxShadow: selected && !challengeOption ? "0 1px 4px rgba(0,0,0,0.1)" : "none", fontFamily: HOME_FONT }}>{option.label}</button>;
                    })}
                  </div>
                </div>
              </div>

              <div style={{ background: isChallenge ? "rgba(17,17,24,0.7)" : T.card, border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`, borderRadius: 10, padding: "10px 16px", marginBottom: 16, boxShadow: isChallenge ? "none" : T.shadow, ...fadeIn(120) }}>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: isChallenge ? CH.t2 : T.t2 }}>
                  <span>- 覆盖 2026 TOEFL iBT 全部写作任务类型</span>
                  <span>- ETS 风格限时练习</span>
                  <span>- AI 评分与反馈</span>
                  <span>- 仅供练习使用，不代表官方 ETS 评分</span>
                </div>
              </div>

              <div className="home-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                {gridItems.map((item) => (
                  <div key={item.k} style={{ display: "flex", ...fadeIn(item.delay) }}>
                    <HomeTaskCard item={item} hoverKey={hoverKey} setHoverKey={setHoverKey} isChallenge={isChallenge} />
                  </div>
                ))}
              </div>

              {iapEnabled ? <div style={{ marginBottom: 12, ...fadeIn(440) }}><HomeLinkCard href="/iap" cardKey="iap" hoverKey={hoverKey} setHoverKey={setHoverKey} isChallenge={isChallenge} icon="IAP" eyebrow="内部" title="内购工作台" description="用于支付流程联调的内部预览页面。" tone="warning" /></div> : null}

              <div style={{ marginBottom: 28, ...fadeIn(iapEnabled ? 480 : 440) }}>
                <HomeLinkCard href="/progress" cardKey="progress" hoverKey={hoverKey} setHoverKey={setHoverKey} isChallenge={isChallenge} icon="P" eyebrow="记录" title="练习记录" description={sessions.length > 0 ? `已记录 ${sessions.length} 次练习，可查看趋势和薄弱点。` : "查看练习趋势并定位薄弱点。"} badge={sessions.length > 0 ? `${sessions.length} 条记录` : "暂无记录"} />
              </div>

              <div style={{ fontSize: 10, color: isChallenge ? CH.t2 : T.t3, opacity: 0.65, lineHeight: 1.6, textAlign: "center", ...fadeIn(iapEnabled ? 520 : 480) }}>
                该工具为独立练习资源，与 ETS 或 TOEFL 项目无关联。TOEFL 为 ETS 注册商标。AI 评分仅供自学参考。
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
