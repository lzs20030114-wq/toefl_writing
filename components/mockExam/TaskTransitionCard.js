"use client";
import React from "react";
import { Btn, C } from "../shared/ui";
import { formatMinutesLabel } from "../../lib/practiceMode";

const TASK_META = {
  "build-sentence": {
    title: "任务 1：拼句练习",
    description: "将词块重新排列成语法正确的句子。",
  },
  "email-writing": {
    title: "任务 2：邮件写作",
    description: "针对工作场景完成邮件，并覆盖所有目标点。",
  },
  "academic-writing": {
    title: "任务 3：学术讨论写作",
    description: "清晰回应讨论内容，并表达你的观点。",
  },
};

export function TaskTransitionCard({ taskId, seconds, restSeconds, onSkip }) {
  const meta = TASK_META[taskId] || { title: "下一任务", description: "请准备开始。" };
  return (
    <div style={{ background: "#f8fbff", border: "1px solid #b3d4fc", borderRadius: 6, padding: 24, marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: C.t2, marginBottom: 6 }}>即将开始</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: C.nav, marginBottom: 8 }}>{meta.title}</div>
      <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.6, marginBottom: 12 }}>{meta.description}</div>
      <div style={{ fontSize: 13, color: C.t2, marginBottom: 14 }}>
        限时：<b>{formatMinutesLabel(seconds || 0)}</b>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 13, color: C.t2 }}>将在 <b>{restSeconds} 秒</b>后自动开始</div>
        <Btn onClick={onSkip} data-testid="mock-transition-skip">跳过等待，立即开始</Btn>
      </div>
    </div>
  );
}
