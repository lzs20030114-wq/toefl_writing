"use client";
import React, { useState } from "react";
import { C } from "../shared/ui";
import { normalizeReportLanguage, saveReportLanguage, REPORT_LANGUAGE } from "../../lib/reportLanguage";

const I18N = {
  zh: {
    scoreBand: "Band",
    lowConfidenceTitle: "低可信度评分状态",
    lowConfidenceBody: "本次输入信号不足，分数仅作临时估计。请优先根据下面的定性反馈修改后再重测。",
    provisional: "临时估计",
    priorityFeedback: "优先改进反馈",
    confidenceTitle: "评分可信度",
    confidenceReliable: "可靠项",
    confidenceUncertain: "不确定项",
    confidenceNote: "这是定性解释，不是概率值。建议把分数作为训练参考并结合多次练习观察趋势。",
    rubricTitle: "Rubric 维度拆解",
    weightedScore: "加权总分",
    weightedMethod: "计算方式",
    keyProblems: "关键问题（按影响排序）",
    noProblems: "未检测到明显问题。继续保持当前表达质量。",
    diagnosis: "诊断",
    whyMatters: "影响说明",
    example: "你的原句示例",
    action: "行动建议",
    aiNote1: "当前分数是 AI 辅助训练估计值。",
    aiNote2: "反馈用于学习改进，不代表官方成绩预测。",
  },
  en: {
    scoreBand: "Band",
    lowConfidenceTitle: "Low-confidence scoring state",
    lowConfidenceBody: "Signal quality is limited for this response, so the numeric score is provisional. Prioritize the qualitative feedback below, then retry.",
    provisional: "Provisional estimate",
    priorityFeedback: "Priority qualitative feedback",
    confidenceTitle: "Score Confidence",
    confidenceReliable: "Reliable",
    confidenceUncertain: "Uncertain",
    confidenceNote: "This is a qualitative confidence note, not a probability. Use the score as a training estimate and compare trends across attempts.",
    rubricTitle: "Rubric Breakdown",
    weightedScore: "Weighted score",
    weightedMethod: "Method",
    keyProblems: "Key Problems (ranked by impact)",
    noProblems: "No major problems detected. Keep this level of clarity.",
    diagnosis: "Diagnosis",
    whyMatters: "Why it matters",
    example: "Example from your response",
    action: "Action",
    aiNote1: "Scores are AI-assisted training estimates.",
    aiNote2: "Feedback focuses on learning improvement, not official score prediction.",
  },
};

function LangToggle({ lang, onChange }) {
  const opts = [
    { value: REPORT_LANGUAGE.ZH, label: "中文" },
    { value: REPORT_LANGUAGE.EN, label: "EN" },
  ];
  return (
    <div style={{ display: "inline-flex", gap: 4, background: "#f1f5f9", borderRadius: 999, padding: 2 }}>
      {opts.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            border: "none",
            background: lang === o.value ? "#fff" : "transparent",
            boxShadow: lang === o.value ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
            color: lang === o.value ? C.nav : C.t2,
            borderRadius: 999,
            padding: "2px 10px",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
            lineHeight: "20px",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ScoringReport({ result, type, uiLang = "zh" }) {
  const storedLang = (() => {
    try {
      const s = localStorage.getItem("toefl-report-language");
      return s ? normalizeReportLanguage(s) : null;
    } catch {
      return null;
    }
  })();
  const defaultLang = storedLang || normalizeReportLanguage(result?.reportLanguage || uiLang);
  const [langOverride, setLangOverride] = useState(defaultLang);
  const ui = I18N[langOverride] || I18N.en;
  if (!result) return null;

  const score = Number.isFinite(Number(result.score)) ? Number(result.score) : 0;
  const band = Number.isFinite(Number(result.band)) ? Number(result.band) : null;
  const scoreColor = score >= 4 ? C.green : score >= 3 ? C.orange : C.red;
  const keyProblems = (Array.isArray(result.key_problems) ? result.key_problems : [])
    .filter((p) => p && p.explanation && p.example && p.action)
    .slice(0, 3);
  const rubric = result?.rubric || null;
  const rubricDims = rubric?.dimensions || null;
  const confidence = result?.score_confidence || null;
  const confidenceState = result?.confidence_state || null;
  const lowConfidence = confidenceState?.level === "low";
  const reliableAspects = Array.isArray(confidence?.reliable_aspects) ? confidence.reliable_aspects : [];
  const uncertainAspects = Array.isArray(confidence?.uncertain_aspects) ? confidence.uncertain_aspects : [];
  const aspectLabel = (key) => {
    const labels = {
      task_fulfillment: { zh: "任务完成度", en: "task fulfillment" },
      organization_coherence: { zh: "组织与连贯", en: "organization and coherence" },
      language_use: { zh: "语言使用", en: "language use" },
      nuanced_argument_quality: { zh: "细微论证质量", en: "nuanced argument quality" },
      support_depth_in_short_response: { zh: "短文本支持深度", en: "depth of support in shorter responses" },
      tone_register_nuance: { zh: "语气与语域细节", en: "tone/register nuance" },
      specificity_depth_in_short_response: { zh: "短文本具体性深度", en: "specificity in shorter responses" },
    };
    return labels[key]?.[langOverride] || key;
  };
  const listText = (arr) => (arr.length > 0 ? arr.map(aspectLabel).join(langOverride === "zh" ? "、" : ", ") : (langOverride === "zh" ? "语言准确性与任务对齐" : "language use and task alignment"));

  const rubricCard = rubricDims && (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{ui.rubricTitle}</div>
      <div style={{ display: "grid", gap: 8 }}>
        {[
          ["Task fulfillment", rubricDims.task_fulfillment],
          ["Organization & coherence", rubricDims.organization_coherence],
          ["Language use", rubricDims.language_use],
        ].map(([name, d]) => (
          <div key={name} style={{ border: "1px solid #e2e8f0", borderRadius: 4, padding: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
              <b style={{ fontSize: 13 }}>{name}</b>
              <span style={{ fontSize: 12, color: C.t2 }}>{Number(d?.score ?? 0).toFixed(1)} x {Number(d?.weight ?? 0).toFixed(2)}</span>
            </div>
            <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>{d?.definition || ""}</div>
            <div style={{ fontSize: 12, color: C.t1 }}>{d?.reason || ""}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: C.t2 }}>
        <b>{ui.weightedScore}:</b> {Number(rubric.weighted_score || 0).toFixed(2)} | <b>{ui.weightedMethod}:</b> {rubric.method || "weighted_combination"}
      </div>
    </div>
  );

  const keyProblemsCard = (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{lowConfidence ? ui.priorityFeedback : ui.keyProblems}</div>
      {keyProblems.length === 0 ? (
        <div style={{ fontSize: 13, color: C.t2 }}>{ui.noProblems}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {keyProblems.map((p, i) => (
            <div key={i} style={{ border: "1px solid " + C.bdr, borderLeft: "4px solid " + (i === 0 ? C.red : C.orange), borderRadius: 4, padding: 10 }}>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.t2, marginBottom: 4 }}>{ui.diagnosis}</div>
                <div style={{ fontSize: 13, color: C.t1, marginBottom: 6 }}>
                  <b>{ui.whyMatters}:</b> {p.explanation}
                </div>
                <div style={{ fontSize: 13, color: C.t2, background: "#f8fafc", borderRadius: 4, padding: "6px 8px" }}>
                  <b>{ui.example}:</b> "{p.example}"
                </div>
              </div>
              <div style={{ borderTop: "1px dashed " + C.bdr, paddingTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.t2, marginBottom: 4 }}>{ui.action}</div>
                <div style={{ fontSize: 13, color: C.t1 }}>{p.action}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div data-testid="score-panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -4 }}>
        <LangToggle lang={langOverride} onChange={(v) => { setLangOverride(v); saveReportLanguage(v); }} />
      </div>

      <div style={{ background: C.nav, color: "#fff", borderRadius: 6, padding: "16px 20px", opacity: lowConfidence ? 0.92 : 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: lowConfidence ? 30 : 38, fontWeight: 800 }}>{lowConfidence ? `~${score}` : score}</span>
            <span style={{ opacity: 0.8 }}>{lowConfidence ? ui.provisional : "/ 5"}</span>
          </div>
          <span style={{ background: lowConfidence ? "#64748b" : scoreColor, borderRadius: 14, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>
            {ui.scoreBand} {lowConfidence ? "-" : (band ?? "-")}
          </span>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>{result.summary || ""}</div>
      </div>

      {lowConfidence && (
        <div data-testid="low-confidence-state" style={{ background: "#fffbeb", border: "1px solid #f59e0b", borderRadius: 6, padding: "10px 12px", fontSize: 13, color: "#92400e", lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{ui.lowConfidenceTitle}</div>
          <div>{ui.lowConfidenceBody}</div>
        </div>
      )}

      <div
        data-testid="score-disclaimer-note"
        style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          padding: "10px 12px",
          fontSize: 12,
          color: C.t2,
          lineHeight: 1.6,
        }}
      >
        <div>{ui.aiNote1}</div>
        <div>{ui.aiNote2}</div>
      </div>

      <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{ui.confidenceTitle}</div>
        <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.7 }}>
          <div><b>{ui.confidenceReliable}:</b> {listText(reliableAspects)}.</div>
          <div><b>{ui.confidenceUncertain}:</b> {listText(uncertainAspects)}.</div>
          <div style={{ color: C.t2 }}>{ui.confidenceNote}</div>
        </div>
      </div>

      {lowConfidence ? (
        <>
          {keyProblemsCard}
          {rubricCard}
        </>
      ) : (
        <>
          {rubricCard}
          {keyProblemsCard}
        </>
      )}
    </div>
  );
}
