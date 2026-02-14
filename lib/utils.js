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

export function normalizedOrderKey(order) {
  return (Array.isArray(order) ? order : []).map((v) => String(v || "").trim()).join("\u001f");
}

export function evaluateBuildSentenceOrder(question, userOrder) {
  const q = question || {};
  const canonicalKey = normalizedOrderKey(q.answerOrder || []);
  const userKey = normalizedOrderKey(userOrder || []);
  if (userKey === canonicalKey) {
    return { isCorrect: true, alternateAccepted: false, acceptedReason: null };
  }
  const altOrders = Array.isArray(q.acceptedAnswerOrders) ? q.acceptedAnswerOrders : [];
  const matchIdx = altOrders.findIndex((order) => normalizedOrderKey(order) === userKey);
  if (matchIdx >= 0) {
    const reasons = Array.isArray(q.acceptedReasons) ? q.acceptedReasons : [];
    return {
      isCorrect: true,
      alternateAccepted: true,
      acceptedReason: typeof reasons[matchIdx] === "string" ? reasons[matchIdx] : null,
    };
  }
  return { isCorrect: false, alternateAccepted: false, acceptedReason: null };
}
