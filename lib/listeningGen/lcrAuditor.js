/**
 * LCR Answer Auditor — AI-based independent verification.
 *
 * Sends each item to AI WITHOUT telling it the correct answer.
 * AI must independently choose the best response AND flag if
 * multiple options could be valid.
 *
 * Two passes:
 *   Pass 1: "Which is the best response?" → check if AI agrees with our answer
 *   Pass 2: "Are any other options also reasonable?" → detect ambiguity
 *
 * Items flagged as ambiguous are removed from the batch.
 */

const AUDIT_PROMPT = `You are an expert English conversation analyst. You will see a spoken sentence and 4 possible responses. Your job is to evaluate EACH response.

For each option (A/B/C/D), rate it:
- "valid": This would be a natural, appropriate response in real conversation
- "partially_valid": This could work in some contexts but isn't ideal
- "invalid": This does not appropriately respond to the speaker

Then pick the SINGLE BEST response.

IMPORTANT: Be strict. A response is "valid" ONLY if a native English speaker would naturally say it in this exact conversation. Consider:
- Does it address the speaker's actual need/intent?
- Is it a natural conversational move?
- Would a real person actually say this in response?
- ROLE CHECK: Is this line something the ADDRESSEE would say? A line that only makes sense
  coming from the speaker's own side is INVALID (role inversion). Example: Speaker: "You look
  completely wiped out today." → "Want me to grab you a coffee?" is invalid (the tired person
  would not offer the observer coffee), while "I cleaned the whole kitchen last night." is valid
  (it explains the tiredness). When a Situation line is given, use it to determine who the
  addressee is (e.g. "advisor asking a student" → the response is spoken by the student).

Respond in JSON:
{
  "ratings": {
    "A": "valid|partially_valid|invalid",
    "B": "valid|partially_valid|invalid",
    "C": "valid|partially_valid|invalid",
    "D": "valid|partially_valid|invalid"
  },
  "best": "A|B|C|D",
  "reasoning": "Brief explanation"
}`;

/**
 * Audit a single LCR item.
 *
 * @param {object} item — LCR item with speaker, options, answer
 * @param {Function} callAI — async function(prompt) → string (AI response)
 * @returns {Promise<{match: boolean, ambiguous: boolean, aiAnswer: string, ratings: object, reasoning: string}>}
 */
async function auditLCRItem(item, callAI) {
  const situationLine = item.situation ? `Situation: ${item.situation}\n\n` : "";
  const prompt = `${AUDIT_PROMPT}

${situationLine}Speaker: "${item.speaker}"

A. ${item.options.A}
B. ${item.options.B}
C. ${item.options.C}
D. ${item.options.D}`;

  try {
    const response = await callAI(prompt);

    // Parse JSON from response
    let parsed;
    try {
      const cleaned = response.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return { match: true, ambiguous: false, aiAnswer: "?", ratings: {}, reasoning: "parse_error", error: true };
    }

    const aiAnswer = parsed.best;
    const ratings = parsed.ratings || {};
    const reasoning = parsed.reasoning || "";

    // Check if AI agrees with our answer
    const match = aiAnswer === item.answer;

    // Check for ambiguity: multiple options rated "valid"
    const validCount = Object.values(ratings).filter(r => r === "valid").length;
    const partialCount = Object.values(ratings).filter(r => r === "partially_valid").length;

    // Ambiguous if: >1 "valid", or AI picked a different answer
    const ambiguous = validCount > 1 || (!match && (ratings[aiAnswer] === "valid"));

    return {
      match,
      ambiguous,
      aiAnswer,
      ratings,
      reasoning,
      validCount,
      partialCount,
    };
  } catch (err) {
    return { match: true, ambiguous: false, aiAnswer: "?", ratings: {}, reasoning: `error: ${err.message}`, error: true };
  }
}

/**
 * Audit a single LCR item with N independent votes (majority verdict).
 *
 * Rules (2026-08-02 hardening, see lcr-answer-audit-20260802.md):
 *   - key confirmed only when a STRICT MAJORITY of usable votes picked our answer
 *   - ANY usable vote flagging ambiguity (second valid option) vetoes the item
 *   - fewer than 2 usable votes → error:true (caller decides; merge gate fails closed)
 *
 * Return shape is auditLCRItem-compatible ({match, ambiguous, aiAnswer, ratings,
 * reasoning, error?}) plus {votes, usableCount, agreeCount}.
 *
 * @param {object} item — LCR item with speaker, options, answer (situation optional)
 * @param {Function} callAI — async (prompt) → string
 * @param {{votes?: number}} [opts]
 */
async function auditLCRItemMajority(item, callAI, opts = {}) {
  const voteCount = opts.votes || 3;
  const votes = await Promise.all(
    Array.from({ length: voteCount }, () => auditLCRItem(item, callAI))
  );
  const usable = votes.filter(v => !v.error);

  if (usable.length < 2) {
    return {
      match: true, ambiguous: false, aiAnswer: "?", ratings: {},
      reasoning: `majority_audit_error: only ${usable.length}/${voteCount} usable votes`,
      error: true, votes, usableCount: usable.length, agreeCount: 0,
    };
  }

  const agreeCount = usable.filter(v => v.match).length;
  const match = agreeCount * 2 > usable.length;
  const ambiguous = usable.some(v => v.ambiguous);

  // Modal AI answer across usable votes (for the flagged report)
  const tally = {};
  for (const v of usable) tally[v.aiAnswer] = (tally[v.aiAnswer] || 0) + 1;
  const aiAnswer = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];

  return {
    match, ambiguous, aiAnswer,
    ratings: usable[0].ratings,
    reasoning: usable.map((v, i) => `[vote${i + 1}:${v.aiAnswer}${v.ambiguous ? ",ambig" : ""}] ${String(v.reasoning).slice(0, 60)}`).join(" "),
    votes, usableCount: usable.length, agreeCount,
  };
}

/**
 * Audit a batch with majority voting. Same {clean, flagged, errors} contract as
 * auditLCRBatch, but fail-closed by default: items whose audit errored go to
 * `flagged` (with audit_result.error=true) instead of silently passing.
 *
 * @param {object[]} items
 * @param {Function} callAI
 * @param {{votes?: number, failClosed?: boolean}} [opts]
 */
async function auditLCRBatchMajority(items, callAI, opts = {}) {
  const { votes = 3, failClosed = true } = opts;
  const clean = [];
  const flagged = [];
  let errors = 0;

  for (const item of items) {
    const result = await auditLCRItemMajority(item, callAI, { votes });

    if (result.error) {
      errors++;
      if (failClosed) {
        flagged.push({ ...item, audit_result: { error: true, reasoning: result.reasoning, ourAnswer: item.answer, aiAnswer: "?", match: false, ambiguous: false, ratings: {} } });
      } else {
        clean.push(item);
      }
      continue;
    }

    if (result.ambiguous || !result.match) {
      flagged.push({
        ...item,
        audit_result: {
          aiAnswer: result.aiAnswer, ourAnswer: item.answer,
          match: result.match, ambiguous: result.ambiguous,
          ratings: result.ratings, reasoning: result.reasoning,
          agreeCount: result.agreeCount, usableCount: result.usableCount,
        },
      });
    } else {
      item._audit = { match: true, ambiguous: false, votes: result.usableCount, agree: result.agreeCount };
      clean.push(item);
    }
  }

  return { clean, flagged, errors };
}

/**
 * Audit a batch of LCR items.
 *
 * @param {object[]} items
 * @param {Function} callAI
 * @returns {Promise<{clean: object[], flagged: object[], errors: number}>}
 */
async function auditLCRBatch(items, callAI) {
  const clean = [];
  const flagged = [];
  let errors = 0;

  for (const item of items) {
    const result = await auditLCRItem(item, callAI);

    if (result.error) {
      errors++;
      clean.push(item); // Keep on error (benefit of doubt)
      continue;
    }

    if (result.ambiguous) {
      flagged.push({
        ...item,
        audit_result: {
          aiAnswer: result.aiAnswer,
          ourAnswer: item.answer,
          match: result.match,
          ambiguous: true,
          ratings: result.ratings,
          reasoning: result.reasoning,
        },
      });
    } else if (!result.match) {
      flagged.push({
        ...item,
        audit_result: {
          aiAnswer: result.aiAnswer,
          ourAnswer: item.answer,
          match: false,
          ambiguous: false,
          ratings: result.ratings,
          reasoning: result.reasoning,
        },
      });
    } else {
      item._audit = { match: true, ambiguous: false, validCount: result.validCount };
      clean.push(item);
    }
  }

  return { clean, flagged, errors };
}

module.exports = { auditLCRItem, auditLCRBatch, auditLCRItemMajority, auditLCRBatchMajority };
