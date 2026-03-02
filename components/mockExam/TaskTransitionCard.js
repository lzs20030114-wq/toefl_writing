"use client";
import React from "react";
import { Btn, C } from "../shared/ui";
import { formatMinutesLabel } from "../../lib/practiceMode";

const TASK_META = {
  "build-sentence": {
    title: "Task 1: Build a Sentence",
    description: "Arrange the given word chunks to form a grammatically correct sentence. There may be one distractor chunk that does not belong.",
  },
  "email-writing": {
    title: "Task 2: Integrated Writing — Email",
    description: "Read the prompt and write an email response that addresses all required points.",
  },
  "academic-writing": {
    title: "Task 3: Writing for an Academic Discussion",
    description: "Read the discussion board post and write a response that clearly expresses and supports your opinion.",
  },
};

export function TaskTransitionCard({ taskId, seconds, restSeconds, onSkip }) {
  const meta = TASK_META[taskId] || { title: "Next Task", description: "Prepare to begin." };
  return (
    <div style={{ background: "#f8fbff", border: "1px solid #b3d4fc", borderRadius: 6, padding: 24, marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: C.t2, marginBottom: 6 }}>Up Next</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: C.nav, marginBottom: 8 }}>{meta.title}</div>
      <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.6, marginBottom: 12 }}>{meta.description}</div>
      <div style={{ fontSize: 13, color: C.t2, marginBottom: 14 }}>
        Time limit: <b>{formatMinutesLabel(seconds || 0)}</b>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 13, color: C.t2 }}>Starting in <b>{restSeconds}s</b></div>
        <Btn onClick={onSkip} data-testid="mock-transition-skip">Skip & Start Now</Btn>
      </div>
    </div>
  );
}
