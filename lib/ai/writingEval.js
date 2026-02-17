import { callAI } from "./client";
import { parseReport } from "./parse";
import { calibrateScoreReport } from "./calibration";
import { buildEmailUserPrompt, getEmailSystemPrompt } from "./prompts/emailWriting";
import { buildDiscussionUserPrompt, getDiscussionSystemPrompt } from "./prompts/academicWriting";

export async function evaluateWritingResponse(type, promptData, text, reportLanguage = "zh") {
  const sys = type === "email" ? getEmailSystemPrompt(reportLanguage) : getDiscussionSystemPrompt(reportLanguage);
  const userPrompt = type === "email"
    ? buildEmailUserPrompt(promptData, text)
    : buildDiscussionUserPrompt(promptData, text);

  const raw = await callAI(sys, userPrompt, 2600, 30000, 0.3);
  const parsed = parseReport(raw);
  if (parsed.error) {
    throw new Error(parsed.errorReason || "AI evaluation failed");
  }
  return { ...calibrateScoreReport(type, parsed, text), reportLanguage };
}
