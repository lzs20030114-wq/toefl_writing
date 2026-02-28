"use client";
import React, { useState } from "react";
import { BuildSentenceTask } from "./buildSentence/BuildSentenceTask";
import { WritingTask } from "./writing/WritingTask";
import { ProgressView } from "./ProgressView";
import { C, FONT, Btn } from "./shared/ui";

export default function ToeflApp() {
  const [v, setV] = useState("menu");

  if (v === "build") return <BuildSentenceTask onExit={() => setV("menu")} />;
  if (v === "email") return <WritingTask onExit={() => setV("menu")} type="email" />;
  if (v === "disc") return <WritingTask onExit={() => setV("menu")} type="discussion" />;
  if (v === "prog") return <ProgressView onBack={() => setV("menu")} />;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <div style={{ background: C.nav, color: "#fff", padding: "0 20px", height: 48, display: "flex", alignItems: "center", borderBottom: "3px solid " + C.navDk }}><span style={{ fontWeight: 700, fontSize: 15 }}>TOEFL iBT</span><span style={{ opacity: 0.5, margin: "0 12px" }}>|</span><span style={{ fontSize: 13 }}>写作部分 2026</span></div>
      <div style={{ maxWidth: 800, margin: "32px auto", padding: "0 20px" }}>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "32px 40px", marginBottom: 24, textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.nav }}>写作部分</h1>
          <p style={{ color: C.t2, fontSize: 14, margin: "8px 0 0" }}>TOEFL iBT 写作练习</p>
        </div>
        {[
          { k: "build", n: "任务 1", t: "拼句练习", d: "将词块排列成语法正确的句子，包含不同难度题目。", ti: "6 分 50 秒", it: "10 题" },
          { k: "email", n: "任务 2", t: "邮件写作", d: "完成一封职场邮件，覆盖 3 个目标点。", ti: "7 分钟", it: "80-120 词" },
          { k: "disc", n: "任务 3", t: "学术讨论写作", d: "阅读讨论内容并完成回应。", ti: "10 分钟", it: "100+ 词" },
        ].map(c => (
          <button data-testid={"task-" + c.k} key={c.k} onClick={() => setV(c.k)} style={{ display: "flex", width: "100%", textAlign: "left", background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 0, marginBottom: 12, cursor: "pointer", overflow: "hidden", fontFamily: FONT }}>
            <div style={{ width: 6, background: C.blue, flexShrink: 0 }} />
            <div style={{ padding: "16px 20px", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><span style={{ fontSize: 11, color: C.blue, fontWeight: 700, letterSpacing: 1 }}>{c.n}</span></div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 4 }}>{c.t}</div>
              <div style={{ fontSize: 13, color: C.t2 }}>{c.d}</div>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", borderLeft: "1px solid " + C.bdr, minWidth: 110 }}><div style={{ fontSize: 14, fontWeight: 700, color: C.nav }}>{c.ti}</div><div style={{ fontSize: 12, color: C.t2 }}>{c.it}</div></div>
          </button>
        ))}
        <button data-testid="task-prog" onClick={() => setV("prog")} style={{ display: "flex", width: "100%", textAlign: "left", background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 0, marginTop: 8, marginBottom: 12, cursor: "pointer", fontFamily: FONT }}>
          <div style={{ width: 6, background: C.green, flexShrink: 0 }} />
          <div style={{ padding: "16px 20px", flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>练习记录</div><div style={{ fontSize: 13, color: C.t2 }}>查看最近练习记录和成绩趋势。</div></div>
          <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", color: C.blue, fontSize: 20 }}>&gt;</div>
        </button>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "14px 20px", fontSize: 12, color: C.t2 }}><b style={{ color: C.t1 }}>由 DeepSeek AI 提供支持</b>｜ETS 风格评分｜语法诊断｜薄弱点追踪｜AI 题目生成</div>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "14px 20px", marginTop: 12, fontSize: 11, color: C.t2, lineHeight: 1.6 }}>
          <b style={{ color: C.t1 }}>说明：</b>该工具为独立练习资源，与 ETS 或 TOEFL 项目无关联，也未获得其认可。TOEFL 和 TOEFL iBT 为 ETS 注册商标。AI 评分基于公开评分标准，仅供自学参考，不代表真实考试成绩。
        </div>
      </div>
    </div>
  );
}
