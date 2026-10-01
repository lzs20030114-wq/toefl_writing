"use client";
import { C, FONT } from "../shared/ui";
import { SpeakButton } from "../shared/SpeakButton";

const ACCENT = "#0891B2";
const card = { background: "#fff", border: "1px solid #dde5df", borderRadius: 14, boxShadow: "0 1px 3px #0a281908" };
const ghostBtn = {
  border: "1px solid #dde5df", background: "#fff", color: C.t2, borderRadius: 7,
  padding: "6px 10px", fontSize: 12, cursor: "pointer", fontFamily: FONT,
};

function Stat({ label, children, tone }) {
  const tones = {
    plain: { background: "#f7faf9", border: "1px solid #ebf0ed" },
    good: { background: "#ecfdf5", border: "1px solid #a7f3d0" },
    bad: { background: "#fef2f2", border: "1px solid #fecaca" },
  };
  return (
    <div style={{ padding: "14px 16px", borderRadius: 12, minWidth: 0, ...tones[tone] }}>
      <div style={{ fontSize: 11, color: C.t2 }}>{label}</div>
      {children}
    </div>
  );
}

/**
 * 一轮阅读复习结束后的复盘页：这一轮学得怎么样、哪些词忘了、接下来该做什么。
 * 全是展示，数据由 VocabReview 算好传进来（见 VocabReview 的 buildSummary）。
 */
export default function ReviewSummary({ summary, nextTask, tomorrow, onExit, onStartNext, onExportWords }) {
  const { duration, words, asks, good, again, firstRate, firstGood, lost, changes } = summary;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: FONT }}>
      <section style={{ ...card, borderRadius: 16, padding: "28px 26px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, background: "#ECFDF5", border: "1px solid #D1FAE5",
            display: "grid", placeItems: "center", fontSize: 28, flexShrink: 0,
          }}>🌿</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.t1, letterSpacing: -0.4 }}>这一轮复习完成</div>
            <div style={{ fontSize: 13, color: C.t2, marginTop: 4 }}>
              阅读复习 · 用时 {duration} · 过了 {words} 个词，共 {asks} 次提问
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginTop: 22 }}>
          <Stat label="第一次就想起来" tone="plain">
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: C.t1, letterSpacing: -0.5 }}>{firstRate}%</span>
              <span style={{ fontSize: 12, color: C.t3 }}>{firstGood} / {words} 词</span>
            </div>
            <div style={{ height: 4, background: "#ebf0ed", borderRadius: 999, overflow: "hidden", marginTop: 8 }}>
              <div style={{ height: "100%", width: `${firstRate}%`, background: "#0D9668" }} />
            </div>
          </Stat>
          <Stat label="记得" tone="good">
            <div style={{ fontSize: 26, fontWeight: 800, color: "#0d9668", marginTop: 4 }}>{good}</div>
          </Stat>
          <Stat label="忘了" tone="bad">
            <div style={{ fontSize: 26, fontWeight: 800, color: "#dc2626", marginTop: 4 }}>{again}</div>
          </Stat>
        </div>

        {changes && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", marginTop: 18, borderTop: "1px solid #ebf0ed", paddingTop: 16 }}>
            {changes.map((c) => (
              <div key={c.label} style={{ padding: "0 14px", borderLeft: "1px solid #ebf0ed", minWidth: 0 }}>
                <div style={{ fontSize: 11, color: C.t3 }}>{c.label}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, color: C.t3 }}>{c.from} →</span>
                  <strong style={{ fontSize: 18, color: C.t1 }}>{c.to}</strong>
                  <span style={{ fontSize: 11, fontWeight: 700, color: c.color }}>{c.delta}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ ...card, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "16px 22px", borderBottom: "1px solid #ebf0ed", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 15, color: C.t1 }}>
            这一轮忘了的词 <span style={{ color: C.t3, fontSize: 13, fontWeight: 500, marginLeft: 6 }}>{lost.length}</span>
          </h2>
          {lost.length > 0 && onExportWords && (
            <button type="button" style={ghostBtn} onClick={() => onExportWords(lost.map((l) => l.word))}>导出这些词 PDF</button>
          )}
        </div>
        {lost.map((l) => (
          <div key={l.word} style={{
            display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr) auto", alignItems: "center",
            gap: 14, padding: "12px 22px", borderBottom: "1px solid #ebf0ed",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <strong style={{ fontSize: 14, color: C.t1, overflowWrap: "anywhere" }}>{l.display}</strong>
              <SpeakButton word={l.display} size={24} />
            </div>
            <div style={{ fontSize: 12, color: C.t2, lineHeight: 1.5, minWidth: 0, overflowWrap: "anywhere" }}>{l.sense}</div>
            <span style={{ fontSize: 11, color: C.t3, whiteSpace: "nowrap" }}>已安排重学</span>
          </div>
        ))}
        {lost.length === 0 && <div style={{ padding: 22, textAlign: "center", fontSize: 13, color: C.t2 }}>这一轮一个都没忘。</div>}
        <div style={{ padding: "11px 22px", color: C.t3, fontSize: 11, lineHeight: 1.6 }}>
          它们已排进学习步，到时间会自动回到复习里。别现在回头再刷一遍——那只会制造「我记住了」的错觉。
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <div style={{ ...card, border: nextTask?.todo > 0 ? "1px solid #a5e8f0" : card.border, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 0.3, color: nextTask?.todo > 0 ? ACCENT : C.t3, fontWeight: 700 }}>NEXT</div>
            {nextTask?.todo > 0 ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginTop: 4 }}>{nextTask.label}还有 {nextTask.todo} 词</div>
                <div style={{ fontSize: 12, color: C.t2, marginTop: 3 }}>约 {nextTask.minutes} 分钟，今天的任务就清空了</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginTop: 4 }}>今天的复习任务清空了</div>
                <div style={{ fontSize: 12, color: C.t2, marginTop: 3 }}>新词按每日额度放出，明天继续。</div>
              </>
            )}
          </div>
          {nextTask?.todo > 0 && onStartNext && (
            <button type="button" onClick={onStartNext} style={{
              border: "none", background: ACCENT, color: "#fff", borderRadius: 10, padding: "10px 0",
              fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
            }}>开始{nextTask.label}</button>
          )}
        </div>
        <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 0.3, color: C.t3, fontWeight: 700 }}>TOMORROW</div>
            {tomorrow ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginTop: 4 }}>明天预计 {tomorrow.n} 词</div>
                <div style={{ fontSize: 12, color: C.t2, marginTop: 3 }}>
                  {tomorrow.carried > 0 ? `含今天顺延的 ${tomorrow.carried} 个到期词` : "按当前每日额度估算"}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginTop: 4 }}>明天见</div>
            )}
          </div>
          <button type="button" onClick={onExit} style={{
            border: "1px solid #dde5df", background: "#fff", color: C.t1, borderRadius: 10, padding: "10px 0",
            fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
          }}>返回单词本</button>
        </div>
      </div>
    </div>
  );
}
