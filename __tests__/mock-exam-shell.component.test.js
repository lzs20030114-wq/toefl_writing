import React from "react";
import { act, render, screen } from "@testing-library/react";
import { MockExamShell } from "../components/mockExam/MockExamShell";
import { loadMockCheckpoint, saveMockCheckpoint } from "../lib/mockExam/storage";
import { evaluateWritingResponse } from "../lib/ai/writingEval";
import { upsertMockSess } from "../lib/sessionStore";

jest.mock("../lib/ai/writingEval", () => ({ evaluateWritingResponse: jest.fn() }));
jest.mock("../lib/sessionStore", () => ({ ...jest.requireActual("../lib/sessionStore"), upsertMockSess: jest.fn() }));

describe("MockExamShell", () => {
  test("renders start view", () => {
    render(<MockExamShell onExit={() => {}} />);
    expect(screen.getByText("整套模考")).toBeInTheDocument();
    expect(screen.getByText("开始模考")).toBeInTheDocument();
  });

  test("shows start card with exam button", () => {
    render(<MockExamShell onExit={() => {}} />);
    // Start card should display the exam button (clicking may trigger cost/usage modal)
    const btn = screen.getByText("开始模考");
    expect(btn).toBeInTheDocument();
    expect(btn.tagName === "BUTTON" || btn.closest("button")).toBeTruthy();
  });
});

// Deferred AI scoring of tasks 2/3 resolves 30–90 s after the exam ends. 「开始新模考」 must
// not be offered meanwhile, and a result that lands after the exam left the page must not
// take over the page or the (shared, unscoped) checkpoint of a newer exam.
describe("MockExamShell deferred scoring (standard mock)", () => {
  const blueprint = [
    { taskId: "build-sentence", title: "Task 1 - Build a Sentence", seconds: 410, weight: 0.34 },
    { taskId: "email-writing", title: "Task 2 - Write an Email", seconds: 420, weight: 0.33 },
    { taskId: "academic-writing", title: "Task 3 - Academic Discussion", seconds: 600, weight: 0.33 },
  ];
  const essay = (id, userText) => ({ promptData: { id }, userText, promptSummary: "", reportLanguage: "zh" });
  const completed = (id) => ({
    id, status: "completed", mode: "standard", blueprint, currentTaskIndex: 2,
    createdAt: "2026-10-04T07:30:00.000Z", startedAt: "2026-10-04T07:31:00.000Z", completedAt: "2026-10-04T08:00:00.000Z",
    aggregate: { band: 2, scaledScore: 8, percent: 23 },
    attempts: {
      "build-sentence": { taskId: "build-sentence", status: "submitted", score: 7, maxScore: 10, meta: { type: "bs", details: [] } },
      "email-writing": { taskId: "email-writing", status: "submitted", score: null, maxScore: 5, meta: { type: "email", deferredPayload: essay("email_1", "Dear Jessica") } },
      "academic-writing": { taskId: "academic-writing", status: "submitted", score: null, maxScore: 5, meta: { type: "discussion", deferredPayload: essay("disc_1", "I agree.") } },
    },
  });
  let calls;

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    calls = [];
    evaluateWritingResponse.mockImplementation(() => {
      let resolve;
      const promise = new Promise((res) => { resolve = res; });
      calls.push({ resolve });
      return promise;
    });
  });

  async function settle(score) {
    await act(async () => { calls.at(-1).resolve({ score, band: score }); });
    await act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });
  }

  test("hides 「开始新模考」 while scoring runs", async () => {
    saveMockCheckpoint(completed("mock-old"), "pending");
    render(<MockExamShell onExit={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("正在生成成绩…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始新模考" })).not.toBeInTheDocument();
    await settle(4);
    await settle(3);
    expect(screen.getByRole("button", { name: "开始新模考" })).toBeInTheDocument();
    expect(upsertMockSess).toHaveBeenCalledWith(expect.objectContaining({ type: "mock", details: expect.objectContaining({ mockSessionId: "mock-old", scoringPhase: "done" }) }), "mock-old");
  });

  test("a result that lands after the page unmounted saves its record but leaves a newer exam's checkpoint", async () => {
    saveMockCheckpoint(completed("mock-old"), "pending");
    const view = render(<MockExamShell onExit={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    view.unmount();
    saveMockCheckpoint({ ...completed("mock-new"), status: "running", currentTaskIndex: 0 }, "idle");

    await settle(4);
    await settle(3);

    expect(upsertMockSess).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ mockSessionId: "mock-old", scoringPhase: "done" }) }), "mock-old");
    expect(loadMockCheckpoint()?.session?.id).toBe("mock-new");
  });
});
