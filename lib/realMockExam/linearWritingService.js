import { TASK_IDS } from "../mockExam/contracts";
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

export function buildRealWritingHistory(session, phase = "done", error = "") {
  const paper = session.realMockPaper;
  const tasks = (session.blueprint || []).map((task) => {
    const attempt = session.attempts?.[task.taskId] || {};
    const type = task.taskId === TASK_IDS.BUILD_SENTENCE ? "bs" : task.taskId === TASK_IDS.EMAIL_WRITING ? "email" : "discussion";
    const paperItems = type === "bs" ? paper.bsQuestions : [type === "email" ? paper.emailPrompt : paper.discussionPrompt];
    return { taskId: task.taskId, taskType: type, title: task.title, score: Number.isFinite(attempt.score) ? attempt.score : null,
      maxScore: type === "bs" ? 10 : 5, itemIds: paperItems.map((item) => item.id), items: paperItems,
      meta: attempt.meta || null };
  });
  return {
    type: "mock", mode: "mock", date: new Date().toISOString(), score: session.aggregate?.raw ?? null,
    scale: 20, band: session.aggregate?.band ?? null, status: session.status,
    details: { real: true, source: "real-bank", realMock: true, subtype: "mock", section: "writing",
      attemptId: paper.attemptId, templateVersion: paper.templateVersion, mockSessionId: session.id,
      itemIds: paper.items.map((item) => item.id), items: paper.items,
      seenItemIds: session.realMockSeenItemIds || [],
      paperSnapshot: paper, tasks, aggregate: session.aggregate,
      scoringPhase: phase, scoringError: error },
  };
}
