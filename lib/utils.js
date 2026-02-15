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
  const answer = String(q.answer || "").trim();

  // Normalize: lowercase, strip punctuation, collapse spaces
  const normAnswer = answer.toLowerCase().replace(/[.,!?;:]/g, "").replace(/\s+/g, " ").trim();

  // Build user sentence from chunk array
  const chunks = Array.isArray(userChunks) ? userChunks : [];
  const userWords = [];
  chunks.forEach(c => {
    const text = (typeof c === "object" && c !== null ? String(c.text || c) : String(c || "")).trim();
    if (text) text.split(/\s+/).forEach(w => userWords.push(w));
  });

  // Prepend prefilled words at their positions
  const prefilledPositions = q.prefilled_positions && typeof q.prefilled_positions === "object"
    ? q.prefilled_positions : {};
  const answerWords = normAnswer.split(/\s+/).filter(Boolean);
  const totalSlots = answerWords.length;
  const fullSlots = new Array(totalSlots).fill(null);

  // Place prefilled
  for (const [chunk, pos] of Object.entries(prefilledPositions)) {
    const ws = chunk.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
    for (let i = 0; i < ws.length && pos + i < totalSlots; i++) {
      fullSlots[pos + i] = ws[i];
    }
  }

  // Fill remaining with user words
  let wi = 0;
  for (let i = 0; i < totalSlots; i++) {
    if (fullSlots[i] === null && wi < userWords.length) {
      fullSlots[i] = userWords[wi++].toLowerCase();
    }
  }

  const normUser = fullSlots.filter(Boolean).join(" ");
  const isCorrect = normUser === normAnswer;
  return { isCorrect, alternateAccepted: false, acceptedReason: null };
}
