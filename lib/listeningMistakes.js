// Extract Listening wrong-answer records from saved practice sessions.
//
// Listening sessions are produced by app/listening/page.js → saveListeningSession.
// Two layouts coexist:
//   - LCR (Choose a Response): a batch of independent items, each with its
//     own speaker prompt + 4 options. Results array is parallel to items.
//   - LA / LC / LAT (Announcement / Conversation / Academic Talk): one item
//     containing a list of questions. Results array is parallel to questions.
//
// We flatten both into a uniform mistake shape so the generic mistake view can
// render them. The transcript / conversation context is attached at the group
// level so users can re-read what they heard.

const LISTENING_SUBTYPE_LABELS = {
  lcr: "Choose a Response",
  la: "Announcement",
  lc: "Conversation",
  lat: "Academic Talk",
};

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function lcrStem(item) {
  const speaker = String(item?.speaker || "").trim();
  return speaker || "(missing prompt)";
}

function buildLcrMistake(items, result, index) {
  const item = items[index] || null;
  const options = item?.options && typeof item.options === "object" ? item.options : null;
  const selectedKey = result?.selected ?? null;
  const correctKey = result?.correct ?? item?.answer ?? null;
  return {
    stem: lcrStem(item),
    options,
    optionsKey: options ? Object.keys(options) : null,
    selected: selectedKey,
    correctKey,
    userAnswer: selectedKey && options ? `${selectedKey}. ${options[selectedKey] || ""}` : (selectedKey || ""),
    correctAnswer: correctKey && options ? `${correctKey}. ${options[correctKey] || ""}` : (correctKey || ""),
    explanation: String(item?.explanation || "").trim(),
    type: item?.pragmatic_function || null,
    _index: index,
  };
}

function buildMcqMistake(questions, result, index) {
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

export function extractListeningMistakes(sessions) {
  return safeArray(sessions)
    .filter((s) => s?.type === "listening" && s?.details && Array.isArray(s.details.results))
    .map((session, idx) => {
      const details = session.details || {};
      const subtype = details.subtype || "lcr";
      const wrongs = details.results
        .map((r, i) => ({ result: r, index: i }))
        .filter(({ result }) => result && result.isCorrect === false);
      if (wrongs.length === 0) return null;

      let mistakes;
      let contextText = "";
      if (subtype === "lcr") {
        const items = safeArray(details.items);
        mistakes = wrongs.map(({ result, index }) => buildLcrMistake(items, result, index));
      } else {
        const questions = safeArray(details.questions);
        mistakes = wrongs.map(({ result, index }) => buildMcqMistake(questions, result, index));
        contextText = details.transcript
          || (Array.isArray(details.conversation)
            ? details.conversation.map((t) => `${t?.speaker || ""}: ${t?.text || ""}`).filter((x) => x.trim() !== ":").join("\n")
            : "");
      }

      return {
        key: session.date || `listening-${idx}`,
        sessionId: session.id ?? null,
        date: session.date,
        subtype,
        subtypeLabel: LISTENING_SUBTYPE_LABELS[subtype] || subtype.toUpperCase(),
        topic: details.topic || "",
        itemIds: safeArray(details.itemIds),
        total: Number.isFinite(session.total) ? session.total : details.results.length,
        correct: Number.isFinite(session.correct) ? session.correct : details.results.filter((r) => r?.isCorrect).length,
        wrongCount: mistakes.length,
        mistakes,
        contextText,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

export function countListeningMistakes(sessions) {
  return safeArray(sessions)
    .filter((s) => s?.type === "listening" && Array.isArray(s?.details?.results))
    .reduce((n, s) => n + s.details.results.filter((r) => r && r.isCorrect === false).length, 0);
}
