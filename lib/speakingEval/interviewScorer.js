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
import { callAIMulti, isDailyLimitError, isUpstreamQueuedError, mapScoringError } from "../ai/client";
import { getSpeakingSystemPrompt, buildInterviewUserPrompt } from "../ai/prompts/speaking";
import { readCachedInterviewScore, writeCachedInterviewScore } from "./interviewScoreCache";
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
 *
 * retryable 标记「这题还能救」：转写就在手里，重算一次即可，UI 据此显示
 * 「重新评分」。词数不足那种失败不该带它——重算多少次都还是没话可评。
 */
function fallbackResult(reason, { retryable = false } = {}) {
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
    retryable,
  };
}

const RETRY_HINT = "点「重新评分」可用已保存的转写重试，不用重录。";

// 失败文案。绝不写「请检查网络」——上游排队跟用户的网络毫无关系，让人去查网络
// 只会白折腾（2026-09-20 事故里用户看到的正是这句，真因是 DeepSeek 变慢）。
function scoringFailureReason(err) {
  if (isUpstreamQueuedError(err)) return `AI 正在排队，这一题没能及时出分。${RETRY_HINT}`;
  // 次数用完时重试必然再失败，不诱导用户去点。
  if (isDailyLimitError(err)) return mapScoringError(err);
  return `${mapScoringError(err)}。${RETRY_HINT}`;
}

/**
 * Score a single interview question response via DeepSeek AI（三路取中位 + 护栏）。
 *
 * @param {Object} params
 * @param {string} params.question    — the interview question text
 * @param {string} params.transcript  — the STT-recognized transcript
 * @returns {Promise<Object>} — 向后兼容的评分报告（见文件头 shape）
 */
export async function scoreInterview({ question, transcript, signal } = {}) {
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
    const raws = await callAIMulti(systemPrompt, userPrompt, 2500, 120000, 0.3, 3, { signal });

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
      return fallbackResult(`AI 返回格式异常，评分失败。${RETRY_HINT}`, { retryable: true });
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

    const report = {
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
    // 交卷只等 60 秒，晚到的这一份就进不了那条练习记录了——存一份，记录页据此补上。
    writeCachedInterviewScore({ question, transcript: trimmed }, report);
    return report;
  } catch (err) {
    // 主动中止（交卷时掐掉在途评分）不是故障，不打 error 日志。
    if (err?.name === "AbortError" || signal?.aborted) {
      return fallbackResult(`评分已取消。${RETRY_HINT}`, { retryable: true });
    }
    console.error("[interviewScorer] scoring failed:", err);
    return fallbackResult(scoringFailureReason(err), { retryable: !isDailyLimitError(err) });
  }
}

/**
 * 「重新评分」的统一入口：先查本地补分缓存，没有才真的调一次 AI。
 *
 * 两处 UI 共用（面试结束页、练习记录的面试详情），所以「不重复计费」这条只需
 * 在这里保证一次。scoreInterview 自己不查缓存——它的契约就是「真的算一次」，
 * 混进缓存会让同样的入参在不同时刻给出不同行为，调用方和测试都难判。
 */
export async function rescoreInterview({ question, transcript, signal } = {}) {
  const trimmed = String(transcript || "").trim();
  const cached = readCachedInterviewScore({ question, transcript: trimmed });
  if (cached) return cached;
  return scoreInterview({ question, transcript: trimmed, signal });
}
