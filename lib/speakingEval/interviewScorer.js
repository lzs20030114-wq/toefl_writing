/**
 * Score an interview response using DeepSeek AI.
 *
 * 2026-07-15 官方锚定改造：
 *   - 官方 holistic 0-5 rubric prompt（lib/ai/prompts/speaking.js）
 *   - 三路取中位（callAIMulti samples=3，各路独立 parse，按 overall 取中位报告）
 *   - 规则护栏层（lib/speakingEval/calibration.js，词数/跑题/复读/一致性）
 *
 * 输出 shape 向后兼容：{ score, dimensions:{fluency,intelligibility,language,
 * organization}, summary, suggestions, error? }，另加纯增量字段 guardrails / samplesUsed。
 */
import { callAIMulti } from "../ai/client";
import { getSpeakingSystemPrompt, buildInterviewUserPrompt } from "../ai/prompts/speaking";
import {
  parseInterviewResponse,
  pickMedianReport,
  applyGuardrails,
  annotateOffTopicSummary,
} from "./calibration";

// 最少作答词数——低于此视为「无有效语音」，直接给 error fallback（与历史 UX 一致）。
const MIN_WORDS = 3;

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
    guardrails: [],
    samplesUsed: 0,
    error: true,
  };
}

/**
 * Score a single interview question response via DeepSeek AI（三路取中位 + 护栏）。
 *
 * @param {Object} params
 * @param {string} params.question    — the interview question text
 * @param {string} params.transcript  — the STT-recognized transcript
 * @returns {Promise<Object>} — 向后兼容的评分报告（见文件头 shape）
 */
export async function scoreInterview({ question, transcript }) {
  // 前置：空 / 极短转写直接判无效（0 分 error，避免浪费 AI 调用）。
  const trimmed = String(transcript || "").trim();
  if (!trimmed || trimmed.split(/\s+/).filter(Boolean).length < MIN_WORDS) {
    return fallbackResult("未检测到有效语音输入，无法评分。请确保麦克风正常并尝试重新录制。");
  }

  try {
    const systemPrompt = getSpeakingSystemPrompt();
    const userPrompt = buildInterviewUserPrompt(question, trimmed);

    // 三路取中位：服务端并行 3 发（只扣 1 次用量）。采访输出 JSON 较小，但 v4-flash 是
    // 推理型模型（reasoning token 计入预算），给 2500 headroom 防偶发正文被推理吃光。
    // 120s 外层超时——采访评分比写作轻，但仍需容纳代理/负载抖动。
    const raws = await callAIMulti(systemPrompt, userPrompt, 2500, 120000, 0.3, 3);

    // 各路独立 parse，失败路丢弃。
    const candidates = [];
    for (const raw of Array.isArray(raws) ? raws : []) {
      if (!raw || !String(raw).trim()) continue;
      try {
        candidates.push(parseInterviewResponse(raw));
      } catch {
        // 单路 parse 失败——丢弃，交给中位选取（与写作一致，无单路重试）。
      }
    }

    if (candidates.length === 0) {
      return fallbackResult("AI 返回格式异常，评分失败，请重试。");
    }

    // 取中位路的完整报告。
    const chosen = pickMedianReport(candidates);

    // 护栏层：词数/跑题/复读/一致性。
    const guarded = applyGuardrails({
      overall: chosen.overall,
      dimensions: chosen.dimensions,
      transcript: trimmed,
      question,
      onTopic: chosen.onTopic,
    });

    const summary = annotateOffTopicSummary(chosen.summary, guarded.guardrails);

    return {
      score: guarded.score,
      dimensions: guarded.dimensions,
      summary,
      suggestions: chosen.suggestions,
      // 纯增量可观测字段（不影响任何渲染/存储校验）。
      guardrails: guarded.guardrails,
      samplesUsed: candidates.length,
      onTopic: chosen.onTopic,
      overallRaw: chosen.overall,
    };
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
