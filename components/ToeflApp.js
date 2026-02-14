"use client";
import React, { useState, useEffect, useRef } from "react";
import BS_EASY_DATA from "../data/questionBank/v1/build_sentence/easy.json";
import BS_MEDIUM_DATA from "../data/questionBank/v1/build_sentence/medium.json";
import BS_HARD_DATA from "../data/questionBank/v1/build_sentence/hard.json";
import EM_DATA from "../data/emailPrompts.json";
import AD_DATA from "../data/discussionPrompts.json";

const BS_DATA = [...BS_EASY_DATA, ...BS_MEDIUM_DATA, ...BS_HARD_DATA];

export function fmt(s) { return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
export function wc(t) { return t.trim() ? t.trim().split(/\s+/).length : 0; }
export function shuffle(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
export function norm(s) { return s.toLowerCase().replace(/[.,!?]/g, "").trim(); }

/* --- localStorage helpers --- */
export function loadHist() { try { return JSON.parse(localStorage.getItem("toefl-hist") || '{"sessions":[]}'); } catch { return { sessions: [] }; } }
export function saveSess(s) { try { const h = loadHist(); h.sessions.push({ ...s, date: new Date().toISOString() }); if (h.sessions.length > 50) h.sessions = h.sessions.slice(-50); localStorage.setItem("toefl-hist", JSON.stringify(h)); } catch (e) { console.error(e); } }
export function deleteSession(index) { try { const h = loadHist(); h.sessions.splice(index, 1); localStorage.setItem("toefl-hist", JSON.stringify(h)); return h; } catch (e) { console.error(e); return loadHist(); } }
export function clearAllSessions() { try { localStorage.setItem("toefl-hist", JSON.stringify({ sessions: [] })); return { sessions: [] }; } catch (e) { console.error(e); return { sessions: [] }; } }

export function loadDoneIds(key) { try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set(); } }
export function addDoneIds(key, ids) { try { const done = loadDoneIds(key); ids.forEach(id => done.add(id)); localStorage.setItem(key, JSON.stringify([...done])); } catch (e) { console.error(e); } }

/* --- Build a Sentence question selection (3 easy + 3 medium + 3 hard) --- */
export function selectBSQuestions() {
  const doneIds = loadDoneIds("toefl-bs-done");
  const byDiff = { easy: [], medium: [], hard: [] };
  BS_DATA.forEach(q => { if (byDiff[q.difficulty]) byDiff[q.difficulty].push(q); });

  function pickN(pool, n, targetDifficulty) {
    if (!pool || pool.length === 0) {
      // Fallback: synthesize target difficulty items when a bucket is empty.
      return shuffle(BS_DATA)
        .slice(0, Math.min(n, BS_DATA.length))
        .map((q, i) => ({
          ...q,
          id: `${q.id}__${targetDifficulty}_${i}`,
          difficulty: targetDifficulty,
        }));
    }
    const undone = pool.filter(q => !doneIds.has(q.id));
    const source = undone.length >= n ? undone : pool;
    return shuffle(source).slice(0, Math.min(n, source.length));
  }

  const selected = [
    ...pickN(byDiff.easy, 3, "easy"),
    ...pickN(byDiff.medium, 3, "medium"),
    ...pickN(byDiff.hard, 3, "hard"),
  ];
  return shuffle(selected);
}

/* --- Pick random prompt for Email/Discussion, preferring undone --- */
export function pickRandomPrompt(data, usedSessionSet, storageKey) {
  const doneIds = loadDoneIds(storageKey);
  // Priority 1: not done + not used this session
  let candidates = [];
  for (let i = 0; i < data.length; i++) {
    if (!usedSessionSet.has(i) && !doneIds.has(data[i].id)) candidates.push(i);
  }
  // Priority 2: not used this session
  if (candidates.length === 0) {
    for (let i = 0; i < data.length; i++) {
      if (!usedSessionSet.has(i)) candidates.push(i);
    }
  }
  // Priority 3: reset session
  if (candidates.length === 0) {
    usedSessionSet.clear();
    candidates = Array.from({ length: data.length }, (_, i) => i);
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/* --- AI --- */
export async function callAI(system, message, maxTokens, timeoutMs = 25000) {
  let timeoutId;
  try {
    const requestPromise = (async () => {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system, message, maxTokens: maxTokens || 1200 }),
      });
      if (!r.ok) throw new Error("API error " + r.status);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      return d.content;
    })();
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("API timeout")), timeoutMs);
    });
    return await Promise.race([requestPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function mapScoringError(err) {
  const raw = String(err?.message || err || "");
  const m = raw.toLowerCase();
  if (m.includes("api timeout")) {
    return "请求超时，请检查网络后重试";
  }
  if (m.includes("api error 401") || m.includes("api error 403")) {
    return "鉴权失败 (401/403)";
  }
  if (m.includes("api error 429")) {
    return "AI service 429";
  }
  if (m.includes("unexpected token") || m.includes("json")) {
    return "返回格式异常";
  }
  if (m.includes("api error")) {
    return "服务暂时不可用";
  }
  if (m.includes("failed to fetch") || m.includes("network")) {
    return "网络连接异常";
  }
  return "评分失败";
}

const EMAIL_SYS = "You are a STRICT ETS TOEFL iBT 2026 Writing scorer. Score the email 0-5 with ZERO inflation. RUBRIC: 5(RARE)=CONSISTENT facility,PRECISE/IDIOMATIC,almost NO errors. 4=MOSTLY effective,ADEQUATE,FEW errors. 3=GENERALLY accomplishes but NOTICEABLE errors. 2=MOSTLY UNSUCCESSFUL. 1=UNSUCCESSFUL. Most score 3-4. BAND: 5=5.0-6.0,4=4.0-4.5,3=3.0-3.5,2=2.0-2.5,1=1.0-1.5. Find ALL weaknesses first. IMPORTANT: Write summary, weaknesses, strengths, grammar_issues, vocabulary_note, next_steps ALL in Chinese (缂傚倷鑳舵慨顓㈠磻閹捐秮褰掓晲閸℃ê鐭梺鐓庣仛閸ㄥ灝顕?. The sample model response should remain in English. Return ONLY JSON: {\"score\":0,\"band\":0.0,\"goals_met\":[false,false,false],\"summary\":\"濠电偞鍨堕幖鈺呭储娴犲鍑犻柛鎰靛枛缁犳垿鏌ゆ慨鎰偓妤€鈻?..\",\"weaknesses\":[\"濠电偞鍨堕幖鈺呭储娴犲鍑犻柛鎰电厛閸ゆ洟寮堕崼姘珔濞?..\"],\"strengths\":[\"濠电偞鍨堕幖鈺呭储娴犲鍑犻柛鎰ㄦ櫅椤曡鲸淇婇婊冨付濞?..\"],\"grammar_issues\":[\"濠电偞鍨堕幖鈺呭储娴犲鍑犻柛鎰典簼鐎氭碍銇勯幘璺烘灁闁靛棗锕濠氬磼閵堝懏鐝濆?..\"],\"vocabulary_note\":\"濠电偞鍨堕幖鈺呭储娴犲鍑犻柛鎰典簼鐎氭氨鈧箍鍎卞Λ娑橈耿娴犲鐓熼柟閭﹀櫘閺€浼存煟?..\",\"next_steps\":[\"濠电偞鍨堕幖鈺呭储娴犲鍑犻柛鎰靛枛缂佲晝鐥鐐村櫧缂佺姾宕甸埀顒傚仯閸婃繄绱撳棰濇晩?..\"],\"sample\":\"English model response\"}";

const DISC_SYS = "You are a STRICT ETS TOEFL iBT 2026 Writing scorer. Score the discussion post 0-5 with ZERO inflation. RUBRIC: 5(RARE)=VERY CLEAR,WELL-ELABORATED,PRECISE/IDIOMATIC. 4=RELEVANT,ADEQUATELY elaborated,FEW errors. 3=MOSTLY relevant,NOTICEABLE errors. 2=MOSTLY UNSUCCESSFUL. 1=UNSUCCESSFUL. Most score 3-4. BAND: 5=5.0-6.0,4=4.0-4.5,3=3.0-3.5,2=2.0-2.5,1=1.0-1.5. Find ALL weaknesses first. IMPORTANT: Write summary, weaknesses, strengths, grammar_issues, vocabulary_note, argument_quality, next_steps ALL in Chinese (缂傚倷鑳舵慨顓㈠磻閹捐秮褰掓晲閸℃ê鐭梺鐓庣仛閸ㄥ灝顕?. The sample model response should remain in English. Return ONLY JSON: {\"score\":0,\"band\":0.0,\"engages_professor\":false,\"engages_students\":false,\"summary\":\"濠电偞鍨堕幖鈺呭储娴犲鍑犻柛鎰靛枛缁犳垿鏌ゆ慨鎰偓妤€鈻?..\",\"weaknesses\":[\"濠电偞鍨堕幖鈺呭储娴犲鍑犻柛鎰电厛閸ゆ洟寮堕崼姘珔濞?..\"],\"strengths\":[\"濠电偞鍨堕幖鈺呭储娴犲鍑犻柛鎰ㄦ櫅椤曡鲸淇婇婊冨付濞?..\"],\"grammar_issues\":[\"濠电偞鍨堕幖鈺呭储娴犲鍑犻柛鎰典簼鐎氭碍銇勯幘璺烘灁闁靛棗锕濠氬磼閵堝懏鐝濆?..\"],\"vocabulary_note\":\"濠电偞鍨堕幖鈺呭储娴犲鍑犻柛鎰典簼鐎氭氨鈧箍鍎卞Λ娑橈耿娴犲鐓熼柟閭﹀櫘閺€浼存煟?..\",\"argument_quality\":\"濠电偞鍨堕幖鈺呭储娴犲鍑犻柛鎰典簼婵厧螖閿曚焦纭舵俊鎻掔墦閹綊骞囬埡浣割潎闂侀潻缍€濞咃綁骞忛悩璇茬妞ゅ繐妫楃粻?..\",\"next_steps\":[\"濠电偞鍨堕幖鈺呭储娴犲鍑犻柛鎰靛枛缂佲晝鐥鐐村櫧缂佺姾宕甸埀顒傚仯閸婃繄绱撳棰濇晩?..\"],\"sample\":\"English model response\"}";

async function aiEval(type, pd, text) {
  const sys = type === "email" ? EMAIL_SYS : DISC_SYS;
  const up = type === "email"
    ? "Scenario: " + pd.scenario + "\nGoals:\n" + pd.goals.map((g, i) => (i + 1) + ". " + g).join("\n") + "\n\nStudent email:\n" + text
    : "Prof " + pd.professor.name + ": " + pd.professor.text + "\n\n" + pd.students.map(s => s.name + ": " + s.text).join("\n\n") + "\n\nStudent response:\n" + text;
  try {
    const raw = await callAI(sys, up, 1200);
    return JSON.parse(raw.replace(/```json/g, "").replace(/```/g, "").trim());
  } catch (e) { console.error(e); throw new Error(e?.message || "AI evaluation failed"); }
}

async function aiGen(type) {
  const prompts = {
    buildSentence: 'Generate 9 TOEFL 2026 Build a Sentence items as JSON array. All chunks and answer must be lowercase, answer has no punctuation. Mix difficulties. Format: [{"prompt":"context question","chunks":["lowercase","word","chunks"],"answer":"lowercase answer no punctuation","hasDistractor":false,"gp":"grammar point","difficulty":"medium"}]',
    email: 'Generate 1 TOEFL 2026 email prompt as JSON: {"scenario":"...","direction":"Write an email:","goals":["g1","g2","g3"],"to":"...","from":"You"}',
    discussion: 'Generate 1 TOEFL 2026 discussion prompt as JSON: {"professor":{"name":"Dr. X","text":"..."},"students":[{"name":"A","text":"..."},{"name":"B","text":"..."}]}'
  };
  try {
    const raw = await callAI("Generate TOEFL 2026 questions. Output ONLY valid JSON.", prompts[type], 1500);
    return JSON.parse(raw.replace(/```json/g, "").replace(/```/g, "").trim());
  } catch (e) { console.error(e); return null; }
}

/* --- Theme --- */
const C = { nav: "#003366", navDk: "#002244", bg: "#f0f0f0", bdr: "#ccc", t1: "#333", t2: "#666", blue: "#0066cc", green: "#28a745", orange: "#ff8c00", red: "#dc3545", ltB: "#e8f0fe" };
const FONT = "'Segoe UI','Helvetica Neue',Arial,sans-serif";

function Btn({ children, onClick, disabled, variant, ...props }) {
  const colors = { primary: { bg: C.blue, c: "#fff" }, secondary: { bg: "#fff", c: C.blue }, success: { bg: C.green, c: "#fff" }, danger: { bg: C.red, c: "#fff" } };
  const s = colors[variant || "primary"] || colors.primary;
  return <button onClick={onClick} disabled={disabled} style={{ background: disabled ? "#ccc" : s.bg, color: disabled ? "#888" : s.c, border: "1px solid " + (disabled ? "#ccc" : s.bg), padding: "8px 24px", borderRadius: 4, fontSize: 14, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", fontFamily: FONT }} {...props}>{children}</button>;
}

function Toast({ message, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", background: C.red, color: "#fff", padding: "10px 24px", borderRadius: 6, fontSize: 14, fontWeight: 600, zIndex: 9999, boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
      {message}
    </div>
  );
}

function TopBar({ title, section, timeLeft, isRunning, qInfo, onExit }) {
  return (
    <div style={{ background: C.nav, color: "#fff", padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 48, fontFamily: FONT, fontSize: 14, borderBottom: "3px solid " + C.navDk, position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}><span style={{ fontWeight: 700, fontSize: 15 }}>TOEFL iBT</span><span style={{ opacity: 0.5 }}>|</span><span style={{ fontSize: 13 }}>{section}</span></div>
      <div style={{ fontSize: 13, opacity: 0.9 }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {qInfo && <span style={{ fontSize: 12, opacity: 0.8 }}>{qInfo}</span>}
        {timeLeft !== undefined && <div style={{ background: timeLeft <= 60 ? "rgba(220,53,69,0.6)" : "rgba(255,255,255,0.13)", padding: "4px 12px", borderRadius: 4, fontFamily: "Consolas,monospace", fontSize: 16, fontWeight: 700 }}>{fmt(timeLeft)}</div>}
        <button onClick={onExit} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12, fontFamily: FONT }}>Exit</button>
      </div>
    </div>
  );
}

function ScorePanel({ result, type }) {
  if (!result) return null;
  const sc = result.score >= 4 ? C.green : result.score >= 3 ? C.orange : C.red;
  return (
    <div data-testid="score-panel" style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, overflow: "hidden" }}>
      <div style={{ background: C.nav, color: "#fff", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>ETS Scoring</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontSize: 36, fontWeight: 800 }}>{result.score}</span>
            <span style={{ fontSize: 16, opacity: 0.7 }}>/ 5</span>
            <span style={{ background: sc, padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600, marginLeft: 8 }}>Band {result.band}</span>
          </div>
        </div>
      </div>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ color: C.t1, fontSize: 14, lineHeight: 1.6, margin: 0 }}>{result.summary}</p>
        {type === "email" && result.goals_met && (
          <div style={{ background: C.ltB, borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>Goal Coverage</div>
            {result.goals_met.map((m, i) => (
              <div key={i} style={{ fontSize: 13, marginBottom: 3 }}>
                <span style={{ color: m ? C.green : C.red, fontWeight: 700, marginRight: 6 }}>{m ? "OK" : "NO"}</span>
                Goal {i + 1}
              </div>
            ))}
          </div>
        )}
        {type === "discussion" && (
          <div style={{ background: C.ltB, borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>Discussion Engagement</div>
            <div style={{ fontSize: 13, marginBottom: 3 }}>
              <span style={{ color: result.engages_professor ? C.green : C.red, fontWeight: 700, marginRight: 6 }}>{result.engages_professor ? "OK" : "NO"}</span>
              Professor
            </div>
            <div style={{ fontSize: 13 }}>
              <span style={{ color: result.engages_students ? C.green : C.red, fontWeight: 700, marginRight: 6 }}>{result.engages_students ? "OK" : "NO"}</span>
              Students
            </div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ background: "#f0fff4", border: "1px solid #c6f6d5", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 6 }}>Strengths</div>
            {(result.strengths || []).map((s, i) => <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>+ {s}</div>)}
          </div>
          <div style={{ background: "#fff5f5", border: "1px solid #fed7d7", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.red, marginBottom: 6 }}>Weaknesses</div>
            {(result.weaknesses || []).map((s, i) => <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>- {s}</div>)}
          </div>
        </div>
        {result.grammar_issues && result.grammar_issues.length > 0 && (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#b45309", marginBottom: 6 }}>Language Diagnostics</div>
            {result.grammar_issues.map((g, i) => <div key={i} style={{ fontSize: 13, marginBottom: 3 }}>- {g}</div>)}
            {result.vocabulary_note && <div style={{ fontSize: 13, marginTop: 6 }}><b>Vocabulary:</b> {result.vocabulary_note}</div>}
            {result.argument_quality && <div style={{ fontSize: 13, marginTop: 4 }}><b>Argument:</b> {result.argument_quality}</div>}
          </div>
        )}
        {result.next_steps && result.next_steps.length > 0 && (
          <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>Next Steps</div>
            {result.next_steps.map((s, i) => <div key={i} style={{ fontSize: 13, marginBottom: 4 }}><b style={{ color: C.blue }}>{i + 1}.</b> {s}</div>)}
          </div>
        )}
        {result.sample && (
          <div style={{ background: "#f8f9fa", border: "1px solid " + C.bdr, borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>Sample Response (Score 5)</div>
            <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0, fontStyle: "italic" }}>{result.sample}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ========== BUILD A SENTENCE (Slot-based UI) ========== */

export function BuildSentenceTask({ onExit, questions }) {
  const [qs, setQs] = useState(() => questions || selectBSQuestions());
  const [idx, setIdx] = useState(0);
  const [slots, setSlots] = useState([]);
  const [bank, setBank] = useState([]);
  const [results, setResults] = useState([]);
  const [phase, setPhase] = useState("instruction");
  const [tl, setTl] = useState(360);
  const [run, setRun] = useState(false);
  const [toast, setToast] = useState(null);
  const tr = useRef(null);

  const autoSubmitRef = useRef(false);
  const resultsRef = useRef([]);
  const idxRef = useRef(0);
  const slotsRef = useRef([]);
  const submitLockRef = useRef(false);

  /* Drag state */
  const [dragItem, setDragItem] = useState(null); // { from: "bank"|"slot", chunk, slotIndex? }
  const [hoverSlot, setHoverSlot] = useState(null);
  const [hoverBank, setHoverBank] = useState(false);

  function initQ(i, questions) {
    const q = questions[i];
    setBank(shuffle((q.bank || []).map((c, j) => ({ text: c, id: i + "-" + j }))));
    setSlots(Array((q.bank || []).length).fill(null));
  }

  function startTimer() {
    if (phase !== "instruction") return;
    if (tr.current) clearInterval(tr.current);
    setPhase("active");
    setRun(true);
    initQ(0, qs);
    tr.current = setInterval(() => setTl(p => {
      if (p <= 1) { clearInterval(tr.current); setRun(false); autoSubmitRef.current = true; return 0; }
      return p - 1;
    }), 1000);
  }

  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => { idxRef.current = idx; }, [idx]);
  useEffect(() => { slotsRef.current = slots; }, [slots]);

  useEffect(() => {
    if (tl === 0 && autoSubmitRef.current && phase === "active") {
      autoSubmitRef.current = false;
      const curSlots = slotsRef.current;
      const curQ = qs[idxRef.current];
      const curAnswerOrder = curSlots.map(s => (s ? s.text : ""));
      const curAnswer = curAnswerOrder.join(" ").trim();
      const curOk = curAnswerOrder.join(" ") === (curQ.answerOrder || []).join(" ");
      let nr = [...resultsRef.current, { q: curQ, userAnswer: curAnswer || "(no answer)", isCorrect: curOk }];
      for (let i = idxRef.current + 1; i < qs.length; i++) {
        nr.push({ q: qs[i], userAnswer: "(no answer)", isCorrect: false });
      }
      setResults(nr);
      setPhase("review");
      saveSess({ type: "bs", correct: nr.filter(r => r.isCorrect).length, total: nr.length, errors: nr.filter(r => !r.isCorrect).map(r => r.q.gp) });
      addDoneIds("toefl-bs-done", qs.map(q => q.id));
      submitLockRef.current = false;
    }
  }, [tl, phase, qs]);

  useEffect(() => () => clearInterval(tr.current), []);

  /* --- Click interactions --- */
  function pickChunk(chunk) {
    const emptyIdx = slots.findIndex(s => s === null);
    if (emptyIdx === -1) return;
    setSlots(p => { const n = [...p]; n[emptyIdx] = chunk; return n; });
    setBank(p => p.filter(x => x.id !== chunk.id));
  }

  function removeChunk(slotIdx) {
    const chunk = slots[slotIdx];
    if (!chunk) return;
    setSlots(p => { const n = [...p]; n[slotIdx] = null; return n; });
    setBank(p => [...p, chunk]);
  }

  /* --- Drag interactions --- */
  function onDragStartBank(e, chunk) {
    setDragItem({ from: "bank", chunk });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", chunk.id);
    e.currentTarget.style.opacity = "0.4";
  }
  function onDragStartSlot(e, chunk, slotIdx) {
    setDragItem({ from: "slot", chunk, slotIndex: slotIdx });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", chunk.id);
    e.currentTarget.style.opacity = "0.4";
  }
  function onDragEnd(e) {
    e.currentTarget.style.opacity = "1";
    setDragItem(null);
    setHoverSlot(null);
    setHoverBank(false);
  }

  function onDropSlot(e, targetIdx) {
    e.preventDefault();
    if (!dragItem) return;
    const targetChunk = slots[targetIdx];

    if (dragItem.from === "bank") {
      if (targetChunk) {
        // Replace: move existing chunk back to bank, place new one
        setBank(p => [...p.filter(x => x.id !== dragItem.chunk.id), targetChunk]);
        setSlots(p => { const n = [...p]; n[targetIdx] = dragItem.chunk; return n; });
      } else {
        // Fill empty slot
        setBank(p => p.filter(x => x.id !== dragItem.chunk.id));
        setSlots(p => { const n = [...p]; n[targetIdx] = dragItem.chunk; return n; });
      }
    } else if (dragItem.from === "slot") {
      if (targetIdx === dragItem.slotIndex) { /* dropped on self, no-op */ }
      else {
        // Swap slots
        setSlots(p => {
          const n = [...p];
          n[targetIdx] = dragItem.chunk;
          n[dragItem.slotIndex] = targetChunk; // may be null
          return n;
        });
      }
    }
    setDragItem(null);
    setHoverSlot(null);
  }

  function onDropBank(e) {
    e.preventDefault();
    if (!dragItem || dragItem.from !== "slot") return;
    // Return slot chunk to bank
    setSlots(p => { const n = [...p]; n[dragItem.slotIndex] = null; return n; });
    setBank(p => [...p, dragItem.chunk]);
    setDragItem(null);
    setHoverBank(false);
  }

  function resetQ() { initQ(idx, qs); }

  function submit() {
    if (phase !== "active") return;
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    const q = qs[idx];
    const filledOrder = slots.map(s => (s ? s.text : ""));
    const ua = filledOrder.join(" ");
    const ok = filledOrder.join(" ") === (q.answerOrder || []).join(" ");
    const nr = [...results, { q, userAnswer: ua || "(no answer)", isCorrect: ok }];
    setResults(nr);
    if (idx < qs.length - 1) { setIdx(idx + 1); initQ(idx + 1, qs); submitLockRef.current = false; }
    else {
      clearInterval(tr.current); setRun(false); setPhase("review");
      saveSess({ type: "bs", correct: nr.filter(r => r.isCorrect).length, total: nr.length, errors: nr.filter(r => !r.isCorrect).map(r => r.q.gp) });
      addDoneIds("toefl-bs-done", qs.map(q => q.id));
      submitLockRef.current = false;
    }
  }

  /* ---- Review phase ---- */
  if (phase === "review") {
    const ok = results.filter(r => r.isCorrect).length;
    const ge = {};
    results.filter(r => !r.isCorrect).forEach(r => { const g = r.q.gp || "general"; ge[g] = (ge[g] || 0) + 1; });
    const te = Object.entries(ge).sort((a, b) => b[1] - a[1]);

    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
        <TopBar title="Build a Sentence Report" section="Writing" onExit={onExit} />
        <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
          <div style={{ background: C.nav, color: "#fff", borderRadius: 6, padding: 24, textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 48, fontWeight: 800 }}>{ok}/{results.length}</div>
            <div style={{ fontSize: 14, opacity: 0.7 }}>Correct answers</div>
          </div>
          {te.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 12 }}>Weak grammar points</div>
              {te.map(([g, n], i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < te.length - 1 ? "1px solid #eee" : "none" }}><span>{g}</span><span style={{ background: "#fee2e2", color: C.red, padding: "2px 10px", borderRadius: 10, fontSize: 12, fontWeight: 600 }}>{n}x</span></div>)}
              <div style={{ marginTop: 12, fontSize: 13, color: C.blue, background: C.ltB, padding: 10, borderRadius: 4 }}><b>Suggestion:</b> Review these points first: {te.map(e => e[0]).join(", ")}</div>
            </div>
          )}
          {results.map((r, i) => (
            <div data-testid={`build-result-${i}`} data-correct={r.isCorrect ? "true" : "false"} key={i} style={{ background: "#fff", border: "1px solid " + (r.isCorrect ? "#c6f6d5" : "#fed7d7"), borderLeft: "4px solid " + (r.isCorrect ? C.green : C.red), borderRadius: 4, padding: 14, marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>Q{i + 1}: {(r.q.promptTokens || []).map(t => ((t.type || t.t) === "blank" ? "___" : (t.value || t.v || ""))).join(" ")} <span style={{ color: C.blue }}>({r.q.gp || "build_sentence"})</span></div>
              <div style={{ fontSize: 14, color: r.isCorrect ? C.green : C.red }}>{r.isCorrect ? "Correct" : "Incorrect"} {capitalize(r.userAnswer)}</div>
              {!r.isCorrect && <div data-testid={`build-correct-answer-${i}`} style={{ fontSize: 13, color: C.blue, marginTop: 4 }}>Correct answer: {capitalize((r.q.answerOrder || []).join(" "))}</div>}
            </div>
          ))}
          <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
            <Btn onClick={onExit} variant="secondary">Back to Practice</Btn>
          </div>
        </div>
      </div>
    );
  }

  /* ---- Instruction phase ---- */
  if (phase === "instruction") {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        <TopBar title="Build a Sentence" section="Writing 闁?Task 1" onExit={onExit} />
        <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "32px 40px" }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 20, color: C.nav }}>Task 1: Build a Sentence</h2>
            <div style={{ fontSize: 14, color: C.t1, lineHeight: 1.8 }}>
              <p><b>Directions:</b> In this task, you will see prompt tokens and a set of bank chunks below. Drag or click the chunks to place them into the blank slots and form a grammatically correct sentence.</p>
              <p><b>Questions:</b> 9 (3 easy + 3 medium + 3 hard)</p>
              <p><b>Time limit:</b> 6 minutes</p>
              <p>The timer will start when you click <b>Start</b>. When time runs out, your answers will be submitted automatically.</p>
            </div>
            <div style={{ marginTop: 24, textAlign: "center" }}><Btn data-testid="build-start" onClick={startTimer}>Start</Btn></div>
          </div>
        </div>
      </div>
    );
  }

  /* ---- Active phase (slot-based UI) ---- */
  const q = qs[idx];
  const allFilled = slots.length > 0 && slots.every(s => s !== null);
  const tokenType = (t) => t?.t || t?.type;
  const tokenValue = (t) => t?.v || t?.value || "";

  const slotStyle = (i) => {
    const filled = slots[i] !== null;
    const isHover = hoverSlot === i && dragItem;
    return {
      minWidth: 80,
      minHeight: 40,
      padding: "6px 14px",
      borderRadius: 4,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 14,
      fontWeight: filled ? 500 : 400,
      cursor: filled ? "grab" : "default",
      userSelect: "none",
      transition: "border-color 0.15s, background 0.15s",
      ...(filled
        ? {
            background: C.blue,
            color: "#fff",
            border: "2px solid " + C.blue,
            opacity: dragItem && dragItem.from === "slot" && dragItem.slotIndex === i ? 0.4 : 1,
          }
        : {
            background: isHover ? "#e0ecff" : "#fafafa",
            color: "#aaa",
            border: "2px dashed " + (isHover ? C.blue : "#ccc"),
          }
      ),
    };
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      <TopBar title="Build a Sentence" section="Writing 闁?Task 1" timeLeft={tl} isRunning={run} qInfo={(idx + 1) + " / " + qs.length} onExit={onExit} />
      <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
        {/* Directions */}
        <div style={{ background: C.ltB, border: "1px solid #b3d4fc", borderRadius: 4, padding: 14, marginBottom: 20, fontSize: 13 }}>
          <b>Directions:</b> 闂備礁缍婇弨閬嶆偋濡ゅ啠鍋撳顒佸仴妤犵偛顑夊浠嬵敃椤厼瀵查梻浣告啞閸ㄨ泛危閹烘鍎婃繝闈涱儏闁裤倖淇婇妶鍌氫壕闂佹寧绻勯崑銈呯暦濡ゅ懎唯闁靛牆娲ㄩ幉顕€姊洪崫鍕偓绋匡耿闁秴鐓橀柡宥冨妽婵鈧箍鍎辩换鎺旂矆婢跺瞼纾藉ù锝囶焾椤忣亪鏌涢妸锕佸妞ゎ偁鍨介弫鎰板炊閿濆倸浜炬慨妞诲亾闁诡垰鍟村畷鐔碱敃閵忋垻鈼ら梺璇插缁嬫帡宕濋幋锕€鐒?
        </div>

        {/* Prompt + in-sentence slots */}
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: C.t2, letterSpacing: 1, marginBottom: 8 }}>PROMPT</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minHeight: 48, alignItems: "center", lineHeight: 1.6 }}>
            {(() => {
              let blankIndex = 0;
              return (q.promptTokens || []).map((token, ti) => {
                const tt = tokenType(token);
                if (tt === "text") {
                  return <span key={`text-${ti}`} style={{ fontSize: 16, color: C.t1 }}>{tokenValue(token)}</span>;
                }
                if (tt === "given") {
                  return (
                    <span key={`given-${ti}`} data-testid="given-token" style={{ fontSize: 14, color: C.nav, background: "#e6f0ff", border: "1px solid #b3d4fc", borderRadius: 4, padding: "4px 10px", fontWeight: 600 }}>
                      <span style={{ fontSize: 10, opacity: 0.8, marginRight: 6 }}>GIVEN</span>{tokenValue(token)}
                    </span>
                  );
                }
                if (tt === "blank") {
                  const sidx = blankIndex;
                  blankIndex += 1;
                  const slot = slots[sidx];
                  return (
                    <div
                      key={`blank-${ti}`}
                      data-testid={`slot-${sidx}`}
                      style={slotStyle(sidx)}
                      draggable={!!slot}
                      onDragStart={slot ? (e) => onDragStartSlot(e, slot, sidx) : undefined}
                      onDragEnd={slot ? onDragEnd : undefined}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setHoverSlot(sidx); }}
                      onDragLeave={() => setHoverSlot(null)}
                      onDrop={(e) => onDropSlot(e, sidx)}
                      onClick={() => slot && removeChunk(sidx)}
                    >
                      {slot ? slot.text : (sidx + 1)}
                    </div>
                  );
                }
                return null;
              });
            })()}
          </div>
        </div>

        {/* Word Bank */}
        <div
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setHoverBank(true); }}
          onDragLeave={() => setHoverBank(false)}
          onDrop={onDropBank}
          style={{
            background: hoverBank && dragItem && dragItem.from === "slot" ? "#fff3f3" : "#fff",
            border: "1px solid " + C.bdr,
            borderRadius: 4,
            padding: 16,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 20,
            minHeight: 48,
          }}
        >
          <div style={{ fontSize: 11, color: C.t2, width: "100%", marginBottom: 4, letterSpacing: 1 }}>WORD BANK</div>
          {bank.length === 0 && <span style={{ fontSize: 13, color: "#aaa", fontStyle: "italic" }}>闂備礁婀遍。浠嬪磻閹剧粯鐓涢柛顐ｇ箥濡插ジ鏌ｉ敂鐣岀疄鐎规洜顭堣灃闁逞屽墴瀹曟瑩鏁撻悩鑼摋闂佽鍨庨崘銊﹁緢</span>}
          {bank.map(chunk => (
            <button
              data-testid={`bank-chunk-${chunk.id}`}
              key={chunk.id}
              draggable
              onDragStart={(e) => onDragStartBank(e, chunk)}
              onDragEnd={onDragEnd}
              onClick={() => pickChunk(chunk)}
              style={{
                background: "#f8f9fa",
                color: C.t1,
                border: "1px solid " + C.bdr,
                borderRadius: 4,
                padding: "6px 14px",
                fontSize: 14,
                cursor: "grab",
                fontFamily: FONT,
                userSelect: "none",
                opacity: dragItem && dragItem.from === "bank" && dragItem.chunk.id === chunk.id ? 0.4 : 1,
              }}
            >{chunk.text}</button>
          ))}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 12 }}>
          <Btn onClick={resetQ} variant="secondary">Reset</Btn>
          <Btn data-testid="build-submit" onClick={submit} disabled={!allFilled}>
            {idx < qs.length - 1 ? "Next Question" : "Finish and Review"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ========== WRITING TASK (Email / Discussion) ========== */

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
        saveSess({ type, score: r.score, band: r.band, wordCount: wc(text), weaknesses: r.weaknesses, next_steps: r.next_steps });
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
      <TopBar title={taskTitle} section={"Writing 闁?" + (type === "email" ? "Task 2" : "Task 3")} timeLeft={phase !== "ready" ? tl : undefined} isRunning={run} onExit={onExit} />
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
          <div style={{ marginTop: 20 }}><ScorePanel result={fb} type={type} /><div style={{ display: "flex", gap: 12, marginTop: 16 }}><Btn onClick={next} variant="secondary">Next Prompt</Btn><Btn onClick={genNew} disabled={gen}>{gen ? "Generating..." : "Generate New Prompt"}</Btn><Btn onClick={onExit} variant="secondary">Back to Practice</Btn></div></div>
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

/* ========== PRACTICE HISTORY ========== */

function ProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
  useEffect(() => { setHist(loadHist()); }, []);
  if (!hist) return <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center" }}>Loading...</div>;
  const ss = hist.sessions || [];
  const em = ss.filter(s => s.type === "email");
  const di = ss.filter(s => s.type === "discussion");
  const bs = ss.filter(s => s.type === "bs");

  function handleDelete(realIndex) {
    if (!window.confirm("Delete this record?")) return;
    const newHist = deleteSession(realIndex);
    setHist({ ...newHist });
  }

  function handleClearAll() {
    if (!window.confirm("Delete all history records?")) return;
    const newHist = clearAllSessions();
    setHist({ ...newHist });
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title="Practice History" section="Progress" onExit={onBack} />
      <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
        {ss.length === 0 ? <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 40, textAlign: "center" }}>No history records yet.</div> : (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <button onClick={handleClearAll} style={{ background: C.red, color: "#fff", border: "none", borderRadius: 4, padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>Clear All</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
              {[
                { l: "Build", n: bs.length, s: bs.length ? Math.round(bs.reduce((a, s) => a + s.correct / s.total * 100, 0) / bs.length) + "%" : "-" },
                { l: "Email", n: em.length, s: em.length ? (em.reduce((a, s) => a + s.score, 0) / em.length).toFixed(1) + "/5" : "-" },
                { l: "Discussion", n: di.length, s: di.length ? (di.reduce((a, s) => a + s.score, 0) / di.length).toFixed(1) + "/5" : "-" }
              ].map((c, i) => <div key={i} style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 16, textAlign: "center" }}><div style={{ fontSize: 11, color: C.t2, marginBottom: 6 }}>{c.l}</div><div style={{ fontSize: 24, fontWeight: 700, color: C.nav }}>{c.n}</div><div style={{ fontSize: 12, color: C.t2 }}>{c.s}</div></div>)}
            </div>
            <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.nav, marginBottom: 12 }}>Recent Attempts</div>
              {ss.slice(-10).reverse().map((s, i) => {
                const realIndex = ss.length - 1 - i;
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < Math.min(ss.length, 10) - 1 ? "1px solid #eee" : "none" }}>
                    <div><span style={{ fontSize: 13, fontWeight: 600 }}>{s.type === "bs" ? "Build" : s.type === "email" ? "Email" : "Discussion"}</span><span style={{ fontSize: 11, color: C.t2, marginLeft: 8 }}>{new Date(s.date).toLocaleDateString()}</span></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: s.type === "bs" ? (s.correct / s.total >= 0.8 ? C.green : C.orange) : (s.score >= 4 ? C.green : s.score >= 3 ? C.orange : C.red) }}>{s.type === "bs" ? s.correct + "/" + s.total : s.score + "/5"}</span>
                      <button onClick={() => handleDelete(realIndex)} title="Delete this entry" style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, padding: "2px 6px", lineHeight: 1, fontWeight: 700, opacity: 0.6 }} onMouseOver={e => e.currentTarget.style.opacity = "1"} onMouseOut={e => e.currentTarget.style.opacity = "0.6"}>x</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ marginTop: 20 }}><Btn onClick={onBack} variant="secondary">Back to Menu</Btn></div>
      </div>
    </div>
  );
}

/* ========== MAIN APP ========== */

export default function ToeflApp() {
  const [v, setV] = useState("menu");

  if (v === "build") return <BuildSentenceTask onExit={() => setV("menu")} />;
  if (v === "email") return <WritingTask onExit={() => setV("menu")} type="email" />;
  if (v === "disc") return <WritingTask onExit={() => setV("menu")} type="discussion" />;
  if (v === "prog") return <ProgressView onBack={() => setV("menu")} />;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <div style={{ background: C.nav, color: "#fff", padding: "0 20px", height: 48, display: "flex", alignItems: "center", borderBottom: "3px solid " + C.navDk }}><span style={{ fontWeight: 700, fontSize: 15 }}>TOEFL iBT</span><span style={{ opacity: 0.5, margin: "0 12px" }}>|</span><span style={{ fontSize: 13 }}>Writing Section 2026</span></div>
      <div style={{ maxWidth: 800, margin: "32px auto", padding: "0 20px" }}>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "32px 40px", marginBottom: 24, textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.nav }}>Writing Section</h1>
          <p style={{ color: C.t2, fontSize: 14, margin: "8px 0 0" }}>New TOEFL iBT format practice</p>
        </div>
        {[
          { k: "build", n: "Task 1", t: "Build a Sentence", d: "Arrange chunks into a correct sentence. Easy / medium / hard sets.", ti: "~6 min", it: "9 Qs", tag: true },
          { k: "email", n: "Task 2", t: "Write an Email", d: "Write a professional email. 3 goals. 8 prompts.", ti: "7 min", it: "80-120w", tag: true },
          { k: "disc", n: "Task 3", t: "Academic Discussion", d: "Respond on a discussion board. 8 topics.", ti: "10 min", it: "100+w", tag: false },
        ].map(c => (
          <button data-testid={"task-" + c.k} key={c.k} onClick={() => setV(c.k)} style={{ display: "flex", width: "100%", textAlign: "left", background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 0, marginBottom: 12, cursor: "pointer", overflow: "hidden", fontFamily: FONT }}>
            <div style={{ width: 6, background: C.blue, flexShrink: 0 }} />
            <div style={{ padding: "16px 20px", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><span style={{ fontSize: 11, color: C.blue, fontWeight: 700, letterSpacing: 1 }}>{c.n}</span>{c.tag && <span style={{ fontSize: 10, color: "#fff", background: C.orange, padding: "1px 8px", borderRadius: 3, fontWeight: 700 }}>NEW</span>}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 4 }}>{c.t}</div>
              <div style={{ fontSize: 13, color: C.t2 }}>{c.d}</div>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", borderLeft: "1px solid " + C.bdr, minWidth: 110 }}><div style={{ fontSize: 14, fontWeight: 700, color: C.nav }}>{c.ti}</div><div style={{ fontSize: 12, color: C.t2 }}>{c.it}</div></div>
          </button>
        ))}
        <button data-testid="task-prog" onClick={() => setV("prog")} style={{ display: "flex", width: "100%", textAlign: "left", background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 0, marginTop: 8, marginBottom: 12, cursor: "pointer", fontFamily: FONT }}>
          <div style={{ width: 6, background: C.green, flexShrink: 0 }} />
          <div style={{ padding: "16px 20px", flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Practice History</div><div style={{ fontSize: 13, color: C.t2 }}>View recent attempts and score trends.</div></div>
          <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", color: C.blue, fontSize: 20 }}>&gt;</div>
        </button>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "14px 20px", fontSize: 12, color: C.t2 }}><b style={{ color: C.t1 }}>Powered by DeepSeek AI</b> | ETS-style scoring | Grammar diagnostics | Weakness tracking | AI question generation</div>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "14px 20px", marginTop: 12, fontSize: 11, color: C.t2, lineHeight: 1.6 }}>
          <b style={{ color: C.t1 }}>Disclaimer:</b> This tool is an independent practice resource and is not affiliated with, endorsed by, or associated with ETS or the TOEFL program. TOEFL and TOEFL iBT are registered trademarks of ETS. AI scoring is based on publicly available ETS rubric criteria and is intended for self-study reference only. Scores may not reflect actual TOEFL exam results.
        </div>
      </div>
    </div>
  );
}

