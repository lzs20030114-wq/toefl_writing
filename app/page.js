"use client";
import Link from "next/link";
import { C, FONT } from "../components/shared/ui";

const TASKS = [
  { k: "build-sentence", n: "Task 1", t: "Build a Sentence", d: "Arrange chunks into a correct sentence. Easy / medium / hard sets.", ti: "5m 50s", it: "10 Qs", tag: true },
  { k: "email-writing", n: "Task 2", t: "Write an Email", d: "Write a professional email. 3 goals. 8 prompts.", ti: "7 min", it: "80-120w", tag: true },
  { k: "academic-writing", n: "Task 3", t: "Academic Discussion", d: "Respond on a discussion board. 8 topics.", ti: "10 min", it: "100+w", tag: false },
];

export default function Page() {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <div style={{ background: C.nav, color: "#fff", padding: "0 20px", height: 48, display: "flex", alignItems: "center", borderBottom: "3px solid " + C.navDk }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>TOEFL iBT</span>
        <span style={{ opacity: 0.5, margin: "0 12px" }}>|</span>
        <span style={{ fontSize: 13 }}>Writing Section 2026</span>
      </div>
      <div style={{ maxWidth: 800, margin: "32px auto", padding: "0 20px" }}>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "32px 40px", marginBottom: 24, textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.nav }}>Writing Section</h1>
          <p style={{ color: C.t2, fontSize: 14, margin: "8px 0 0" }}>New TOEFL iBT format practice</p>
        </div>
        {TASKS.map(c => (
          <Link href={"/" + c.k} key={c.k} style={{ display: "flex", width: "100%", textAlign: "left", background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 0, marginBottom: 12, cursor: "pointer", overflow: "hidden", fontFamily: FONT, textDecoration: "none", color: "inherit" }}>
            <div style={{ width: 6, background: C.blue, flexShrink: 0 }} />
            <div style={{ padding: "16px 20px", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: C.blue, fontWeight: 700, letterSpacing: 1 }}>{c.n}</span>
                {c.tag && <span style={{ fontSize: 10, color: "#fff", background: C.orange, padding: "1px 8px", borderRadius: 3, fontWeight: 700 }}>NEW</span>}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 4 }}>{c.t}</div>
              <div style={{ fontSize: 13, color: C.t2 }}>{c.d}</div>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", borderLeft: "1px solid " + C.bdr, minWidth: 110 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.nav }}>{c.ti}</div>
              <div style={{ fontSize: 12, color: C.t2 }}>{c.it}</div>
            </div>
          </Link>
        ))}
        <Link href="/progress" style={{ display: "flex", width: "100%", textAlign: "left", background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 0, marginTop: 8, marginBottom: 12, cursor: "pointer", fontFamily: FONT, textDecoration: "none", color: "inherit" }}>
          <div style={{ width: 6, background: C.green, flexShrink: 0 }} />
          <div style={{ padding: "16px 20px", flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Practice History</div>
            <div style={{ fontSize: 13, color: C.t2 }}>View recent attempts and score trends.</div>
          </div>
          <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", color: C.blue, fontSize: 20 }}>&gt;</div>
        </Link>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "14px 20px", fontSize: 12, color: C.t2 }}>
          <b style={{ color: C.t1 }}>Powered by DeepSeek AI</b> | ETS-style scoring | Grammar diagnostics | Weakness tracking | AI question generation
        </div>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "14px 20px", marginTop: 12, fontSize: 11, color: C.t2, lineHeight: 1.6 }}>
          <b style={{ color: C.t1 }}>Disclaimer:</b> This tool is an independent practice resource and is not affiliated with, endorsed by, or associated with ETS or the TOEFL program. TOEFL and TOEFL iBT are registered trademarks of ETS. AI scoring is based on publicly available ETS rubric criteria and is intended for self-study reference only. Scores may not reflect actual TOEFL exam results.
        </div>
      </div>
    </div>
  );
}
