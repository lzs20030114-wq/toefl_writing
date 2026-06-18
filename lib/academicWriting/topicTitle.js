/**
 * Extract a short, scannable title from a Discussion professor prompt.
 *
 * Pure + CommonJS so it can be unit-tested in isolation and imported by the
 * (client) academic-writing page. The trigger words use word boundaries so
 * "discuss"/"question" never match inside "discussing"/"discussion" — which
 * previously produced ~1/3 of picker titles starting mid-word with "ing …".
 */
function extractShortTitle(professorText) {
  const text = String(professorText || "").trim();
  // Try to find the core question — often after "talk about", "discuss", etc.
  const match = text.match(/(?:\btalk about\b|\bdiscuss\b|\bquestion\b[:\s]+)(.*?)(?:[.?]|$)/i);
  if (match) {
    const fragment = match[1].trim();
    if (fragment.length > 5 && fragment.length <= 80) return fragment;
  }
  // Fallback: first sentence, truncated
  const first = text.split(/[.!?]/).filter(Boolean)[0]?.trim() || text;
  return first.length > 80 ? first.slice(0, 77) + "..." : first;
}

module.exports = { extractShortTitle };
