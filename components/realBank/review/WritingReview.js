"use client";
// 写作真题记录的回顾：
//   · 有 AI 反馈 → 直接复用写作页 / 模考报告同一个 WritingFeedbackPanel（45/55 分屏、原文短语级批注、四个标签页）；
//   · 评分没完成 → 「没有评分反馈」横幅 + 「重试评分」，成功后记录变成带批改报告的写作记录（设计稿 · 邮件评分失败）。
import React from "react";
import { WritingFeedbackPanel } from "../../writing/WritingFeedbackPanel";
import { buildRetryHref, startRetryFromHistory } from "../../../lib/history/retry";
import { wc } from "../../../lib/utils";
import { READ_FONT } from "../realBankUi";

export function WritingReport({ session, color, focus, onBack }) {
  const d = session.details || {};
  const retry = buildRetryHref(session);
  return (
    <div data-testid="real-writing-report" data-wfp="1" style={{ border: "1px solid #ebf0ed", borderLeft: `3px solid ${color}`, borderRadius: 12, overflow: "hidden" }}>
      <WritingFeedbackPanel
        fb={d.feedback}
        type={session.type}
        pd={d.promptData || null}
        userText={d.userText || ""}
        containerHeight="720px"
        onRetry={retry ? () => startRetryFromHistory(session) : null}
        onNext={null}
        onExit={onBack}
        externalFocus={focus}
      />
    </div>
  );
}

function PromptPanel({ type, pd }) {
  const p = pd || {};
  if (type === "discussion") {
    return (
      <div style={{ flex: "1 1 280px", minWidth: 0, border: "1px solid #ebf0ed", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>题目</div>
        {p.professor ? (
          <div style={{ fontSize: 12.5, lineHeight: 1.65 }}><b>{p.professor.name}（教授）：</b>{p.professor.text}</div>
        ) : null}
        {(Array.isArray(p.students) ? p.students : []).map((s, i) => (
          <div key={i} style={{ fontSize: 12.5, lineHeight: 1.65, color: "#5a6b62" }}><b style={{ color: "#1a2420" }}>{s.name}：</b>{s.text}</div>
        ))}
        {!p.professor && !(p.students || []).length ? <div style={{ fontSize: 12, color: "#94a39a" }}>这条记录没有保存题目内容。</div> : null}
      </div>
    );
  }
  const goals = Array.isArray(p.goals) ? p.goals : [];
  return (
    <div style={{ flex: "1 1 280px", minWidth: 0, border: "1px solid #ebf0ed", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>题目</div>
      {p.to ? <div style={{ fontSize: 12, color: "#5a6b62" }}>收件人：{p.to}</div> : null}
      {p.scenario || p.situation ? <div style={{ fontSize: 12.5, lineHeight: 1.65 }}>{p.scenario || p.situation}</div> : null}
      {goals.length ? <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a39a", letterSpacing: ".06em", marginTop: 4 }}>写作目标</div> : null}
      {goals.map((t, n) => (
        <div key={n} style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.55 }}>
          <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#ECFEFF", color: "#0891B2", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>{n + 1}</span>{t}
        </div>
      ))}
      {!p.to && !p.scenario && !goals.length ? <div style={{ fontSize: 12, color: "#94a39a" }}>这条记录没有保存题目内容。</div> : null}
    </div>
  );
}

export function UnscoredReport({ session, canRetry, rescoring, error, onRescore }) {
  const d = session.details || {};
  const text = String(d.userText || "");
  const tone = rescoring ? { bg: "#FFF7ED", title: "正在重新评分", body: "正在把作答重新提交给 AI 评分，通常需要 20–60 秒，请稍候。" }
    : error ? { bg: "#FEF2F2", title: "重新评分失败", body: `${error}。作答原文仍已保存，可以再试一次。` }
    : { bg: "#FFFBEB", title: "没有评分反馈", body: "这次提交时 AI 评分没有完成，作答原文已保存。可以重试评分，成功后这里会变成完整的批改报告。" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div data-testid="real-unscored-banner" role="status" style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", borderRadius: 10, background: tone.bg, border: `1px solid ${error && !rescoring ? "#FECACA" : "#FDE68A"}`, fontSize: 12.5, color: error && !rescoring ? "#991B1B" : "#92400e", lineHeight: 1.6, flexWrap: "wrap" }}>
        <strong style={{ flexShrink: 0 }}>{tone.title}</strong>
        <span style={{ flex: "1 1 280px", minWidth: 0 }}>{tone.body}</span>
        {canRetry && !rescoring ? (
          <button type="button" onClick={onRescore}
            style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "none", background: "#B45309", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" /><path d="M13.5 2.5v3h-3" /></svg>
            {error ? "再试一次" : "重试评分"}
          </button>
        ) : null}
        {rescoring ? (
          <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 8, background: "#fff", border: "1px solid #FDE68A", fontSize: 12, fontWeight: 700, color: "#B45309" }}>
            <span style={{ width: 80, height: 4, borderRadius: 2, background: "#FDE68A", overflow: "hidden", display: "block", position: "relative" }}>
              <span style={{ position: "absolute", top: 0, bottom: 0, width: "40%", background: "#B45309", borderRadius: 2, animation: "rbIndeterminate 1.2s ease-in-out infinite" }} />
            </span>
            评分中…
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <PromptPanel type={session.type} pd={d.promptData} />
        <div style={{ flex: "1.4 1 400px", minWidth: 0, border: "1px solid #ebf0ed", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #ebf0ed" }}>
            <strong style={{ fontSize: 12 }}>你的作答</strong>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a39a" }}>{text.trim() ? wc(text) : 0} 词</span>
          </div>
          <div data-testid="real-unscored-text" style={{ padding: "14px 16px", fontFamily: READ_FONT, fontSize: 14, lineHeight: 1.85, whiteSpace: "pre-wrap" }}>{text || "未保存作答文本。"}</div>
        </div>
      </div>
    </div>
  );
}
