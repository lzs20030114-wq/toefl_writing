"use client";
import React from "react";
import { C } from "../shared/ui";
import { fmt } from "../../lib/utils";

export function SectionTimerPanel({ currentTask, progress, sectionTimer, status, scoringPhase, aggregate, isAborted }) {
  return (
    <div style={{ position: "sticky", top: 72 }}>
      <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: C.t2, marginBottom: 6, letterSpacing: 1 }}>当前部分</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.t1, marginBottom: 8 }}>
          {currentTask ? currentTask.title : "尚未开始"}
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.nav, fontFamily: "Consolas,monospace", marginBottom: 6 }}>
          {sectionTimer == null ? "--:--" : fmt(sectionTimer)}
        </div>
        <div style={{ fontSize: 12, color: C.t2 }}>
          进度 {progress.done}/{progress.total}（{progress.percent}%）
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 16 }}>
        <div style={{ fontSize: 12, color: C.t2, marginBottom: 6 }}>状态</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.t1, marginBottom: 4 }}>{status}</div>
        {scoringPhase === "pending" && <div style={{ fontSize: 12, color: C.blue }}>AI 评分进行中...</div>}
        {scoringPhase === "done" && <div style={{ fontSize: 12, color: C.green }}>AI 评分已完成</div>}
        {!isAborted && (scoringPhase === "done" || scoringPhase === "error") && aggregate && Number.isFinite(aggregate.band) && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #eee" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.nav }}>{aggregate.band.toFixed(1)}</div>
            <div style={{ fontSize: 11, color: C.t2 }}>段位（换算分 {aggregate.scaledScore}/30）</div>
          </div>
        )}
      </div>
    </div>
  );
}
