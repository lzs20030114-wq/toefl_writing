"use client";
import { createPortal } from "react-dom";
import { C, FONT } from "../shared/ui";
import { fmtDuration } from "../../lib/vocab/reviewSummary";

/** 每过这么多个词停一下：落一次存档、给一份小结，也给人一个自然的休息点。 */
export const SEGMENT_SIZE = 10;
/** 小结上的措辞：阅读说「记得/忘了」，听力说「听懂了/没听懂」。 */
export const SEGMENT_LABELS = { good: "记得", again: "忘了", requeue: "忘了的词已排到后面，隔一会儿再考一次。" };
export const LISTENING_SEGMENT_LABELS = { good: "听懂了", again: "没听懂", requeue: "没听懂的词已排到后面，隔一会儿再听一次。" };

const ACCENT = "#0891B2";
const kbd = (color, border) => ({
  fontSize: 11, fontWeight: 700, border: `1px solid ${border}`, borderRadius: 5,
  padding: "0 6px", lineHeight: "18px", color, background: "transparent",
});

/** 每过完一段（10 个词）弹出的小结：这一段每个词记没记得、用了多久，可以休息退出，也可以继续。 */
export function SegmentCheckpoint({ segNo, rows, good, again, durationMs, saved, onContinue, onPause, labels = SEGMENT_LABELS }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: FONT,
    }}>
      <div role="dialog" aria-modal="true" aria-label={`第 ${segNo} 段复习完成`} style={{
        width: 560, maxWidth: "100%", maxHeight: "calc(100vh - 48px)", display: "flex", flexDirection: "column",
        background: "#fff", borderRadius: 16, boxShadow: "0 10px 40px rgba(0,0,0,0.12)", overflow: "hidden",
      }}>
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid #ebf0ed" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 10, letterSpacing: 0.3, color: C.t3, fontWeight: 700, whiteSpace: "nowrap" }}>第 {segNo} 段</span>
            {saved && (
              <span style={{ fontSize: 10, fontWeight: 700, color: "#087355", background: "#ECFDF5", border: "1px solid #D1FAE5", borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" }}>
                ✓ 已存档
              </span>
            )}
          </div>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.3, color: C.t1 }}>这 {SEGMENT_SIZE} 个词过完了</div>
          <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 12, color: C.t2, flexWrap: "wrap" }}>
            <span>本段用时 {fmtDuration(durationMs)}</span>
            <span style={{ color: "#0d9668", fontWeight: 700 }}>{labels.good} {good}</span>
            <span style={{ color: "#dc2626", fontWeight: 700 }}>{labels.again} {again}</span>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {rows.map((r, i) => (
            <div key={`${r.word}-${i}`} style={{
              display: "grid", gridTemplateColumns: "minmax(0, .9fr) minmax(0, 1.3fr) auto", alignItems: "center",
              gap: 12, padding: "10px 24px", borderBottom: "1px solid #ebf0ed",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14, color: C.t1, overflowWrap: "anywhere" }}>{r.display}</strong>
                {r.n > 1 && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#B45309", background: "#FFFBEB", borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap" }}>
                    第 {r.n} 次
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: C.t2, lineHeight: 1.5, minWidth: 0, overflowWrap: "anywhere" }}>{r.sense}</div>
              <span style={{
                fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap",
                color: r.good ? "#0d9668" : "#dc2626", background: r.good ? "#ecfdf5" : "#fef2f2",
                border: `1px solid ${r.good ? "#a7f3d0" : "#fecaca"}`,
              }}>
                {r.good ? labels.good : labels.again}
              </span>
            </div>
          ))}
        </div>
        <div style={{ padding: "14px 24px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 11, color: C.t3, lineHeight: 1.6 }}>
            {labels.requeue}
            {saved ? "现在退出也没关系，下次会从这个存档点接着复习。" : "现在退出也没关系，已评分的词都已计入进度。"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: 10 }}>
            <button type="button" onClick={onPause} style={{
              border: "1px solid #dde5df", background: "#fff", color: C.t2, borderRadius: 10, padding: "12px 0",
              fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
            }}>先休息，退出</button>
            <button type="button" autoFocus onClick={onContinue} style={{
              border: "none", background: ACCENT, color: "#fff", borderRadius: 10, padding: "12px 0", fontSize: 14,
              fontWeight: 700, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              继续下一段 <span style={kbd("#fff", "rgba(255,255,255,.5)")}>空格</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
