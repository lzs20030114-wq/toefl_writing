"use client";
import React from "react";
import { C } from "../shared/ui";

export function WritingPromptPanel({ type, pd }) {
  const emailGoals = Array.isArray(pd?.goals) ? pd.goals : [];
  const professorName = String(pd?.professor?.name || "Professor");
  const professorText = String(pd?.professor?.text || "");
  const students = Array.isArray(pd?.students) ? pd.students : [];
  const professorInitial = professorName.trim() ? professorName.trim().slice(0, 1).toUpperCase() : "P";

  return (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, overflow: "hidden" }}>
      <div style={{ background: "#e8e8e8", padding: "10px 16px", fontSize: 12, fontWeight: 700, color: C.t2, borderBottom: "1px solid " + C.bdr }}>
        {type === "email" ? "SCENARIO" : "DISCUSSION BOARD"}
      </div>
      {type === "email" ? (
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 12, color: C.t2, marginBottom: 6 }}>
            <b>To:</b> {pd?.to || "Professor"} | <b>From:</b> {pd?.from || "You"}
          </div>
          <p style={{ fontSize: 14, color: C.t1, lineHeight: 1.7, margin: "12px 0" }}>{pd?.scenario || ""}</p>
          <div style={{ borderTop: "1px solid " + C.bdr, paddingTop: 12, marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{pd?.direction || "Write an email."}</div>
            {emailGoals.map((g, i) => (
              <div key={i} style={{ fontSize: 13, paddingLeft: 16, marginBottom: 4 }}>
                {i + 1}. {g}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div>
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
                  {String(s?.name || "S").slice(0, 1)}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s?.name || "Student"}</div>
              </div>
              <p style={{ fontSize: 13, color: C.t1, lineHeight: 1.6, margin: 0 }}>{s?.text || ""}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
