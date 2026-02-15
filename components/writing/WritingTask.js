"use client";
import React, { useState, useEffect, useRef } from "react";
import EM_DATA from "../../data/emailWriting/prompts.json";
import AD_DATA from "../../data/academicWriting/prompts.json";
import { wc } from "../../lib/utils";
import { saveSess, addDoneIds } from "../../lib/sessionStore";
import { callAI, mapScoringError } from "../../lib/ai/client";
import { EMAIL_SYS, buildEmailUserPrompt, EMAIL_GEN_PROMPT } from "../../lib/ai/prompts/emailWriting";
import { DISC_SYS, buildDiscussionUserPrompt, DISC_GEN_PROMPT } from "../../lib/ai/prompts/academicWriting";
import { BS_GEN_PROMPT } from "../../lib/ai/prompts/buildSentence";
import { parseReport } from "../../lib/ai/parse";
import { pickRandomPrompt } from "../../lib/questionSelector";
import { C, FONT, Btn, Toast, TopBar } from "../shared/ui";
import { ScoringReport } from "./ScoringReport";

async function aiEval(type, pd, text) {
  const sys = type === "email" ? EMAIL_SYS : DISC_SYS;
  const up = type === "email"
    ? buildEmailUserPrompt(pd, text)
    : buildDiscussionUserPrompt(pd, text);
  try {
    const raw = await callAI(sys, up, 2600);
    const result = parseReport(raw);
    if (result.error) throw new Error(result.errorReason || "AI evaluation failed");
    return result;
  } catch (e) { console.error(e); throw new Error(e?.message || "AI evaluation failed"); }
}

async function aiGen(type) {
  const prompts = {
    buildSentence: BS_GEN_PROMPT,
    email: EMAIL_GEN_PROMPT,
    discussion: DISC_GEN_PROMPT,
  };
  try {
    const raw = await callAI("Generate TOEFL 2026 questions. Output ONLY valid JSON.", prompts[type], 1500);
    return JSON.parse(raw.replace(/```json/g, "").replace(/```/g, "").trim());
  } catch (e) { console.error(e); return null; }
}

export function WritingTask({ onExit, type }) {
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
  useEffect(() => { phaseRef.current = phase; }, [phase]);

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
      const r = await aiEval(type, pd, text);
      setFb(r);
      setPhase("done");
      if (r) {
        saveSess({
          type, score: r.score, band: r.band, wordCount: wc(text), weaknesses: r.weaknesses, next_steps: r.next_steps,
          details: {
            promptSummary: type === "email"
              ? pd.scenario.substring(0, 80) + "..."
              : pd.professor.text.substring(0, 80) + "...",
            userText: text,
            feedback: r
          }
        });
        addDoneIds(storageKey, [pd.id]);
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
  async function submitScore() { await runScoringAttempt(); }
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
    setPi(n); setPd(data[n]); setText(""); setTl(limit); setRun(false); setPhase("ready"); setFb(null); setRequestState("idle"); setScoreError(""); submitLockRef.current = false;
  }
  async function genNew() {
    setGen(true);
    const d = await aiGen(type);
    if (d) { setPd({ id: "gen", ...d }); setText(""); setTl(limit); setRun(false); setPhase("ready"); setFb(null); setRequestState("idle"); setScoreError(""); submitLockRef.current = false; }
    else { setToast("Generation failed. Please retry."); }
    setGen(false);
  }
  useEffect(() => () => clearInterval(tr.current), []);

  const w = wc(text);
  const taskTitle = type === "email" ? "Write an Email" : "Academic Discussion";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      <TopBar title={taskTitle} section={"Writing | " + (type === "email" ? "Task 2" : "Task 3")} timeLeft={phase !== "ready" ? tl : undefined} isRunning={run} onExit={onExit} />
      <div style={{ maxWidth: 860, margin: "24px auto", padding: "0 20px" }}>
        <div style={{ background: C.ltB, border: "1px solid #b3d4fc", borderRadius: 4, padding: 14, marginBottom: 20, fontSize: 13 }}><b>Directions:</b> {type === "email" ? "Write an email addressing all 3 goals. 7 min. 80-120 words." : "Read the discussion and write a response. 10 min. 100+ words."}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, overflow: "hidden" }}>
            <div style={{ background: "#e8e8e8", padding: "10px 16px", fontSize: 12, fontWeight: 700, color: C.t2, borderBottom: "1px solid " + C.bdr }}>{type === "email" ? "SCENARIO" : "DISCUSSION BOARD"}</div>
            {type === "email" ? (
              <div style={{ padding: 20 }}>
                <div style={{ fontSize: 12, color: C.t2, marginBottom: 6 }}><b>To:</b> {pd.to} | <b>From:</b> {pd.from}</div>
                <p style={{ fontSize: 14, color: C.t1, lineHeight: 1.7, margin: "12px 0" }}>{pd.scenario}</p>
                <div style={{ borderTop: "1px solid " + C.bdr, paddingTop: 12, marginTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{pd.direction}</div>
                  {pd.goals.map((g, i) => <div key={i} style={{ fontSize: 13, paddingLeft: 16, marginBottom: 4 }}>{i + 1}. {g}</div>)}
                </div>
              </div>
            ) : (
              <div>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid " + C.bdr }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.nav, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
                      {pd.professor.name.split(" ").pop()[0]}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{pd.professor.name}</div>
                      <div style={{ fontSize: 11, color: C.t2 }}>Professor</div>
                    </div>
                  </div>
                  <p style={{ fontSize: 13, color: C.t1, lineHeight: 1.6, margin: 0 }}>{pd.professor.text}</p>
                </div>
                {pd.students.map((s, i) => (
                  <div key={i} style={{ padding: "14px 20px 14px 40px", borderBottom: i < pd.students.length - 1 ? "1px solid " + C.bdr : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><div style={{ width: 28, height: 28, borderRadius: "50%", background: i ? "#e8913a" : "#4a90d9", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{s.name[0]}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div></div>
                    <p style={{ fontSize: 13, color: C.t1, lineHeight: 1.6, margin: 0 }}>{s.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {phase === "ready" ? (
              <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 40, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                <div style={{ fontSize: 14, color: C.t2 }}>Read the prompt, then click start to begin writing.</div>
                <Btn data-testid="writing-start" onClick={start}>Start Writing</Btn>
              </div>
            ) : (
              <>
                <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, overflow: "hidden", flex: 1, display: "flex", flexDirection: "column" }}>
                  <div style={{ background: "#e8e8e8", padding: "10px 16px", fontSize: 12, fontWeight: 700, color: C.t2, borderBottom: "1px solid " + C.bdr, display: "flex", justifyContent: "space-between" }}><span>Your response</span><span style={{ color: w < minW ? C.orange : C.green }}>{w} words {w < minW ? "(" + (minW - w) + " more)" : ""}</span></div>
                  <textarea data-testid="writing-textarea" value={text} onChange={e => setText(e.target.value)} disabled={phase === "scoring" || phase === "done"} placeholder={type === "email" ? "Dear " + pd.to + ",\n\nI am writing to..." : "I think this is an interesting question..."} style={{ flex: 1, minHeight: type === "email" ? 280 : 320, border: "none", padding: 16, fontSize: 14, fontFamily: FONT, lineHeight: 1.7, color: C.t1, resize: "none", outline: "none", background: phase === "done" ? "#fafafa" : "#fff" }} />
                </div>
                {phase === "writing" && <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Btn data-testid="writing-submit" onClick={submitScore} disabled={w < 10} variant="success">Submit for Scoring</Btn><span style={{ fontSize: 11, color: C.t2 }}>Ctrl+Enter</span></div>}
              </>
            )}
            {phase === "scoring" && <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 32, textAlign: "center", color: C.t2 }}>AI is scoring your response...</div>}
          </div>
        </div>
        {phase === "done" && fb && (
          <div style={{ marginTop: 20 }}><ScoringReport result={fb} type={type} /><div style={{ display: "flex", gap: 12, marginTop: 16 }}><Btn onClick={next} variant="secondary">Next Prompt</Btn><Btn onClick={genNew} disabled={gen}>{gen ? "Generating..." : "Generate New Prompt"}</Btn><Btn onClick={onExit} variant="secondary">Back to Practice</Btn></div></div>
        )}
        {phase === "done" && !fb && (
          <div style={{ marginTop: 20 }}>
            <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 32, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>!</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.red, marginBottom: 8 }}>Scoring failed</div>
              <div style={{ fontSize: 14, color: C.t2, marginBottom: 20 }}>The AI service did not return a valid score. You can retry or exit.</div>
              {requestState === "error" && !!scoreError && <div data-testid="score-error-reason" style={{ fontSize: 12, color: C.red, marginBottom: 12 }}>{scoreError}</div>}
              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <Btn onClick={retryScore}>Retry Scoring</Btn>
                <Btn onClick={onExit} variant="secondary">Back to Practice</Btn>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
