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
  const prompt = `${AUDIT_PROMPT}

Speaker: "${item.speaker}"

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

module.exports = { auditLCRItem, auditLCRBatch };
