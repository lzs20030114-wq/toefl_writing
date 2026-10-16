"use client";
import React, { useState } from "react";
import { translateGrammarPoint } from "../../lib/utils";
import { C, ChevronIcon, SurfaceCard } from "../shared/ui";
import { useBsAiExplain, BsAiExplainBlock } from "../buildSentence/useBsAiExplain";

// 拼句一次练习的逐题明细：练习记录展开后看到的，和答完题的结果页是同一个组件（2026-10 用户要求两边一致）。
// details 是存进练习记录的形状：{ prompt, userAnswer, correctAnswer, isCorrect, grammar_points }。

export function renderWordDiff(userText, correctText) {
  if (!userText) return <span style={{ color: "#9ca3af", fontStyle: "italic" }}>（未作答）</span>;
  const normalize = (word) => String(word).toLowerCase().replace(/[.,!?;:'"]/g, "");
  const userWords = String(userText).trim().split(/\s+/);
  const correctWords = String(correctText || "").trim().split(/\s+/);
  return (
    <>
      {userWords.map((word, index) => {
        const isWrong = normalize(word) !== normalize(correctWords[index] || "");
        return (
          <React.Fragment key={index}>
            <span style={{ textDecoration: isWrong ? "underline" : "none", textDecorationColor: "#ef4444", textDecorationThickness: 2, color: isWrong ? "#ef4444" : "#111827", fontWeight: isWrong ? 600 : 400 }}>{word}</span>
            {index < userWords.length - 1 ? " " : ""}
          </React.Fragment>
        );
      })}
    </>
  );
}

function GrammarChip({ children }) {
  return <span style={{ display: "inline-flex", alignItems: "center", padding: "1px 6px", borderRadius: 999, fontSize: 10, fontWeight: 700, color: C.blue, background: C.softBlue, whiteSpace: "nowrap" }}>{children}</span>;
}

export function BsSessionDetail({ details, correct, total, explainPrefix = "hist" }) {
  const [openItems, setOpenItems] = useState({});
  const bsAi = useBsAiExplain();
  const list = Array.isArray(details) ? details : [];

  return (
    <SurfaceCard style={{ background: "#f9fafb", padding: 12, margin: "5px 0 7px", boxShadow: "none" }}>
      <div style={{ fontSize: 11, color: C.t2, marginBottom: 8 }}>答对 {correct}/{total}</div>
      {list.map((detail, index) => {
        const itemOpen = !!openItems[index];
        const statusColor = detail.isCorrect ? C.green : C.red;
        return (
          <div key={index} data-testid={`build-result-${index}`} data-correct={detail.isCorrect ? "true" : "false"} style={{ borderBottom: index < list.length - 1 ? "1px solid #e5e7eb" : "none" }}>
            <button data-testid={`build-result-toggle-${index}`} aria-expanded={itemOpen} onClick={() => setOpenItems((prev) => ({ ...prev, [index]: !prev[index] }))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", cursor: "pointer", width: "100%", border: "none", background: "transparent", textAlign: "left" }}>
              <span title={detail.isCorrect ? "答对" : "答错"} style={{ color: statusColor, fontWeight: 700, fontSize: 15, flexShrink: 0, width: 18, textAlign: "center" }}>{detail.isCorrect ? "✓" : "!"}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.t1, flexShrink: 0 }}>第 {index + 1} 题</span>
              <span style={{ fontSize: 11, color: C.t2, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail.prompt}</span>
              <ChevronIcon open={itemOpen} size={10} />
            </button>
            {itemOpen ? (
              <div style={{ paddingLeft: 26, paddingBottom: 10, display: "flex", flexDirection: "column", gap: 7 }}>
                <div data-testid={`build-your-sentence-${index}`}>
                  <div style={{ fontSize: 11, color: C.t2, marginBottom: 4 }}>你的答案</div>
                  <div style={{ fontSize: 13, lineHeight: 1.65 }}>{renderWordDiff(detail.userAnswer, detail.correctAnswer)}</div>
                </div>
                {!detail.isCorrect ? (
                  <div data-testid={`build-correct-answer-${index}`}>
                    <div style={{ fontSize: 11, color: C.t2, marginBottom: 4 }}>正确答案</div>
                    <div style={{ fontSize: 13, color: C.blue, lineHeight: 1.65 }}>{detail.correctAnswer}</div>
                  </div>
                ) : null}
                {Array.isArray(detail.grammar_points) && detail.grammar_points.length > 0 ? (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {detail.grammar_points.map((g, gi) => <GrammarChip key={gi}>{translateGrammarPoint(g)}</GrammarChip>)}
                  </div>
                ) : null}
                <BsAiExplainBlock explainKey={`${explainPrefix}-${index}`} detail={detail} aiExplains={bsAi.aiExplains} isLegacy={bsAi.isLegacy} handleAiExplain={bsAi.handleAiExplain} includeCorrect />
              </div>
            ) : null}
          </div>
        );
      })}
    </SurfaceCard>
  );
}
