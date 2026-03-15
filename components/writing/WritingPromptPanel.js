"use client";
import React from "react";
import { C, SurfaceCard } from "../shared/ui";

export function WritingPromptPanel({ type, pd }) {
  const emailGoals = Array.isArray(pd?.goals) ? pd.goals : [];
  const professorName = String(pd?.professor?.name || "Professor");
  const professorText = String(pd?.professor?.text || "");
  const students = Array.isArray(pd?.students) ? pd.students : [];
  const professorInitial = professorName.trim() ? professorName.trim().slice(0, 1).toUpperCase() : "P";
  const course = pd?.course ? String(pd.course) : "";

  return (
    <SurfaceCard style={{ overflow: "hidden" }}>
      <div style={{ background: C.ltB, padding: "12px 16px", fontSize: 12, fontWeight: 700, color: C.t2, borderBottom: "1px solid " + C.bdrSubtle }}>
        {type === "email" ? "Email Prompt" : "Discussion Board"}
      </div>
      {type === "email" ? (
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 14, color: C.t1, lineHeight: 1.7, margin: "0 0 12px" }}>{pd?.scenario || ""}</p>
          <div style={{ borderTop: "1px solid " + C.bdr, paddingTop: 12, marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{pd?.direction || "Complete the email writing task."}</div>
            <ul style={{ margin: "0 0 12px", paddingLeft: 22 }}>
              {emailGoals.map((g, i) => (
                <li key={i} style={{ fontSize: 13, marginBottom: 4, lineHeight: 1.5 }}>{g}</li>
              ))}
            </ul>
            <div style={{ fontSize: 13, color: C.t2, fontStyle: "italic" }}>Write as much as you can and in complete sentences.</div>
          </div>
        </div>
      ) : (
        <div>
          {/* TOEFL instruction block */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid " + C.bdr, fontSize: 12.5, color: C.t2, lineHeight: 1.7 }}>
            <p style={{ margin: "0 0 6px" }}>Your professor is teaching a class on <b style={{ color: C.t1 }}>{course || "social studies"}</b>. Write a post responding to the professor's question.</p>
            <p style={{ margin: "0 0 4px" }}>In your response, you should</p>
            <ul style={{ margin: "0 0 4px", paddingLeft: 20 }}>
              <li>express and support your personal opinion</li>
              <li>make a contribution to the discussion in your own words</li>
            </ul>
            <p style={{ margin: 0 }}>An effective response will contain at least 100 words.</p>
          </div>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid " + C.bdr }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.nav, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
                {professorInitial}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{professorName}</div>
                <div style={{ fontSize: 11, color: C.t2 }}>Professor</div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: C.t1, lineHeight: 1.6, margin: 0 }}>{professorText}</p>
          </div>
          {students.map((s, i) => (
            <div key={i} style={{ padding: "14px 20px 14px 40px", borderBottom: i < students.length - 1 ? "1px solid " + C.bdr : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: i ? "#e8913a" : "#4a90d9", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                  {String(s?.name || "学生").slice(0, 1)}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s?.name || "Student"}</div>
              </div>
              <p style={{ fontSize: 13, color: C.t1, lineHeight: 1.6, margin: 0 }}>{s?.text || ""}</p>
            </div>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}
