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

function reconstructUserText(session, feedback) {
  const direct = String(session?.details?.userText || "").trim();
  if (direct) return direct;
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
  const len = Math.max(4, normalizeWord(correctWord).length);
  return "_".repeat(len);
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

function isSpellingSegment(segment) {
  if (!segment || segment.type !== "mark") return false;
  const wrongText = normalizeWord(segment.text);
  const fixText = normalizeWord(segment.fix);
  const noteText = normalizeWord(segment.note);
  if (!wrongText || !fixText) return false;
  if (!isSingleWord(wrongText) || !isSingleWord(fixText)) return false;
  if (!SPELLING_NOTE_RE.test(noteText)) return false;
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
    const userText = reconstructUserText(session, feedback);
    const marks = Array.isArray(feedback?.annotationSegments) ? feedback.annotationSegments : [];
    const sourceDate = String(session?.date || "");
    const dayKey = toDayKey(sourceDate);
    const bucket = isSameLocalDay(sourceDate, now) ? "today" : "notebook";

    marks.forEach((segment, markIndex) => {
      if (!isSpellingSegment(segment)) return;
      const wrongText = normalizeWord(segment.text);
      const correctText = normalizeWord(segment.fix);
      const { sentence, promptSentence } = buildPromptSentence(userText, segment.start, segment.end, correctText);
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
