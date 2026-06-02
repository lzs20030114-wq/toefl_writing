// Relative day label for the progress views' session lists: 今天 / 昨天 / M月D日.
// Extracted from the identical inline ternary previously repeated in ProgressView,
// ReadingProgressView, ListeningProgressView and SpeakingProgressView. The header
// markup and the showHeader/lastLabel run-length logic stay in each view (they
// differ per view), so only this shared label computation is centralized here.
export function relativeDateLabel(date, now) {
  const d = date instanceof Date ? date : new Date(date);
  const today = now instanceof Date ? now : new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "今天";
  if (d.toDateString() === yesterday.toDateString()) return "昨天";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
