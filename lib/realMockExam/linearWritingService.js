import { MOCK_EXAM_STATUS, TASK_IDS } from "../mockExam/contracts";
import { scoreRealWriting } from "./linearScore";

const tasks = [
  { id: TASK_IDS.EMAIL_WRITING, type: "email" },
  { id: TASK_IDS.ACADEMIC_WRITING, type: "discussion" },
];

/** Score only unresolved AI tasks. Failed calls stay null and retain their retry payload. */
export async function finalizeRealWriting(session, evaluateResponse, updateTaskScore) {
  let next = session;
  const errors = [];
  for (const task of tasks) {
    const attempt = next.attempts?.[task.id];
    if (!attempt || Number.isFinite(attempt.score)) continue;
    const payload = attempt.meta?.retryPayload || attempt.meta?.deferredPayload;
    if (!payload?.promptData || typeof payload.userText !== "string") {
      errors.push(`${task.type} 缺少待评分答案`);
      continue;
    }
    if (!payload.userText.trim()) {
      next = updateTaskScore(next, task.id, {
        score: 0, maxScore: 5,
        meta: { ...attempt.meta, deferredPayload: null, retryPayload: null, error: "", unanswered: true,
          response: { userText: "", promptSummary: payload.promptSummary || "" } },
      }, { skipAggregate: true });
      continue;
    }
    try {
      const result = await evaluateResponse(task.type, payload.promptData, payload.userText, payload.reportLanguage || "zh");
      if (!Number.isFinite(result?.score)) throw new Error("评分服务未返回有效分数");
      next = updateTaskScore(next, task.id, {
        score: result.score, maxScore: 5,
        meta: { ...attempt.meta, deferredPayload: null, retryPayload: null, error: "", feedback: result,
          response: { userText: payload.userText, promptSummary: payload.promptSummary || "" } },
      }, { skipAggregate: true });
    } catch (error) {
      const message = error?.message || "AI 评分失败";
      errors.push(`${task.type}: ${message}`);
      next = updateTaskScore(next, task.id, {
        score: null, maxScore: 5,
        meta: { ...attempt.meta, deferredPayload: null, retryPayload: payload, error: message,
          response: { userText: payload.userText, promptSummary: payload.promptSummary || "" } },
      }, { skipAggregate: true });
    }
  }
  const estimate = scoreRealWriting(next.attempts);
  return {
    session: { ...next, aggregate: { ...estimate, scaledScore: null, cefr: null, color: estimate.band == null ? "yellow" : estimate.band >= 4.5 ? "green" : estimate.band >= 3 ? "blue" : "orange" } },
    phase: estimate.band == null ? "error" : "done",
    error: errors.join(" | "),
  };
}

/**
 * 本地检查点要不要留这一场（存档和开页恢复同一把尺子）。答题中、评分未完成（刷新后要接着评）、
 * 评分失败（「重试 AI 评分」只在结果页有，记录页不能给模考重评）都留；评完的、中止的不留——
 * 否则 2 小时内每次打开写作真题模考都会回到旧结果页 / 中止页。
 */
export function shouldKeepRealWritingCheckpoint(session, scoringPhase) {
  if (!session || session.status === MOCK_EXAM_STATUS.ABORTED) return false;
  return !(session.status === MOCK_EXAM_STATUS.COMPLETED && scoringPhase === "done");
}

export function buildRealWritingHistory(session, phase = "done", error = "") {
  const paper = session.realMockPaper;
  // 没展示过的题（造句计时用完没轮到、中止时还没到的任务）会在 finish 时放回题池，
  // 记录里只留占位，不留题面和答案。
  const seen = new Set(session.realMockSeenItemIds || []);
  const visible = (item) => (seen.has(item?.id) ? item : { id: item?.id, taskType: item?.taskType, unreached: true });
  const tasks = (session.blueprint || []).map((task) => {
    const attempt = session.attempts?.[task.taskId] || {};
    const type = task.taskId === TASK_IDS.BUILD_SENTENCE ? "bs" : task.taskId === TASK_IDS.EMAIL_WRITING ? "email" : "discussion";
    const paperItems = type === "bs" ? paper.bsQuestions : [type === "email" ? paper.emailPrompt : paper.discussionPrompt];
    const meta = type === "bs" && Array.isArray(attempt.meta?.details)
      ? { ...attempt.meta, details: attempt.meta.details.map((d) => (seen.has(d?.qid) ? d : { qid: d?.qid, unreached: true, isCorrect: false })) }
      : attempt.meta || null;
    return { taskId: task.taskId, taskType: type, title: task.title, score: Number.isFinite(attempt.score) ? attempt.score : null,
      maxScore: type === "bs" ? 10 : 5, itemIds: paperItems.map((item) => item.id), items: paperItems.map(visible),
      meta };
  });
  const aborted = phase === "aborted";
  // 中止的卷不给成绩：state machine 的 abort 按普通模考口径（ETS 换算）算了一份 aggregate，不能写进真题记录。
  const aggregate = aborted ? { raw: null, maxRaw: 20, percent: null, band: null } : session.aggregate;
  return {
    // date 取交卷时刻：同一场评分重试 / 重写记录时日期不变（记录页按它定位这一场）。
    type: "mock", mode: "mock", date: session.completedAt || new Date().toISOString(), score: aggregate?.raw ?? null,
    scale: 20, band: aggregate?.band ?? null, status: session.status,
    details: { real: true, source: "real-bank", realMock: true, subtype: "mock", section: "writing",
      attemptId: paper.attemptId, templateVersion: paper.templateVersion, mockSessionId: session.id,
      itemIds: paper.items.map((item) => item.id), items: paper.items.map(visible),
      seenItemIds: session.realMockSeenItemIds || [],
      tasks, aggregate,
      scoringPhase: phase, scoringError: error,
      ...(aborted ? { aborted: true } : {}) },
  };
}
