/**
 * Parse AI response text into a structured report object.
 * Strips markdown code fences, validates required fields,
 * and returns a minimal fallback on failure.
 */
export function parseReport(rawText) {
  try {
    const cleaned = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== "object" || parsed === null) {
      return fallbackReport("AI returned non-object response");
    }
    if (typeof parsed.score !== "number") {
      return fallbackReport("AI response missing score field");
    }
    return parsed;
  } catch (e) {
    return fallbackReport(e.message || "JSON parse failed");
  }
}

function fallbackReport(reason) {
  return {
    score: null,
    band: null,
    summary: "评分解析失败，请重试",
    weaknesses: [],
    strengths: [],
    grammar_issues: [],
    vocabulary_note: "",
    next_steps: [],
    sample: "",
    error: true,
    errorReason: reason,
  };
}
