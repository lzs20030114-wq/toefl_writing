"use client";
import React, { useState, useEffect, useMemo, useRef } from "react";
import EM_DATA from "../../data/emailWriting/prompts.json";
import AD_DATA from "../../data/academicWriting/prompts.json";
import { wc } from "../../lib/utils";
import { saveSess, addDoneIds } from "../../lib/sessionStore";
import { callAI, mapScoringError } from "../../lib/ai/client";
import { EMAIL_GEN_PROMPT } from "../../lib/ai/prompts/emailWriting";
import { DISC_GEN_PROMPT } from "../../lib/ai/prompts/academicWriting";
import { BS_GEN_PROMPT } from "../../lib/ai/prompts/buildSentence";
import { evaluateWritingResponse } from "../../lib/ai/writingEval";
import { pickRandomPrompt } from "../../lib/questionSelector";
import { C, FONT, Btn, Toast, TopBar } from "../shared/ui";
import { ScoringReport } from "./ScoringReport";
import { WritingPromptPanel } from "./WritingPromptPanel";
import { WritingResponsePanel } from "./WritingResponsePanel";
import { formatMinutesLabel, PRACTICE_MODE } from "../../lib/practiceMode";
import { normalizeReportLanguage, readReportLanguage } from "../../lib/reportLanguage";

async function aiGen(type) {
  const prompts = {
    buildSentence: BS_GEN_PROMPT,
    email: EMAIL_GEN_PROMPT,
    discussion: DISC_GEN_PROMPT,
  };
  try {
    const raw = await callAI("Generate TOEFL 2026 questions. Output ONLY valid JSON.", prompts[type], 1500, 30000, 0.7);
    return JSON.parse(raw.replace(/```json/g, "").replace(/```/g, "").trim());
  } catch (e) { console.error(e); return null; }
}

function normalizeEmailPrompt(input, fallbackId = "gen-email") {
  if (!input || typeof input !== "object") return null;
  const scenario = String(input.scenario || "").trim();
  const direction = String(input.direction || "").trim();
  const goals = Array.isArray(input.goals)
    ? input.goals.map((g) => String(g || "").trim()).filter(Boolean).slice(0, 3)
    : [];
  if (!scenario || !direction || goals.length < 3) return null;
  return {
    id: String(input.id || fallbackId),
    to: String(input.to || "Professor").trim() || "Professor",
    from: String(input.from || "You").trim() || "You",
    scenario,
    direction,
    goals,
  };
}

function normalizeDiscussionPrompt(input, fallbackId = "gen-discussion") {
  if (!input || typeof input !== "object") return null;
  const professorName = String(input?.professor?.name || "").trim();
  const professorText = String(input?.professor?.text || "").trim();
  const students = Array.isArray(input?.students)
    ? input.students
      .map((s) => ({
        name: String(s?.name || "").trim(),
        text: String(s?.text || "").trim(),
      }))
      .filter((s) => s.name && s.text)
      .slice(0, 2)
    : [];
  if (!professorName || !professorText || students.length < 2) return null;
  return {
    id: String(input.id || fallbackId),
    professor: { name: professorName, text: professorText },
    students,
  };
}

function normalizePrompt(type, input, fallbackId) {
  return type === "email"
    ? normalizeEmailPrompt(input, fallbackId)
    : normalizeDiscussionPrompt(input, fallbackId);
}

function summarizePrompt(type, pd) {
  if (!pd) return "";
  const src = type === "email" ? pd.scenario : pd?.professor?.text;
  const text = String(src || "").trim();
  if (!text) return "";
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

export function WritingTask({
  onExit,
  type,
  embedded = false,
  persistSession = true,
  onComplete = null,
  deferScoring = false,
  onTimerChange = null,
  timeLimitSeconds = null,
  practiceMode = PRACTICE_MODE.STANDARD,
  showTaskIntro = true,
  autoStartOnMount = false,
  reportLanguage,
}) {
  const uiReportLanguage = normalizeReportLanguage(reportLanguage || readReportLanguage());
  const dataRaw = type === "email" ? EM_DATA : AD_DATA;
  const data = useMemo(
    () =>
      (Array.isArray(dataRaw)
        ? dataRaw
          .map((d, i) => normalizePrompt(type, d, `${type}-${i + 1}`))
          .filter(Boolean)
        : []),
    [dataRaw, type]
  );
  const defaultLimit = type === "email" ? 420 : 600;
  const limit = Number.isFinite(timeLimitSeconds) && timeLimitSeconds > 0 ? timeLimitSeconds : defaultLimit;
  const minW = type === "email" ? 80 : 100;
  const storageKey = type === "email" ? "toefl-em-done" : "toefl-disc-done";

  const usedRef = useRef(new Set());
  const [initialError] = useState(() => (data.length === 0 ? "Prompt bank is empty or invalid." : ""));
  const [pi, setPi] = useState(() => {
    try {
      const i = pickRandomPrompt(data, usedRef.current, storageKey);
      usedRef.current.add(i);
      return i;
    } catch {
      return 0;
    }
  });
  const [pd, setPd] = useState(() => data[pi] || null);
  const [text, setText] = useState("");
  const [tl, setTl] = useState(limit);
  const [run, setRun] = useState(false);
  const [phase, setPhase] = useState("ready");
  const [fb, setFb] = useState(null);
  const [requestState, setRequestState] = useState("idle");
  const [scoreError, setScoreError] = useState("");
  const [gen, setGen] = useState(false);
  const [toast, setToast] = useState(null);
  const [intro, setIntro] = useState(showTaskIntro);
  const tr = useRef(null);
  const submitLockRef = useRef(false);

  useEffect(() => { setPd(data[pi] || null); }, [pi, data]);
  useEffect(() => { setIntro(showTaskIntro); }, [showTaskIntro, type]);

  const submitRef = useRef(null);
  const phaseRef = useRef(phase);
  const completionSentRef = useRef(false);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => {
    if (typeof onTimerChange === "function") {
      onTimerChange({ timeLeft: tl, isRunning: run, phase });
    }
  }, [tl, run, phase, onTimerChange]);

  function start() {
    if (phase !== "ready") return;
    if (run) return;
    if (tr.current) clearInterval(tr.current);
    setRequestState("idle");
    setScoreError("");
    setPhase("writing");
    setRun(true);
    tr.current = setInterval(() => setTl(p => {
      if (p <= 1) { clearInterval(tr.current); setRun(false); return 0; }
      return p - 1;
    }), 1000);
  }

  async function runScoringAttempt() {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    clearInterval(tr.current);
    setRun(false);
    setPhase("scoring");
    setRequestState("pending");
    setScoreError("");
    setFb(null);
    try {
      if (!pd) {
        throw new Error("Prompt data is missing.");
      }
      const r = await evaluateWritingResponse(type, pd, text, uiReportLanguage);
      setFb(r);
      setPhase("done");
      if (r) {
        const payload = {
          type, score: r.score, band: r.band, wordCount: wc(text), weaknesses: r.weaknesses, next_steps: r.next_steps, mode: practiceMode,
          details: {
            promptSummary: summarizePrompt(type, pd),
            userText: text,
            feedback: r
          }
        };
        if (persistSession) {
          saveSess(payload);
          addDoneIds(storageKey, [pd.id]);
        }
        if (typeof onComplete === "function" && !completionSentRef.current) {
          completionSentRef.current = true;
          onComplete(payload);
        }
        setRequestState("success");
      } else {
        setRequestState("error");
        setScoreError("Scoring did not return a valid result. Please try again.");
      }
    } catch (e) {
      setPhase("done");
      setRequestState("error");
      setScoreError(mapScoringError(e));
    } finally {
      submitLockRef.current = false;
    }
  }

  useEffect(() => {
    if (intro) return;
    if (!autoStartOnMount) return;
    if (phase !== "ready") return;
    start();
  }, [intro, autoStartOnMount, phase]);
  async function submitScore() {
    if (deferScoring) {
      if (submitLockRef.current) return;
      submitLockRef.current = true;
      clearInterval(tr.current);
      setRun(false);
      setPhase("done");
      setRequestState("success");
      setScoreError("");
      if (!pd) {
        submitLockRef.current = false;
        setRequestState("error");
        setScoreError("Prompt data is missing.");
        return;
      }
      if (typeof onComplete === "function" && !completionSentRef.current) {
        completionSentRef.current = true;
        onComplete({
          type,
          wordCount: wc(text),
          mode: practiceMode,
          details: {
            promptData: pd,
            promptSummary: summarizePrompt(type, pd),
            userText: text,
            reportLanguage: uiReportLanguage,
          },
        });
      }
      submitLockRef.current = false;
      return;
    }
    await runScoringAttempt();
  }
  submitRef.current = submitScore;

  async function retryScore() { await runScoringAttempt(); }

  useEffect(() => { if (tl === 0 && phaseRef.current === "writing") { submitRef.current(); } }, [tl]);

  useEffect(() => {
    function handleKey(e) { if (e.ctrlKey && e.key === "Enter" && phaseRef.current === "writing") { e.preventDefault(); submitRef.current(); } }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  function next() {
    clearInterval(tr.current);
    let n = 0;
    try {
      n = pickRandomPrompt(data, usedRef.current, storageKey);
    } catch {
      setToast("Prompt bank is empty or invalid.");
      return;
    }
    usedRef.current.add(n);
    setPi(n); setPd(data[n]); setText(""); setTl(limit); setRun(false); setPhase("ready"); setFb(null); setRequestState("idle"); setScoreError(""); submitLockRef.current = false; completionSentRef.current = false; setIntro(showTaskIntro);
  }
  async function genNew() {
    setGen(true);
    const d = await aiGen(type);
    const normalized = normalizePrompt(type, d, `gen-${Date.now()}`);
    if (normalized) { setPd(normalized); setText(""); setTl(limit); setRun(false); setPhase("ready"); setFb(null); setRequestState("idle"); setScoreError(""); submitLockRef.current = false; completionSentRef.current = false; setIntro(showTaskIntro); }
    else { setToast("Generation failed. Please retry."); }
    setGen(false);
  }
  useEffect(() => () => clearInterval(tr.current), []);

  const w = wc(text);
  const taskTitle = type === "email" ? "Write an Email" : "Academic Discussion";
  const introTitle = type === "email" ? "Task 2: Write an Email" : "Task 3: Academic Discussion";
  const introDesc = type === "email"
    ? "You will read a workplace scenario and write an email that addresses all required goals."
    : "You will read a discussion board prompt and write a focused academic response.";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      {!embedded && <TopBar title={taskTitle} section={"Writing | " + (type === "email" ? "Task 2" : "Task 3")} timeLeft={phase !== "ready" ? tl : undefined} isRunning={run} onExit={onExit} />}
      <div style={{ maxWidth: 860, margin: "24px auto", padding: "0 20px" }}>
        {initialError && (
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 28, marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.red, marginBottom: 8 }}>Prompt bank unavailable</div>
            <div style={{ fontSize: 14, color: C.t2 }}>{initialError}</div>
            <div style={{ marginTop: 16 }}><Btn onClick={onExit} variant="secondary">{embedded ? "Back" : "Back to Practice"}</Btn></div>
          </div>
        )}
        {!initialError && !pd && (
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 28, marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.red, marginBottom: 8 }}>Prompt unavailable</div>
            <div style={{ fontSize: 14, color: C.t2 }}>Please refresh and try again.</div>
          </div>
        )}
        {!initialError && pd && (
          <>
        {intro && phase === "ready" ? (
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 28 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.nav, marginBottom: 10 }}>{introTitle}</div>
            <div style={{ fontSize: 14, color: C.t1, lineHeight: 1.7, marginBottom: 12 }}>{introDesc}</div>
            <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.7 }}>
              <div>Time limit: <b>{formatMinutesLabel(limit)}</b></div>
              <div>Minimum words: <b>{minW}</b></div>
              {practiceMode === PRACTICE_MODE.CHALLENGE && <div>Mode: <b>Challenge</b> (compressed timing)</div>}
            </div>
            <div style={{ marginTop: 18 }}>
              <Btn
                data-testid="writing-intro-start"
                onClick={() => {
                  setIntro(false);
                  start();
                }}
              >
                Continue and start timer
              </Btn>
            </div>
          </div>
        ) : (
          <>
        <div style={{ background: C.ltB, border: "1px solid #b3d4fc", borderRadius: 4, padding: 14, marginBottom: 20, fontSize: 13 }}>
          <b>Directions:</b> {type === "email" ? `Write an email addressing all 3 goals. ${formatMinutesLabel(limit)}. 80-120 words.` : `Read the discussion and write a response. ${formatMinutesLabel(limit)}. 100+ words.`}
          {practiceMode === PRACTICE_MODE.CHALLENGE && <span> Challenge mode: compressed timing.</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <WritingPromptPanel type={type} pd={pd} />
          <WritingResponsePanel
            type={type}
            pd={pd}
            phase={phase}
            text={text}
            onTextChange={setText}
            w={w}
            minW={minW}
            gen={gen}
            fb={fb}
            deferScoring={deferScoring}
            requestState={requestState}
            scoreError={scoreError}
            onStart={start}
            onSubmit={submitScore}
            onRetry={retryScore}
            onNext={next}
            onGenNew={genNew}
            onExit={onExit}
            embedded={embedded}
          />
        </div>
          </>
        )}
        {phase === "done" && fb && (
          <div style={{ marginTop: 20 }}><ScoringReport result={fb} type={type} uiLang={uiReportLanguage} /><div style={{ display: "flex", gap: 12, marginTop: 16 }}><Btn onClick={next} variant="secondary">Next Prompt</Btn><Btn onClick={genNew} disabled={gen}>{gen ? "Generating..." : "Generate New Prompt"}</Btn><Btn onClick={onExit} variant="secondary">{embedded ? "Back" : "Back to Practice"}</Btn></div></div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
