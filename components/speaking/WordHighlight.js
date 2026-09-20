"use client";

/**
 * 原句逐词高亮：命中的词绿色加粗，漏掉 / 说错的词红色划掉。
 *
 * 原先 RepeatTask（总结页 + AccuracyCard）和 SpeakingProgressView（历史页 RepeatDetail）
 * 各存了一份几乎一样的私有实现，改一处忘另一处就会出现「同一句在两页配色不同」。
 * 这里抽成唯一实现，差异只剩 fontSize（任务页 14 / 历史页 13）。
 *
 * matchedWords / missedWords 是 scoreRepeat 产出的归一化词表，可能含重复词，
 * 所以用 pool + splice「消费一次算一次」，避免 "the … the" 这种句子里第二个 the
 * 蹭到第一个 the 的判定。两个池子都没命中的词按漏词处理（划掉）。
 */
export function WordHighlight({ originalSentence, matchedWords, missedWords, fontSize = 14, style }) {
  const origWords = String(originalSentence || "").split(/\s+/).filter(Boolean);
  const normalizeWord = (w) => w.toLowerCase().replace(/[^\w]/g, "");

  const matchedPool = [...(matchedWords || [])];
  const missedPool = [...(missedWords || [])];

  const styled = origWords.map((word, idx) => {
    const norm = normalizeWord(word);
    const matchIdx = matchedPool.indexOf(norm);
    if (matchIdx !== -1) {
      matchedPool.splice(matchIdx, 1);
      return (
        <span key={idx} style={{ color: "#16A34A", fontWeight: 600 }}>
          {word}{" "}
        </span>
      );
    }
    const missIdx = missedPool.indexOf(norm);
    if (missIdx !== -1) {
      missedPool.splice(missIdx, 1);
      return (
        <span key={idx} style={{
          color: "#DC2626", textDecoration: "line-through",
          textDecorationColor: "#DC2626",
        }}>
          {word}{" "}
        </span>
      );
    }
    // 兜底：既没命中也不在漏词表里的词，按漏词渲染
    return (
      <span key={idx} style={{
        color: "#DC2626", textDecoration: "line-through",
        textDecorationColor: "#DC2626",
      }}>
        {word}{" "}
      </span>
    );
  });

  return (
    <div style={{ fontSize, lineHeight: 1.8, marginBottom: 4, ...style }}>
      {styled}
    </div>
  );
}
