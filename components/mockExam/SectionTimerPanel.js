"use client";
import React from "react";
import { C } from "../shared/ui";
import { fmt } from "../../lib/utils";

export function SectionTimerPanel({ currentTask, progress, sectionTimer, status, scoringPhase }) {
  return (
    <div style={{ position: "sticky", top: 72 }}>
      <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: C.t2, marginBottom: 6, letterSpacing: 1 }}>CURRENT SECTION</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.t1, marginBottom: 8 }}>
          {currentTask ? currentTask.title : "Not started"}
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.nav, fontFamily: "Consolas,monospace", marginBottom: 6 }}>
          {sectionTimer == null ? "--:--" : fmt(sectionTimer)}
        </div>
        <div style={{ fontSize: 12, color: C.t2 }}>
          Progress {progress.done}/{progress.total} ({progress.percent}%)
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 16 }}>
        <div style={{ fontSize: 12, color: C.t2, marginBottom: 6 }}>Status</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.t1, marginBottom: 4 }}>{status}</div>
        {scoringPhase === "pending" && <div style={{ fontSize: 12, color: C.blue }}>AI scoring in progress...</div>}
        {scoringPhase === "done" && <div style={{ fontSize: 12, color: C.green }}>AI scoring completed</div>}
      </div>
    </div>
  );
}
