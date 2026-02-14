"use client";
import React, { useState, useEffect, useRef } from "react";
import BS_DATA from "../data/buildSentence.json";
import EM_DATA from "../data/emailPrompts.json";
import AD_DATA from "../data/discussionPrompts.json";

function fmt(s) { return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
function wc(t) { return t.trim() ? t.trim().split(/\s+/).length : 0; }
function shuffle(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function norm(s) { return s.toLowerCase().replace(/[.,!?]/g, "").trim(); }

/* --- localStorage helpers --- */
function loadHist() { try { return JSON.parse(localStorage.getItem("toefl-hist") || '{"sessions":[]}'); } catch { return { sessions: [] }; } }
function saveSess(s) { try { const h = loadHist(); h.sessions.push({ ...s, date: new Date().toISOString() }); if (h.sessions.length > 50) h.sessions = h.sessions.slice(-50); localStorage.setItem("toefl-hist", JSON.stringify(h)); } catch (e) { console.error(e); } }
function deleteSession(index) { try { const h = loadHist(); h.sessions.splice(index, 1); localStorage.setItem("toefl-hist", JSON.stringify(h)); return h; } catch (e) { console.error(e); return loadHist(); } }
function clearAllSessions() { try { localStorage.setItem("toefl-hist", JSON.stringify({ sessions: [] })); return { sessions: [] }; } catch (e) { console.error(e); return { sessions: [] }; } }

function loadDoneIds(key) { try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set(); } }
function addDoneIds(key, ids) { try { const done = loadDoneIds(key); ids.forEach(id => done.add(id)); localStorage.setItem(key, JSON.stringify([...done])); } catch (e) { console.error(e); } }

/* --- Build a Sentence question selection (3 easy + 3 medium + 3 hard) --- */
function selectBSQuestions() {
  const doneIds = loadDoneIds("toefl-bs-done");
  const byDiff = { easy: [], medium: [], hard: [] };
  BS_DATA.forEach(q => { if (byDiff[q.difficulty]) byDiff[q.difficulty].push(q); });

  function pickN(pool, n) {
    const undone = pool.filter(q => !doneIds.has(q.id));
    const source = undone.length >= n ? undone : pool;
    return shuffle(source).slice(0, Math.min(n, source.length));
  }

  const selected = [
    ...pickN(byDiff.easy, 3),
    ...pickN(byDiff.medium, 3),
    ...pickN(byDiff.hard, 3),
  ];
  return shuffle(selected);
}

/* --- Pick random prompt for Email/Discussion, preferring undone --- */
function pickRandomPrompt(data, usedSessionSet, storageKey) {
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
async function callAI(system, message, maxTokens) {
  const r = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, message, maxTokens: maxTokens || 1200 }),
  });
  if (!r.ok) throw new Error("API error " + r.status);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.content;
}

const EMAIL_SYS = "You are a STRICT ETS TOEFL iBT 2026 Writing scorer. Score the email 0-5 with ZERO inflation. RUBRIC: 5(RARE)=CONSISTENT facility,PRECISE/IDIOMATIC,almost NO errors. 4=MOSTLY effective,ADEQUATE,FEW errors. 3=GENERALLY accomplishes but NOTICEABLE errors. 2=MOSTLY UNSUCCESSFUL. 1=UNSUCCESSFUL. Most score 3-4. BAND: 5=5.0-6.0,4=4.0-4.5,3=3.0-3.5,2=2.0-2.5,1=1.0-1.5. Find ALL weaknesses first. IMPORTANT: Write summary, weaknesses, strengths, grammar_issues, vocabulary_note, next_steps ALL in Chinese (简体中文). The sample model response should remain in English. Return ONLY JSON: {\"score\":0,\"band\":0.0,\"goals_met\":[false,false,false],\"summary\":\"中文总结...\",\"weaknesses\":[\"中文弱点...\"],\"strengths\":[\"中文优点...\"],\"grammar_issues\":[\"中文语法问题...\"],\"vocabulary_note\":\"中文词汇点评...\",\"next_steps\":[\"中文改进建议...\"],\"sample\":\"English model response\"}";

const DISC_SYS = "You are a STRICT ETS TOEFL iBT 2026 Writing scorer. Score the discussion post 0-5 with ZERO inflation. RUBRIC: 5(RARE)=VERY CLEAR,WELL-ELABORATED,PRECISE/IDIOMATIC. 4=RELEVANT,ADEQUATELY elaborated,FEW errors. 3=MOSTLY relevant,NOTICEABLE errors. 2=MOSTLY UNSUCCESSFUL. 1=UNSUCCESSFUL. Most score 3-4. BAND: 5=5.0-6.0,4=4.0-4.5,3=3.0-3.5,2=2.0-2.5,1=1.0-1.5. Find ALL weaknesses first. IMPORTANT: Write summary, weaknesses, strengths, grammar_issues, vocabulary_note, argument_quality, next_steps ALL in Chinese (简体中文). The sample model response should remain in English. Return ONLY JSON: {\"score\":0,\"band\":0.0,\"engages_professor\":false,\"engages_students\":false,\"summary\":\"中文总结...\",\"weaknesses\":[\"中文弱点...\"],\"strengths\":[\"中文优点...\"],\"grammar_issues\":[\"中文语法问题...\"],\"vocabulary_note\":\"中文词汇点评...\",\"argument_quality\":\"中文论证质量评价...\",\"next_steps\":[\"中文改进建议...\"],\"sample\":\"English model response\"}";

async function aiEval(type, pd, text) {
  const sys = type === "email" ? EMAIL_SYS : DISC_SYS;
  const up = type === "email"
    ? "Scenario: " + pd.scenario + "\nGoals:\n" + pd.goals.map((g, i) => (i + 1) + ". " + g).join("\n") + "\n\nStudent email:\n" + text
    : "Prof " + pd.professor.name + ": " + pd.professor.text + "\n\n" + pd.students.map(s => s.name + ": " + s.text).join("\n\n") + "\n\nStudent response:\n" + text;
  try {
    const raw = await callAI(sys, up, 1200);
    return JSON.parse(raw.replace(/```json/g, "").replace(/```/g, "").trim());
  } catch (e) { console.error(e); return null; }
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

function Btn({ children, onClick, disabled, variant }) {
  const colors = { primary: { bg: C.blue, c: "#fff" }, secondary: { bg: "#fff", c: C.blue }, success: { bg: C.green, c: "#fff" }, danger: { bg: C.red, c: "#fff" } };
  const s = colors[variant || "primary"] || colors.primary;
  return <button onClick={onClick} disabled={disabled} style={{ background: disabled ? "#ccc" : s.bg, color: disabled ? "#888" : s.c, border: "1px solid " + (disabled ? "#ccc" : s.bg), padding: "8px 24px", borderRadius: 4, fontSize: 14, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", fontFamily: FONT }}>{children}</button>;
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
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}><span style={{ fontWeight: 700, fontSize: 15 }}>TOEFL iBT®</span><span style={{ opacity: 0.5 }}>|</span><span style={{ fontSize: 13 }}>{section}</span></div>
      <div style={{ fontSize: 13, opacity: 0.9 }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {qInfo && <span style={{ fontSize: 12, opacity: 0.8 }}>{qInfo}</span>}
        {timeLeft !== undefined && <div style={{ background: timeLeft <= 60 ? "rgba(220,53,69,0.6)" : "rgba(255,255,255,0.13)", padding: "4px 12px", borderRadius: 4, fontFamily: "Consolas,monospace", fontSize: 16, fontWeight: 700 }}>{fmt(timeLeft)}</div>}
        <button onClick={onExit} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12, fontFamily: FONT }}>退出</button>
      </div>
    </div>
  );
}

function ScorePanel({ result, type }) {
  if (!result) return null;
  const sc = result.score >= 4 ? C.green : result.score >= 3 ? C.orange : C.red;
  return (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, overflow: "hidden" }}>
      <div style={{ background: C.nav, color: "#fff", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>ETS评分标准</div>
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
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>交际目标达成</div>
            {result.goals_met.map((m, i) => <div key={i} style={{ fontSize: 13, marginBottom: 3 }}><span style={{ color: m ? C.green : C.red, fontWeight: 700, marginRight: 6 }}>{m ? "✓" : "✗"}</span>目标 {i + 1}</div>)}
          </div>
        )}
        {type === "discussion" && (
          <div style={{ background: C.ltB, borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>讨论参与度</div>
            <div style={{ fontSize: 13, marginBottom: 3 }}><span style={{ color: result.engages_professor ? C.green : C.red, fontWeight: 700, marginRight: 6 }}>{result.engages_professor ? "✓" : "✗"}</span>教授</div>
            <div style={{ fontSize: 13 }}><span style={{ color: result.engages_students ? C.green : C.red, fontWeight: 700, marginRight: 6 }}>{result.engages_students ? "✓" : "✗"}</span>同学</div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ background: "#f0fff4", border: "1px solid #c6f6d5", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 6 }}>优点</div>
            {(result.strengths || []).map((s, i) => <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>+ {s}</div>)}
          </div>
          <div style={{ background: "#fff5f5", border: "1px solid #fed7d7", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.red, marginBottom: 6 }}>不足</div>
            {(result.weaknesses || []).map((s, i) => <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>→ {s}</div>)}
          </div>
        </div>
        {result.grammar_issues && result.grammar_issues.length > 0 && (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#b45309", marginBottom: 6 }}>语言诊断</div>
            {result.grammar_issues.map((g, i) => <div key={i} style={{ fontSize: 13, marginBottom: 3 }}>• {g}</div>)}
            {result.vocabulary_note && <div style={{ fontSize: 13, marginTop: 6 }}><b>词汇：</b> {result.vocabulary_note}</div>}
            {result.argument_quality && <div style={{ fontSize: 13, marginTop: 4 }}><b>论证：</b> {result.argument_quality}</div>}
          </div>
        )}
        {result.next_steps && result.next_steps.length > 0 && (
          <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>下一步改进</div>
            {result.next_steps.map((s, i) => <div key={i} style={{ fontSize: 13, marginBottom: 4 }}><b style={{ color: C.blue }}>{i + 1}.</b> {s}</div>)}
          </div>
        )}
        {result.sample && (
          <div style={{ background: "#f8f9fa", border: "1px solid " + C.bdr, borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>满分范文 (Score 5)</div>
            <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0, fontStyle: "italic" }}>{result.sample}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ========== BUILD A SENTENCE (Slot-based UI) ========== */

function BuildSentenceTask({ onExit }) {
  const [qs, setQs] = useState(() => selectBSQuestions());
  const [idx, setIdx] = useState(0);
  const [slots, setSlots] = useState([]);
  const [bank, setBank] = useState([]);
  const [results, setResults] = useState([]);
  const [phase, setPhase] = useState("instruction");
  const [tl, setTl] = useState(360);
  const [run, setRun] = useState(false);
  const [gen, setGen] = useState(false);
  const [toast, setToast] = useState(null);
  const tr = useRef(null);

  const autoSubmitRef = useRef(false);
  const resultsRef = useRef([]);
  const idxRef = useRef(0);
  const slotsRef = useRef([]);

  /* Drag state */
  const [dragItem, setDragItem] = useState(null); // { from: "bank"|"slot", chunk, slotIndex? }
  const [hoverSlot, setHoverSlot] = useState(null);
  const [hoverBank, setHoverBank] = useState(false);

  function initQ(i, questions) {
    const q = questions[i];
    const numSlots = q.hasDistractor ? q.chunks.length - 1 : q.chunks.length;
    setBank(shuffle(q.chunks.map((c, j) => ({ text: c, id: i + "-" + j }))));
    setSlots(Array(numSlots).fill(null));
  }

  function startTimer() {
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
      const curAnswer = curSlots.filter(s => s).map(s => s.text).join(" ");
      const curOk = norm(curAnswer) === norm(curQ.answer);
      let nr = [...resultsRef.current, { q: curQ, userAnswer: curAnswer || "(no answer)", isCorrect: curOk }];
      for (let i = idxRef.current + 1; i < qs.length; i++) {
        nr.push({ q: qs[i], userAnswer: "(no answer)", isCorrect: false });
      }
      setResults(nr);
      setPhase("review");
      saveSess({ type: "bs", correct: nr.filter(r => r.isCorrect).length, total: nr.length, errors: nr.filter(r => !r.isCorrect).map(r => r.q.gp) });
      addDoneIds("toefl-bs-done", qs.map(q => q.id));
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
    const q = qs[idx];
    const ua = slots.filter(s => s).map(s => s.text).join(" ");
    const ok = norm(ua) === norm(q.answer);
    const nr = [...results, { q, userAnswer: ua || "(no answer)", isCorrect: ok }];
    setResults(nr);
    if (idx < qs.length - 1) { setIdx(idx + 1); initQ(idx + 1, qs); }
    else {
      clearInterval(tr.current); setRun(false); setPhase("review");
      saveSess({ type: "bs", correct: nr.filter(r => r.isCorrect).length, total: nr.length, errors: nr.filter(r => !r.isCorrect).map(r => r.q.gp) });
      addDoneIds("toefl-bs-done", qs.map(q => q.id));
    }
  }

  async function genNew() {
    setGen(true);
    const d = await aiGen("buildSentence");
    if (d && Array.isArray(d)) {
      const m = d.map((x, i) => ({ id: "gen" + i, hasDistractor: false, difficulty: "medium", ...x }));
      setQs(m); setIdx(0); setResults([]); setPhase("active"); setTl(360); setRun(true); initQ(0, m);
      tr.current = setInterval(() => setTl(p => { if (p <= 1) { clearInterval(tr.current); setRun(false); autoSubmitRef.current = true; return 0; } return p - 1; }), 1000);
    } else {
      setToast("题目生成失败，请稍后重试");
    }
    setGen(false);
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
        <TopBar title="Build a Sentence — 报告" section="Writing" onExit={onExit} />
        <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
          <div style={{ background: C.nav, color: "#fff", borderRadius: 6, padding: 24, textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 48, fontWeight: 800 }}>{ok}/{results.length}</div>
            <div style={{ fontSize: 14, opacity: 0.7 }}>正确</div>
          </div>
          {te.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 12 }}>语法薄弱点</div>
              {te.map(([g, n], i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < te.length - 1 ? "1px solid #eee" : "none" }}><span>{g}</span><span style={{ background: "#fee2e2", color: C.red, padding: "2px 10px", borderRadius: 10, fontSize: 12, fontWeight: 600 }}>{n}x</span></div>)}
              <div style={{ marginTop: 12, fontSize: 13, color: C.blue, background: C.ltB, padding: 10, borderRadius: 4 }}><b>下一步：</b> 重点练习 {te.map(e => e[0]).join(" 和 ")}。</div>
            </div>
          )}
          {results.map((r, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid " + (r.isCorrect ? "#c6f6d5" : "#fed7d7"), borderLeft: "4px solid " + (r.isCorrect ? C.green : C.red), borderRadius: 4, padding: 14, marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>Q{i + 1}: {r.q.prompt} <span style={{ color: C.blue }}>({r.q.gp})</span></div>
              <div style={{ fontSize: 14, color: r.isCorrect ? C.green : C.red }}>{r.isCorrect ? "✓" : "✗"} {capitalize(r.userAnswer)}</div>
              {!r.isCorrect && <div style={{ fontSize: 13, color: C.blue, marginTop: 4 }}>正确：{capitalize(r.q.answer)}</div>}
            </div>
          ))}
          <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
            <Btn onClick={onExit} variant="secondary">菜单</Btn>
            <Btn onClick={genNew} disabled={gen}>{gen ? "生成中..." : "AI生成新题"}</Btn>
          </div>
        </div>
      </div>
    );
  }

  /* ---- Instruction phase ---- */
  if (phase === "instruction") {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        <TopBar title="Build a Sentence" section="Writing · Task 1" onExit={onExit} />
        <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "32px 40px" }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 20, color: C.nav }}>Task 1: Build a Sentence</h2>
            <div style={{ fontSize: 14, color: C.t1, lineHeight: 1.8 }}>
              <p><b>Directions:</b> In this task, you will see a prompt and a set of word chunks below. Drag or click the chunks to place them into the correct slots and form a grammatically correct sentence. Some questions may include an extra word that does not belong in the answer.</p>
              <p><b>Questions:</b> 9 (3 easy + 3 medium + 3 hard)</p>
              <p><b>Time limit:</b> 6 minutes</p>
              <p>The timer will start when you click <b>Start</b>. When time runs out, your answers will be submitted automatically.</p>
            </div>
            <div style={{ marginTop: 24, textAlign: "center" }}><Btn onClick={startTimer}>Start</Btn></div>
          </div>
        </div>
      </div>
    );
  }

  /* ---- Active phase (slot-based UI) ---- */
  const q = qs[idx];
  const allFilled = slots.length > 0 && slots.every(s => s !== null);

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
      <TopBar title="Build a Sentence" section="Writing · Task 1" timeLeft={tl} isRunning={run} qInfo={(idx + 1) + " / " + qs.length} onExit={onExit} />
      <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
        {/* Directions */}
        <div style={{ background: C.ltB, border: "1px solid #b3d4fc", borderRadius: 4, padding: 14, marginBottom: 20, fontSize: 13 }}>
          <b>Directions:</b> 拖拽或点击词块填入下方空位，组成正确的句子。
          {q.hasDistractor && <span style={{ color: C.orange, fontWeight: 600, marginLeft: 8 }}>注意：有一个多余的词不需要使用。</span>}
        </div>

        {/* Prompt */}
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: C.t2, letterSpacing: 1, marginBottom: 8 }}>PROMPT</div>
          <div style={{ fontSize: 16, color: C.t1 }}>{q.prompt}</div>
        </div>

        {/* Difficulty badge */}
        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 10,
            background: q.difficulty === "easy" ? "#dcfce7" : q.difficulty === "medium" ? "#fef3c7" : "#fee2e2",
            color: q.difficulty === "easy" ? C.green : q.difficulty === "medium" ? "#b45309" : C.red,
          }}>{q.difficulty.toUpperCase()}</span>
          <span style={{ fontSize: 12, color: C.t2 }}>{q.gp}</span>
        </div>

        {/* Slots */}
        <div style={{ background: "#fff", border: "2px solid " + (allFilled ? C.green : C.blue), borderRadius: 4, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.t2, marginBottom: 10, letterSpacing: 1 }}>YOUR SENTENCE</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minHeight: 48, alignItems: "center" }}>
            {slots.map((slot, i) => (
              <div
                key={i}
                style={slotStyle(i)}
                draggable={!!slot}
                onDragStart={slot ? (e) => onDragStartSlot(e, slot, i) : undefined}
                onDragEnd={slot ? onDragEnd : undefined}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setHoverSlot(i); }}
                onDragLeave={() => setHoverSlot(null)}
                onDrop={(e) => onDropSlot(e, i)}
                onClick={() => slot && removeChunk(i)}
              >
                {slot ? slot.text : (i + 1)}
              </div>
            ))}
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
          {bank.length === 0 && <span style={{ fontSize: 13, color: "#aaa", fontStyle: "italic" }}>{q.hasDistractor && allFilled ? "剩余的词为干扰词" : "所有词块已放入"}</span>}
          {bank.map(chunk => (
            <button
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
          <Btn onClick={resetQ} variant="secondary">重置</Btn>
          <Btn onClick={submit} disabled={!allFilled}>{idx < qs.length - 1 ? "下一题 →" : "提交全部"}</Btn>
        </div>
      </div>
    </div>
  );
}

/* ========== WRITING TASK (Email / Discussion) ========== */

function WritingTask({ onExit, type }) {
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
  const [gen, setGen] = useState(false);
  const [toast, setToast] = useState(null);
  const tr = useRef(null);

  useEffect(() => { setPd(data[pi]); }, [pi, data]);

  const submitRef = useRef(null);
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  function start() { setPhase("writing"); setRun(true); tr.current = setInterval(() => setTl(p => { if (p <= 1) { clearInterval(tr.current); setRun(false); return 0; } return p - 1; }), 1000); }

  async function submitScore() {
    clearInterval(tr.current); setRun(false); setPhase("scoring");
    const r = await aiEval(type, pd, text);
    setFb(r);
    setPhase("done");
    if (r) {
      saveSess({ type, score: r.score, band: r.band, wordCount: wc(text), weaknesses: r.weaknesses, next_steps: r.next_steps });
      addDoneIds(storageKey, [pd.id]);
    }
  }
  submitRef.current = submitScore;

  async function retryScore() {
    setPhase("scoring"); setFb(null);
    const r = await aiEval(type, pd, text);
    setFb(r); setPhase("done");
    if (r) {
      saveSess({ type, score: r.score, band: r.band, wordCount: wc(text), weaknesses: r.weaknesses, next_steps: r.next_steps });
      addDoneIds(storageKey, [pd.id]);
    }
  }

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
    setPi(n); setPd(data[n]); setText(""); setTl(limit); setRun(false); setPhase("ready"); setFb(null);
  }
  async function genNew() {
    setGen(true);
    const d = await aiGen(type);
    if (d) { setPd({ id: "gen", ...d }); setText(""); setTl(limit); setRun(false); setPhase("ready"); setFb(null); }
    else { setToast("题目生成失败，请稍后重试"); }
    setGen(false);
  }
  useEffect(() => () => clearInterval(tr.current), []);

  const w = wc(text);
  const taskTitle = type === "email" ? "Write an Email" : "Academic Discussion";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      <TopBar title={taskTitle} section={"Writing · " + (type === "email" ? "Task 2" : "Task 3")} timeLeft={phase !== "ready" ? tl : undefined} isRunning={run} onExit={onExit} />
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
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}><div style={{ width: 32, height: 32, borderRadius: "50%", background: C.nav, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{pd.professor.name.split(" ").pop()[0]}</div><div><div style={{ fontSize: 13, fontWeight: 700 }}>{pd.professor.name}</div><div style={{ fontSize: 11, color: C.t2 }}>教授</div></div></div>
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
              <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 40, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}><div style={{ fontSize: 14, color: C.t2 }}>点击开始计时。</div><Btn onClick={start}>开始写作</Btn></div>
            ) : (
              <>
                <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, overflow: "hidden", flex: 1, display: "flex", flexDirection: "column" }}>
                  <div style={{ background: "#e8e8e8", padding: "10px 16px", fontSize: 12, fontWeight: 700, color: C.t2, borderBottom: "1px solid " + C.bdr, display: "flex", justifyContent: "space-between" }}><span>你的回答</span><span style={{ color: w < minW ? C.orange : C.green }}>{w} 词 {w < minW ? "(还差 " + (minW - w) + ")" : "✓"}</span></div>
                  <textarea value={text} onChange={e => setText(e.target.value)} disabled={phase === "scoring" || phase === "done"} placeholder={type === "email" ? "Dear " + pd.to + ",\n\nI am writing to..." : "I think this is an interesting question..."} style={{ flex: 1, minHeight: type === "email" ? 280 : 320, border: "none", padding: 16, fontSize: 14, fontFamily: FONT, lineHeight: 1.7, color: C.t1, resize: "none", outline: "none", background: phase === "done" ? "#fafafa" : "#fff" }} />
                </div>
                {phase === "writing" && <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Btn onClick={submitScore} disabled={w < 10} variant="success">提交评分</Btn><span style={{ fontSize: 11, color: C.t2 }}>Ctrl+Enter</span></div>}
              </>
            )}
            {phase === "scoring" && <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 32, textAlign: "center", color: C.t2 }}>AI评分中...</div>}
          </div>
        </div>
        {phase === "done" && fb && (
          <div style={{ marginTop: 20 }}><ScorePanel result={fb} type={type} /><div style={{ display: "flex", gap: 12, marginTop: 16 }}><Btn onClick={next} variant="secondary">下一题</Btn><Btn onClick={genNew} disabled={gen}>{gen ? "生成中..." : "AI生成新题"}</Btn><Btn onClick={onExit} variant="secondary">菜单</Btn></div></div>
        )}
        {phase === "done" && !fb && (
          <div style={{ marginTop: 20 }}>
            <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 32, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⚠</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.red, marginBottom: 8 }}>评分失败</div>
              <div style={{ fontSize: 14, color: C.t2, marginBottom: 20 }}>AI服务暂时不可用，请稍后重试。</div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <Btn onClick={retryScore}>重试</Btn>
                <Btn onClick={onExit} variant="secondary">菜单</Btn>
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
    if (!window.confirm("确定删除这条记录吗？")) return;
    const newHist = deleteSession(realIndex);
    setHist({ ...newHist });
  }

  function handleClearAll() {
    if (!window.confirm("确定清空所有练习记录？此操作不可撤销")) return;
    const newHist = clearAllSessions();
    setHist({ ...newHist });
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title="练习历史" section="Progress" onExit={onBack} />
      <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
        {ss.length === 0 ? <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 40, textAlign: "center" }}>暂无练习记录</div> : (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <button onClick={handleClearAll} style={{ background: C.red, color: "#fff", border: "none", borderRadius: 4, padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>清空全部历史</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
              {[
                { l: "Build", n: bs.length, s: bs.length ? Math.round(bs.reduce((a, s) => a + s.correct / s.total * 100, 0) / bs.length) + "%" : "—" },
                { l: "Email", n: em.length, s: em.length ? (em.reduce((a, s) => a + s.score, 0) / em.length).toFixed(1) + "/5" : "—" },
                { l: "Discussion", n: di.length, s: di.length ? (di.reduce((a, s) => a + s.score, 0) / di.length).toFixed(1) + "/5" : "—" }
              ].map((c, i) => <div key={i} style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 16, textAlign: "center" }}><div style={{ fontSize: 11, color: C.t2, marginBottom: 6 }}>{c.l}</div><div style={{ fontSize: 24, fontWeight: 700, color: C.nav }}>{c.n}</div><div style={{ fontSize: 12, color: C.t2 }}>{c.s}</div></div>)}
            </div>
            <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.nav, marginBottom: 12 }}>最近记录</div>
              {ss.slice(-10).reverse().map((s, i) => {
                const realIndex = ss.length - 1 - i;
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < Math.min(ss.length, 10) - 1 ? "1px solid #eee" : "none" }}>
                    <div><span style={{ fontSize: 13, fontWeight: 600 }}>{s.type === "bs" ? "Build" : s.type === "email" ? "Email" : "Discussion"}</span><span style={{ fontSize: 11, color: C.t2, marginLeft: 8 }}>{new Date(s.date).toLocaleDateString()}</span></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: s.type === "bs" ? (s.correct / s.total >= 0.8 ? C.green : C.orange) : (s.score >= 4 ? C.green : s.score >= 3 ? C.orange : C.red) }}>{s.type === "bs" ? s.correct + "/" + s.total : s.score + "/5"}</span>
                      <button onClick={() => handleDelete(realIndex)} title="删除" style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, padding: "2px 6px", lineHeight: 1, fontWeight: 700, opacity: 0.6 }} onMouseOver={e => e.currentTarget.style.opacity = "1"} onMouseOut={e => e.currentTarget.style.opacity = "0.6"}>×</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ marginTop: 20 }}><Btn onClick={onBack} variant="secondary">菜单</Btn></div>
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
      <div style={{ background: C.nav, color: "#fff", padding: "0 20px", height: 48, display: "flex", alignItems: "center", borderBottom: "3px solid " + C.navDk }}><span style={{ fontWeight: 700, fontSize: 15 }}>TOEFL iBT®</span><span style={{ opacity: 0.5, margin: "0 12px" }}>|</span><span style={{ fontSize: 13 }}>Writing Section — 2026</span></div>
      <div style={{ maxWidth: 800, margin: "32px auto", padding: "0 20px" }}>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "32px 40px", marginBottom: 24, textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.nav }}>Writing Section</h1>
          <p style={{ color: C.t2, fontSize: 14, margin: "8px 0 0" }}>New TOEFL iBT — January 21, 2026</p>
        </div>
        {[
          { k: "build", n: "Task 1", t: "Build a Sentence", d: "拖拽词块组成正确句子。题库含 easy / medium / hard 三档。", ti: "~6 min", it: "9 Qs", tag: true },
          { k: "email", n: "Task 2", t: "Write an Email", d: "Write a professional email. 3 goals. 8 prompts.", ti: "7 min", it: "80-120w", tag: true },
          { k: "disc", n: "Task 3", t: "Academic Discussion", d: "Respond on a discussion board. 8 topics.", ti: "10 min", it: "100+w", tag: false },
        ].map(c => (
          <button key={c.k} onClick={() => setV(c.k)} style={{ display: "flex", width: "100%", textAlign: "left", background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 0, marginBottom: 12, cursor: "pointer", overflow: "hidden", fontFamily: FONT }}>
            <div style={{ width: 6, background: C.blue, flexShrink: 0 }} />
            <div style={{ padding: "16px 20px", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><span style={{ fontSize: 11, color: C.blue, fontWeight: 700, letterSpacing: 1 }}>{c.n}</span>{c.tag && <span style={{ fontSize: 10, color: "#fff", background: C.orange, padding: "1px 8px", borderRadius: 3, fontWeight: 700 }}>NEW</span>}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 4 }}>{c.t}</div>
              <div style={{ fontSize: 13, color: C.t2 }}>{c.d}</div>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", borderLeft: "1px solid " + C.bdr, minWidth: 110 }}><div style={{ fontSize: 14, fontWeight: 700, color: C.nav }}>{c.ti}</div><div style={{ fontSize: 12, color: C.t2 }}>{c.it}</div></div>
          </button>
        ))}
        <button onClick={() => setV("prog")} style={{ display: "flex", width: "100%", textAlign: "left", background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 0, marginTop: 8, marginBottom: 12, cursor: "pointer", fontFamily: FONT }}>
          <div style={{ width: 6, background: C.green, flexShrink: 0 }} />
          <div style={{ padding: "16px 20px", flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>练习历史</div><div style={{ fontSize: 13, color: C.t2 }}>分数趋势与改进方向</div></div>
          <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", color: C.blue, fontSize: 20 }}>→</div>
        </button>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "14px 20px", fontSize: 12, color: C.t2 }}><b style={{ color: C.t1 }}>Powered by DeepSeek AI</b> · ETS 0–5 scoring · Grammar diagnostics · Weakness tracking · AI question generation</div>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "14px 20px", marginTop: 12, fontSize: 11, color: C.t2, lineHeight: 1.6 }}>
          <b style={{ color: C.t1 }}>Disclaimer:</b> This tool is an independent practice resource and is not affiliated with, endorsed by, or associated with ETS or the TOEFL program. TOEFL and TOEFL iBT are registered trademarks of ETS. AI scoring is based on publicly available ETS rubric criteria and is intended for self-study reference only. Scores may not reflect actual TOEFL exam results.
        </div>
      </div>
    </div>
  );
}
