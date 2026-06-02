"use client";
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { C, FONT } from "./ui";

const Q1_OPTIONS = [
  { value: "better", emoji: "😊", label: "比预期好" },
  { value: "same", emoji: "😐", label: "差不多" },
  { value: "worse", emoji: "😟", label: "比预期差" },
];

const Q3_OPTIONS = [
  { value: "question_quality", label: "题目本身的质量(准确性、地道度)" },
  { value: "difficulty", label: "题目难度" },
  { value: "ai_quality", label: "AI 解析的质量" },
  { value: "ui", label: "答题界面/操作体验" },
  { value: "coverage", label: "题目数量或题型范围" },
  { value: "not_my_stage", label: "我目前备考阶段不太需要" },
  { value: "other_tool", label: "我已经有更习惯的工具" },
  { value: "other", label: "其他" },
];

function buildQ2Options(proDaysLeft) {
  const days = Math.max(0, Number(proDaysLeft) || 0);
  const prefix = days > 0 ? `你的 Pro 体验还剩 ${days} 天` : "你的 Pro 体验";
  return {
    title: `${prefix},期间打算?`,
    options: [
      { value: "use_it_up", label: "多做几套,把 Pro 用足" },
      { value: "maybe", label: "不一定,看时间" },
      { value: "probably_not", label: "大概不会再做了" },
    ],
  };
}

export function FirstSetSurveyModal({
  open,
  proDaysLeft = 0,
  rewardDays = 1,
  onSubmit,
  onDismiss,
  onSnooze,
}) {
  const [q1, setQ1] = useState("");
  const [q2, setQ2] = useState("");
  const [q3, setQ3] = useState("");
  const [q3Other, setQ3Other] = useState("");
  const [q4, setQ4] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const q2Block = useMemo(() => buildQ2Options(proDaysLeft), [proDaysLeft]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQ1(""); setQ2(""); setQ3(""); setQ3Other(""); setQ4("");
      setSubmitting(false); setError("");
    }
  }, [open]);

  if (!open) return null;

  const needsQ3Other = q3 === "other" && !q3Other.trim();
  const canSubmit = !!q1 && !!q2 && !!q3 && !needsQ3Other && !submitting;

  async function handleSubmit() {
    if (!canSubmit) {
      setError("请回答前 3 题");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onSubmit?.({
        q1,
        q2,
        q3,
        q3Other: q3 === "other" ? q3Other.trim() : "",
        q4: q4.trim(),
      });
    } catch (e) {
      setError(e?.message || "提交失败,请稍后再试");
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="新手体验问卷"
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(15,23,42,0.55)",
        WebkitBackdropFilter: "blur(6px)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, fontFamily: FONT,
      }}
    >
      <div
        style={{
          background: "#fff",
          width: "100%", maxWidth: 480,
          maxHeight: "90vh", overflowY: "auto",
          borderRadius: 14,
          border: `1px solid ${C.bdr}`,
          boxShadow: "0 20px 50px rgba(15,23,42,0.25)",
          padding: 24,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.t1 }}>帮我们做得更好</div>
            <div style={{ fontSize: 13, color: C.t2, marginTop: 4 }}>
              30 秒,只问 3 个问题
              <span style={{ color: C.t3 }}>(本次针对全新升级的 V2 题库)</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => (onSnooze || onDismiss)?.()}
              title="先关掉 · 做完两套新题后会再提醒你一次,也可随时在首页重新打开"
              style={{
                background: "transparent",
                border: `1px solid ${C.bdr}`,
                borderRadius: 999,
                padding: "5px 11px",
                fontSize: 12,
                color: C.t2,
                cursor: "pointer",
                fontFamily: FONT,
                whiteSpace: "nowrap",
              }}
            >
              再做两套看看
            </button>
            <button
              onClick={() => onDismiss?.()}
              aria-label="关闭"
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                fontSize: 22, color: C.t3, lineHeight: 1, padding: 4,
              }}
            >
              ×
            </button>
          </div>
        </div>

        <SurveyQuestion index={1} title="这套题感觉怎么样?">
          <div style={{ display: "flex", gap: 8 }}>
            {Q1_OPTIONS.map((opt) => (
              <ChoiceCard
                key={opt.value}
                selected={q1 === opt.value}
                onClick={() => setQ1(opt.value)}
                style={{ flex: 1, textAlign: "center" }}
              >
                <span style={{ marginRight: 4 }}>{opt.emoji}</span>{opt.label}
              </ChoiceCard>
            ))}
          </div>
        </SurveyQuestion>

        <SurveyQuestion index={2} title={q2Block.title}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {q2Block.options.map((opt) => (
              <ChoiceCard
                key={opt.value}
                selected={q2 === opt.value}
                onClick={() => setQ2(opt.value)}
              >
                {opt.label}
              </ChoiceCard>
            ))}
          </div>
        </SurveyQuestion>

        <SurveyQuestion index={3} title="影响你最大的一点是?">
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {Q3_OPTIONS.map((opt) => (
              <ChoiceCard
                key={opt.value}
                selected={q3 === opt.value}
                onClick={() => setQ3(opt.value)}
                muted={opt.value === "other" && q3 !== "other"}
              >
                {opt.label}
              </ChoiceCard>
            ))}
          </div>
          {q3 === "other" && (
            <input
              type="text"
              value={q3Other}
              onChange={(e) => setQ3Other(e.target.value)}
              placeholder="一句话描述..."
              maxLength={200}
              style={{
                marginTop: 8, width: "100%", boxSizing: "border-box",
                padding: "10px 12px", border: `1px solid ${C.bdr}`, borderRadius: 8,
                fontSize: 13, fontFamily: FONT, color: C.t1, outline: "none",
              }}
            />
          )}
        </SurveyQuestion>

        <SurveyQuestion
          index={4}
          title={<>还有什么想告诉我们的? <span style={{ color: C.t3, fontWeight: 400 }}>(可选)</span></>}
        >
          <textarea
            value={q4}
            onChange={(e) => setQ4(e.target.value)}
            placeholder="一句话就行,真实的想法对我们最有帮助..."
            maxLength={1000}
            rows={3}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: 10, border: `1px solid ${C.bdr}`, borderRadius: 8,
              fontSize: 13, fontFamily: FONT, color: C.t1,
              minHeight: 60, resize: "vertical", outline: "none",
            }}
          />
        </SurveyQuestion>

        {error && (
          <div style={{ color: C.red, fontSize: 12, marginBottom: 8 }}>{error}</div>
        )}

        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            paddingTop: 12, borderTop: `1px solid ${C.bdrSubtle}`, gap: 12,
          }}
        >
          <div style={{ fontSize: 12, color: C.green, display: "flex", alignItems: "center", gap: 6 }}>
            <GiftIcon />
            <span>提交后赠送 {rewardDays} 天 Pro</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              padding: "9px 18px",
              background: canSubmit ? C.t1 : "#d1d5db",
              color: canSubmit ? "#fff" : "#6b7280",
              border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 700,
              cursor: canSubmit ? "pointer" : "not-allowed",
              fontFamily: FONT,
            }}
          >
            {submitting ? "提交中..." : "提交反馈"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SurveyQuestion({ index, title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 13, color: C.t2, marginBottom: 8 }}>
        {index} / {title}
      </div>
      {children}
    </div>
  );
}

function ChoiceCard({ children, selected, onClick, muted, style }) {
  return (
    <button
      onClick={onClick}
      type="button"
      style={{
        textAlign: "left",
        padding: "9px 12px",
        border: `1px solid ${selected ? C.blue : C.bdr}`,
        background: selected ? C.ltB : "#fff",
        color: muted ? C.t2 : C.t1,
        borderRadius: 8,
        fontSize: 13,
        fontFamily: FONT,
        cursor: "pointer",
        transition: "background 120ms ease, border-color 120ms ease",
        ...(style || {}),
      }}
    >
      {children}
    </button>
  );
}

function GiftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="2" y="7" width="20" height="5" rx="1" stroke="currentColor" strokeWidth="2" />
      <path d="M12 21V7" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7s-2-4-5-4a2.5 2.5 0 0 0 0 5h5z M12 7s2-4 5-4a2.5 2.5 0 0 1 0 5h-5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
