"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import LoginGate from "../components/LoginGate";
import { isIapEnabledClient } from "../lib/featureFlags";
import { loadHist, SESSION_STORE_EVENTS, setCurrentUser } from "../lib/sessionStore";
import {
  formatMinutesLabel,
  getTaskTimeSeconds,
  normalizePracticeMode,
  PRACTICE_MODE,
  STANDARD_TIME_SECONDS,
} from "../lib/practiceMode";

/* ── Design tokens ── */
const T = {
  bg: "#F4F7F5",
  card: "#FFFFFF",
  bdr: "#DDE5DF",
  bdrSubtle: "#EBF0ED",
  t1: "#1A2420",
  t2: "#5A6B62",
  t3: "#94A39A",
  primary: "#0D9668",
  primaryDeep: "#087355",
  primarySoft: "#ECFDF5",
  primaryMist: "#D1FAE5",
  amber: "#D97706",
  amberSoft: "#FFFBEB",
  cyan: "#0891B2",
  cyanSoft: "#ECFEFF",
  indigo: "#6366F1",
  indigoSoft: "#EEF2FF",
  rose: "#E11D48",
  roseSoft: "#FFF1F2",
  shadow: "0 1px 3px rgba(10,40,25,0.04), 0 1px 2px rgba(10,40,25,0.02)",
  shadowMd: "0 4px 14px rgba(10,40,25,0.06), 0 1px 3px rgba(10,40,25,0.03)",
};
const JFONT = "'Plus Jakarta Sans','Noto Sans SC','Segoe UI',sans-serif";

const TASK_ACCENTS = [
  { color: T.amber, soft: T.amberSoft },
  { color: T.cyan, soft: T.cyanSoft },
  { color: T.indigo, soft: T.indigoSoft },
];

/* ── Challenge theme ── */
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
};

/* ── CSS keyframes ── */
const PAGE_CSS = `
@keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
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
  return (
    <canvas
      ref={ref}
      style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }}
    />
  );
}

/* ── Static data ── */
const PRACTICE_TASKS = [
  { k: "build-sentence", modeKey: "build", n: "Task 1", t: "Build a Sentence", d: "Reorder words to form a grammatically correct response.", it: "10 questions" },
  { k: "email-writing", modeKey: "email", n: "Task 2", t: "Write an Email", d: "Respond appropriately to a workplace situation.", it: "80–120 words" },
  { k: "academic-writing", modeKey: "discussion", n: "Task 3", t: "Academic Discussion", d: "Respond to an academic discussion prompt.", it: "100+ words" },
];
const MOCK = { k: "mock-exam", n: "Full Writing Section", t: "Mock Exam Mode", it: "模拟全场" };
const IAP_ENABLED = isIapEnabledClient();

/* ── Page ── */
function HomePage({ userCode, onLogout }) {
  const [hoverKey, setHoverKey] = useState("");
  const [sessions, setSessions] = useState([]);
  const [mode, setMode] = useState(PRACTICE_MODE.STANDARD);
  const [crtFlash, setCrtFlash] = useState(false);
  const [shaking, setShaking] = useState(false);
  /* sidebar state */
  const [fbOpen, setFbOpen] = useState(false);
  const [fbText, setFbText] = useState("");
  const [fbBusy, setFbBusy] = useState(false);
  const [fbSent, setFbSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [logoutHover, setLogoutHover] = useState(false);

  const isChallenge = mode === PRACTICE_MODE.CHALLENGE;

  useEffect(() => {
    const refresh = () => setSessions(loadHist().sessions || []);
    refresh();
    window.addEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
  }, []);

  /* practice stats */
  const { totalCount, weekCount, bestMock } = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const mockBands = sessions.filter((s) => s?.type === "mock" && Number.isFinite(s?.band)).map((s) => s.band);
    return {
      totalCount: sessions.length,
      weekCount: sessions.filter((s) => new Date(s?.date || 0).getTime() >= weekAgo).length,
      bestMock: mockBands.length > 0 ? Math.max(...mockBands) : null,
    };
  }, [sessions]);

  function switchMode(newMode) {
    const m = normalizePracticeMode(newMode);
    if (m === mode) return;
    setCrtFlash(true);
    setTimeout(() => { setMode(m); setShaking(true); }, 150);
    setTimeout(() => setCrtFlash(false), 400);
    setTimeout(() => setShaking(false), 600);
  }

  function copyCode() {
    if (!userCode) return;
    navigator.clipboard.writeText(userCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function submitFeedback() {
    const content = String(fbText || "").trim();
    if (!content || fbBusy || fbSent) return;
    setFbBusy(true);
    try {
      console.log("[feedback]", { userCode, content, page: "/" });
      await new Promise((r) => setTimeout(r, 500));
      setFbText("");
      setFbSent(true);
      setTimeout(() => setFbSent(false), 2500);
    } finally {
      setFbBusy(false);
    }
  }

  const querySuffix = isChallenge ? "?mode=challenge" : "";
  const mockTotalSec = getTaskTimeSeconds("build", mode) + getTaskTimeSeconds("email", mode) + getTaskTimeSeconds("discussion", mode);
  const mockChSec = getTaskTimeSeconds("build", PRACTICE_MODE.CHALLENGE) + getTaskTimeSeconds("email", PRACTICE_MODE.CHALLENGE) + getTaskTimeSeconds("discussion", PRACTICE_MODE.CHALLENGE);
  const mockStdSec = STANDARD_TIME_SECONDS.build + STANDARD_TIME_SECONDS.email + STANDARD_TIME_SECONDS.discussion;
  const tickerText = "⚠ CHALLENGE MODE ACTIVE · REDUCED TIME LIMITS · PROVE YOUR SKILLS UNDER PRESSURE · NO MERCY · ";

  /* shared card base for sidebar */
  const sideCard = (extra) => ({
    background: isChallenge ? CH.card : T.card,
    border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`,
    borderRadius: 14,
    boxShadow: isChallenge ? "none" : T.shadow,
    overflow: "hidden",
    ...extra,
  });

  /* staggered animation helper */
  const fa = (ms) => ({ animation: `fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) ${ms}ms both` });

  /* ── renders one task card (Link), used in the 2×2 grid ── */
  function renderTaskCard(opts) {
    const { k, href, acc, n, t, d, it, timeSec, stdSec, chSec, isMock = false } = opts;
    const isHover = hoverKey === k;
    const cardLink = (
      <Link
        href={href}
        onMouseEnter={() => setHoverKey(k)}
        onMouseLeave={() => setHoverKey("")}
        style={{
          flex: 1, display: "flex", alignItems: "stretch", position: "relative",
          textDecoration: "none", color: "inherit",
          background: isChallenge
            ? (isMock ? "linear-gradient(180deg,#14101c 0%,#1a0e16 100%)" : CH.card)
            : (isMock ? T.primarySoft : T.card),
          border: isChallenge
            ? "none"
            : `1px solid ${isHover ? acc.color + "90" : (isMock ? T.primary + "50" : T.bdr)}`,
          borderRadius: isMock && isChallenge ? 10 : 12,
          overflow: "hidden", cursor: "pointer",
          transform: isHover ? "translateY(-2px)" : "translateY(0)",
          boxShadow: isHover
            ? (isChallenge ? "0 6px 20px rgba(255,30,30,0.2)" : `0 6px 18px ${acc.color}28`)
            : (isMock
              ? (isChallenge ? "0 2px 12px rgba(255,30,30,0.15)" : `0 2px 8px ${T.primary}18`)
              : T.shadow),
          transition: "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease",
        }}
      >
        {/* Accent bar */}
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
          background: isChallenge ? CH.accent : acc.color,
          opacity: isMock ? (isChallenge ? 0 : 0.45) : (isHover ? 1 : 0),
          transition: "opacity 150ms ease",
          borderRadius: isMock && isChallenge ? "10px 0 0 10px" : "12px 0 0 12px",
        }} />

        {/* Time column */}
        <div style={{
          width: 68, minWidth: 68, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          background: isChallenge ? CH.timeBg : (isMock ? `${T.primary}18` : acc.soft),
          padding: "12px 4px", gap: isChallenge ? 3 : 0,
        }}>
          {isChallenge ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 800, color: CH.accent, animation: "ch-pulse 2s ease-in-out infinite", whiteSpace: "nowrap" }}>
                {formatMinutesLabel(isChallenge ? chSec : timeSec)}
              </div>
              <div style={{ fontSize: 10, color: CH.t2, textDecoration: "line-through", whiteSpace: "nowrap" }}>
                {formatMinutesLabel(stdSec)}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 17, fontWeight: 800, color: acc.color, whiteSpace: "nowrap" }}>
              {formatMinutesLabel(timeSec)}
            </div>
          )}
        </div>

        {/* Gradient divider */}
        <div style={{
          width: 1, flexShrink: 0,
          background: isChallenge ? CH.cardBorder : `linear-gradient(to bottom, transparent, ${acc.color}45, transparent)`,
        }} />

        {/* Content */}
        <div style={{ padding: "14px 16px 14px 18px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: 11, color: isChallenge ? CH.accent : acc.color, fontWeight: 700, marginBottom: 3, letterSpacing: 0.3 }}>
            {isChallenge && isMock ? "🔥 " : ""}{n}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: isChallenge ? CH.t1 : T.t1, marginBottom: 3, lineHeight: 1.3 }}>{t}</div>
          <div style={{ fontSize: 12, color: isChallenge ? CH.t2 : T.t2, lineHeight: 1.4 }}>{d}</div>
        </div>

        {/* Meta tag */}
        <div style={{ padding: "14px 14px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", gap: 6 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
            color: isChallenge ? (isMock ? CH.accent : CH.t2) : acc.color,
            background: isChallenge ? (isMock ? "rgba(255,30,30,0.1)" : "rgba(255,255,255,0.05)") : acc.soft,
            borderRadius: 6, padding: "3px 7px",
            border: `1px solid ${isChallenge ? (isMock ? "rgba(255,30,30,0.2)" : "rgba(255,255,255,0.08)") : acc.color + "30"}`,
          }}>{it}</div>
          {isChallenge && isMock && (
            <div style={{ fontSize: 10, color: CH.accent, fontWeight: 700, animation: "ch-pulse 1.5s ease-in-out infinite" }}>🔥 Challenge</div>
          )}
          <div style={{ color: isChallenge ? CH.accent : acc.color, fontSize: 15, lineHeight: 1 }}>›</div>
        </div>
      </Link>
    );

    /* challenge mock wraps in gradient border */
    if (isChallenge && isMock) {
      return (
        <div style={{
          flex: 1, display: "flex",
          borderRadius: 12, padding: 2,
          background: "linear-gradient(90deg,#ff2222,#ff6600,#ff2222,#cc0000)",
          backgroundSize: "300% 100%",
          animation: "ch-gradRot 3s ease infinite",
        }}>
          {cardLink}
        </div>
      );
    }
    return cardLink;
  }

  /* ── 4 grid items ── */
  const gridItems = [
    ...PRACTICE_TASKS.map((c, i) => ({
      k: c.k, href: `/${c.k}${querySuffix}`,
      acc: TASK_ACCENTS[i], n: c.n, t: c.t, d: c.d, it: c.it,
      timeSec: getTaskTimeSeconds(c.modeKey, mode),
      stdSec: STANDARD_TIME_SECONDS[c.modeKey] || 0,
      chSec: getTaskTimeSeconds(c.modeKey, PRACTICE_MODE.CHALLENGE),
      delay: 190 + i * 70,
    })),
    {
      k: MOCK.k, href: `/${MOCK.k}${querySuffix}`,
      acc: { color: T.primary, soft: T.primarySoft }, n: MOCK.n, t: MOCK.t,
      d: "Task 1 + Task 2 + Task 3 · Full writing section", it: MOCK.it,
      timeSec: mockTotalSec, stdSec: mockStdSec, chSec: mockChSec,
      isMock: true, delay: 400,
    },
  ];

  return (
    <>
      <style>{PAGE_CSS}</style>

      {/* Challenge global layers */}
      {isChallenge && <ParticleField />}
      {isChallenge && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.7) 100%)", pointerEvents: "none", zIndex: 1, animation: "ch-vignette 6s ease-in-out infinite" }} />
      )}
      {isChallenge && (
        <>
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,transparent,${CH.accent},transparent)`, zIndex: 2, pointerEvents: "none", animation: "ch-glowPulse 3s ease-in-out infinite" }} />
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,transparent,${CH.accent},transparent)`, zIndex: 2, pointerEvents: "none", animation: "ch-glowPulse 3s ease-in-out infinite" }} />
          <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, width: 2, background: `linear-gradient(180deg,transparent,${CH.accent},transparent)`, zIndex: 2, pointerEvents: "none", animation: "ch-glowPulse 3s ease-in-out infinite" }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 2, background: `linear-gradient(180deg,transparent,${CH.accent},transparent)`, zIndex: 2, pointerEvents: "none", animation: "ch-glowPulse 3s ease-in-out infinite" }} />
        </>
      )}
      {crtFlash && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "#fff", zIndex: 9999, pointerEvents: "none", animation: "ch-crtFlash .4s ease-out forwards" }} />
      )}

      {/* ── Wrapper ── */}
      <div style={{
        minHeight: "100vh",
        background: isChallenge ? CH.bg : T.bg,
        fontFamily: JFONT,
        position: "relative",
        zIndex: 3,
        animation: shaking ? "ch-screenShake .35s ease-out" : "none",
        transition: "background .3s ease",
      }}>

        {/* ── Sticky Navbar ── */}
        {isChallenge ? (
          <div style={{
            position: "sticky", top: 0, zIndex: 10,
            background: CH.nav, color: "#fff",
            padding: "0 36px", height: 52,
            display: "flex", alignItems: "center",
            borderBottom: `3px solid ${CH.navBorder}`,
            overflow: "hidden",
          }}>
            <span style={{ fontWeight: 700, fontSize: 15, position: "relative", zIndex: 1 }}>TOEFL iBT</span>
            <span style={{ opacity: 0.5, margin: "0 12px", position: "relative", zIndex: 1 }}>|</span>
            <span style={{ fontSize: 13, position: "relative", zIndex: 1 }}>Writing Section 2026</span>
            <div style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: CH.accent, letterSpacing: 1, textTransform: "uppercase", position: "relative", zIndex: 1 }}>CHALLENGE</div>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", background: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,0.03) 2px,rgba(255,255,255,0.03) 4px)", zIndex: 0 }} />
            <div style={{ position: "absolute", top: 0, bottom: 0, width: "30%", background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)", animation: "ch-sweep 4s ease-in-out infinite", pointerEvents: "none", zIndex: 0 }} />
          </div>
        ) : (
          <div style={{
            position: "sticky", top: 0, zIndex: 10,
            height: 52, display: "flex", alignItems: "center",
            padding: "0 36px",
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(12px)",
            borderBottom: `1px solid ${T.bdrSubtle}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#087355,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 800 }}>T</span>
              </div>
              <span style={{ fontWeight: 700, fontSize: 15, color: T.t1 }}>TOEFL Writing</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.primary, background: T.primarySoft, border: `1px solid ${T.primaryMist}`, borderRadius: 5, padding: "1px 6px", letterSpacing: 0.3 }}>2026</span>
            </div>
            <div style={{ marginLeft: "auto", fontSize: 12, color: T.t3 }}>Powered by DeepSeek AI</div>
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

        {/* ── Body ── */}
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 36px 60px", display: "flex", gap: 28, alignItems: "flex-start" }}>

          {/* ──────────── LEFT SIDEBAR ──────────── */}
          <div style={{ width: 240, minWidth: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, position: "sticky", top: 80, alignSelf: "flex-start" }}>

            {/* Card 1: User info */}
            <div style={{ ...sideCard({ padding: "20px 18px" }), ...fa(100) }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#087355,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14, flexShrink: 0 }}>
                <span style={{ color: "#fff", fontSize: 20, fontWeight: 800 }}>T</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: isChallenge ? CH.t2 : T.t3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>登录码</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: isChallenge ? CH.t1 : T.t1, fontVariantNumeric: "tabular-nums", letterSpacing: "0.05em", fontFamily: "monospace" }}>
                  {userCode || "—"}
                </span>
                {userCode && (
                  <button
                    onClick={copyCode}
                    style={{
                      border: `1px solid ${copied ? T.primary : (isChallenge ? CH.cardBorder : T.bdr)}`,
                      background: copied ? T.primarySoft : (isChallenge ? "rgba(255,255,255,0.05)" : T.bg),
                      color: copied ? T.primary : (isChallenge ? CH.t2 : T.t2),
                      borderRadius: 6, padding: "2px 7px", fontSize: 11, fontWeight: 600,
                      cursor: "pointer", transition: "all .15s", fontFamily: JFONT,
                    }}
                  >
                    {copied ? "✓" : "复制"}
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: isChallenge ? CH.t2 : T.t3, lineHeight: 1.5, marginBottom: 14 }}>
                请保存此码，用于登录和同步数据
              </div>
              <button
                onClick={onLogout}
                onMouseEnter={() => setLogoutHover(true)}
                onMouseLeave={() => setLogoutHover(false)}
                style={{
                  width: "100%", padding: "8px 0", fontSize: 12, fontWeight: 600,
                  border: `1px solid ${logoutHover ? T.rose : (isChallenge ? CH.cardBorder : T.bdr)}`,
                  color: logoutHover ? T.rose : (isChallenge ? CH.t2 : T.t2),
                  background: logoutHover ? T.roseSoft : "transparent",
                  borderRadius: 8, cursor: "pointer", transition: "all .15s", fontFamily: JFONT,
                }}
              >
                退出登录
              </button>
            </div>

            {/* Card 2: Feedback (collapsible) */}
            <div style={{ ...sideCard({}), ...fa(180) }}>
              <button
                onClick={() => setFbOpen((v) => !v)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "14px 18px", background: "transparent", border: "none",
                  cursor: "pointer", fontFamily: JFONT, textAlign: "left",
                }}
              >
                <span style={{ fontSize: 14 }}>💡</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: isChallenge ? CH.t1 : T.t1, flex: 1 }}>反馈建议</span>
                <span style={{ fontSize: 11, color: isChallenge ? CH.t2 : T.t3, display: "inline-block", transform: fbOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.25s ease" }}>▾</span>
              </button>
              <div style={{ maxHeight: fbOpen ? 220 : 0, overflow: "hidden", transition: "max-height 0.35s cubic-bezier(0.25,1,0.5,1)" }}>
                <div style={{ padding: "0 18px 16px" }}>
                  <textarea
                    value={fbText}
                    onChange={(e) => { setFbText(e.target.value); if (fbSent) setFbSent(false); }}
                    placeholder="遇到了什么问题？有什么改进建议？"
                    style={{
                      width: "100%", height: 80, resize: "none",
                      background: isChallenge ? "rgba(255,255,255,0.04)" : T.bg,
                      border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`,
                      borderRadius: 8, padding: "8px 10px",
                      fontSize: 12, lineHeight: 1.5,
                      color: isChallenge ? CH.t1 : T.t1,
                      fontFamily: JFONT, outline: "none", boxSizing: "border-box",
                      transition: "border-color .15s",
                    }}
                    onFocus={(e) => { e.target.style.borderColor = T.primary; }}
                    onBlur={(e) => { e.target.style.borderColor = isChallenge ? CH.cardBorder : T.bdr; }}
                  />
                  <button
                    onClick={submitFeedback}
                    disabled={!fbText.trim() || fbBusy || fbSent}
                    style={{
                      width: "100%", marginTop: 8, padding: "8px 0", fontSize: 12, fontWeight: 700,
                      borderRadius: 8, border: "none",
                      cursor: fbText.trim() && !fbBusy && !fbSent ? "pointer" : "default",
                      background: fbSent ? T.primarySoft : (fbText.trim() ? T.primary : (isChallenge ? "rgba(255,255,255,0.07)" : T.bg)),
                      color: fbSent ? T.primary : (fbText.trim() ? "#fff" : (isChallenge ? CH.t2 : T.t3)),
                      transition: "all .15s", fontFamily: JFONT,
                    }}
                  >
                    {fbSent ? "✓ 已提交，感谢！" : fbBusy ? "提交中..." : "提交"}
                  </button>
                </div>
              </div>
            </div>

            {/* Card 3: Practice overview */}
            <div style={{ ...sideCard({ padding: "16px 18px" }), ...fa(260) }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: isChallenge ? CH.t2 : T.t3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                练习概览
              </div>
              {[
                { label: "总练习", value: totalCount > 0 ? String(totalCount) : "—", color: T.primary },
                { label: "本周", value: String(weekCount), color: T.cyan },
                { label: "最佳模考", value: bestMock !== null ? `Band ${bestMock.toFixed(1)}` : "—", color: T.amber },
              ].map(({ label, value, color }, i) => (
                <div key={label}>
                  {i > 0 && <div style={{ height: 1, background: isChallenge ? CH.cardBorder : T.bdrSubtle, margin: "9px 0" }} />}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: isChallenge ? CH.t2 : T.t2 }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: isChallenge ? CH.t1 : color, fontVariantNumeric: "tabular-nums" }}>{value}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ──────────── MAIN CONTENT ──────────── */}
          <div style={{ flex: 1, minWidth: 0 }}>

            {/* Hero */}
            <div style={{ marginBottom: 16, ...fa(50) }}>
              <h1 style={{ margin: "0 0 10px", fontSize: 30, fontWeight: 800, color: isChallenge ? CH.t1 : T.t1, letterSpacing: -0.5, lineHeight: 1.2 }}>
                {isChallenge
                  ? <>TOEFL iBT Writing — <span style={{ color: CH.accent }}>Challenge Mode</span></>
                  : "TOEFL iBT Writing Practice"}
              </h1>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <p style={{ margin: 0, fontSize: 13, color: isChallenge ? CH.accent : T.t2, fontWeight: isChallenge ? 600 : 400 }}>
                  {isChallenge
                    ? "Prove your skills under pressure. Reduced time. No mercy."
                    : "ETS 风格计时 · AI 评分反馈 · 全部 3 种题型"}
                </p>
                {/* Mode toggle */}
                <div style={{
                  display: "inline-flex", gap: 4, flexShrink: 0,
                  background: isChallenge ? "rgba(255,255,255,0.05)" : T.card,
                  border: `1px solid ${isChallenge ? "rgba(255,30,30,0.3)" : T.bdr}`,
                  borderRadius: 999, padding: 4,
                  boxShadow: T.shadow,
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
            </div>

            {/* Info strip */}
            <div style={{
              background: isChallenge ? "rgba(17,17,24,0.7)" : T.card,
              border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`,
              borderRadius: 10, padding: "10px 16px", marginBottom: 16,
              boxShadow: isChallenge ? "none" : T.shadow,
              ...fa(120),
            }}>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: isChallenge ? CH.t2 : T.t2 }}>
                <span>· 覆盖 2026 TOEFL iBT Writing 全部题型</span>
                <span>· ETS 风格限时</span>
                <span>· AI 批改与反馈</span>
                <span>· 仅供练习，非官方评分</span>
              </div>
            </div>

            {/* ── 2×2 Task grid ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              {gridItems.map((item) => (
                <div key={item.k} style={{ display: "flex", ...fa(item.delay) }}>
                  {renderTaskCard(item)}
                </div>
              ))}
            </div>

            {/* IAP card (flag-protected) */}
            {IAP_ENABLED && (
              <div style={{ marginBottom: 12, ...fa(440) }}>
                <Link
                  href="/iap"
                  onMouseEnter={() => setHoverKey("iap")}
                  onMouseLeave={() => setHoverKey("")}
                  style={{
                    display: "flex", alignItems: "stretch", position: "relative",
                    textDecoration: "none", color: "inherit",
                    background: isChallenge ? CH.card : T.card,
                    border: `1px solid ${hoverKey === "iap" ? "#f59e0b" : (isChallenge ? CH.cardBorder : T.bdr)}`,
                    borderRadius: 12, overflow: "hidden", cursor: "pointer",
                    transform: hoverKey === "iap" ? "translateY(-2px)" : "none",
                    boxShadow: hoverKey === "iap" ? "0 4px 14px rgba(245,158,11,0.15)" : T.shadow,
                    transition: "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease",
                  }}
                >
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "#f59e0b", opacity: hoverKey === "iap" ? 1 : 0, transition: "opacity 150ms ease", borderRadius: "12px 0 0 12px" }} />
                  <div style={{ width: 68, minWidth: 68, display: "flex", alignItems: "center", justifyContent: "center", background: "#fef3c7", padding: "12px 4px" }}>
                    <span style={{ fontSize: 24 }}>💳</span>
                  </div>
                  <div style={{ width: 1, background: "#f59e0b40", flexShrink: 0 }} />
                  <div style={{ padding: "14px 16px 14px 18px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ fontSize: 11, color: "#92400e", fontWeight: 700, marginBottom: 3 }}>PRIVATE</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: T.t1, marginBottom: 3, lineHeight: 1.3 }}>In-App Purchase</div>
                    <div style={{ fontSize: 12, color: T.t2 }}>Private staging workspace for payment flow.</div>
                  </div>
                  <div style={{ padding: "14px 14px", display: "flex", alignItems: "center" }}>
                    <div style={{ color: "#d97706", fontSize: 15 }}>›</div>
                  </div>
                </Link>
              </div>
            )}

            {/* Progress card */}
            <div style={{ marginBottom: 28, ...fa(IAP_ENABLED ? 480 : 440) }}>
              <Link
                href="/progress"
                onMouseEnter={() => setHoverKey("progress")}
                onMouseLeave={() => setHoverKey("")}
                style={{
                  display: "flex", alignItems: "stretch", position: "relative",
                  textDecoration: "none", color: "inherit",
                  background: isChallenge ? CH.card : T.card,
                  border: `1px solid ${hoverKey === "progress" ? (isChallenge ? "rgba(134,239,172,0.4)" : T.primary + "80") : (isChallenge ? CH.cardBorder : T.bdr)}`,
                  borderRadius: 12, overflow: "hidden", cursor: "pointer",
                  transform: hoverKey === "progress" ? "translateY(-2px)" : "none",
                  boxShadow: hoverKey === "progress" ? `0 4px 14px ${T.primary}22` : T.shadow,
                  transition: "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease",
                }}
              >
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: isChallenge ? "#4ade80" : T.primary, opacity: hoverKey === "progress" ? 1 : 0, transition: "opacity 150ms ease", borderRadius: "12px 0 0 12px" }} />
                <div style={{ width: 68, minWidth: 68, display: "flex", alignItems: "center", justifyContent: "center", background: isChallenge ? "rgba(22,101,52,0.15)" : T.primarySoft, padding: "12px 4px" }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: isChallenge ? "rgba(22,101,52,0.3)" : `${T.primary}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 22 }}>📊</span>
                  </div>
                </div>
                <div style={{ width: 1, background: isChallenge ? CH.cardBorder : `${T.primary}30`, flexShrink: 0 }} />
                <div style={{ padding: "14px 16px 14px 18px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ fontSize: 11, color: isChallenge ? "#4ade80" : T.primaryDeep, fontWeight: 700, marginBottom: 3 }}>PROGRESS</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: isChallenge ? CH.t1 : T.t1, marginBottom: 3, lineHeight: 1.3 }}>Practice History</div>
                  <div style={{ fontSize: 12, color: isChallenge ? CH.t2 : T.t2 }}>
                    {sessions.length > 0 ? `${sessions.length} 次练习已记录，查看进度与薄弱点` : "跟踪练习趋势，发现薄弱环节"}
                  </div>
                </div>
                <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", gap: 6 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                    color: isChallenge ? "#4ade80" : T.primaryDeep,
                    background: isChallenge ? "rgba(22,101,52,0.2)" : T.primarySoft,
                    borderRadius: 6, padding: "3px 8px",
                    border: `1px solid ${isChallenge ? "rgba(74,222,128,0.2)" : T.primary + "30"}`,
                  }}>{sessions.length > 0 ? `${sessions.length} 次` : "0 次"}</div>
                  <div style={{ color: isChallenge ? "#4ade80" : T.primary, fontSize: 15 }}>›</div>
                </div>
              </Link>
            </div>

            {/* Footer */}
            <div style={{ fontSize: 10, color: isChallenge ? CH.t2 : T.t3, opacity: 0.65, lineHeight: 1.6, textAlign: "center", ...fa(IAP_ENABLED ? 520 : 480) }}>
              This tool is an independent practice resource not affiliated with ETS or the TOEFL program. TOEFL® is a registered trademark of ETS. AI scoring is for self-study reference only.
            </div>
          </div>
        </div>
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
