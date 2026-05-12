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

  // 150s outer timeout matches the new callAI default — gives DeepSeek room
  // to finish a long 2.6K-token evaluation under proxy/load.
  const raw = await callAI(sys, userPrompt, 2600, 150000, 0.3);
  const parsed = parseReport(raw);
  if (parsed.error) {
    throw new Error(parsed.errorReason || "AI evaluation failed");
  }
  return { ...calibrateScoreReport(type, parsed, text), reportLanguage };
}
