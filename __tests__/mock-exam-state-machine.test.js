import { getDefaultMockExamBlueprint } from "../lib/mockExam/planner";
import {
  createMockExamState,
  getCurrentTask,
  moveToNextTask,
  startMockExam,
  submitCurrentTask,
  updateTaskScore,
} from "../lib/mockExam/stateMachine";
import { MOCK_EXAM_STATUS } from "../lib/mockExam/contracts";

describe("mock exam state machine", () => {
  test("starts from idle and opens the first task", () => {
    const blueprint = getDefaultMockExamBlueprint();
    const idle = createMockExamState(blueprint, "2026-02-16T00:00:00.000Z");
    expect(idle.status).toBe("idle");
    expect(idle.currentTaskIndex).toBe(-1);

    const running = startMockExam(idle, "2026-02-16T00:00:10.000Z");
    expect(running.status).toBe("running");
    expect(running.currentTaskIndex).toBe(0);
    expect(getCurrentTask(running).taskId).toBe("build-sentence");
    expect(running.attempts["build-sentence"].status).toBe("started");
  });

  test("submit + next moves through all tasks and completes exam", () => {
    const blueprint = getDefaultMockExamBlueprint();
    let session = startMockExam(createMockExamState(blueprint));

    session = submitCurrentTask(session, { score: 8, maxScore: 10 });
    session = moveToNextTask(session);
    expect(session.currentTaskIndex).toBe(1);
    expect(getCurrentTask(session).taskId).toBe("email-writing");

    session = submitCurrentTask(session, { score: 4, maxScore: 5 });
    session = moveToNextTask(session);
    expect(session.currentTaskIndex).toBe(2);
    expect(getCurrentTask(session).taskId).toBe("academic-writing");

    session = submitCurrentTask(session, { score: 4, maxScore: 5 });
    session = moveToNextTask(session);
    expect(session.status).toBe(MOCK_EXAM_STATUS.COMPLETED);
    expect(session.aggregate).toBeTruthy();
    expect(session.aggregate.completedTasks).toBe(3);
    expect(session.aggregate.totalTasks).toBe(3);
  });

  test("cannot advance before submit", () => {
    const blueprint = getDefaultMockExamBlueprint();
    const running = startMockExam(createMockExamState(blueprint));
    const unchanged = moveToNextTask(running);
    expect(unchanged.currentTaskIndex).toBe(0);
    expect(getCurrentTask(unchanged).taskId).toBe("build-sentence");
  });

  test("updateTaskScore keeps existing score when only metadata is updated", () => {
    const blueprint = getDefaultMockExamBlueprint();
    let session = startMockExam(createMockExamState(blueprint));
    session = submitCurrentTask(session, { score: 8, maxScore: 10 });
    session = moveToNextTask(session);

    const next = updateTaskScore(session, "build-sentence", { meta: { reviewed: true } });
    expect(next.attempts["build-sentence"].score).toBe(8);
    expect(next.attempts["build-sentence"].meta?.reviewed).toBe(true);
  });
});
