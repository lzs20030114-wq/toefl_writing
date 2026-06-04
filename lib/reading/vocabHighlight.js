// Vocabulary-in-context questions ("The word \"X\" in paragraph N is closest in
// meaning to ...") ask about one specific word. Real TOEFL highlights that word
// in the passage; the bank has no explicit target field, so we parse it from the
// question stem. Pure helpers (no React) so they can be unit-tested and reused by
// both the mock (AdaptiveExamShell) and practice (RDLTask) renderers.

// Shared inline style for the highlighted word (kept here so both renderers match).
export const VOCAB_HIGHLIGHT_STYLE = { backgroundColor: "#FEF08A", borderRadius: 2, padding: "0 1px", boxShadow: "0 0 0 1px #FDE047" };

/**
 * Extract the target word/phrase a vocab-in-context question asks about.
 * Returns null for non-vocab questions (so callers highlight nothing).
 */
export function getVocabTargetWord(question) {
  if (!question || typeof question !== "object") return null;
  if (question.target_word) return String(question.target_word).trim() || null;
  // Only vocab stems name a quoted word/phrase, e.g.
  //   The word "varies" in paragraph 1 is closest in meaning to
  //   The phrase "give up" ...
  const stem = String(question.stem || question.question || "");
  const m = stem.match(/\b(?:word|phrase|expression)\s+["“”']([^"“”']+)["“”']/i);
  return m ? m[1].trim() || null : null;
}

/**
 * Split `text` into segments around whole-word occurrences of `word`, so a
 * renderer can wrap the hits in a highlight. Case-insensitive; preserves the
 * passage's original casing. Returns [{ text, hit }]. With no word/match the
 * whole text comes back as a single non-hit segment.
 */
export function splitForHighlight(text, word) {
  const s = String(text == null ? "" : text);
  if (!word) return [{ text: s, hit: false }];
  const esc = String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re;
  try {
    re = new RegExp(`(\\b${esc}\\b)`, "i");
  } catch {
    return [{ text: s, hit: false }];
  }
  const lw = String(word).toLowerCase();
  return s
    .split(re)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, hit: part.toLowerCase() === lw }));
}
