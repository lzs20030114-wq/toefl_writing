"use client";
import React from "react";
import { Btn, C } from "../shared/ui";
import { formatMinutesLabel } from "../../lib/practiceMode";

const TASK_META = {
  "build-sentence": {
    title: "Task 1: Build a Sentence",
    description: "Reorder chunks into a grammatically correct response.",
  },
  "email-writing": {
    title: "Task 2: Write an Email",
    description: "Respond appropriately to a workplace situation and cover all goals.",
  },
  "academic-writing": {
    title: "Task 3: Academic Discussion",
    description: "Respond to the discussion and engage with the ideas clearly.",
  },
};

export function TaskTransitionCard({ taskId, seconds, restSeconds, onSkip }) {
  const meta = TASK_META[taskId] || { title: "Next Task", description: "Get ready." };
  return (
    <div style={{ background: "#f8fbff", border: "1px solid #b3d4fc", borderRadius: 6, padding: 24, marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: C.t2, marginBottom: 6 }}>Upcoming section</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: C.nav, marginBottom: 8 }}>{meta.title}</div>
      <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.6, marginBottom: 12 }}>{meta.description}</div>
      <div style={{ fontSize: 13, color: C.t2, marginBottom: 14 }}>
        Time limit: <b>{formatMinutesLabel(seconds || 0)}</b>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 13, color: C.t2 }}>Auto start in <b>{restSeconds}s</b></div>
        <Btn onClick={onSkip} data-testid="mock-transition-skip">Skip wait and start now</Btn>
      </div>
    </div>
  );
}
