/** 同场学习步可以提前排进队列，但必须先隔开十张其他卡。 */
export function reinsertAfterGap(queue, pos, updated, times, {
  gap = 10, maxAppearances = 4, windowMs = 30 * 60 * 1000, now = Date.now(),
} = {}) {
  if (!updated || times >= maxAppearances || queue.length - pos - 1 < gap) return queue;
  const dueIn = new Date(updated.due).getTime() - now;
  if (!Number.isFinite(dueIn) || dueIn > windowMs) return queue;
  const next = [...queue];
  next.splice(pos + 1 + gap, 0, updated);
  return next;
}
