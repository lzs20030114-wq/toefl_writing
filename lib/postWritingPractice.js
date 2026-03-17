const SPELLING_NOTE_RE = /(拼写|spelling|misspell|misspelled|typo)/i;
const SINGLE_WORD_RE = /^[A-Za-z][A-Za-z'-]*$/;
const SENTENCE_BREAK_RE = /[.!?\n]/;

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
 * This MUST be built from annotationSegments (the parsed plainText),
 * NOT from session.details.userText — the AI may reformat the text
 * and normalizeDetachedAnnotationLines may remove lines, so raw userText
 * offsets won't match segment positions.
 */
function reconstructAnnotationPlainText(feedback) {
  const segments = Array.isArray(feedback?.annotationSegments) ? feedback.annotationSegments : [];
  if (segments.length === 0) return "";
  return segments.map((segment) => String(segment?.text || "")).join("");
}

function getSentenceBounds(text, start, end) {
  const safeText = String(text || "");
  let left = 0;
  for (let i = Math.max(0, start - 1); i >= 0; i -= 1) {
    if (SENTENCE_BREAK_RE.test(safeText[i])) {
      left = i + 1;
      break;
    }
  }
  let right = safeText.length;
  for (let i = Math.max(end, 0); i < safeText.length; i += 1) {
    if (SENTENCE_BREAK_RE.test(safeText[i])) {
      right = i + 1;
      break;
    }
  }
  return { left, right };
}

function createBlankToken(correctWord) {
  void correctWord;
  return "______";
}

function buildPromptSentence(userText, start, end, correctWord) {
  const safeText = String(userText || "");
  if (!safeText || !Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
    return { sentence: "", promptSentence: "" };
  }
  const { left, right } = getSentenceBounds(safeText, start, end);
  const sentence = safeText.slice(left, right).trim();
  if (!sentence) return { sentence: "", promptSentence: "" };
  const blank = createBlankToken(correctWord);
  const relativeStart = Math.max(0, start - left);
  const relativeEnd = Math.max(relativeStart, end - left);
  const promptSentence = `${sentence.slice(0, relativeStart)}[${blank}]${sentence.slice(relativeEnd)}`.trim();
  return { sentence, promptSentence };
}

/**
 * Extract the corrected English word from a fix or note string.
 * The AI may output various formats:
 *   - "receive" (bare word)
 *   - "将 recieve 改为 receive" (Chinese instruction)
 *   - "应为 receive" / "正确拼写为 receive"
 *   - "recieve → receive"
 * Also takes wrongWord to avoid returning the same word.
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
  // Fallback: last English word that differs from the wrong word
  const words = s.match(/[A-Za-z][A-Za-z'-]*/g);
  if (words) {
    for (let i = words.length - 1; i >= 0; i--) {
      if (words[i].toLowerCase() !== wl) return words[i];
    }
  }
  return "";
}

function isSpellingSegment(segment) {
  if (!segment || segment.type !== "mark") return false;
  const wrongText = normalizeWord(segment.text);
  const noteText = normalizeWord(segment.note);
  const fixRaw = normalizeWord(segment.fix);
  const errorType = normalizeWord(segment.errorType).toLowerCase();
  if (!wrongText) return false;
  if (!isSingleWord(wrongText)) return false;
  // Must be identified as spelling (by errorType or keyword in note/fix)
  if (errorType !== "spelling" && !SPELLING_NOTE_RE.test(noteText) && !SPELLING_NOTE_RE.test(fixRaw)) return false;
  // Extract the corrected word from fix, then note as fallback
  const fixText = extractCorrectedWord(fixRaw, wrongText) || extractCorrectedWord(noteText, wrongText);
  if (!fixText || !isSingleWord(fixText)) return false;
  if (wrongText.toLowerCase() === fixText.toLowerCase()) return false;
  return true;
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
    const annotationText = reconstructAnnotationPlainText(feedback);
    const marks = Array.isArray(feedback?.annotationSegments) ? feedback.annotationSegments : [];
    const sourceDate = String(session?.date || "");
    const dayKey = toDayKey(sourceDate);
    const bucket = isSameLocalDay(sourceDate, now) ? "today" : "notebook";

    marks.forEach((segment, markIndex) => {
      if (!isSpellingSegment(segment)) return;
      const wrongText = normalizeWord(segment.text);
      const correctText = extractCorrectedWord(normalizeWord(segment.fix), wrongText)
        || extractCorrectedWord(normalizeWord(segment.note), wrongText);
      const { sentence, promptSentence } = buildPromptSentence(annotationText, segment.start, segment.end, correctText);
      const dedupeKey = [
        String(session?.details?.practiceRootId || `${type}-${sessionIndex}`),
        dayKey,
        wrongText.toLowerCase(),
        correctText.toLowerCase(),
        sentence,
      ].join("|");
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      next.push({
        id: `${type}-${sessionIndex}-${markIndex}`,
        bucket,
        dayKey,
        sourceDate,
        sourceType: type,
        wrongText,
        correctText,
        note: normalizeWord(segment.note),
        sentence,
        promptSentence,
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
