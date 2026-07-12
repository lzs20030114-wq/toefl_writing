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
  // to finish a long evaluation under proxy/load.
  // 2026-07-12 判分锚改造: 2600→4000。新增 ===ERRORS=== 推理段 + GOALS 佐证引文后,
  // 实测未截断输出需 3.1-3.9K tokens(vaccine 最长 3835);2600/3000 会把长文的
  // ===SCORE=== 直接截飞导致 format-fail。4000 为实测最大值 + ~5% 余量。
  const raw = await callAI(sys, userPrompt, 4000, 150000, 0.3);
  const parsed = parseReport(raw);
  if (parsed.error) {
    throw new Error(parsed.errorReason || "AI evaluation failed");
  }
  return { ...calibrateScoreReport(type, parsed, text), reportLanguage };
}
