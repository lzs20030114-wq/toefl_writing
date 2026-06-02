// Maps a TOEFL band score (≈0–6) to its display color.
//
// Previously copy-pasted verbatim in ProgressView, MobileProgressView,
// MockSessionDetail and ReadingProgressView. The band→color thresholds were
// identical in all four; the only difference was the non-finite case:
//   - ProgressView / MobileProgressView never pass a non-finite band (callers
//     guard with `Number.isFinite(...) ? getBandColor(...) : P.textDim`).
//   - MockSessionDetail / ReadingProgressView call it directly and rely on the
//     built-in guard returning their `textDim` color (#94a39a).
// `fallback` defaults to that same #94a39a, so it is a drop-in for all four.
export function getBandColor(band, fallback = "#94a39a") {
  if (!Number.isFinite(band)) return fallback;
  if (band >= 5.5) return "#16a34a";
  if (band >= 4.5) return "#2563eb";
  if (band >= 3.5) return "#d97706";
  if (band >= 2.5) return "#ea580c";
  return "#dc2626";
}
