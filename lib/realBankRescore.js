// 真题练习记录里「没有评分反馈」的写作记录（邮件 / 讨论）→ 重试评分。
//
// 评分失败（超时 / 评分中途离开页面）时 WritingTask 会把作答原文与整道题（promptData）存下来，
// score 为空、feedback 为 null、details.scoringFailed = true。这里把存下的题与作答重新交给
// evaluateWritingResponse，成功后把 score / band / feedback 一起补回**同一条记录**——
// 记录页随历史事件刷新后，这条记录就变成带批改报告的写作记录（与正常评分的那份完全同一结构）。
//
// evaluateWritingResponse 体量不小（prompt + parse + 校准），动态 import：只有点「重试评分」才加载，
// 不进记录页首屏 bundle。用量口径同 /api/ai：评分成功才记一次，失败不扣。

import { patchSession } from "./sessionStore";

export const RESCORABLE_TYPES = ["email", "discussion"];

/** 这条记录能不能重试评分：写作类 + 没有反馈 + 题与作答原文都还在。 */
export function canRescoreSession(session) {
  if (!session || !RESCORABLE_TYPES.includes(session.type)) return false;
  const d = session.details;
  if (!d || typeof d !== "object" || Array.isArray(d)) return false;
  if (d.feedback) return false;
  return !!(d.promptData && typeof d.promptData === "object" && String(d.userText || "").trim());
}

/**
 * 要补丁的那条，和此刻存储里该位置上的是不是同一条（类型 / 时间 / 作答原文都一致）。
 * 本地存储按数组下标定位，页面上的下标可能已经过期（另一个标签页删了记录、云端刷新重排）；
 * 对不上就宁可不写，也不能把评分写到别人的记录上。
 */
export function isSameSession(a, b) {
  if (!a || !b) return false;
  return a.type === b.type && a.date === b.date && String(a.details?.userText || "") === String(b.details?.userText || "");
}

/** 重新评分后的整条记录（纯函数，便于测试）。 */
export function applyRescore(session, feedback, now = new Date()) {
  const { scoringError: _scoringError, ...details } = session.details || {};
  return {
    ...session,
    score: feedback.score,
    band: feedback.band,
    details: { ...details, feedback, scoringFailed: false, rescoredAt: now.toISOString() },
  };
}

/**
 * 重试评分。成功返回 { feedback, saved }（saved=false 表示评分拿到了但回写没成功，
 * 本次页面仍可展示；刷新后会回到未评分）；失败抛 Error，message 是给用户看的中文。
 */
export async function rescoreWritingEntry(entry) {
  const session = entry?.session;
  if (!canRescoreSession(session)) throw new Error("缺少题目或作答原文，无法重新评分。");
  const d = session.details;
  const { evaluateWritingResponse } = await import("./ai/writingEval");
  const { mapScoringError } = await import("./ai/client");
  let feedback;
  try {
    feedback = await evaluateWritingResponse(session.type, d.promptData, d.userText, d.reportLanguage || "zh");
  } catch (e) {
    throw new Error(mapScoringError(e));
  }
  if (!feedback || !Number.isFinite(Number(feedback.score))) throw new Error("评分结果无效，请重试");
  const saved = await patchSession(entry.sourceIndex, (cur) => (isSameSession(cur, session) ? applyRescore(cur, feedback) : null));
  return { feedback, saved };
}
