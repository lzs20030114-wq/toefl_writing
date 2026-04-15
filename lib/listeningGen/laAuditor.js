/**
 * LA Answer Auditor -- AI-based independent verification.
 *
 * Sends each announcement + questions to AI WITHOUT correct answers.
 * AI must independently choose the best answer for each question AND
 * flag if multiple options could be valid.
 *
 * Adapted from lcrAuditor.js for announcement MCQ format:
 *   - Each item has an announcement + 2 questions (not a single speaker sentence)
 *   - AI reads the announcement and answers each question independently
 *   - Items flagged as ambiguous are removed from the batch
 */

const AUDIT_PROMPT = `You are an expert TOEFL listening comprehension evaluator. You will see a campus announcement and multiple-choice questions about it. Your job is to evaluate EACH option for EACH question.

For each option (A/B/C/D), rate it:
- "valid": This correctly answers the question based on the announcement
- "partially_valid": This is close but not precisely correct, or could be argued
- "invalid": This does not correctly answer the question based on the announcement

Then pick the SINGLE BEST answer for each question.

IMPORTANT: Be strict. An option is "valid" ONLY if:
- For detail questions: the information is explicitly stated in the announcement
- For main_idea questions: it captures the overall purpose, not just one detail
- For inference questions: it can be logically inferred from the announcement without going too far

A "partially_valid" option is one that:
- Contains some truth but is incomplete or misleading
- Could be argued as correct in some interpretations
- Is too narrow or too broad for the question

Respond in JSON:
{
  "questions": [
    {
      "question_index": 0,
      "ratings": {
        "A": "valid|partially_valid|invalid",
        "B": "valid|partially_valid|invalid",
        "C": "valid|partially_valid|invalid",
        "D": "valid|partially_valid|invalid"
      },
      "best": "A|B|C|D",
      "reasoning": "Brief explanation of why this is the best answer"
    },
    {
      "question_index": 1,
      "ratings": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "best": "A|B|C|D",
      "reasoning": "..."
    }
  ]
}`;

/**
 * Audit a single LA item (announcement + 2 questions).
 *
 * @param {object} item -- LA item with announcement, questions
 * @param {Function} callAI -- async function(prompt) -> string
 * @returns {Promise<{match: boolean, ambiguous: boolean, details: object[]}>}
 */
async function auditLAItem(item, callAI) {
  const questionsBlock = item.questions.map((q, i) => {
    return `Question ${i + 1} (${q.type || "unknown"}):\n${q.stem}\nA. ${q.options.A}\nB. ${q.options.B}\nC. ${q.options.C}\nD. ${q.options.D}`;
  }).join("\n\n");

  const prompt = `${AUDIT_PROMPT}

ANNOUNCEMENT:
"${item.announcement}"

${questionsBlock}`;

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
      return {
        match: true,
        ambiguous: false,
        details: [],
        error: true,
        errorMsg: "parse_error",
      };
    }

    const questionResults = parsed.questions || [];
    let allMatch = true;
    let anyAmbiguous = false;
    const details = [];

    for (let qi = 0; qi < item.questions.length; qi++) {
      const q = item.questions[qi];
      const aiResult = questionResults.find(r => r.question_index === qi) || questionResults[qi];

      if (!aiResult) {
        details.push({
          questionIndex: qi,
          match: true,
          ambiguous: false,
          aiAnswer: "?",
          ourAnswer: q.answer,
          ratings: {},
          reasoning: "no_ai_result",
        });
        continue;
      }

      const aiAnswer = aiResult.best;
      const ratings = aiResult.ratings || {};
      const reasoning = aiResult.reasoning || "";
      const match = aiAnswer === q.answer;

      // Check for ambiguity: multiple options rated "valid"
      const validCount = Object.values(ratings).filter(r => r === "valid").length;
      const partialCount = Object.values(ratings).filter(r => r === "partially_valid").length;
      const ambiguous = validCount > 1 || (!match && ratings[aiAnswer] === "valid");

      if (!match) allMatch = false;
      if (ambiguous) anyAmbiguous = true;

      details.push({
        questionIndex: qi,
        match,
        ambiguous,
        aiAnswer,
        ourAnswer: q.answer,
        ratings,
        reasoning,
        validCount,
        partialCount,
      });
    }

    return {
      match: allMatch,
      ambiguous: anyAmbiguous,
      details,
    };
  } catch (err) {
    return {
      match: true,
      ambiguous: false,
      details: [],
      error: true,
      errorMsg: err.message,
    };
  }
}

/**
 * Audit a batch of LA items.
 *
 * @param {object[]} items
 * @param {Function} callAI
 * @returns {Promise<{clean: object[], flagged: object[], errors: number}>}
 */
async function auditLABatch(items, callAI) {
  const clean = [];
  const flagged = [];
  let errors = 0;

  for (const item of items) {
    const result = await auditLAItem(item, callAI);

    if (result.error) {
      errors++;
      clean.push(item); // Keep on error (benefit of doubt)
      continue;
    }

    if (result.ambiguous) {
      flagged.push({
        ...item,
        audit_result: {
          match: result.match,
          ambiguous: true,
          details: result.details,
        },
      });
    } else if (!result.match) {
      flagged.push({
        ...item,
        audit_result: {
          match: false,
          ambiguous: false,
          details: result.details,
        },
      });
    } else {
      item._audit = {
        match: true,
        ambiguous: false,
        details: result.details.map(d => ({
          qi: d.questionIndex,
          match: d.match,
          validCount: d.validCount,
        })),
      };
      clean.push(item);
    }
  }

  return { clean, flagged, errors };
}

module.exports = { auditLAItem, auditLABatch };
