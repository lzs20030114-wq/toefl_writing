/**
 * Post-writing spelling drill extraction.
 *
 * Pipeline:
 *   AI grades essay → feedback contains {annotationSegments, correctedText}
 *   extractPostWritingPracticeItems walks the spelling marks
 *   For each: locate the same sentence in correctedText (clean version),
 *   blank out the correct word in that clean sentence → drill prompt
 *
 * Why correctedText not user text:
 *   The user's original sentence is often broken in multiple places
 *   (multiple spellings, grammar errors, etc.). Showing the user a polluted
 *   sentence with one blank teaches them the wrong context. correctedText
 *   is AI's minimally-corrected version — clean enough to drill against.
 *
 * Sessions saved before the ===CORRECTED=== prompt change won't have
 * correctedText; those items are silently skipped (acceptable per product
 * decision: few users with only legacy sessions).
 */

const SPELLING_NOTE_RE = /(拼写|spelling|misspell|misspelled|typo)/i;
const SINGLE_WORD_RE = /^[A-Za-z][A-Za-z'-]*$/;
const SENTENCE_BREAK_RE = /[.!?\n]/;
const WORD_BOUNDARY_RE = /[A-Za-z][A-Za-z'-]*/g;

function normalizeWord(value) {
  return String(value || "").trim();
}

function isSingleWord(value) {
  return SINGLE_WORD_RE.test(normalizeWord(value));
}

function isSameLocalDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  if (!Number.isFinite(da.getTime()) || !Number.isFinite(db.getTime())) return false;
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function toDayKey(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Reconstruct the text that segment.start/end positions are relative to.
 * Built from annotationSegments (the parsed plainText), not raw userText.
 */
function reconstructAnnotationPlainText(feedback) {
  const segments = Array.isArray(feedback?.annotationSegments) ? feedback.annotationSegments : [];
  if (segments.length === 0) return "";
  return segments.map((segment) => String(segment?.text || "")).join("");
}

/**
 * Extract the corrected English word from a fix or note string.
 * AI may output in various formats:
 *   - "receive" (bare word)
 *   - "将 recieve 改为 receive" (Chinese instruction)
 *   - "应为 receive" / "正确拼写为 receive"
 *   - "recieve → receive"
 *   - "should be receive"
 * Returns "" if no clear correction is found. We deliberately DO NOT use
 * a "last English word" fallback — that turned out to pick up noise like
 * "again" / "typo" / "error" from the note text and serve them as the
 * "correct answer", teaching the user wrong spellings.
 */
function extractCorrectedWord(text, wrongWord) {
  const s = String(text || "").trim();
  if (!s) return "";
  const wl = String(wrongWord || "").trim().toLowerCase();
  // Bare single English word
  if (SINGLE_WORD_RE.test(s) && s.toLowerCase() !== wl) return s;
  // "改为 Y" / "应为 Y" / "为 Y" (Chinese patterns)
  const m1 = s.match(/(?:改为|应为|应该是|正确.*?为|拼写.*?为)\s*([A-Za-z][A-Za-z'-]*)/);
  if (m1 && m1[1].toLowerCase() !== wl) return m1[1];
  // "→ Y" / "-> Y"
  const m2 = s.match(/(?:→|->)\s*([A-Za-z][A-Za-z'-]*)/);
  if (m2 && m2[1].toLowerCase() !== wl) return m2[1];
  // "should be Y" / "change to Y" / "replace with Y" / "correct: Y"
  const m3 = s.match(/(?:should be|change to|replace with|correct(?:ed)?\s*(?:to|:))\s*([A-Za-z][A-Za-z'-]*)/i);
  if (m3 && m3[1].toLowerCase() !== wl) return m3[1];
  return "";
}

/**
 * Attempt to recover a single-word spelling pair from a multi-word mark.
 * AI sometimes wraps an entire sentence in <r>...</r> even though only one
 * word is misspelled. We diff segment.text vs segment.fix word-by-word; if
 * they differ in exactly one position, that's our wrong/correct pair.
 *
 * Example:
 *   wrongText = "I recieved your email"
 *   fixText   = "I received your email"
 *   → { wrong: "recieved", correct: "received" }
 *
 * Returns null if the diff is anything other than a single-word change.
 */
function recoverSingleWordDiff(wrongText, fixText) {
  const w = String(wrongText || "").trim();
  const f = String(fixText || "").trim();
  if (!w || !f) return null;
  const wWords = w.split(/\s+/);
  const fWords = f.split(/\s+/);
  if (wWords.length !== fWords.length) return null;

  let diffIdx = -1;
  for (let i = 0; i < wWords.length; i += 1) {
    // Strip surrounding punctuation for the comparison
    const wn = wWords[i].toLowerCase().replace(/[^a-z'-]/g, "");
    const fn = fWords[i].toLowerCase().replace(/[^a-z'-]/g, "");
    if (wn !== fn) {
      if (diffIdx !== -1) return null; // more than one diff
      diffIdx = i;
    }
  }
  if (diffIdx === -1) return null;

  const wrong = wWords[diffIdx].replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, "");
  const correct = fWords[diffIdx].replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, "");
  if (!isSingleWord(wrong) || !isSingleWord(correct)) return null;
  if (wrong.toLowerCase() === correct.toLowerCase()) return null;
  return { wrong, correct };
}

/**
 * Determine if a segment is a spelling mark we can drill.
 * Returns the resolved { wrongWord, correctWord } pair, or null if unusable.
 */
function resolveSpellingPair(segment) {
  if (!segment || segment.type !== "mark") return null;
  const wrongRaw = normalizeWord(segment.text);
  const fixRaw = normalizeWord(segment.fix);
  const noteRaw = normalizeWord(segment.note);
  const errorType = normalizeWord(segment.errorType).toLowerCase();
  if (!wrongRaw) return null;

  // Must be tagged as spelling somehow (explicit errorType, or note/fix keyword)
  const looksSpelling =
    errorType === "spelling" ||
    SPELLING_NOTE_RE.test(noteRaw) ||
    SPELLING_NOTE_RE.test(fixRaw);
  if (!looksSpelling) return null;

  // Case 1: <r>recieve</r> + fix="receive" — the common case
  if (isSingleWord(wrongRaw)) {
    const correctWord =
      extractCorrectedWord(fixRaw, wrongRaw) ||
      extractCorrectedWord(noteRaw, wrongRaw);
    if (!correctWord || !isSingleWord(correctWord)) return null;
    if (wrongRaw.toLowerCase() === correctWord.toLowerCase()) return null;
    return { wrongWord: wrongRaw, correctWord };
  }

  // Case 2: AI marked a whole sentence/phrase for a single spelling error.
  // Recover the actual word pair by diffing wrongText vs fix.
  const recovered = recoverSingleWordDiff(wrongRaw, fixRaw);
  if (recovered) return { wrongWord: recovered.wrong, correctWord: recovered.correct };

  return null;
}

/**
 * Split text into sentences, preserving the order. Returns array of
 * { text, start, end } where start/end are offsets in the source text.
 */
function splitSentencesWithBounds(text) {
  const safe = String(text || "");
  if (!safe) return [];
  const out = [];
  let cursor = 0;
  for (let i = 0; i < safe.length; i += 1) {
    if (SENTENCE_BREAK_RE.test(safe[i])) {
      const sent = safe.slice(cursor, i + 1);
      if (sent.trim()) out.push({ text: sent, start: cursor, end: i + 1 });
      cursor = i + 1;
    }
  }
  if (cursor < safe.length) {
    const tail = safe.slice(cursor);
    if (tail.trim()) out.push({ text: tail, start: cursor, end: safe.length });
  }
  return out;
}

function indexOfWordCaseInsensitive(sentence, word) {
  if (!sentence || !word) return -1;
  const sLower = sentence.toLowerCase();
  const wLower = word.toLowerCase();
  // Look for whole-word boundary match
  const re = new RegExp(`\\b${wLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const m = sLower.match(re);
  if (m && typeof m.index === "number") return m.index;
  // Fallback: simple substring
  const i = sLower.indexOf(wLower);
  return i;
}

/**
 * Build the drill prompt for a single spelling pair using correctedText.
 * Strategy:
 *   1. Locate the user-side sentence containing the wrong-word mark
 *   2. Map to the same sentence index in correctedText
 *   3. Blank out the corrected word in that sentence
 *
 * If sentence alignment fails (counts differ, word not found), return null
 * and skip this item — better to skip than show a polluted/wrong drill.
 */
function buildDrillFromCorrected({ userPlainText, correctedText, segment, correctWord }) {
  if (!correctedText) return null;
  if (!Number.isInteger(segment?.start) || !Number.isInteger(segment?.end)) return null;

  const userSentences = splitSentencesWithBounds(userPlainText);
  const correctedSentences = splitSentencesWithBounds(correctedText);
  if (userSentences.length === 0 || correctedSentences.length === 0) return null;
  if (userSentences.length !== correctedSentences.length) return null;

  // Find which user-side sentence contains the mark
  let targetIdx = -1;
  for (let i = 0; i < userSentences.length; i += 1) {
    const s = userSentences[i];
    if (segment.start >= s.start && segment.end <= s.end) {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx < 0) return null;

  const correctedSentence = correctedSentences[targetIdx].text.trim();
  if (!correctedSentence) return null;

  // Locate the correct word in the corrected sentence
  const idx = indexOfWordCaseInsensitive(correctedSentence, correctWord);
  if (idx < 0) return null;

  // Use the original case from the corrected sentence (preserve capitalization)
  const matchedWord = correctedSentence.slice(idx, idx + correctWord.length);
  const promptSentence =
    `${correctedSentence.slice(0, idx)}[______]${correctedSentence.slice(idx + matchedWord.length)}`.trim();

  return { sentence: correctedSentence, promptSentence, displayCorrectWord: matchedWord };
}

export function extractPostWritingPracticeItems(histOrSessions, now = new Date()) {
  const sessions = Array.isArray(histOrSessions)
    ? histOrSessions
    : Array.isArray(histOrSessions?.sessions)
      ? histOrSessions.sessions
      : [];
  const next = [];
  const seen = new Set();

  sessions.forEach((session, sessionIndex) => {
    const type = String(session?.type || "");
    if (type !== "email" && type !== "discussion") return;
    const feedback = session?.details?.feedback || null;
    const correctedText = String(feedback?.correctedText || "").trim();
    // Without a correctedText we cannot generate a clean drill. Skip these
    // (legacy sessions graded before the ===CORRECTED=== prompt change).
    if (!correctedText) return;

    const userPlainText = reconstructAnnotationPlainText(feedback);
    const marks = Array.isArray(feedback?.annotationSegments) ? feedback.annotationSegments : [];
    const sourceDate = String(session?.date || "");
    const dayKey = toDayKey(sourceDate);
    const bucket = isSameLocalDay(sourceDate, now) ? "today" : "notebook";

    // Stable per-session ID for dedup — prefer practiceRootId (set on new
    // sessions), then cloud row id, then date. Avoid sessionIndex (which
    // shifts as new sessions arrive, causing false duplicates).
    const stableSessionKey =
      String(session?.details?.practiceRootId || "") ||
      String(session?.id ?? "") ||
      sourceDate ||
      `s${sessionIndex}`;

    marks.forEach((segment, markIndex) => {
      const pair = resolveSpellingPair(segment);
      if (!pair) return;
      const { wrongWord, correctWord } = pair;

      const drill = buildDrillFromCorrected({
        userPlainText,
        correctedText,
        segment,
        correctWord,
      });
      if (!drill) return;

      const dedupeKey = [
        stableSessionKey,
        dayKey,
        wrongWord.toLowerCase(),
        correctWord.toLowerCase(),
        drill.sentence,
      ].join("|");
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      next.push({
        id: `${type}-${stableSessionKey}-${markIndex}`,
        bucket,
        dayKey,
        sourceDate,
        sourceType: type,
        wrongText: wrongWord,
        correctText: drill.displayCorrectWord || correctWord,
        note: normalizeWord(segment.note),
        sentence: drill.sentence,
        promptSentence: drill.promptSentence,
      });
    });
  });

  return next.sort((a, b) => new Date(b.sourceDate).getTime() - new Date(a.sourceDate).getTime());
}

export function groupPostWritingPracticeItems(items) {
  const list = Array.isArray(items) ? items : [];
  return {
    today: list.filter((item) => item.bucket === "today"),
    notebook: list.filter((item) => item.bucket === "notebook"),
  };
}

// Test-only export so unit tests can verify the pair resolver in isolation.
export const __test__ = {
  extractCorrectedWord,
  recoverSingleWordDiff,
  resolveSpellingPair,
  splitSentencesWithBounds,
  indexOfWordCaseInsensitive,
  buildDrillFromCorrected,
};
