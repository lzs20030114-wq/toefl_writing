"use client";
import React from "react";
import { C, Btn } from "../shared/ui";
import { PRACTICE_MODE } from "../../lib/practiceMode";

export function MockExamStartCard({ savedCount, onStart, mode = PRACTICE_MODE.STANDARD, totalTimeLabel = "24 min" }) {
  return (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 24 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.nav, marginBottom: 8 }}>模考入口</div>
      <div style={{ fontSize: 13, color: C.t2, marginBottom: 14 }}>
        流程：任务 1（拼句） {"->"} 任务 2（邮件写作） {"->"} 任务 3（学术讨论）
      </div>
      <div style={{ fontSize: 13, color: mode === PRACTICE_MODE.CHALLENGE ? C.red : C.t2, marginBottom: 14 }}>
        模式：{mode === PRACTICE_MODE.CHALLENGE ? `挑战模式（${totalTimeLabel}）` : `标准模式（${totalTimeLabel}）`}
      </div>
      <Btn onClick={onStart}>开始模考</Btn>
      <div style={{ fontSize: 12, color: C.t2, marginTop: 16 }}>已保存模考记录：{savedCount}</div>
    </div>
  );
}
