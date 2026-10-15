"use client";
import { C, FONT } from "../shared/ui";
import { reviewCardStyle, reviewKbd as kbd } from "./reviewPresentation";

const ACCENT = "#0891B2";
const STATUS = {
  good: { label: "这次记得", fg: "#0d9668", bg: "#ecfdf5", bd: "#a7f3d0" },
  again: { label: "这次忘了", fg: "#dc2626", bg: "#fef2f2", bd: "#fecaca" },
  rest: { label: "今天不用复习", fg: "#94a39a", bg: "#F7FAF9", bd: "#dde5df" },
};

/**
 * 一个词形组在本场连着复习完后的小结：整组词形、词性和中文一屏看完。只是看，不打分、不进排期。
 * rows: [{ word, display, sense, status: "good" | "again" | "rest" }]
 */
export function FamilyRecap({ family, rows, onContinue }) {
  return (
    <div data-testid="family-recap" style={{ ...reviewCardStyle, cursor: "default", fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: "#92400E", background: "#FEF3C7",
          border: "1px solid #F3D9A4", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap",
        }}>
          {family} 组
        </span>
        <span style={{ fontSize: 11, color: C.t3 }}>这一组复习完了，整组再看一眼</span>
      </div>
      <div style={{ border: "1px solid #ebf0ed", borderRadius: 10, overflow: "hidden", margin: "12px 0 18px" }}>
        {rows.map((r, i) => {
          const s = STATUS[r.status] || STATUS.rest;
          return (
            <div key={r.word} data-testid="family-recap-row" style={{
              display: "grid", gridTemplateColumns: "minmax(0, 1fr) 84px", alignItems: "center",
              gap: 12, padding: "10px 14px", borderTop: i ? "1px solid #ebf0ed" : "none",
              background: r.word === family ? "#FFFDF7" : "#fff",
            }}>
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <strong style={{ fontSize: 15, color: C.t1, overflowWrap: "anywhere" }}>{r.display}</strong>
                <span style={{ fontSize: 12.5, color: C.t2, lineHeight: 1.5, minWidth: 0, overflowWrap: "anywhere" }}>{r.sense}</span>
              </div>
              <span style={{
                justifySelf: "end", fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap",
                color: s.fg, background: s.bg, border: `1px solid ${s.bd}`,
              }}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
      <button type="button" autoFocus onClick={onContinue} style={{
        width: "100%", border: "none", background: ACCENT, color: "#fff", borderRadius: 10, padding: "12px 0", fontSize: 14,
        fontWeight: 700, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      }}>
        继续 <span style={kbd("#fff", "rgba(255,255,255,.5)")}>空格</span>
      </button>
    </div>
  );
}
