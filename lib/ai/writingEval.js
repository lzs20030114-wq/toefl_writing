import { callAIMulti } from "./client";
import { parseReport } from "./parse";
import { calibrateScoreReport } from "./calibration";
import { buildEmailUserPrompt, getEmailSystemPrompt } from "./prompts/emailWriting";
import { buildDiscussionUserPrompt, getDiscussionSystemPrompt } from "./prompts/academicWriting";

// DeepSeek 在 4/5 分边界有单次调用方差(同一篇官方 5 分文三次打 [5,4,5])。
// 「三路取中位」在服务端并行发 3 次评分,各自 parse+calibrate 后取中位那份的完整
// 报告展示,把边界抖动压下去。选择逻辑抽成纯函数以便 jest 直测。
//
// 中位规则(candidates 是含 { final } 的候选数组,返回被选索引):
//   n=3：按 final 升序稳定排序取索引 1(中位)
//   n=2：取 final 较低者(保守,防垃圾文靠方差侧漏高分)
//   n=1：用它
//   n=0：无有效候选,返回 -1(调用方走错误契约)
// 注:samples 上限为 3(见 /api/ai MAX_SAMPLES),故 n 只会是 0/1/2/3。
export function pickMedianCandidate(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const n = list.length;
  if (n === 0) return -1;
  if (n === 1) return 0;
  // 升序排序,原索引做 tie-breaker 保证并列时的稳定选取。
  const ordered = list
    .map((c, i) => ({ i, final: Number(c?.final) }))
    .sort((a, b) => (a.final - b.final) || (a.i - b.i));
  if (n === 2) return ordered[0].i; // 取较低
  return ordered[1].i; // n === 3：中位
}

export async function evaluateWritingResponse(type, promptData, text, reportLanguage = "zh") {
  const sys = type === "email" ? getEmailSystemPrompt(reportLanguage) : getDiscussionSystemPrompt(reportLanguage);
  const userPrompt = type === "email"
    ? buildEmailUserPrompt(promptData, text)
    : buildDiscussionUserPrompt(promptData, text);

  // 150s outer timeout matches the new callAIMulti default — gives DeepSeek room
  // to finish a long evaluation under proxy/load.
  // 2026-07-12 判分锚改造: 2600→4000。新增 ===ERRORS=== 推理段 + GOALS 佐证引文后,
  // 实测未截断输出需 3.1-3.9K tokens(vaccine 最长 3835);2600/3000 会把长文的
  // ===SCORE=== 直接截飞导致 format-fail。4000 为实测最大值 + ~5% 余量。
  // 2026-07-12 三路取中位: 服务端并行 3 发(只扣 1 次用量),对每份原始输出各自
  // parse+calibrate,取中位分那份展示。
  const raws = await callAIMulti(sys, userPrompt, 4000, 150000, 0.3, 3);

  const parsedList = raws.map((raw) => parseReport(raw));
  const scoreSamples = []; // 按采样顺序;parse 失败位置放 null,成功放该候选 final
  const candidates = [];
  parsedList.forEach((parsed) => {
    if (parsed.error) {
      scoreSamples.push(null);
      return;
    }
    const report = calibrateScoreReport(type, parsed, text);
    scoreSamples.push(report.score);
    candidates.push({ report, final: report.score });
  });

  if (candidates.length === 0) {
    // 全部 parse 失败——维持现有错误契约:用第一份的 errorReason。
    throw new Error(parsedList[0].errorReason || "AI evaluation failed");
  }

  const chosen = candidates[pickMedianCandidate(candidates)];
  return {
    ...chosen.report,
    reportLanguage,
    // 纯增量可观测字段(存进 details.feedback,不影响任何渲染/存储校验)。
    scoreSamples,
    scoreSampleCount: candidates.length,
  };
}
