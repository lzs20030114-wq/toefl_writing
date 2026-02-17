import { getDefaultMockExamBlueprint } from "./planner";
import {
  abortMockExam,
  createMockExamState,
  getCurrentTask,
  moveToNextTask,
  recomputeAggregate,
  startMockExam,
  submitCurrentTask,
  updateTaskScore,
} from "./stateMachine";

export function createExamSession(blueprint = getDefaultMockExamBlueprint(), now) {
  return createMockExamState(blueprint, now);
}

export function startNewExam(blueprint = getDefaultMockExamBlueprint(), now) {
  const idle = createMockExamState(blueprint, now);
  return startMockExam(idle, now);
}

export function submitAndAdvance(session, payload, now) {
  const submitted = submitCurrentTask(session, payload, now);
  if (!submitted || submitted === session) return session;
  return moveToNextTask(submitted, now);
}

export function getExamProgress(session) {
  if (!session) return { done: 0, total: 0, percent: 0 };
  const total = session.blueprint.length;
  const done = Object.values(session.attempts).filter((a) => a.status === "submitted").length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return { done, total, percent };
}

export const mockExamRunner = {
  createExamSession,
  startNewExam,
  getCurrentTask,
  submitAndAdvance,
  updateTaskScore,
  recomputeAggregate,
  abort: abortMockExam,
  getExamProgress,
};
