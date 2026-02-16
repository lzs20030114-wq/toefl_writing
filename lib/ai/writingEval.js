import { callAI } from "./client";
import { parseReport } from "./parse";
import { calibrateScoreReport } from "./calibration";
import { EMAIL_SYS, buildEmailUserPrompt } from "./prompts/emailWriting";
import { DISC_SYS, buildDiscussionUserPrompt } from "./prompts/academicWriting";

export async function evaluateWritingResponse(type, promptData, text) {
  const sys = type === "email" ? EMAIL_SYS : DISC_SYS;
  const userPrompt = type === "email"
    ? buildEmailUserPrompt(promptData, text)
    : buildDiscussionUserPrompt(promptData, text);

  const raw = await callAI(sys, userPrompt, 2600, 30000, 0.3);
  const parsed = parseReport(raw);
  if (parsed.error) {
    throw new Error(parsed.errorReason || "AI evaluation failed");
  }
  return calibrateScoreReport(type, parsed, text);
}
