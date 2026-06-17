// MCQ answer-audit core — pure, deterministic, model-free.
//
// This is the COMPARISON half of the "second examiner". The SOLVING half is
// done by the Claude routine itself (see scripts/routine-audit.mjs): the routine
// re-answers each question blind (no answer key in front of it), writes its
// answers to data/.audit-solved.json, and this module decides — purely by string
// comparison — which items are mis-keyed and must be dropped.
//
// Why split it this way: the routine runs on the claude.ai subscription model
// and its environment has no DEEPSEEK_API_KEY, so the old merge-time auditor
// (lib/readingGen/answerAuditor.js, which calls DeepSeek over HTTP) was SKIPPED
// on the primary path — reading answers shipped unverified and listening was
// never wired at all. By making the routine model the examiner and keeping only
// the deterministic compare in code, the audit always runs on the primary path
// and needs no API key.
//
// Covers MCQ banks only:
//   reading:   ap, rdl            (answer key = question.correct_answer)
//   listening: la, lat, lc, lcr   (answer key = question.answer; lcr = item.answer)
// CTW (c-test) is NOT MCQ and is audited elsewhere (cTestBlanker + ctwValidator
// + the DeepSeek auditCTWItem on the CI path).

// Per-prefix accessors: where the context text, the question list, and the
// marked answer live for each bank's schema.
export const MCQ_CONFIG = {
  ap: {
    section: "reading",
    context: (it) => it.passage || (Array.isArray(it.paragraphs) ? it.paragraphs.join("\n\n") : ""),
    questions: (it) => (Array.isArray(it.questions) ? it.questions : []),
    key: (q) => q.correct_answer,
  },
  rdl: {
    section: "reading",
    context: (it) => it.text || "",
    questions: (it) => (Array.isArray(it.questions) ? it.questions : []),
    key: (q) => q.correct_answer,
  },
  la: {
    section: "listening",
    context: (it) => it.announcement || "",
    questions: (it) => (Array.isArray(it.questions) ? it.questions : []),
    key: (q) => q.answer,
  },
  lat: {
    section: "listening",
    context: (it) => it.transcript || "",
    questions: (it) => (Array.isArray(it.questions) ? it.questions : []),
    key: (q) => q.answer,
  },
  lc: {
    section: "listening",
    context: (it) => (Array.isArray(it.conversation) ? it.conversation : [])
      .map((t) => `${t.speaker}: ${t.text}`).join("\n"),
    questions: (it) => (Array.isArray(it.questions) ? it.questions : []),
    key: (q) => q.answer,
  },
  // lcr is a single implicit question: the prompt line is the "context", the
  // four responses are the options, and the marked answer sits at the top level.
  lcr: {
    section: "listening",
    context: (it) => it.speaker || "",
    questions: (it) => [{
      type: it.answer_paradigm || "short_response",
      stem: "Choose the best spoken response to the prompt above.",
      options: it.options,
    }],
    key: (q, it) => it.answer,
  },
};

// Leading alpha prefix of a staging filename: "lc-routine-….json" → "lc",
// "rdl-routine-…-short.json" → "rdl". Mirrors merge-staging.mjs's regex so the
// two scripts always agree on which validator/auditor a file maps to.
export function prefixOf(file) {
  const m = String(file || "").match(/^([a-z]+)-/);
  return m ? m[1] : "";
}

// Stable question identifier shared by extract (writes it) and apply (looks it
// up in the solved map). Keyed by file + item index + question index so it
// survives the staging file being rewritten between phases.
export function questionKey(file, itemIndex, qIndex) {
  return `${file}#${itemIndex}#q${qIndex}`;
}

function norm(x) {
  return String(x == null ? "" : x).trim().toUpperCase();
}

// Build the blind question list for one staging file: stem + options + context,
// but NEVER the answer key or explanation. This is what the routine solves.
export function extractBlind(items, prefix, file) {
  const cfg = MCQ_CONFIG[prefix];
  if (!cfg || !Array.isArray(items)) return [];
  const out = [];
  items.forEach((it, i) => {
    cfg.questions(it).forEach((q, qi) => {
      if (!q || !q.options) return; // not an MCQ question — skip
      out.push({
        key: questionKey(file, i, qi),
        section: cfg.section,
        prefix,
        file,
        itemIndex: i,
        qIndex: qi,
        type: q.type || q.question_type || "unknown",
        context: cfg.context(it),
        stem: q.stem || "",
        options: q.options,
      });
    });
  });
  return out;
}

// Compare the routine's blind answers against the marked keys for one file.
// An item is REJECTED if any of its questions has an answered-but-mismatched
// key (fail-closed: a mis-keyed question taints the whole item). A question the
// routine left unanswered is recorded as `skipped` and does NOT reject the item
// (we never drop a good item because the examiner forgot to answer one).
//
// `solved` is either { answers: { key: "B", … } } or the bare { key: "B" } map.
export function applyVerdict(items, prefix, file, solved) {
  const cfg = MCQ_CONFIG[prefix];
  const answers = (solved && solved.answers) || solved || {};
  const mismatches = [];
  const skipped = [];
  const rejectedIdx = new Set();
  let totalQ = 0;
  let matched = 0;

  if (!cfg || !Array.isArray(items)) {
    return { keptItems: items || [], rejectedItems: [], mismatches, skipped, totalQ, matched };
  }

  items.forEach((it, i) => {
    cfg.questions(it).forEach((q, qi) => {
      if (!q || !q.options) return;
      totalQ += 1;
      const key = questionKey(file, i, qi);
      const marked = norm(cfg.key(q, it));
      const claude = norm(answers[key]);
      if (!claude) {
        skipped.push({ key, itemIndex: i, qIndex: qi, marked });
        return;
      }
      if (claude !== marked) {
        rejectedIdx.add(i);
        mismatches.push({
          key,
          itemIndex: i,
          qIndex: qi,
          id: it.id,
          marked,
          claude,
          stem: String(q.stem || "").slice(0, 90),
        });
      } else {
        matched += 1;
      }
    });
  });

  const keptItems = items.filter((_, i) => !rejectedIdx.has(i));
  const rejectedItems = [...rejectedIdx].sort((a, b) => a - b).map((i) => ({ itemIndex: i, id: items[i].id }));
  return { keptItems, rejectedItems, mismatches, skipped, totalQ, matched };
}
