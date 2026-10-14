"use client";
import React from "react";

// 一键提问回答的「小标题 + 内容」版式（块由 lib/qa/answerLayout 的 answerBlocks 给）：
// 左列是小标题，右列是内容；一个小标题下有好几行时逐行分条。没有小标题的块占满整行。
// 标签列取最长那个小标题的宽度，所有块的内容左边对齐，扫一眼就能找到想看的那一项。
//
// renderSegs(segs) 渲染一行的段落（出处标签、引文由调用方按自己的样式画）；
// renderLabel(label) 画非文字标签（举一反三的 [题N]）；tone 给配色。

const VERDICT_TONES = {
  做对: { color: "#047857", background: "#ECFDF5" },
  做错: { color: "#B91C1C", background: "#FEF2F2" },
  未作答: { color: "#6B7280", background: "#F3F4F6" },
};

export function AnswerBlocks({ blocks, renderSegs, renderLabel, tone, renderBlock, testId = "answer-blocks" }) {
  const labelStyle = (muted) => ({
    alignSelf: "start", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 700, lineHeight: "18px", marginTop: 2,
    padding: "0 6px", borderRadius: 4, justifySelf: "start",
    color: muted ? "#6B7280" : tone.label, background: muted ? "#F3F4F6" : tone.labelBg,
  });
  return (
    <div data-testid={testId} style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", columnGap: 8, rowGap: 6, alignItems: "start" }}>
      {blocks.map((b, i) => {
        const custom = renderBlock?.(b);
        const lines = b.lines.filter((l) => l.length);
        const many = lines.length > 1;
        const content = custom || (
          <div style={{ minWidth: 0 }}>
            {b.verdict ? (
              <span data-testid="answer-verdict" style={{ ...VERDICT_TONES[b.verdict], display: "inline-block", fontSize: 11, fontWeight: 700, lineHeight: "16px", borderRadius: 4, padding: "0 5px", marginRight: 6, verticalAlign: "1px" }}>{b.verdict}</span>
            ) : null}
            {lines.map((segs, k) => (
              <div key={k} data-testid={many ? "answer-item" : undefined} style={many ? { position: "relative", paddingLeft: 11, marginTop: k ? 3 : 0 } : { display: b.verdict ? "inline" : "block" }}>
                {many ? <span aria-hidden style={{ position: "absolute", left: 1, top: "0.72em", width: 4, height: 4, borderRadius: 2, background: tone.dot }} /> : null}
                {renderSegs(segs)}
              </div>
            ))}
          </div>
        );
        if (!b.label) return <div key={i} style={{ gridColumn: "1 / -1", minWidth: 0 }}>{content}</div>;
        const muted = b.label === "补充";
        return (
          <React.Fragment key={i}>
            {typeof b.label === "string"
              ? <span data-testid="answer-label" style={labelStyle(muted)}>{b.label}</span>
              : <span style={{ alignSelf: "start", marginTop: 1 }}>{renderLabel(b.label)}</span>}
            {content}
          </React.Fragment>
        );
      })}
    </div>
  );
}
