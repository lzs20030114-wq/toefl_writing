"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import LoginGate from "../components/LoginGate";
import { isIapEnabledClient } from "../lib/featureFlags";
import { loadHist, SESSION_STORE_EVENTS, setCurrentUser } from "../lib/sessionStore";
import { formatMinutesLabel, getTaskTimeSeconds, normalizePracticeMode, PRACTICE_MODE, STANDARD_TIME_SECONDS } from "../lib/practiceMode";

/* ── Design tokens ── */
const T = {
  bg: "#F4F7F5",
  card: "#FFFFFF",
  bdr: "#E2EAE6",
  primary: "#0D9668",
  primarySoft: "#E8F5F0",
  primaryDk: "#0A7A54",
  t1: "#1A2E26",
  t2: "#5A7A6E",
  t3: "#8AA89E",
  amber: "#F59E0B",
  amberSoft: "#FEF3C7",
  cyan: "#0891B2",
  cyanSoft: "#E0F7FA",
  indigo: "#4F46E5",
  indigoSoft: "#EEF2FF",
};
const JFONT = "'Plus Jakarta Sans','Noto Sans SC','Segoe UI',sans-serif";

const TASK_ACCENTS = [
  { color: T.amber, soft: T.amberSoft },
  { color: T.cyan, soft: T.cyanSoft },
  { color: T.indigo, soft: T.indigoSoft },
];

/* ── Challenge theme palette ── */
const CH = {
  bg: "#0a0a12",
  card: "#111118",
  cardBorder: "#2a1525",
  t1: "#e8e8ec",
  t2: "#8888a0",
  accent: "#ff2222",
  nav: "#0d0d14",
  navBorder: "#ff2222",
  timeBg: "#1a0a10",
  blue: "#4488ff",
};

/* ── CSS keyframes ── */
const PAGE_CSS = `
@keyframes fadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
@keyframes ch-crtFlash{0%{opacity:0}5%{opacity:1}100%{opacity:0}}
@keyframes ch-screenShake{0%,100%{transform:translateX(0)}10%{transform:translateX(-3px)}20%{transform:translateX(3px)}30%{transform:translateX(-2px)}40%{transform:translateX(2px)}50%{transform:translateX(-1px)}60%{transform:translateX(1px)}70%{transform:translateX(0)}}
@keyframes ch-vignette{0%,100%{opacity:.7}50%{opacity:.4}}
@keyframes ch-glowPulse{0%,100%{opacity:.8}50%{opacity:.3}}
@keyframes ch-ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
@keyframes ch-sweep{0%{left:-30%}100%{left:130%}}
@keyframes ch-gradRot{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes ch-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
@keyframes ch-borderGlow{0%,100%{box-shadow:0 0 8px rgba(255,30,30,.25),inset 0 0 8px rgba(255,30,30,.08)}50%{box-shadow:0 0 18px rgba(255,30,30,.45),inset 0 0 12px rgba(255,30,30,.12)}}
`;

/* ── Particle field (challenge only) ── */
function ParticleField() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    const pts = Array.from({ length: 60 }, () => ({
      x: Math.random() * (canvas.width || 800),
      y: Math.random() * (canvas.height || 600),
      r: Math.random() * 2 + 0.5,
      vy: -(Math.random() * 0.5 + 0.15),
      vx: (Math.random() - 0.5) * 0.3,
      a: Math.random() * 0.45 + 0.1,
    }));
    let raf;
    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.y < -10) { p.y = canvas.height + 10; p.x = Math.random() * canvas.width; }
        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,50,50,${p.a})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { window.removeEventListener("resize", resize); cancelAnimationFrame(raf); };
  }, []);
  return <canvas ref={ref} style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }} />;
}

/* ── Static data ── */
const PRACTICE_TASKS = [
  { k: "build-sentence", modeKey: "build", n: "Task 1", t: "Build a Sentence", d: "Reorder words to form a grammatically correct response.", it: "10 questions" },
  { k: "email-writing", modeKey: "email", n: "Task 2", t: "Write an Email", d: "Respond appropriately to a workplace situation.", it: "80–120 words" },
  { k: "academic-writing", modeKey: "discussion", n: "Task 3", t: "Academic Discussion", d: "Respond to an academic discussion prompt.", it: "100+ words" },
];
const MOCK_TASK = { k: "mock-exam", n: "Full Writing Section", t: "Mock Exam Mode", d: "Simulated exam environment", it: "Task 1 + Task 2 + Task 3" };
const IAP_ENABLED = isIapEnabledClient();

/* ── Page component ── */
function HomePage({ userCode, onLogout }) {
  const [hoverKey, setHoverKey] = useState("");
  const [sessionCount, setSessionCount] = useState(0);
  const [mode, setMode] = useState(PRACTICE_MODE.STANDARD);
  const [crtFlash, setCrtFlash] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState("");

  const isChallenge = mode === PRACTICE_MODE.CHALLENGE;

  useEffect(() => {
    const refresh = () => { setSessionCount((loadHist().sessions || []).length); };
    refresh();
    window.addEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
  }, []);

  const historyText = useMemo(() => {
    if (sessionCount > 0) return `${sessionCount} 次练习已记录，查看进度与薄弱点`;
    return "跟踪练习趋势，发现薄弱环节";
  }, [sessionCount]);

  function switchMode(newMode) {
    const m = normalizePracticeMode(newMode);
    if (m === mode) return;
    setCrtFlash(true);
    setTimeout(() => { setMode(m); setShaking(true); }, 150);
    setTimeout(() => setCrtFlash(false), 400);
    setTimeout(() => setShaking(false), 600);
  }

  async function submitFeedback() {
    const content = String(feedbackText || "").trim();
    if (!content) { setFeedbackMsg("请输入你的建议内容。"); return; }
    setFeedbackBusy(true);
    setFeedbackMsg("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode, content, page: "/" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setFeedbackText("");
      setFeedbackMsg("提交成功，感谢你的反馈。");
    } catch (e) {
      setFeedbackMsg(`提交失败：${String(e.message || e)}`);
    } finally {
      setFeedbackBusy(false);
    }
  }

  const querySuffix = isChallenge ? "?mode=challenge" : "";
  const mockTotalSeconds = getTaskTimeSeconds("build", mode) + getTaskTimeSeconds("email", mode) + getTaskTimeSeconds("discussion", mode);
  const mockStandardTotal = STANDARD_TIME_SECONDS.build + STANDARD_TIME_SECONDS.email + STANDARD_TIME_SECONDS.discussion;
  const tickerText = "⚠ CHALLENGE MODE ACTIVE · REDUCED TIME LIMITS · PROVE YOUR SKILLS UNDER PRESSURE · NO MERCY · ";

  return (
    <>
      <style>{PAGE_CSS}</style>

      {/* Challenge-only global layers */}
      {isChallenge && <ParticleField />}
      {isChallenge && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.7) 100%)", pointerEvents: "none", zIndex: 1, animation: "ch-vignette 6s ease-in-out infinite" }} />
      )}
      {isChallenge && (
        <>
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${CH.accent}, transparent)`, zIndex: 2, pointerEvents: "none", animation: "ch-glowPulse 3s ease-in-out infinite" }} />
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${CH.accent}, transparent)`, zIndex: 2, pointerEvents: "none", animation: "ch-glowPulse 3s ease-in-out infinite" }} />
          <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, width: 2, background: `linear-gradient(180deg, transparent, ${CH.accent}, transparent)`, zIndex: 2, pointerEvents: "none", animation: "ch-glowPulse 3s ease-in-out infinite" }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 2, background: `linear-gradient(180deg, transparent, ${CH.accent}, transparent)`, zIndex: 2, pointerEvents: "none", animation: "ch-glowPulse 3s ease-in-out infinite" }} />
        </>
      )}
      {crtFlash && <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "#fff", zIndex: 9999, pointerEvents: "none", animation: "ch-crtFlash .4s ease-out forwards" }} />}

      {/* Main wrapper */}
      <div style={{
        minHeight: "100vh",
        background: isChallenge ? CH.bg : T.bg,
        fontFamily: JFONT,
        position: "relative",
        zIndex: 3,
        animation: shaking ? "ch-screenShake .35s ease-out" : "none",
        transition: "background .3s ease",
      }}>

        {/* ── Navbar ── */}
        {isChallenge ? (
          <div style={{
            background: CH.nav, color: "#fff", padding: "0 20px", height: 48,
            display: "flex", alignItems: "center",
            borderBottom: `3px solid ${CH.navBorder}`,
            position: "relative", overflow: "hidden",
          }}>
            <span style={{ fontWeight: 700, fontSize: 15, position: "relative", zIndex: 1 }}>TOEFL iBT</span>
            <span style={{ opacity: 0.5, margin: "0 12px", position: "relative", zIndex: 1 }}>|</span>
            <span style={{ fontSize: 13, position: "relative", zIndex: 1 }}>Writing Section 2026</span>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, position: "relative", zIndex: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: CH.accent, letterSpacing: 1, textTransform: "uppercase" }}>CHALLENGE</span>
              {userCode && (
                <>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", fontFamily: "monospace" }}>{userCode}</span>
                  <button onClick={onLogout} style={{ border: "1px solid rgba(255,255,255,0.35)", background: "transparent", color: "#fff", borderRadius: 6, fontSize: 11, fontWeight: 700, padding: "3px 8px", cursor: "pointer", fontFamily: JFONT }}>退出</button>
                </>
              )}
            </div>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)", zIndex: 0 }} />
            <div style={{ position: "absolute", top: 0, bottom: 0, width: "30%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)", animation: "ch-sweep 4s ease-in-out infinite", pointerEvents: "none", zIndex: 0 }} />
          </div>
        ) : (
          <div style={{ height: 52, display: "flex", alignItems: "center", padding: "0 24px", borderBottom: `1px solid ${T.bdr}`, background: T.card }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${T.primary} 0%, ${T.primaryDk} 100%)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 800 }}>T</span>
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: T.t1 }}>TOEFL Writing</span>
              <span style={{ fontSize: 11, color: T.t3, marginLeft: 2 }}>2026</span>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              {userCode && (
                <>
                  <span style={{ fontSize: 11, color: T.t2, fontFamily: "monospace" }}>{userCode}</span>
                  <button onClick={onLogout} style={{ border: `1px solid ${T.bdr}`, background: "transparent", color: T.t2, borderRadius: 6, fontSize: 11, fontWeight: 600, padding: "3px 8px", cursor: "pointer", fontFamily: JFONT }}>退出</button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Challenge ticker */}
        {isChallenge && (
          <div style={{ overflow: "hidden", background: "rgba(255,20,20,0.06)", borderBottom: "1px solid rgba(255,30,30,0.25)", padding: "5px 0" }}>
            <div style={{ display: "flex", whiteSpace: "nowrap", animation: "ch-ticker 25s linear infinite", fontSize: 11, fontWeight: 700, color: CH.accent, letterSpacing: 2, textTransform: "uppercase", fontFamily: "Consolas,monospace" }}>
              <span>{tickerText}{tickerText}{tickerText}{tickerText}</span>
            </div>
          </div>
        )}

        {/* ── Content ── */}
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "28px 20px 48px" }}>

          {/* Hero card */}
          <div style={{
            background: isChallenge ? "rgba(17,17,24,0.85)" : T.card,
            backdropFilter: isChallenge ? "blur(8px)" : "none",
            border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`,
            borderRadius: 14,
            padding: "28px 24px 22px",
            marginBottom: 16,
            textAlign: "center",
            animation: isChallenge ? "ch-borderGlow 3s ease-in-out infinite, fadeUp .45s ease both" : "fadeUp .45s ease both",
            transition: "background .3s, border-color .3s",
          }}>
            {isChallenge ? (
              <>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: CH.t1, letterSpacing: -0.5, fontFamily: JFONT }}>
                  TOEFL iBT Writing — <span style={{ color: CH.accent }}>Challenge Mode</span>
                </h1>
                <p style={{ color: CH.accent, fontSize: 13, margin: "8px 0 0", fontWeight: 600 }}>
                  Prove your skills under pressure. Reduced time. No mercy.
                </p>
              </>
            ) : (
              <>
                <h1 style={{ margin: 0, fontSize: 27, fontWeight: 800, color: T.t1, letterSpacing: -0.5, fontFamily: JFONT }}>
                  TOEFL iBT Writing Practice
                </h1>
                <p style={{ color: T.t2, fontSize: 13, margin: "6px 0 0" }}>
                  ETS 风格计时 · AI 评分反馈 · 全部 3 种题型
                </p>
              </>
            )}

            {/* Mode toggle */}
            <div style={{
              display: "inline-flex", gap: 4,
              background: isChallenge ? "rgba(255,255,255,0.05)" : T.bg,
              border: `1px solid ${isChallenge ? "rgba(255,30,30,0.3)" : T.bdr}`,
              borderRadius: 999, marginTop: 16, padding: 4,
              transition: "background .3s, border-color .3s",
            }}>
              {[
                { value: PRACTICE_MODE.STANDARD, label: "Standard" },
                { value: PRACTICE_MODE.CHALLENGE, label: "🔥 Challenge" },
              ].map((opt) => {
                const sel = mode === opt.value;
                const isCh = opt.value === PRACTICE_MODE.CHALLENGE;
                return (
                  <button
                    key={opt.value}
                    onClick={() => switchMode(opt.value)}
                    style={{
                      border: "none",
                      background: sel ? (isCh ? "rgba(255,30,30,0.18)" : "#fff") : "transparent",
                      color: sel ? (isCh ? CH.accent : T.t1) : (isChallenge ? CH.t2 : T.t2),
                      borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 700,
                      cursor: "pointer", transition: "all .15s",
                      boxShadow: sel && !isCh ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                      fontFamily: JFONT,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Info strip */}
          <div style={{
            background: isChallenge ? "rgba(17,17,24,0.7)" : T.card,
            border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`,
            borderRadius: 10, padding: "10px 16px", marginBottom: 20,
            animation: "fadeUp .45s ease .05s both",
          }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: isChallenge ? CH.t2 : T.t2 }}>
              <span>· 覆盖 2026 TOEFL iBT Writing 全部题型</span>
              <span>· ETS 风格限时</span>
              <span>· AI 批改与反馈</span>
              <span>· 仅供练习，非官方评分</span>
            </div>
          </div>

          {/* ── Task cards ── */}
          {PRACTICE_TASKS.map((c, i) => {
            const acc = TASK_ACCENTS[i];
            const stdSec = STANDARD_TIME_SECONDS[c.modeKey] || 0;
            const chSec = getTaskTimeSeconds(c.modeKey, PRACTICE_MODE.CHALLENGE);
            const hover = hoverKey === c.k;
            return (
              <Link
                href={`/${c.k}${querySuffix}`}
                key={c.k}
                onMouseEnter={() => setHoverKey(c.k)}
                onMouseLeave={() => setHoverKey("")}
                style={{
                  display: "flex", alignItems: "stretch", position: "relative",
                  textDecoration: "none", color: "inherit",
                  background: isChallenge ? CH.card : T.card,
                  border: `1px solid ${hover ? (isChallenge ? "rgba(255,30,30,0.5)" : acc.color + "90") : (isChallenge ? CH.cardBorder : T.bdr)}`,
                  borderRadius: 12, marginBottom: 10, overflow: "hidden", cursor: "pointer",
                  transform: hover ? "translateY(-2px)" : "translateY(0)",
                  boxShadow: hover ? (isChallenge ? "0 6px 20px rgba(255,30,30,0.18)" : `0 6px 18px ${acc.color}28`) : "0 1px 3px rgba(0,0,0,0.05)",
                  transition: "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease",
                  animation: `fadeUp .45s ease ${0.1 + i * 0.06}s both`,
                }}
              >
                {/* Hover accent bar */}
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
                  background: isChallenge ? CH.accent : acc.color,
                  opacity: hover ? 1 : 0, transition: "opacity 150ms ease",
                  borderRadius: "12px 0 0 12px",
                }} />

                {/* Time column */}
                <div style={{
                  width: 72, minWidth: 72, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  background: isChallenge ? CH.timeBg : acc.soft,
                  padding: "10px 4px", gap: isChallenge ? 2 : 0,
                }}>
                  {isChallenge ? (
                    <>
                      <div style={{ fontSize: 18, fontWeight: 800, color: CH.accent, animation: "ch-pulse 2s ease-in-out infinite", whiteSpace: "nowrap" }}>{formatMinutesLabel(chSec)}</div>
                      <div style={{ fontSize: 11, color: CH.t2, textDecoration: "line-through", whiteSpace: "nowrap" }}>{formatMinutesLabel(stdSec)}</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 20, fontWeight: 800, color: acc.color, whiteSpace: "nowrap" }}>{formatMinutesLabel(getTaskTimeSeconds(c.modeKey, mode))}</div>
                  )}
                </div>

                {/* Gradient divider */}
                <div style={{ width: 1, background: isChallenge ? CH.cardBorder : `linear-gradient(to bottom, transparent, ${acc.color}50, transparent)`, flexShrink: 0 }} />

                {/* Content */}
                <div style={{ padding: "14px 16px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ fontSize: 11, color: isChallenge ? CH.accent : acc.color, fontWeight: 700, marginBottom: 3, letterSpacing: 0.3 }}>{c.n}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: isChallenge ? CH.t1 : T.t1, marginBottom: 3, lineHeight: 1.25 }}>{c.t}</div>
                  <div style={{ fontSize: 12, color: isChallenge ? CH.t2 : T.t2, lineHeight: 1.4 }}>{c.d}</div>
                </div>

                {/* Meta tag */}
                <div style={{ padding: "14px 14px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", gap: 6 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
                    color: isChallenge ? CH.t2 : acc.color,
                    background: isChallenge ? "rgba(255,255,255,0.05)" : acc.soft,
                    borderRadius: 6, padding: "3px 8px",
                    border: `1px solid ${isChallenge ? "rgba(255,255,255,0.08)" : acc.color + "30"}`,
                  }}>{c.it}</div>
                  <div style={{ color: isChallenge ? CH.accent : T.primary, fontSize: 16, lineHeight: 1 }}>›</div>
                </div>
              </Link>
            );
          })}

          {/* ── Mock Exam card ── */}
          <div
            onMouseEnter={() => setHoverKey(MOCK_TASK.k)}
            onMouseLeave={() => setHoverKey("")}
            style={{
              marginBottom: 10, borderRadius: 12,
              padding: isChallenge ? 2 : 0,
              background: isChallenge ? "linear-gradient(90deg, #ff2222, #ff6600, #ff2222, #cc0000)" : "transparent",
              backgroundSize: isChallenge ? "300% 100%" : "auto",
              animation: isChallenge ? "ch-gradRot 3s ease infinite, fadeUp .45s ease .28s both" : "fadeUp .45s ease .28s both",
            }}
          >
            <Link
              href={`/${MOCK_TASK.k}${querySuffix}`}
              style={{
                display: "flex", alignItems: "stretch", position: "relative",
                textDecoration: "none", color: "inherit",
                background: isChallenge ? "linear-gradient(180deg, #14101c 0%, #1a0e16 100%)" : T.primarySoft,
                border: isChallenge ? "none" : `1px solid ${hoverKey === MOCK_TASK.k ? T.primary : T.primary + "55"}`,
                borderRadius: 10, overflow: "hidden", cursor: "pointer",
                transform: hoverKey === MOCK_TASK.k ? "translateY(-2px)" : "translateY(0)",
                boxShadow: hoverKey === MOCK_TASK.k
                  ? (isChallenge ? "0 6px 24px rgba(255,30,30,0.3)" : `0 6px 20px ${T.primary}30`)
                  : (isChallenge ? "0 2px 12px rgba(255,30,30,0.15)" : `0 2px 8px ${T.primary}18`),
                transition: "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease",
              }}
            >
              {/* Always-visible accent bar */}
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
                background: isChallenge ? CH.accent : T.primary,
                opacity: isChallenge ? 0 : 0.5,
                borderRadius: "10px 0 0 10px",
              }} />

              {/* Time column */}
              <div style={{
                width: 72, minWidth: 72, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                background: isChallenge ? CH.timeBg : `${T.primary}18`,
                padding: "10px 4px", gap: isChallenge ? 2 : 0,
              }}>
                {isChallenge ? (
                  <>
                    <div style={{ fontSize: 18, fontWeight: 800, color: CH.accent, animation: "ch-pulse 2s ease-in-out infinite", whiteSpace: "nowrap" }}>{formatMinutesLabel(mockTotalSeconds)}</div>
                    <div style={{ fontSize: 11, color: CH.t2, textDecoration: "line-through", whiteSpace: "nowrap" }}>{formatMinutesLabel(mockStandardTotal)}</div>
                  </>
                ) : (
                  <div style={{ fontSize: 20, fontWeight: 800, color: T.primary, whiteSpace: "nowrap" }}>{formatMinutesLabel(mockTotalSeconds)}</div>
                )}
              </div>

              {/* Divider */}
              <div style={{ width: 1, background: isChallenge ? CH.cardBorder : `${T.primary}30`, flexShrink: 0 }} />

              {/* Content */}
              <div style={{ padding: "14px 16px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ fontSize: 11, color: isChallenge ? CH.accent : T.primaryDk, fontWeight: 700, marginBottom: 3, letterSpacing: 0.3 }}>
                  {isChallenge ? "🔥 " : ""}{MOCK_TASK.n}
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: isChallenge ? CH.t1 : T.t1, marginBottom: 3, lineHeight: 1.25 }}>
                  {MOCK_TASK.t}
                </div>
                <div style={{ fontSize: 12, color: isChallenge ? CH.t2 : T.primaryDk }}>
                  Task 1 + Task 2 + Task 3 · {formatMinutesLabel(mockTotalSeconds)}
                </div>
              </div>

              {/* Meta */}
              <div style={{ padding: "14px 14px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", gap: 6 }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
                  color: isChallenge ? CH.accent : T.primaryDk,
                  background: isChallenge ? "rgba(255,30,30,0.1)" : `${T.primary}18`,
                  borderRadius: 6, padding: "3px 8px",
                  border: `1px solid ${isChallenge ? "rgba(255,30,30,0.2)" : T.primary + "30"}`,
                }}>模拟全场</div>
                {isChallenge && (
                  <div style={{ fontSize: 11, color: CH.accent, fontWeight: 700, animation: "ch-pulse 1.5s ease-in-out infinite" }}>🔥 Challenge</div>
                )}
                <div style={{ color: isChallenge ? CH.accent : T.primary, fontSize: 16, lineHeight: 1 }}>›</div>
              </div>
            </Link>
          </div>

          {/* IAP card (flag-protected) */}
          {IAP_ENABLED && (
            <Link
              href="/iap"
              onMouseEnter={() => setHoverKey("iap")}
              onMouseLeave={() => setHoverKey("")}
              style={{
                display: "flex", alignItems: "stretch", position: "relative",
                textDecoration: "none", color: "inherit",
                background: isChallenge ? CH.card : T.card,
                border: `1px solid ${hoverKey === "iap" ? (isChallenge ? "rgba(251,191,36,0.45)" : "#f59e0b") : (isChallenge ? CH.cardBorder : T.bdr)}`,
                borderRadius: 12, marginTop: 10, overflow: "hidden", cursor: "pointer",
                transform: hoverKey === "iap" ? "translateY(-2px)" : "translateY(0)",
                boxShadow: hoverKey === "iap" ? (isChallenge ? "0 4px 14px rgba(251,191,36,0.12)" : "0 4px 14px rgba(245,158,11,0.15)") : "0 1px 3px rgba(0,0,0,0.05)",
                transition: "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease",
                animation: "fadeUp .45s ease .34s both",
              }}
            >
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: isChallenge ? "#fbbf24" : "#f59e0b", opacity: hoverKey === "iap" ? 1 : 0, transition: "opacity 150ms ease", borderRadius: "12px 0 0 12px" }} />
              <div style={{ width: 72, minWidth: 72, display: "flex", alignItems: "center", justifyContent: "center", background: isChallenge ? "rgba(120,53,15,0.25)" : "#fef3c7", padding: "10px 4px" }}>
                <span style={{ fontSize: 24 }}>💳</span>
              </div>
              <div style={{ width: 1, background: isChallenge ? CH.cardBorder : "#f59e0b40", flexShrink: 0 }} />
              <div style={{ padding: "14px 16px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ fontSize: 11, color: isChallenge ? "#fbbf24" : "#92400e", fontWeight: 700, marginBottom: 3 }}>PRIVATE</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: isChallenge ? CH.t1 : T.t1, marginBottom: 3, lineHeight: 1.25 }}>In-App Purchase</div>
                <div style={{ fontSize: 12, color: isChallenge ? CH.t2 : T.t2 }}>Private staging workspace for payment flow.</div>
              </div>
              <div style={{ padding: "14px 14px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: isChallenge ? "#fbbf24" : "#92400e", background: isChallenge ? "rgba(120,53,15,0.2)" : "#fef3c7", borderRadius: 6, padding: "3px 8px", border: "1px solid #f59e0b30" }}>Flag</div>
                <div style={{ color: isChallenge ? "#fbbf24" : "#92400e", fontSize: 16, lineHeight: 1 }}>›</div>
              </div>
            </Link>
          )}

          {/* Progress card */}
          <Link
            href="/progress"
            onMouseEnter={() => setHoverKey("progress")}
            onMouseLeave={() => setHoverKey("")}
            style={{
              display: "flex", alignItems: "stretch", position: "relative",
              textDecoration: "none", color: "inherit",
              background: isChallenge ? CH.card : T.card,
              border: `1px solid ${hoverKey === "progress" ? (isChallenge ? "rgba(134,239,172,0.4)" : T.primary + "80") : (isChallenge ? CH.cardBorder : T.bdr)}`,
              borderRadius: 12, marginTop: 10, overflow: "hidden", cursor: "pointer",
              transform: hoverKey === "progress" ? "translateY(-2px)" : "translateY(0)",
              boxShadow: hoverKey === "progress" ? (isChallenge ? "0 4px 14px rgba(22,163,74,0.1)" : `0 4px 14px ${T.primary}22`) : "0 1px 3px rgba(0,0,0,0.05)",
              transition: "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease",
              animation: `fadeUp .45s ease ${IAP_ENABLED ? ".40s" : ".34s"} both`,
            }}
          >
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: isChallenge ? "#4ade80" : T.primary, opacity: hoverKey === "progress" ? 1 : 0, transition: "opacity 150ms ease", borderRadius: "12px 0 0 12px" }} />
            <div style={{ width: 72, minWidth: 72, display: "flex", alignItems: "center", justifyContent: "center", background: isChallenge ? "rgba(22,101,52,0.15)" : T.primarySoft, padding: "10px 4px" }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: isChallenge ? "rgba(22,101,52,0.3)" : `${T.primary}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 22 }}>📊</span>
              </div>
            </div>
            <div style={{ width: 1, background: isChallenge ? CH.cardBorder : `${T.primary}30`, flexShrink: 0 }} />
            <div style={{ padding: "14px 16px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: 11, color: isChallenge ? "#4ade80" : T.primaryDk, fontWeight: 700, marginBottom: 3 }}>PROGRESS</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: isChallenge ? CH.t1 : T.t1, marginBottom: 3, lineHeight: 1.25 }}>Practice History</div>
              <div style={{ fontSize: 12, color: isChallenge ? CH.t2 : T.t2 }}>{historyText}</div>
            </div>
            <div style={{ padding: "14px 14px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", gap: 6 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                color: isChallenge ? "#4ade80" : T.primaryDk,
                background: isChallenge ? "rgba(22,101,52,0.2)" : T.primarySoft,
                borderRadius: 6, padding: "3px 8px",
                border: `1px solid ${isChallenge ? "rgba(74,222,128,0.2)" : T.primary + "30"}`,
              }}>{sessionCount > 0 ? `${sessionCount} 次` : "0 次"}</div>
              <div style={{ color: isChallenge ? "#4ade80" : T.primary, fontSize: 16, lineHeight: 1 }}>›</div>
            </div>
          </Link>

          {/* Footer */}
          <div style={{
            marginTop: 24, padding: "14px 16px",
            background: isChallenge ? "rgba(17,17,24,0.7)" : T.card,
            border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`,
            borderRadius: 10, fontSize: 12,
            color: isChallenge ? CH.t2 : T.t2,
            animation: "fadeUp .45s ease .45s both",
          }}>
            <span style={{ fontWeight: 700, color: isChallenge ? CH.t1 : T.t1 }}>Powered by DeepSeek AI</span>
            {" · "}ETS 风格评分 · 语法诊断 · 薄弱点跟踪 · AI 题目生成
          </div>

          <div style={{
            marginTop: 10, padding: "12px 16px",
            background: isChallenge ? "rgba(17,17,24,0.7)" : T.card,
            border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`,
            borderRadius: 10, fontSize: 11,
            color: isChallenge ? CH.t2 : T.t3,
            lineHeight: 1.6,
            animation: "fadeUp .45s ease .48s both",
          }}>
            <b style={{ color: isChallenge ? CH.t1 : T.t2 }}>Disclaimer:</b> This tool is an independent practice resource not affiliated with ETS or the TOEFL program. TOEFL® is a registered trademark of ETS. AI scoring is for self-study reference only.{" "}
            <button
              onClick={() => { setFeedbackOpen(true); setFeedbackMsg(""); }}
              style={{ background: "none", border: "none", padding: 0, color: isChallenge ? CH.accent : T.primary, fontSize: 11, cursor: "pointer", textDecoration: "underline", fontFamily: JFONT }}
            >
              提交改进建议
            </button>
          </div>
        </div>

        {/* ── Feedback modal ── */}
        {feedbackOpen && (
          <div
            style={{ position: "fixed", inset: 0, zIndex: 30, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
            onClick={() => setFeedbackOpen(false)}
          >
            <div
              style={{ width: "100%", maxWidth: 520, background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 14, padding: "20px 20px 16px" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontSize: 17, fontWeight: 800, color: T.t1, marginBottom: 4, fontFamily: JFONT }}>内测反馈</div>
              <div style={{ fontSize: 12, color: T.t2, marginBottom: 12 }}>
                用户码：<b style={{ fontFamily: "monospace" }}>{userCode || "-"}</b>
              </div>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="请写下你希望改进的点，例如：哪里不好用、有 bug、希望新增什么功能。"
                maxLength={2000}
                style={{ width: "100%", minHeight: 140, resize: "vertical", border: `1px solid ${T.bdr}`, borderRadius: 8, padding: 10, fontSize: 13, lineHeight: 1.6, boxSizing: "border-box", fontFamily: JFONT, outline: "none", color: T.t1 }}
              />
              <div style={{ fontSize: 11, color: T.t3, marginTop: 6 }}>{feedbackText.length}/2000</div>
              {feedbackMsg && (
                <div style={{ marginTop: 8, fontSize: 12, color: feedbackMsg.includes("成功") ? T.primary : "#dc3545" }}>{feedbackMsg}</div>
              )}
              <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onClick={() => setFeedbackOpen(false)}
                  style={{ border: `1px solid ${T.bdr}`, background: T.card, color: T.t2, borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 13, fontFamily: JFONT }}
                >
                  关闭
                </button>
                <button
                  onClick={submitFeedback}
                  disabled={feedbackBusy}
                  style={{ border: `1px solid ${T.primary}`, background: T.primary, color: "#fff", borderRadius: 8, padding: "8px 14px", cursor: feedbackBusy ? "not-allowed" : "pointer", opacity: feedbackBusy ? 0.6 : 1, fontSize: 13, fontWeight: 700, fontFamily: JFONT }}
                >
                  {feedbackBusy ? "提交中..." : "提交反馈"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function Page() {
  return (
    <LoginGate>
      {({ userCode, onLogout }) => {
        setCurrentUser(userCode);
        return <HomePage userCode={userCode} onLogout={onLogout} />;
      }}
    </LoginGate>
  );
}
