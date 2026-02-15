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
 * Evaluate Build a Sentence answer (v2 — ETS chunk-based).
 *
 * User's chunks → expand to words → join → normalize → compare to answer.
 */
export function evaluateBuildSentenceOrder(question, userChunks) {
  const q = question || {};
  if ((!q.answer || !String(q.answer).trim()) && Array.isArray(q.answerOrder)) {
    const chunks = Array.isArray(userChunks) ? userChunks : [];
    const normalizedUser = chunks.map((c) =>
      (typeof c === "object" && c !== null ? String(c.text || c) : String(c || "")).trim().toLowerCase()
    );
    const normalizedAnswer = q.answerOrder.map((c) => String(c || "").trim().toLowerCase());
    const isCorrect = normalizedUser.length === normalizedAnswer.length &&
      normalizedUser.every((v, i) => v === normalizedAnswer[i]);
    return { isCorrect, alternateAccepted: false, acceptedReason: null };
  }

  const { answerWords, slots } = sentenceEngine.buildWordSlots(q, userChunks, { lowercase: true });
  const normAnswer = answerWords.map((w) => w.toLowerCase()).join(" ");
  const normUser = slots.filter(Boolean).join(" ");
  const isCorrect = normUser === normAnswer;
  return { isCorrect, alternateAccepted: false, acceptedReason: null };
}
