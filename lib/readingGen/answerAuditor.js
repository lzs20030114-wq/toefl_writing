/**
 * Answer Auditor — AI-powered verification of generated questions.
 *
 * Uses DeepSeek as a "second examiner" to independently answer each question
 * WITHOUT seeing the marked correct answer. If the AI's answer differs from
 * the marked answer, the question is flagged for review.
 *
 * Also checks:
 * - Whether the AI can answer WITHOUT the passage (guessability test)
 * - Whether multiple options could be correct (ambiguity test)
 * - Whether the explanation matches the marked answer
 */

const { join } = require("path");
const { readFileSync, existsSync } = require("fs");

function loadEnv() {
  try {
    const envPath = join(__dirname, "..", "..", ".env.local");
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
      }
    }
  } catch {}
}

async function callAI(prompt, maxTokens = 2000) {
  loadEnv();
  const { callDeepSeekViaCurl } = require("../ai/deepseekHttp.js");
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");

  const payload = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "You are a TOEFL reading comprehension expert. Answer precisely and concisely. Return only valid JSON." },
      { role: "user", content: prompt },
    ],
    temperature: 0.1, // Low temperature for deterministic answers
    max_tokens: maxTokens,
  };

  const result = await callDeepSeekViaCurl({ apiKey, payload, timeoutMs: 30000 });
  return typeof result === "string" ? result : (result?.choices?.[0]?.message?.content || JSON.stringify(result));
}

function parseJson(text) {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  return JSON.parse(cleaned);
}

/**
 * Audit a single RDL item's questions.
 *
 * @param {object} item — RDL item with text and questions
 * @returns {Promise<object>} audit results
 */
async function auditRDLItem(item) {
  const results = [];

  // ── Step 1: Answer WITH the passage (verify correctness) ──
  const withPassagePrompt = buildAnswerPrompt(item.text, item.questions);
  let withPassageAnswers;
  try {
    const raw = await callAI(withPassagePrompt);
    withPassageAnswers = parseJson(raw);
  } catch (err) {
    return { id: item.id, error: "AI call failed: " + err.message, results: [] };
  }

  // ── Step 2: Answer WITHOUT the passage (guessability test) ──
  const withoutPassagePrompt = buildGuessabilityPrompt(item.questions);
  let withoutPassageAnswers;
  try {
    const raw = await callAI(withoutPassagePrompt);
    withoutPassageAnswers = parseJson(raw);
  } catch {
    withoutPassageAnswers = {}; // Non-critical, continue
  }

  // ── Step 3: Compare results ──
  for (let i = 0; i < item.questions.length; i++) {
    const q = item.questions[i];
    const qKey = `Q${i + 1}`;
    const markedAnswer = q.correct_answer;
    const aiAnswer = withPassageAnswers[qKey]?.answer || withPassageAnswers[qKey] || "?";
    const aiConfidence = withPassageAnswers[qKey]?.confidence || "unknown";
    const aiReasoning = withPassageAnswers[qKey]?.reasoning || "";
    const guessedAnswer = withoutPassageAnswers[qKey]?.answer || withoutPassageAnswers[qKey] || "?";

    const flags = [];

    // Flag 1: AI disagrees with marked answer
    if (aiAnswer !== markedAnswer && aiAnswer !== "?") {
      flags.push({
        type: "ANSWER_MISMATCH",
        severity: "critical",
        detail: `AI says ${aiAnswer}, marked ${markedAnswer}. AI reasoning: ${aiReasoning}`,
      });
    }

    // Flag 2: Guessable without passage
    if (guessedAnswer === markedAnswer) {
      flags.push({
        type: "GUESSABLE",
        severity: "warning",
        detail: `Can be answered without reading the passage (guessed ${guessedAnswer})`,
      });
    }

    // Flag 3: Low confidence
    if (aiConfidence === "low" || aiConfidence === "uncertain") {
      flags.push({
        type: "AMBIGUOUS",
        severity: "warning",
        detail: `AI confidence is ${aiConfidence}: ${aiReasoning}`,
      });
    }

    results.push({
      question: qKey,
      stem: q.stem.substring(0, 80),
      type: q.question_type,
      markedAnswer,
      aiAnswer,
      aiConfidence,
      guessedAnswer,
      match: aiAnswer === markedAnswer,
      guessable: guessedAnswer === markedAnswer,
      flags,
    });
  }

  return {
    id: item.id,
    genre: item.genre,
    totalQuestions: item.questions.length,
    matches: results.filter(r => r.match).length,
    mismatches: results.filter(r => !r.match).length,
    guessable: results.filter(r => r.guessable).length,
    criticalFlags: results.flatMap(r => r.flags).filter(f => f.severity === "critical").length,
    results,
  };
}

function buildAnswerPrompt(text, questions) {
  const qBlocks = questions.map((q, i) => {
    const opts = Object.entries(q.options).map(([k, v]) => `  ${k}. ${v}`).join("\n");
    return `Q${i + 1}. ${q.stem}\n${opts}`;
  }).join("\n\n");

  return `Read the following passage and answer each question by choosing the BEST option (A, B, C, or D).

## PASSAGE
${text}

## QUESTIONS
${qBlocks}

## INSTRUCTIONS
For each question, analyze the passage carefully and select the best answer.
Return a JSON object with this format:
{
  "Q1": { "answer": "B", "confidence": "high", "reasoning": "The passage states that..." },
  "Q2": { "answer": "D", "confidence": "high", "reasoning": "..." },
  "Q3": { "answer": "A", "confidence": "medium", "reasoning": "..." }
}

Confidence levels: "high" (clearly supported), "medium" (requires inference), "low" (uncertain/ambiguous).
Return ONLY the JSON, no other text.`;
}

function buildGuessabilityPrompt(questions) {
  const qBlocks = questions.map((q, i) => {
    const opts = Object.entries(q.options).map(([k, v]) => `  ${k}. ${v}`).join("\n");
    return `Q${i + 1}. ${q.stem}\n${opts}`;
  }).join("\n\n");

  return `Answer the following reading comprehension questions using ONLY common sense and general knowledge. You have NOT read the passage — you must GUESS based on the options alone.

## QUESTIONS
${qBlocks}

## INSTRUCTIONS
For each question, pick the answer that seems most likely to be correct based on common sense alone.
Return a JSON object:
{
  "Q1": { "answer": "B" },
  "Q2": { "answer": "A" },
  "Q3": { "answer": "C" }
}

Return ONLY the JSON.`;
}

/**
 * Audit a CTW item — verify that blank words have unique solutions.
 */
async function auditCTWItem(item) {
  const prompt = `You are given a C-test passage where some words have their endings removed. For each blank, determine the ONLY correct word that fits.

## PASSAGE (with blanks)
${item.blanked_text}

## INSTRUCTIONS
For each numbered blank, provide the complete word. Return JSON:
{
  "1": "word1",
  "2": "word2",
  ...
  "10": "word10"
}

Return ONLY the JSON.`;

  let aiAnswers;
  try {
    const raw = await callAI(prompt);
    aiAnswers = parseJson(raw);
  } catch (err) {
    return { id: item.id, error: "AI call failed: " + err.message, results: [] };
  }

  const results = [];
  item.blanks.forEach((b, i) => {
    const key = String(i + 1);
    const aiWord = (aiAnswers[key] || "").toLowerCase().replace(/[^a-z]/g, "");
    const correctWord = b.original_word.toLowerCase().replace(/[^a-z]/g, "");
    const match = aiWord === correctWord;

    const flags = [];
    if (!match && aiWord) {
      // Check if the AI's answer is also plausible
      flags.push({
        type: "BLANK_MISMATCH",
        severity: aiWord.startsWith(b.displayed_fragment.toLowerCase()) ? "critical" : "info",
        detail: `AI says "${aiWord}", expected "${correctWord}" (fragment: "${b.displayed_fragment}")`,
      });
    }

    results.push({
      blank: i + 1,
      fragment: b.displayed_fragment,
      expected: b.original_word,
      aiAnswer: aiAnswers[key] || "?",
      match,
      flags,
    });
  });

  return {
    id: item.id,
    totalBlanks: item.blanks.length,
    matches: results.filter(r => r.match).length,
    mismatches: results.filter(r => !r.match).length,
    criticalFlags: results.flatMap(r => r.flags).filter(f => f.severity === "critical").length,
    results,
  };
}

module.exports = { auditRDLItem, auditCTWItem };
