const sameFamily = (a, b) => !!(a?.family && b?.family && a.family === b.family && a.reviewMode === b.reviewMode);

/**
 * 同场学习步可以提前排进队列，但必须先隔开十张其他卡。
 * 落点正好在一组连着的同组词中间时往后挪到这组末尾：否则组被拆开，组卡就合不成了
 * （2026-10-17 demonstrated 组 8 个词被一张回插卡隔开，复习时变回了单词卡）。
 */
export function reinsertAfterGap(queue, pos, updated, times, {
  gap = 10, maxAppearances = 4, windowMs = 30 * 60 * 1000, now = Date.now(),
} = {}) {
  if (!updated || times >= maxAppearances || queue.length - pos - 1 < gap) return queue;
  const dueIn = new Date(updated.due).getTime() - now;
  if (!Number.isFinite(dueIn) || dueIn > windowMs) return queue;
  const next = [...queue];
  let at = pos + 1 + gap;
  while (at < next.length && sameFamily(next[at - 1], next[at]) && !sameFamily(next[at], updated)) at += 1;
  next.splice(at, 0, updated);
  return next;
}
