"use client";

import { C, READING_FONT } from "../shared/ui";

/**
 * 插入句题（insert_text）的题干：指令 / 待插入句 / 提问 三段分开渲染。
 *
 * 待插入的句子才是题面，单独成段、左侧一道色条、浅底衬出来；指令和提问是每道题都一样的套话，
 * 降一档字重和颜色，让眼睛先落在句子上。拆分由 lib/reading/insertSentence.js 的 insertStemParts 负责，
 * 调用方拆不出（parts 为 null）时照旧整段渲染原 stem —— 本组件不做回落，免得各页的原样式各写一份。
 *
 * compact：历史复盘 / 错题本的紧凑列表用（13px、色条细一号、间距收紧），答题页用默认档。
 */
export function InsertSentenceStem({ parts, accent = "#3B82F6", soft = "#EFF6FF", compact = false, style }) {
  if (!parts || !parts.sentence) return null;
  const guideStyle = {
    fontSize: compact ? 12.5 : 14,
    fontWeight: compact ? 400 : 500,
    color: C.t2,
    lineHeight: 1.55,
    fontFamily: READING_FONT,
  };
  return (
    <div data-testid="insert-stem" style={{ minWidth: 0, ...style }}>
      <div data-testid="insert-stem-lead" style={guideStyle}>{parts.lead}</div>
      <div
        data-testid="insert-stem-sentence"
        style={{
          margin: compact ? "6px 0" : "10px 0",
          padding: compact ? "6px 10px" : "10px 14px",
          borderLeft: `${compact ? 2 : 3}px solid ${accent}`,
          background: soft,
          borderRadius: compact ? "0 6px 6px 0" : "0 10px 10px 0",
          fontSize: compact ? 13.5 : 16,
          fontWeight: 700,
          color: C.t1,
          lineHeight: 1.6,
          fontFamily: READING_FONT,
          overflowWrap: "anywhere",
        }}
      >
        {parts.sentence}
      </div>
      {parts.tail && (
        <div data-testid="insert-stem-tail" style={guideStyle}>{parts.tail}</div>
      )}
    </div>
  );
}
