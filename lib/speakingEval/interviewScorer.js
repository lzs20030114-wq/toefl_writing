/**
 * Score an interview response using DeepSeek AI.
 * Sends the question + user's transcript to AI for 4-dimension evaluation.
 *
 * Uses the existing callAI() from lib/ai/client.js
 */
import { callAI } from "../ai/client";
import { getSpeakingSystemPrompt, buildInterviewUserPrompt } from "../ai/prompts/speaking";

/**
 * Default/fallback result when scoring fails.
 */
function fallbackResult(reason) {
  return {
    score: 0,
    dimensions: {
      fluency: { score: 0, feedback: reason },
      intelligibility: { score: 0, feedback: reason },
      language: { score: 0, feedback: reason },
      organization: { score: 0, feedback: reason },
    },
    summary: reason,
    suggestions: [],
    error: true,
  };
}

/**
 * Clamp a score value to 0-5 range, rounded to nearest 0.5.
 */
function clampScore(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(5, Math.max(0, n)) * 2) / 2;
}

/**
 * Parse and validate the AI JSON response.
 * Robust against markdown fences, extra text, etc.
 */
function parseAIResponse(raw) {
  let text = String(raw || "").trim();

  // Strip markdown code fences if present
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");

  // Try to find JSON object
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error("No JSON object found in AI response");
  }

  const jsonStr = text.slice(jsonStart, jsonEnd + 1);
  const data = JSON.parse(jsonStr);

  // Validate required structure
  if (!data.dimensions) {
    throw new Error("Missing dimensions in AI response");
  }

  const dims = ["fluency", "intelligibility", "language", "organization"];
  for (const dim of dims) {
    if (!data.dimensions[dim]) {
      data.dimensions[dim] = { score: 0, feedback: "评分数据缺失" };
    }
    data.dimensions[dim].score = clampScore(data.dimensions[dim].score);
    data.dimensions[dim].feedback = String(data.dimensions[dim].feedback || "");
  }

  data.score = clampScore(data.score);
  data.summary = String(data.summary || "");
  data.suggestions = Array.isArray(data.suggestions)
    ? data.suggestions.map(s => String(s)).slice(0, 3)
    : [];

  return data;
}

/**
 * Score a single interview question response via DeepSeek AI.
 *
 * @param {Object} params
 * @param {string} params.question    — the interview question text
 * @param {string} params.transcript  — the STT-recognized transcript
 * @returns {Promise<Object>} — { score, dimensions: { fluency, intelligibility, language, organization }, summary, suggestions }
 */
export async function scoreInterview({ question, transcript }) {
  // Handle empty/very short transcript locally
  const trimmed = String(transcript || "").trim();
  if (!trimmed || trimmed.split(/\s+/).length < 3) {
    return fallbackResult("未检测到有效语音输入，无法评分。请确保麦克风正常并尝试重新录制。");
  }

  try {
    const systemPrompt = getSpeakingSystemPrompt();
    const userPrompt = buildInterviewUserPrompt(question, transcript);

    const raw = await callAI(systemPrompt, userPrompt, 1500, 60000, 0.3);

    if (!raw || !String(raw).trim()) {
      return fallbackResult("AI 返回为空，评分失败，请重试。");
    }

    const result = parseAIResponse(raw);
    return result;
  } catch (err) {
    console.error("[interviewScorer] scoring failed:", err);
    const msg = String(err?.message || "");
    if (msg.includes("timeout")) {
      return fallbackResult("评分超时，请检查网络后重试。");
    }
    if (msg.includes("429")) {
      return fallbackResult("AI 服务繁忙，请稍后重试。");
    }
    return fallbackResult("评分失败: " + (msg || "未知错误"));
  }
}
