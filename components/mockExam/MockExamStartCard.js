"use client";
import React from "react";
import { C, Btn } from "../shared/ui";
import { formatMinutesLabel, PRACTICE_MODE } from "../../lib/practiceMode";

export function MockExamStartCard({ savedCount, onStart, mode = PRACTICE_MODE.STANDARD, totalTimeLabel = "24 min", realMock = false, taskSeconds = null }) {
  return (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 24 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.nav, marginBottom: 8 }}>模考入口</div>
      <div style={{ fontSize: 13, color: C.t2, marginBottom: 14 }}>
        流程：任务 1（拼句） {"->"} 任务 2（邮件写作） {"->"} 任务 3（学术讨论）
      </div>
      {realMock ? (
        <>
          {/* 真题模考的限时是固定的（不分标准 / 挑战），按任务分别计时。 */}
          <div style={{ fontSize: 13, color: C.t2, marginBottom: 14 }}>
            限时：共 {totalTimeLabel}
            {taskSeconds && `（拼句 ${formatMinutesLabel(taskSeconds.bs)} · 邮件 ${formatMinutesLabel(taskSeconds.email)} · 学术讨论 ${formatMinutesLabel(taskSeconds.discussion)}，每个任务单独计时）`}
          </div>
          <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.6, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "10px 12px", marginBottom: 14 }}>
            开考后展示过的题会永久计为已做，不会再出现在之后的真题模考里；中途离开 2 小时内可在本设备继续（计时不停）。
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: mode === PRACTICE_MODE.CHALLENGE ? C.red : C.t2, marginBottom: 14 }}>
          模式：{mode === PRACTICE_MODE.CHALLENGE ? `挑战模式（${totalTimeLabel}）` : `标准模式（${totalTimeLabel}）`}
        </div>
      )}
      <Btn onClick={onStart}>开始模考</Btn>
      {!realMock && <div style={{ fontSize: 12, color: C.t2, marginTop: 16 }}>已保存模考记录：{savedCount}</div>}
    </div>
  );
}
