"use client";
import { C } from "../shared/ui";
import { SpeakButton } from "../shared/SpeakButton";

const AMBER = "#92400E";

/**
 * 词形组的「组卡」：同组词连着到了就合成一张，正面列出整组词形，先在心里说出各自的意思，
 * 翻面看每个词的中文。评分在外面（VocabReview.gradeGroup），一次记到整组每个词上。
 * rows: [{ word, display, sense }]
 */
export function FamilyCardFace({ family, rows, sentence = null, revealed }) {
  return (
    <div data-testid="family-card">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <span data-testid="family-tag" style={{
          fontSize: 11, fontWeight: 700, color: AMBER, background: "#FEF3C7",
          border: "1px solid #F3D9A4", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap",
        }}>
          {family} 组 · {rows.length} 个词
        </span>
        <span style={{ fontSize: 11, color: C.t3 }}>整组一起记：先说出每个词的意思再翻面</span>
      </div>
      {sentence ? (
        <div style={{ fontSize: 16, color: C.t1, lineHeight: 1.8, marginBottom: 14 }}>{sentence}</div>
      ) : null}
      <div style={{ border: "1px solid #ebf0ed", borderRadius: 10, overflow: "hidden" }}>
        {rows.map((r, i) => (
          <div key={r.word} data-testid="family-card-row" style={{
            display: "flex", flexDirection: "column", gap: 2, padding: "10px 14px",
            borderTop: i ? "1px solid #ebf0ed" : "none", background: r.word === family ? "#FFFDF7" : "#fff", minWidth: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <strong style={{ fontSize: 18, color: C.t1, overflowWrap: "anywhere" }}>{r.display}</strong>
              <span onClick={(e) => e.stopPropagation()}><SpeakButton word={r.display} size={24} /></span>
            </div>
            {revealed ? (
              <span style={{ fontSize: 13, color: C.t2, lineHeight: 1.6, overflowWrap: "anywhere" }}>{r.sense || "暂无释义"}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
