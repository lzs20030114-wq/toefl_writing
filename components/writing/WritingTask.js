"use client";
import React, { useState, useEffect, useRef } from "react";
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

export function WritingTask({ onExit, type, embedded = false, persistSession = true, onComplete = null, deferScoring = false, onTimerChange = null }) {
  const data = type === "email" ? EM_DATA : AD_DATA;
  const limit = type === "email" ? 420 : 600;
  const minW = type === "email" ? 80 : 100;
  const storageKey = type === "email" ? "toefl-em-done" : "toefl-disc-done";

  const usedRef = useRef(new Set());
  const [pi, setPi] = useState(() => { const i = pickRandomPrompt(data, usedRef.current, storageKey); usedRef.current.add(i); return i; });
  const [pd, setPd] = useState(() => data[pi]);
  const [text, setText] = useState("");
  const [tl, setTl] = useState(limit);
  const [run, setRun] = useState(false);
  const [phase, setPhase] = useState("ready");
  const [fb, setFb] = useState(null);
  const [requestState, setRequestState] = useState("idle");
  const [scoreError, setScoreError] = useState("");
  const [gen, setGen] = useState(false);
  const [toast, setToast] = useState(null);
  const tr = useRef(null);
  const submitLockRef = useRef(false);

  useEffect(() => { setPd(data[pi]); }, [pi, data]);

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
      const r = await evaluateWritingResponse(type, pd, text);
      setFb(r);
      setPhase("done");
      if (r) {
        const payload = {
          type, score: r.score, band: r.band, wordCount: wc(text), weaknesses: r.weaknesses, next_steps: r.next_steps,
          details: {
            promptSummary: type === "email"
              ? pd.scenario.substring(0, 80) + "..."
              : pd.professor.text.substring(0, 80) + "...",
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
  async function submitScore() {
    if (deferScoring) {
      if (submitLockRef.current) return;
      submitLockRef.current = true;
      clearInterval(tr.current);
      setRun(false);
      setPhase("done");
      setRequestState("success");
      setScoreError("");
      if (typeof onComplete === "function" && !completionSentRef.current) {
        completionSentRef.current = true;
        onComplete({
          type,
          wordCount: wc(text),
          details: {
            promptData: pd,
            promptSummary: type === "email"
              ? pd.scenario.substring(0, 80) + "..."
              : pd.professor.text.substring(0, 80) + "...",
            userText: text,
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
    const n = pickRandomPrompt(data, usedRef.current, storageKey);
    usedRef.current.add(n);
    setPi(n); setPd(data[n]); setText(""); setTl(limit); setRun(false); setPhase("ready"); setFb(null); setRequestState("idle"); setScoreError(""); submitLockRef.current = false; completionSentRef.current = false;
  }
  async function genNew() {
    setGen(true);
    const d = await aiGen(type);
    if (d) { setPd({ id: "gen", ...d }); setText(""); setTl(limit); setRun(false); setPhase("ready"); setFb(null); setRequestState("idle"); setScoreError(""); submitLockRef.current = false; completionSentRef.current = false; }
    else { setToast("Generation failed. Please retry."); }
    setGen(false);
  }
  useEffect(() => () => clearInterval(tr.current), []);

  const w = wc(text);
  const taskTitle = type === "email" ? "Write an Email" : "Academic Discussion";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      {!embedded && <TopBar title={taskTitle} section={"Writing | " + (type === "email" ? "Task 2" : "Task 3")} timeLeft={phase !== "ready" ? tl : undefined} isRunning={run} onExit={onExit} />}
      <div style={{ maxWidth: 860, margin: "24px auto", padding: "0 20px" }}>
        <div style={{ background: C.ltB, border: "1px solid #b3d4fc", borderRadius: 4, padding: 14, marginBottom: 20, fontSize: 13 }}><b>Directions:</b> {type === "email" ? "Write an email addressing all 3 goals. 7 min. 80-120 words." : "Read the discussion and write a response. 10 min. 100+ words."}</div>
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
        {phase === "done" && fb && (
          <div style={{ marginTop: 20 }}><ScoringReport result={fb} type={type} /><div style={{ display: "flex", gap: 12, marginTop: 16 }}><Btn onClick={next} variant="secondary">Next Prompt</Btn><Btn onClick={genNew} disabled={gen}>{gen ? "Generating..." : "Generate New Prompt"}</Btn><Btn onClick={onExit} variant="secondary">{embedded ? "Back" : "Back to Practice"}</Btn></div></div>
        )}
      </div>
    </div>
  );
}
