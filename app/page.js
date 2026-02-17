"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { C, FONT } from "../components/shared/ui";
import { loadHist, SESSION_STORE_EVENTS } from "../lib/sessionStore";
import { formatMinutesLabel, getTaskTimeSeconds, normalizePracticeMode, PRACTICE_MODE, STANDARD_TIME_SECONDS } from "../lib/practiceMode";
import { normalizeReportLanguage, REPORT_LANGUAGE } from "../lib/reportLanguage";

/* ───── Challenge theme palette ───── */
const CH = {
  bg: "#0a0a12",
  card: "#111118",
  cardBorder: "#2a1525",
  t1: "#e8e8ec",
  t2: "#8888a0",
  accent: "#ff2222",
  accentDim: "#991515",
  glow: "rgba(255,30,30,0.6)",
  glowDim: "rgba(255,30,30,0.12)",
  nav: "#0d0d14",
  navBorder: "#ff2222",
  timeBg: "#1a0a10",
  blue: "#4488ff",
};

/* ───── CSS keyframes (injected once when challenge is active) ───── */
const CHALLENGE_CSS = `
@keyframes ch-crtFlash{0%{opacity:0}5%{opacity:1}100%{opacity:0}}
@keyframes ch-screenShake{0%,100%{transform:translateX(0)}10%{transform:translateX(-3px)}20%{transform:translateX(3px)}30%{transform:translateX(-2px)}40%{transform:translateX(2px)}50%{transform:translateX(-1px)}60%{transform:translateX(1px)}70%{transform:translateX(0)}}
@keyframes ch-vignette{0%,100%{opacity:.7}50%{opacity:.4}}
@keyframes ch-glowPulse{0%,100%{opacity:.8}50%{opacity:.3}}
@keyframes ch-ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
@keyframes ch-scanline{0%{top:-2px}100%{top:100%}}
@keyframes ch-sweep{0%{left:-30%}100%{left:130%}}
@keyframes ch-gradRot{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes ch-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
@keyframes ch-flicker{0%{opacity:0;filter:brightness(3)}30%{opacity:1;filter:brightness(1.5)}50%{opacity:.8;filter:brightness(1)}70%{opacity:1;filter:brightness(1.2)}100%{opacity:1;filter:brightness(1)}}
@keyframes ch-borderGlow{0%,100%{box-shadow:0 0 8px rgba(255,30,30,.25),inset 0 0 8px rgba(255,30,30,.08)}50%{box-shadow:0 0 18px rgba(255,30,30,.45),inset 0 0 12px rgba(255,30,30,.12)}}
`;

/* ───── Particle field (canvas) ───── */
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

/* ───── Static data ───── */
const PRACTICE_TASKS = [
  { k: "build-sentence", modeKey: "build", n: "Task 1", t: "Build a Sentence", d: "Reorder words to form a grammatically correct response.", it: "10 questions" },
  { k: "email-writing", modeKey: "email", n: "Task 2", t: "Write an Email", d: "Respond appropriately to a workplace situation.", it: "80-120 words" },
  { k: "academic-writing", modeKey: "discussion", n: "Task 3", t: "Academic Discussion", d: "Respond to an academic discussion prompt.", it: "100+ words" },
];
const MOCK_TASK = { k: "mock-exam", n: "Full Writing Section", t: "Mock Exam Mode", d: "Simulated exam environment", it: "Task 1 + Task 2 + Task 3" };

/* ───── Helpers ───── */
function timeBadge(time, bg = "#e8f0fe", color = C.nav) {
  return (
    <div style={{ width: 90, minWidth: 90, display: "flex", alignItems: "center", justifyContent: "center", background: bg, borderRight: "1px solid " + C.bdr, padding: "8px 4px" }}>
      <div style={{ fontSize: 22, lineHeight: 1, fontWeight: 800, color, whiteSpace: "nowrap" }}>{time}</div>
    </div>
  );
}

function challengeTimeBadge(standardSec, challengeSec) {
  return (
    <div style={{ width: 90, minWidth: 90, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: CH.timeBg, borderRight: "1px solid " + CH.cardBorder, padding: "6px 4px", gap: 2 }}>
      <div style={{ fontSize: 20, lineHeight: 1, fontWeight: 800, color: CH.accent, whiteSpace: "nowrap", animation: "ch-pulse 2s ease-in-out infinite" }}>
        {formatMinutesLabel(challengeSec)}
      </div>
      <div style={{ fontSize: 11, lineHeight: 1, color: CH.t2, textDecoration: "line-through", whiteSpace: "nowrap" }}>
        {formatMinutesLabel(standardSec)}
      </div>
    </div>
  );
}

/* ───── Page component ───── */
export default function Page() {
  const [hoverKey, setHoverKey] = useState("");
  const [sessionCount, setSessionCount] = useState(0);
  const [mode, setMode] = useState(PRACTICE_MODE.STANDARD);
  const [reportLanguage, setReportLanguage] = useState(REPORT_LANGUAGE.ZH);
  const [crtFlash, setCrtFlash] = useState(false);
  const [shaking, setShaking] = useState(false);

  const isChallenge = mode === PRACTICE_MODE.CHALLENGE;

  useEffect(() => {
    try {
      const saved = localStorage.getItem("toefl-report-language");
      if (saved) setReportLanguage(normalizeReportLanguage(saved));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem("toefl-report-language", reportLanguage); } catch { /* ignore */ }
  }, [reportLanguage]);

  useEffect(() => {
    const refresh = () => { setSessionCount((loadHist().sessions || []).length); };
    refresh();
    window.addEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
  }, []);

  const historyText = useMemo(() => {
    if (sessionCount > 0) return `${sessionCount} sessions recorded. Review progress and weak areas.`;
    return "Track progress over time and identify weak areas.";
  }, [sessionCount]);

  /* ── Mode switch with CRT flash + screen shake ── */
  function switchMode(newMode) {
    const m = normalizePracticeMode(newMode);
    if (m === mode) return;
    setCrtFlash(true);
    setTimeout(() => { setMode(m); setShaking(true); }, 150);
    setTimeout(() => setCrtFlash(false), 400);
    setTimeout(() => setShaking(false), 600);
  }

  const querySuffix = (() => {
    const p = new URLSearchParams();
    if (isChallenge) p.set("mode", "challenge");
    if (reportLanguage === REPORT_LANGUAGE.EN) p.set("lang", "en");
    const q = p.toString();
    return q ? `?${q}` : "";
  })();

  const mockTotalSeconds = getTaskTimeSeconds("build", mode) + getTaskTimeSeconds("email", mode) + getTaskTimeSeconds("discussion", mode);
  const mockStandardTotal = STANDARD_TIME_SECONDS.build + STANDARD_TIME_SECONDS.email + STANDARD_TIME_SECONDS.discussion;

  /* ── Card base styles ── */
  const cardBase = {
    display: "flex", width: "100%", textAlign: "left",
    background: isChallenge ? CH.card : "#fff",
    border: "1px solid " + (isChallenge ? CH.cardBorder : C.bdr),
    borderRadius: 8, padding: 0, marginBottom: 12, cursor: "pointer",
    overflow: "hidden", fontFamily: FONT, textDecoration: "none",
    color: "inherit", minHeight: 106,
    transition: "box-shadow 120ms ease, transform 120ms ease, border-color 120ms ease",
  };

  const tickerText = "\u26A0 CHALLENGE MODE ACTIVE \u00B7 REDUCED TIME LIMITS \u00B7 PROVE YOUR SKILLS UNDER PRESSURE \u00B7 NO MERCY \u00B7 ";

  return (
    <>
      {/* Challenge-only global layers */}
      {isChallenge && <style>{CHALLENGE_CSS}</style>}
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
        background: isChallenge ? CH.bg : C.bg,
        fontFamily: FONT,
        position: "relative",
        zIndex: 3,
        animation: shaking ? "ch-screenShake .35s ease-out" : "none",
        transition: "background .3s ease",
      }}>
        {/* ── NavBar ── */}
        <div style={{
          background: isChallenge ? CH.nav : C.nav,
          color: "#fff",
          padding: "0 20px",
          height: 48,
          display: "flex",
          alignItems: "center",
          borderBottom: isChallenge ? `3px solid ${CH.navBorder}` : `3px solid ${C.navDk}`,
          position: "relative",
          overflow: "hidden",
          transition: "background .3s, border-color .3s",
        }}>
          <span style={{ fontWeight: 700, fontSize: 15, position: "relative", zIndex: 1 }}>TOEFL iBT</span>
          <span style={{ opacity: 0.5, margin: "0 12px", position: "relative", zIndex: 1 }}>|</span>
          <span style={{ fontSize: 13, position: "relative", zIndex: 1 }}>Writing Section 2026</span>
          {isChallenge && (
            <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: CH.accent, letterSpacing: 1, textTransform: "uppercase", position: "relative", zIndex: 1 }}>
              CHALLENGE
            </span>
          )}
          {/* Scanlines overlay */}
          {isChallenge && (
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none",
              background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)",
              zIndex: 0,
            }} />
          )}
          {/* Sweep light */}
          {isChallenge && (
            <div style={{
              position: "absolute", top: 0, bottom: 0, width: "30%",
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)",
              animation: "ch-sweep 4s ease-in-out infinite",
              pointerEvents: "none", zIndex: 0,
            }} />
          )}
        </div>

        {/* ── Warning ticker ── */}
        {isChallenge && (
          <div style={{ overflow: "hidden", background: "rgba(255,20,20,0.06)", borderBottom: "1px solid rgba(255,30,30,0.25)", padding: "5px 0" }}>
            <div style={{ display: "flex", whiteSpace: "nowrap", animation: "ch-ticker 25s linear infinite", fontSize: 11, fontWeight: 700, color: CH.accent, letterSpacing: 2, textTransform: "uppercase", fontFamily: "Consolas,monospace" }}>
              <span>{tickerText}{tickerText}{tickerText}{tickerText}</span>
            </div>
          </div>
        )}

        {/* ── Content ── */}
        <div style={{ maxWidth: 800, margin: "32px auto", padding: "0 20px" }}>
          {/* Header card */}
          <div style={{
            background: isChallenge ? "rgba(17,17,24,0.85)" : "#fff",
            backdropFilter: isChallenge ? "blur(8px)" : "none",
            border: isChallenge ? `1px solid ${CH.cardBorder}` : `1px solid ${C.bdr}`,
            borderRadius: 6,
            padding: "32px 40px",
            marginBottom: 24,
            textAlign: "center",
            transition: "background .3s, border-color .3s",
            animation: isChallenge ? "ch-borderGlow 3s ease-in-out infinite" : "none",
          }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: isChallenge ? CH.t1 : C.nav, transition: "color .3s" }}>
              {isChallenge ? "TOEFL iBT Writing \u2014 Challenge Mode" : "TOEFL iBT Writing Practice (2026)"}
            </h1>
            <p style={{ color: isChallenge ? CH.accent : C.t2, fontSize: 14, margin: "8px 0 0", fontWeight: isChallenge ? 600 : 400, transition: "color .3s" }}>
              {isChallenge ? "Prove your skills under pressure. Reduced time. No mercy." : "ETS-style timing & AI feedback for all 3 tasks"}
            </p>

            {/* Mode toggle */}
            <div style={{ display: "inline-flex", gap: 8, background: isChallenge ? "rgba(255,255,255,0.05)" : "#f8fafc", border: "1px solid " + (isChallenge ? "rgba(255,30,30,0.3)" : "#cbd5e1"), borderRadius: 999, marginTop: 14, padding: 4, transition: "background .3s, border-color .3s" }}>
              {[
                { value: PRACTICE_MODE.STANDARD, label: "Standard" },
                { value: PRACTICE_MODE.CHALLENGE, label: "\uD83D\uDD25 Challenge" },
              ].map((opt) => {
                const sel = mode === opt.value;
                const isCh = opt.value === PRACTICE_MODE.CHALLENGE;
                return (
                  <button
                    key={opt.value}
                    onClick={() => switchMode(opt.value)}
                    style={{
                      border: "1px solid " + (sel ? (isCh ? CH.accent : C.blue) : "transparent"),
                      background: sel ? (isCh ? "rgba(255,30,30,0.15)" : "#e8f0fe") : "transparent",
                      color: sel ? (isCh ? CH.accent : C.nav) : (isChallenge ? CH.t2 : C.t2),
                      borderRadius: 999, padding: "4px 12px", fontSize: 12,
                      fontWeight: 700, cursor: "pointer", transition: "all .15s",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Language toggle */}
            <div style={{ display: "inline-flex", gap: 8, background: isChallenge ? "rgba(255,255,255,0.05)" : "#f8fafc", border: "1px solid " + (isChallenge ? "rgba(255,255,255,0.1)" : "#cbd5e1"), borderRadius: 999, marginTop: 10, padding: 4, transition: "background .3s, border-color .3s" }}>
              {[
                { value: REPORT_LANGUAGE.ZH, label: "\u4E2D\u6587" },
                { value: REPORT_LANGUAGE.EN, label: "English" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setReportLanguage(normalizeReportLanguage(opt.value))}
                  style={{
                    border: "1px solid " + (reportLanguage === opt.value ? (isChallenge ? CH.blue : C.blue) : "transparent"),
                    background: reportLanguage === opt.value ? (isChallenge ? "rgba(68,136,255,0.12)" : "#e8f0fe") : "transparent",
                    color: reportLanguage === opt.value ? (isChallenge ? CH.blue : C.nav) : (isChallenge ? CH.t2 : C.t2),
                    borderRadius: 999, padding: "4px 12px", fontSize: 12,
                    fontWeight: 700, cursor: "pointer", transition: "all .15s",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Task cards ── */}
          {PRACTICE_TASKS.map((c) => {
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
                  ...cardBase,
                  borderColor: hover
                    ? (isChallenge ? "rgba(255,30,30,0.5)" : "#94a3b8")
                    : (isChallenge ? CH.cardBorder : C.bdr),
                  boxShadow: hover
                    ? (isChallenge ? "0 4px 18px rgba(255,30,30,0.2)" : "0 4px 14px rgba(0,51,102,0.12)")
                    : (isChallenge ? "0 0 0 transparent" : "none"),
                  transform: hover ? "translateY(-1px)" : "none",
                }}
              >
                {isChallenge
                  ? challengeTimeBadge(stdSec, chSec)
                  : timeBadge(formatMinutesLabel(getTaskTimeSeconds(c.modeKey, mode)))
                }
                <div style={{ padding: "14px 16px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ fontSize: 11, color: isChallenge ? CH.accent : "#6b7280", fontWeight: 600, marginBottom: 3 }}>{c.n}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: isChallenge ? CH.t1 : C.t1, marginBottom: 4, lineHeight: 1.2 }}>{c.t}</div>
                  <div style={{ fontSize: 13, color: isChallenge ? CH.t2 : C.t2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.d}</div>
                </div>
                <div style={{ padding: "14px 12px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", borderLeft: "1px solid " + (isChallenge ? CH.cardBorder : C.bdr), minWidth: 108 }}>
                  <div style={{ fontSize: 12, color: isChallenge ? CH.t2 : C.t2, whiteSpace: "nowrap" }}>{c.it}</div>
                  <div style={{ color: isChallenge ? CH.accent : C.blue, fontSize: 18, lineHeight: 1, marginTop: 4 }}>&gt;</div>
                </div>
              </Link>
            );
          })}

          {/* ── Mock Exam card ── */}
          <div
            onMouseEnter={() => setHoverKey(MOCK_TASK.k)}
            onMouseLeave={() => setHoverKey("")}
            style={{
              position: "relative",
              marginBottom: 16,
              borderRadius: 10,
              padding: isChallenge ? 2 : 0,
              background: isChallenge
                ? "linear-gradient(90deg, #ff2222, #ff6600, #ff2222, #cc0000)"
                : "transparent",
              backgroundSize: isChallenge ? "300% 100%" : "auto",
              animation: isChallenge ? "ch-gradRot 3s ease infinite" : "none",
            }}
          >
            <Link
              href={`/${MOCK_TASK.k}${querySuffix}`}
              style={{
                ...cardBase,
                marginBottom: 0,
                borderRadius: 8,
                border: isChallenge
                  ? "none"
                  : ("2px solid " + (hoverKey === MOCK_TASK.k ? C.nav : "#2f528a")),
                boxShadow: hoverKey === MOCK_TASK.k
                  ? (isChallenge ? "0 6px 24px rgba(255,30,30,0.3)" : "0 6px 18px rgba(0,51,102,0.2)")
                  : (isChallenge ? "0 2px 12px rgba(255,30,30,0.15)" : "0 2px 10px rgba(0,51,102,0.12)"),
                background: isChallenge
                  ? "linear-gradient(180deg, #14101c 0%, #1a0e16 100%)"
                  : "linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%)",
              }}
            >
              {isChallenge
                ? challengeTimeBadge(mockStandardTotal, mockTotalSeconds)
                : timeBadge(formatMinutesLabel(mockTotalSeconds), "#dbeafe", C.nav)
              }
              <div style={{ padding: "14px 16px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ fontSize: 11, color: isChallenge ? CH.accent : "#334155", fontWeight: 700, marginBottom: 3 }}>
                  {isChallenge ? "\uD83D\uDD25 " : ""}{MOCK_TASK.n}
                </div>
                <div style={{
                  fontSize: 18, fontWeight: 800,
                  color: isChallenge ? CH.t1 : C.nav,
                  marginBottom: 4, lineHeight: 1.2,
                }}>
                  {MOCK_TASK.t}
                </div>
                <div style={{ fontSize: 13, color: isChallenge ? CH.t2 : "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  Full TOEFL iBT Writing Section
                </div>
                <div style={{ fontSize: 12, color: isChallenge ? CH.t2 : "#475569", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {`${formatMinutesLabel(mockTotalSeconds)} | Task 1 + Task 2 + Task 3`}
                </div>
                <div style={{ fontSize: 12, color: isChallenge ? CH.t2 : "#475569", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {MOCK_TASK.d}
                </div>
              </div>
              <div style={{
                padding: "14px 12px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end",
                borderLeft: "1px solid " + (isChallenge ? CH.cardBorder : "#bfdbfe"),
                minWidth: 108,
              }}>
                <div style={{ fontSize: 12, color: isChallenge ? CH.t2 : "#334155", whiteSpace: "nowrap" }}>{MOCK_TASK.it}</div>
                {isChallenge && (
                  <div style={{ fontSize: 11, color: CH.accent, fontWeight: 700, marginTop: 4, animation: "ch-pulse 1.5s ease-in-out infinite" }}>
                    \uD83D\uDD25 Challenge
                  </div>
                )}
                {!isChallenge && mode === PRACTICE_MODE.CHALLENGE && (
                  <div style={{ fontSize: 11, color: C.red, fontWeight: 700, marginTop: 4 }}>Challenge</div>
                )}
                <div style={{ color: isChallenge ? CH.accent : C.nav, fontSize: 18, lineHeight: 1, marginTop: 4 }}>&gt;</div>
              </div>
            </Link>
          </div>

          {/* ── Progress card ── */}
          <Link
            href="/progress"
            onMouseEnter={() => setHoverKey("progress")}
            onMouseLeave={() => setHoverKey("")}
            style={{
              ...cardBase,
              marginTop: 8,
              borderColor: hoverKey === "progress"
                ? (isChallenge ? "rgba(134,239,172,0.4)" : "#86efac")
                : (isChallenge ? CH.cardBorder : C.bdr),
              boxShadow: hoverKey === "progress"
                ? (isChallenge ? "0 4px 14px rgba(22,163,74,0.1)" : "0 4px 14px rgba(22,163,74,0.15)")
                : "none",
              transform: hoverKey === "progress" ? "translateY(-1px)" : "none",
            }}
          >
            <div style={{
              width: 90, minWidth: 90, display: "flex", alignItems: "center", justifyContent: "center",
              background: isChallenge ? "rgba(22,101,52,0.15)" : "#dcfce7",
              borderRight: "1px solid " + (isChallenge ? CH.cardBorder : C.bdr),
              padding: "8px 4px",
            }}>
              <div style={{ fontSize: 20, lineHeight: 1, fontWeight: 800, color: isChallenge ? "#4ade80" : "#166534", whiteSpace: "nowrap" }}>Progress</div>
            </div>
            <div style={{ padding: "14px 16px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: isChallenge ? CH.t1 : C.t1, lineHeight: 1.2 }}>Practice History</div>
              <div style={{ fontSize: 13, color: isChallenge ? CH.t2 : C.t2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{historyText}</div>
            </div>
            <div style={{ padding: "14px 12px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", borderLeft: "1px solid " + (isChallenge ? CH.cardBorder : C.bdr), minWidth: 108 }}>
              <div style={{ fontSize: 12, color: isChallenge ? "#4ade80" : "#166534", fontWeight: 700 }}>{sessionCount} sessions</div>
              <div style={{ color: isChallenge ? CH.blue : C.blue, fontSize: 18, lineHeight: 1, marginTop: 4 }}>&gt;</div>
            </div>
          </Link>

          {/* ── Footer info ── */}
          <div style={{
            background: isChallenge ? "rgba(17,17,24,0.7)" : "#fff",
            border: "1px solid " + (isChallenge ? CH.cardBorder : C.bdr),
            borderRadius: 6, padding: "14px 20px", fontSize: 12,
            color: isChallenge ? CH.t2 : C.t2,
            transition: "background .3s, border-color .3s, color .3s",
          }}>
            <b style={{ color: isChallenge ? CH.t1 : C.t1 }}>Powered by DeepSeek AI</b> | ETS-style scoring | Grammar diagnostics | Weakness tracking | AI question generation
          </div>
          <div style={{
            background: isChallenge ? "rgba(17,17,24,0.7)" : "#fff",
            border: "1px solid " + (isChallenge ? CH.cardBorder : C.bdr),
            borderRadius: 6, padding: "14px 20px", marginTop: 12, fontSize: 11,
            color: isChallenge ? CH.t2 : C.t2,
            lineHeight: 1.6,
            transition: "background .3s, border-color .3s, color .3s",
          }}>
            <b style={{ color: isChallenge ? CH.t1 : C.t1 }}>Disclaimer:</b> This tool is an independent practice resource and is not affiliated with, endorsed by, or associated with ETS or the TOEFL program. TOEFL and TOEFL iBT are registered trademarks of ETS. AI scoring is based on publicly available ETS rubric criteria and is intended for self-study reference only. Scores may not reflect actual TOEFL exam results.
          </div>
        </div>
      </div>
    </>
  );
}
