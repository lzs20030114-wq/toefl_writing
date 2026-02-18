import sentenceEngine from "./questionBank/sentenceEngine";

export function fmt(s) {
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

export function wc(t) {
  return t.trim() ? t.trim().split(/\s+/).length : 0;
}

export function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function norm(s) {
  return s.toLowerCase().replace(/[.,!?]/g, "").trim();
}

/**
 * Evaluate Build a Sentence answer.
 */
export function evaluateBuildSentenceOrder(question, userChunks) {
  const q = question || {};
  const { answerWords, slots } = sentenceEngine.buildWordSlots(q, userChunks, { lowercase: true });
  const normAnswer = answerWords.map((w) => w.toLowerCase()).join(" ");
  const normUser = slots.filter(Boolean).join(" ");
  const isCorrect = normUser === normAnswer;
  return { isCorrect, alternateAccepted: false, acceptedReason: null };
}
