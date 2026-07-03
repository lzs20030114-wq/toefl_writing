"use client";
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { C, FONT } from "./ui";

// "这套题感觉怎么样" — new-user only (the V1 cohort gets a comparison instead).
const Q1_OPTIONS = [
  { value: "better", emoji: "😊", label: "比预期好" },
  { value: "same", emoji: "😐", label: "差不多" },
  { value: "worse", emoji: "😟", label: "比预期差" },
];

// "影响你选择最大的一点" — new-user only.
const FACTOR_OPTIONS = [
  { value: "question_quality", label: "题目本身的质量(准确性、地道度)" },
  { value: "difficulty", label: "题目难度" },
  { value: "ai_quality", label: "AI 解析的质量" },
  { value: "ui", label: "答题界面/操作体验" },
  { value: "coverage", label: "题目数量或题型范围" },
  { value: "not_my_stage", label: "我目前备考阶段不太需要" },
  { value: "other_tool", label: "我已经有更习惯的工具" },
  { value: "other", label: "其他" },
];

// Hybrid cohort split: history (cohort prop) is primary; this self-report is the
// fallback shown only when history can't confirm V1 (catches users who practiced
// V1 anonymously before logging in).
const SELF_REPORT_OPTIONS = [
  { value: "yes", label: "做过" },
  { value: "no", label: "没做过" },
];

// V1 cohort branch — how well they remember the old bank decides the matrix:
//   clear → compare V2 against V1 (进步/差不多/退步)
//   fuzzy → can't compare, so rate V2 in absolute terms (不错/一般/不太好)
const RECALL_OPTIONS = [
  { value: "clear", label: "印象比较清楚" },
  { value: "fuzzy", label: "做过,但记不太清了" },
];

const CMP_SCALE = [
  { value: "better", label: "进步" },
  { value: "same", label: "差不多" },
  { value: "worse", label: "退步" },
];
const ABS_SCALE = [
  { value: "good", emoji: "👍", label: "不错" },
  { value: "ok", emoji: "😐", label: "一般" },
  { value: "bad", emoji: "👎", label: "不太好" },
];

// Matrix dimensions. V1 matrices use 4 dims; the new-user matrix adds 答题界面.
const V1_DIMENSIONS = [
  { key: "quality", label: "题目本身的质量" },
  { key: "difficulty", label: "题目难度的合理性" },
  { key: "ai", label: "AI 解析的质量" },
  { key: "similarity", label: "与真实托福的相似度" },
];
const NEW_DIMENSIONS = [
  { key: "quality", label: "题目本身质量(准确性、地道度)" },
  { key: "difficulty", label: "题目难度" },
  { key: "ai", label: "AI 解析质量" },
  { key: "similarity", label: "与真实托福的相似度" },
  { key: "ui", label: "答题界面/操作体验" },
];

const emptyMatrix = () => ({ quality: "", difficulty: "", ai: "", similarity: "", ui: "" });

function buildProOptions(proDaysLeft) {
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

function matrixComplete(obj, dims) {
  return dims.every((d) => !!obj[d.key]);
}
function pickMatrix(obj, dims) {
  const out = {};
  for (const d of dims) out[d.key] = obj[d.key] || "";
  return out;
}

export function FirstSetSurveyModal({
  open,
  cohort = "new", // "v1" (history says did-V1) | "new" (history can't confirm)
  proDaysLeft = 0,
  rewardDays = 1,
  onSubmit,
  onDismiss,
  onSnooze,
}) {
  // new-user fields
  const [q1, setQ1] = useState("");
  const [pro, setPro] = useState("");
  const [factor, setFactor] = useState("");
  const [factorOther, setFactorOther] = useState("");
  // shared
  const [q4, setQ4] = useState("");
  // V1 cohort fields
  const [selfReportV1, setSelfReportV1] = useState(""); // only used when cohort==="new"
  const [recall, setRecall] = useState("");
  const [cmp, setCmp] = useState(emptyMatrix);
  const [abs, setAbs] = useState(emptyMatrix);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const proBlock = useMemo(() => buildProOptions(proDaysLeft), [proDaysLeft]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQ1(""); setPro(""); setFactor(""); setFactorOther(""); setQ4("");
      setSelfReportV1(""); setRecall(""); setCmp(emptyMatrix()); setAbs(emptyMatrix());
      setSubmitting(false); setError("");
    }
  }, [open]);

  // The active questionnaire. cohort==="v1" goes straight to the V1 survey;
  // otherwise the self-report fallback decides ("" = not yet answered).
  const variant =
    cohort === "v1"
      ? "v1"
      : selfReportV1 === "yes"
      ? "v1"
      : selfReportV1 === "no"
      ? "new"
      : "";

  if (!open) return null;

  const needsFactorOther = factor === "other" && !factorOther.trim();

  let coreDone = false;
  if (variant === "v1") {
    coreDone =
      !!recall &&
      (recall === "clear"
        ? matrixComplete(cmp, V1_DIMENSIONS)
        : recall === "fuzzy"
        ? matrixComplete(abs, V1_DIMENSIONS)
        : false);
  } else if (variant === "new") {
    coreDone =
      !!q1 && matrixComplete(abs, NEW_DIMENSIONS) && !!pro && !!factor && !needsFactorOther;
  }
  const canSubmit = coreDone && !submitting;

  function buildPayload() {
    if (variant === "v1") {
      const base = { variant: "v1", recall, q4: q4.trim() };
      if (recall === "clear") base.cmp = pickMatrix(cmp, V1_DIMENSIONS);
      else base.abs = pickMatrix(abs, V1_DIMENSIONS);
      return base;
    }
    return {
      variant: "new",
      q1,
      abs: pickMatrix(abs, NEW_DIMENSIONS),
      q2: pro,
      q3: factor,
      q3Other: factor === "other" ? factorOther.trim() : "",
      q4: q4.trim(),
    };
  }

  async function handleSubmit() {
    if (!canSubmit) {
      setError("请完成所有必答题");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onSubmit?.(buildPayload());
    } catch (e) {
      setError(e?.message || "提交失败,请稍后再试");
      setSubmitting(false);
    }
  }

  // Build the visible question list so we can number it sequentially despite the
  // branching (the set of questions depends on cohort / variant / recall).
  const blocks = [];

  if (cohort === "new") {
    blocks.push({
      title: "你做过 6.2 之前上线的旧题(V1)吗?",
      node: <ChoiceRow options={SELF_REPORT_OPTIONS} value={selfReportV1} onSelect={setSelfReportV1} />,
    });
  }

  if (variant === "v1") {
    blocks.push({
      title: "对 6.2 之前上线的旧题(V1),你还有印象吗?",
      node: <ChoiceCol options={RECALL_OPTIONS} value={recall} onSelect={setRecall} />,
    });
    if (recall === "clear") {
      blocks.push({
        title: "与 V1 旧题相比,你觉得 V2 在以下方面:",
        node: (
          <MatrixQuestion
            dimensions={V1_DIMENSIONS}
            scale={CMP_SCALE}
            value={cmp}
            onChange={(dim, val) => setCmp((p) => ({ ...p, [dim]: val }))}
          />
        ),
      });
    } else if (recall === "fuzzy") {
      blocks.push({
        title: "你觉得 V2 的题目在以下方面表现如何?",
        node: (
          <MatrixQuestion
            dimensions={V1_DIMENSIONS}
            scale={ABS_SCALE}
            value={abs}
            onChange={(dim, val) => setAbs((p) => ({ ...p, [dim]: val }))}
          />
        ),
      });
    }
    blocks.push(openBlock(q4, setQ4));
  } else if (variant === "new") {
    blocks.push({
      title: "这套题感觉怎么样?",
      node: <ChoiceRow options={Q1_OPTIONS} value={q1} onSelect={setQ1} />,
    });
    blocks.push({
      title: "对于刚做的题目,你在以下方面的评价是:",
      node: (
        <MatrixQuestion
          dimensions={NEW_DIMENSIONS}
          scale={ABS_SCALE}
          value={abs}
          onChange={(dim, val) => setAbs((p) => ({ ...p, [dim]: val }))}
        />
      ),
    });
    blocks.push({
      title: proBlock.title,
      node: <ChoiceCol options={proBlock.options} value={pro} onSelect={setPro} />,
    });
    blocks.push({
      title: "影响你选择最大的一点是?",
      node: (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {FACTOR_OPTIONS.map((opt) => (
              <ChoiceCard
                key={opt.value}
                selected={factor === opt.value}
                onClick={() => setFactor(opt.value)}
                muted={opt.value === "other" && factor !== "other"}
              >
                {opt.label}
              </ChoiceCard>
            ))}
          </div>
          {factor === "other" && (
            <input
              type="text"
              value={factorOther}
              onChange={(e) => setFactorOther(e.target.value)}
              placeholder="一句话描述..."
              maxLength={200}
              style={{
                marginTop: 8, width: "100%", boxSizing: "border-box",
                padding: "10px 12px", border: `1px solid ${C.bdr}`, borderRadius: 8,
                fontSize: 13, fontFamily: FONT, color: C.t1, outline: "none",
              }}
            />
          )}
        </>
      ),
    });
    blocks.push(openBlock(q4, setQ4));
  }

  return createPortal(
    <div
      data-tp-overlay
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
              30 秒,几个小问题
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

        {blocks.map((b, i) => (
          <SurveyQuestion key={i} index={i + 1} title={b.title}>
            {b.node}
          </SurveyQuestion>
        ))}

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

// Open-ended free-text block (optional) — shared by both variants.
function openBlock(q4, setQ4) {
  return {
    title: <>还有什么想告诉我们的? <span style={{ color: C.t3, fontWeight: 400 }}>(可选)</span></>,
    node: (
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
    ),
  };
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

// A row of equal-width choices (e.g. 比预期好/差不多/比预期差).
function ChoiceRow({ options, value, onSelect }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {options.map((opt) => (
        <ChoiceCard
          key={opt.value}
          selected={value === opt.value}
          onClick={() => onSelect(opt.value)}
          style={{ flex: 1, textAlign: "center" }}
        >
          {opt.emoji ? <span style={{ marginRight: 4 }}>{opt.emoji}</span> : null}
          {opt.label}
        </ChoiceCard>
      ))}
    </div>
  );
}

// A stacked column of choices (e.g. the Pro-plans question).
function ChoiceCol({ options, value, onSelect }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {options.map((opt) => (
        <ChoiceCard
          key={opt.value}
          selected={value === opt.value}
          onClick={() => onSelect(opt.value)}
        >
          {opt.label}
        </ChoiceCard>
      ))}
    </div>
  );
}

// Matrix: each dimension is one row rated on the given 3-point scale (single-select per row).
function MatrixQuestion({ dimensions, scale, value, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {dimensions.map((dim) => (
        <div key={dim.key}>
          <div style={{ fontSize: 12.5, color: C.t1, marginBottom: 5 }}>{dim.label}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {scale.map((opt) => (
              <ChoiceCard
                key={opt.value}
                selected={value[dim.key] === opt.value}
                onClick={() => onChange(dim.key, opt.value)}
                style={{ flex: 1, textAlign: "center", padding: "8px 4px", fontSize: 12.5 }}
              >
                {opt.emoji ? <span style={{ marginRight: 3 }}>{opt.emoji}</span> : null}
                {opt.label}
              </ChoiceCard>
            ))}
          </div>
        </div>
      ))}
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
