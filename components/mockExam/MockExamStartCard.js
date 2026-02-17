"use client";
import React from "react";
import { C, Btn } from "../shared/ui";
import { PRACTICE_MODE } from "../../lib/practiceMode";

export function MockExamStartCard({ savedCount, onStart, mode = PRACTICE_MODE.STANDARD, totalTimeLabel = "24 min" }) {
  return (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 24 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.nav, marginBottom: 8 }}>Mock Exam Runner</div>
      <div style={{ fontSize: 13, color: C.t2, marginBottom: 14 }}>
        Sequence: Task 1 (Build Sentence) {"->"} Task 2 (Email) {"->"} Task 3 (Academic Discussion)
      </div>
      <div style={{ fontSize: 13, color: mode === PRACTICE_MODE.CHALLENGE ? C.red : C.t2, marginBottom: 14 }}>
        Mode: {mode === PRACTICE_MODE.CHALLENGE ? `Challenge (${totalTimeLabel})` : `Standard (${totalTimeLabel})`}
      </div>
      <Btn onClick={onStart}>Start Mock Exam</Btn>
      <div style={{ fontSize: 12, color: C.t2, marginTop: 16 }}>Saved mock sessions: {savedCount}</div>
    </div>
  );
}
