// Extract Reading wrong-answer records from saved practice sessions.
//
// Reading sessions are produced by app/reading/page.js → saveReadingSession.
// Three subtypes coexist:
//   - "ctw"  (Complete the Words) — fill-in-the-blank, results array of
//            { blankIndex, userInput, expected, isCorrect }, plus blanks
//            metadata for context.
//   - "rdl"  (Read in Daily Life) and "ap" (Academic Passage) — MCQ, results
//            array of { qIndex, selected, correct, isCorrect } plus questions
//            metadata containing { stem, options, answer, explanation }.
//
// We normalize all three into the same shape so a generic mistake view can
// render them. The downstream notebook treats each session as a "group" and
// renders one card per wrong answer.

const READING_SUBTYPE_LABELS = {
  ctw: "Complete the Words",
  rdl: "Read in Daily Life",
  ap: "Academic Passage",
};

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function ctwBlankContext(blank) {
  if (!blank) return "";
  const fragment = String(blank.displayed_fragment || "").trim();
  const original = String(blank.original_word || "").trim();
  if (!fragment || !original) return original;
  // Show the visible fragment with underscores for the missing letters
  const missingLen = Math.max(0, original.length - fragment.length);
  return `${fragment}${"_".repeat(missingLen)}`;
}

function buildCtwMistake(detail, result, index) {
  const blanks = safeArray(detail?.blanks);
  const blank = blanks[result?.blankIndex ?? index];
  const stem = ctwBlankContext(blank);
  const correctWord = String(blank?.original_word || result?.expected || "").trim();
  const userAnswer = (() => {
    const fragment = String(blank?.displayed_fragment || "").trim();
    const input = String(result?.userInput || "").trim();
    return (fragment + input).trim() || input;
  })();
  return {
    stem,
    options: null,
    optionsKey: null,
    selected: null,
    correctKey: null,
    userAnswer,
    correctAnswer: correctWord,
    explanation: blank?.explanation || "",
    sentenceContext: blank?.sentence || detail?.passage || "",
    _index: index,
  };
}

function buildMcqMistake(detail, result, index) {
  const questions = safeArray(detail?.questions);
  const q = questions[result?.qIndex ?? index] || {};
  const options = q.options && typeof q.options === "object" ? q.options : null;
  const selectedKey = result?.selected ?? null;
  const correctKey = result?.correct ?? q.answer ?? null;
  return {
    stem: String(q.stem || "").trim(),
    options,
    optionsKey: options ? Object.keys(options) : null,
    selected: selectedKey,
    correctKey,
    userAnswer: selectedKey && options ? `${selectedKey}. ${options[selectedKey] || ""}` : (selectedKey || ""),
    correctAnswer: correctKey && options ? `${correctKey}. ${options[correctKey] || ""}` : (correctKey || ""),
    explanation: String(q.explanation || "").trim(),
    type: q.type || null,
    _index: index,
  };
}

/**
 * Extract reading mistakes grouped by session, newest first.
 * Each group corresponds to one practice session; one entry per wrong answer
 * inside it. Sessions with no wrong answers are dropped.
 */
export function extractReadingMistakes(sessions) {
  return safeArray(sessions)
    .filter((s) => s?.type === "reading" && s?.details && Array.isArray(s.details.results))
    .map((session, idx) => {
      const details = session.details || {};
      const subtype = details.subtype || "rdl";
      const wrongs = details.results
        .map((r, i) => ({ result: r, index: i }))
        .filter(({ result }) => result && result.isCorrect === false);
      if (wrongs.length === 0) return null;

      const mistakes = wrongs.map(({ result, index }) =>
        subtype === "ctw"
          ? buildCtwMistake(details, result, index)
          : buildMcqMistake(details, result, index),
      );

      return {
        key: session.date || `reading-${idx}`,
        sessionId: session.id ?? null,
        date: session.date,
        subtype,
        subtypeLabel: READING_SUBTYPE_LABELS[subtype] || subtype.toUpperCase(),
        topic: details.topic || details.genre || "",
        itemId: details.itemId || null,
        total: Number.isFinite(session.total) ? session.total : details.results.length,
        correct: Number.isFinite(session.correct) ? session.correct : details.results.filter((r) => r?.isCorrect).length,
        wrongCount: mistakes.length,
        mistakes,
        passage: details.passage || "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

/** Lightweight total — for sidebar badges. */
export function countReadingMistakes(sessions) {
  return safeArray(sessions)
    .filter((s) => s?.type === "reading" && Array.isArray(s?.details?.results))
    .reduce((n, s) => n + s.details.results.filter((r) => r && r.isCorrect === false).length, 0);
}
