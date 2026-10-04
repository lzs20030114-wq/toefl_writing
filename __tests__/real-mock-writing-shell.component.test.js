import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MockExamShell } from "../components/mockExam/MockExamShell";
import { loadMockCheckpoint, saveMockCheckpoint } from "../lib/mockExam/storage";
import { RELEASE_ACTIVE_ATTEMPT_CONFIRM } from "../lib/realMockExam/messages";
import { finishRealMockExamReliably, markRealMockSeen, prepareRealMockExam } from "../lib/realMockExam/client";
import { evaluateWritingResponse } from "../lib/ai/writingEval";
import { upsertMockSess } from "../lib/sessionStore";

jest.mock("../lib/realMockExam/client", () => ({
  ...jest.requireActual("../lib/realMockExam/client"),
  prepareRealMockExam: jest.fn(),
  markRealMockSeen: jest.fn(),
  finishRealMockExamReliably: jest.fn(),
}));
jest.mock("../lib/ai/writingEval", () => ({ evaluateWritingResponse: jest.fn() }));
jest.mock("../lib/sessionStore", () => ({ ...jest.requireActual("../lib/sessionStore"), upsertMockSess: jest.fn() }));

const { RealMockError } = jest.requireActual("../lib/realMockExam/client");
const SCOPE = { source: "real-bank", section: "writing", userCode: "ABC123", templateVersion: "2026-full-v1" };
const COMPLETED_AT = "2026-10-04T08:00:00.000Z";

function writingPaper(attemptId) {
  const bsQuestions = Array.from({ length: 10 }, (_, i) => ({
    id: `real_mock_bs_${i + 1}`, taskType: "bs", prompt: `I can read book ${i + 1}.`, answer: `I can read book ${i + 1}.`,
    chunks: ["I", "can", "read", "book", String(i + 1)], prefilled: [], prefilled_positions: {}, distractor: null,
  }));
  const emailPrompt = { id: "real_mock_email_1", taskType: "email", to: "Jessica", subject: "Class notes", direction: "Write an email to Jessica.", scenario: "You missed class.", goals: ["Explain why you missed class.", "Ask for notes.", "Offer help in return."] };
  const discussionPrompt = { id: "real_mock_discussion_1", taskType: "discussion", course: "communications", professor: { name: "Dr. Gupta", text: "Should students work together?" }, students: [{ name: "Amy", text: "Yes." }, { name: "Ben", text: "No." }] };
  return {
    attemptId, userCode: "ABC123", section: "writing", source: "real-bank", templateVersion: "2026-full-v1",
    timing: { taskSeconds: { bs: 360, email: 420, discussion: 600 } },
    bsQuestions, emailPrompt, discussionPrompt, items: [...bsQuestions, emailPrompt, discussionPrompt],
  };
}

const blueprint = [
  { taskId: "build-sentence", title: "Task 1 - Build a Sentence", seconds: 360, weight: 0.34 },
  { taskId: "email-writing", title: "Task 2 - Write an Email", seconds: 420, weight: 0.33 },
  { taskId: "academic-writing", title: "Task 3 - Academic Discussion", seconds: 600, weight: 0.33 },
];

const essay = (promptData, userText) => ({ promptData, userText, promptSummary: "", reportLanguage: "zh" });

function baseSession(paper, overrides) {
  return {
    id: "mock-old", createdAt: "2026-10-04T07:30:00.000Z", startedAt: "2026-10-04T07:31:00.000Z", completedAt: null,
    mode: "standard", blueprint, currentTaskIndex: 0, aggregate: null,
    realMockPaper: paper, realMockSeenItemIds: [], source: "real-bank", userCode: "ABC123", templateVersion: "2026-full-v1",
    ...overrides,
  };
}

/** A finished paper whose essays still wait for AI scoring. */
function unscoredSession(paper = writingPaper("attempt-old")) {
  return baseSession(paper, {
    status: "completed", completedAt: COMPLETED_AT, currentTaskIndex: 2,
    realMockSeenItemIds: paper.items.map((item) => item.id),
    aggregate: { band: 2, scaledScore: 8, percent: 23 },
    attempts: {
      "build-sentence": { taskId: "build-sentence", status: "submitted", score: 7, maxScore: 10, meta: { type: "bs", details: [] } },
      "email-writing": { taskId: "email-writing", status: "submitted", score: null, maxScore: 5, meta: { type: "email", deferred: true, deferredPayload: essay(paper.emailPrompt, "Dear Jessica, please send notes.") } },
      "academic-writing": { taskId: "academic-writing", status: "submitted", score: null, maxScore: 5, meta: { type: "discussion", deferred: true, deferredPayload: essay(paper.discussionPrompt, "I agree with Amy.") } },
    },
  });
}

/** A finished paper whose discussion scoring failed (「重试 AI 评分」 available). */
function failedScoringSession(paper = writingPaper("attempt-old")) {
  const session = unscoredSession(paper);
  return {
    ...session,
    aggregate: { raw: null, maxRaw: 20, percent: null, band: null, scaledScore: null, cefr: null, color: "yellow" },
    attempts: {
      ...session.attempts,
      "email-writing": { ...session.attempts["email-writing"], score: 4, meta: { type: "email", deferredPayload: null, retryPayload: null, error: "", feedback: { score: 4 }, response: { userText: "Dear Jessica, please send notes.", promptSummary: "" } } },
      "academic-writing": { ...session.attempts["academic-writing"], meta: { type: "discussion", deferredPayload: null, retryPayload: essay(paper.discussionPrompt, "I agree with Amy."), error: "AI timeout", response: { userText: "I agree with Amy.", promptSummary: "" } } },
    },
  };
}

function runningSession(paper, { taskIndex = 0, deadline = null } = {}) {
  const task = blueprint[taskIndex].taskId;
  const attempts = Object.fromEntries(blueprint.map((t, i) => [t.taskId, {
    taskId: t.taskId, status: i < taskIndex ? "submitted" : i === taskIndex ? "started" : "pending",
    score: i < taskIndex ? 7 : null, maxScore: i === 0 ? 10 : 5, meta: i < taskIndex ? { type: "bs", details: [] } : null,
  }]));
  return baseSession(paper, {
    id: "mock-run", status: "running", currentTaskIndex: taskIndex, attempts,
    realMockSeenItemIds: taskIndex > 0 ? paper.bsQuestions.map((q) => q.id) : [],
    realMockTaskDeadlines: deadline ? { [task]: deadline } : {},
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function flush() {
  await act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });
}

const renderShell = () => render(<MockExamShell onExit={() => {}} mode="standard" realMock />);
const checkpointId = () => loadMockCheckpoint(SCOPE)?.session?.id || null;
const startNewButton = () => screen.queryByRole("button", { name: "开始新模考" });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("toefl-user-code", "ABC123");
  localStorage.setItem("toefl-user-tier", "pro");
  jest.clearAllMocks();
  markRealMockSeen.mockResolvedValue({ ok: true });
  finishRealMockExamReliably.mockResolvedValue(true);
  window.confirm = jest.fn(() => true);
});

describe("checkpoint: only an unfinished paper comes back", () => {
  test("a scored paper does not reopen on the next visit", () => {
    saveMockCheckpoint({ ...failedScoringSession(), aggregate: { raw: 14, maxRaw: 20, band: 4.5 } }, "done", SCOPE);
    renderShell();
    expect(screen.getByRole("button", { name: "开始模考" })).toBeInTheDocument();
    expect(screen.queryByText("写作真题模考结果 · 本站估分")).not.toBeInTheDocument();
  });

  test("an aborted paper does not reopen on the next visit", () => {
    saveMockCheckpoint({ ...runningSession(writingPaper("attempt-old")), status: "aborted" }, "idle", SCOPE);
    renderShell();
    expect(screen.getByRole("button", { name: "开始模考" })).toBeInTheDocument();
    expect(screen.queryByText("模考已中止")).not.toBeInTheDocument();
  });

  test("a paper whose scoring failed reopens with 「重试 AI 评分」 (the record page cannot rescore it)", () => {
    saveMockCheckpoint(failedScoringSession(), "error", SCOPE);
    renderShell();
    expect(screen.getByText("写作真题模考结果 · 本站估分")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试 AI 评分" })).toBeInTheDocument();
  });

  test("the real start card shows the real timing and the seen-items rule, not the generic record count", () => {
    renderShell();
    expect(screen.getByText(/限时：共 23 min/)).toBeInTheDocument();
    expect(screen.getByText("开考后展示过的题会永久计为已做，不会再出现在之后的真题模考里；中途离开 2 小时内可在本设备继续（计时不停）。")).toBeInTheDocument();
    expect(screen.queryByText(/已保存模考记录/)).not.toBeInTheDocument();
    expect(screen.queryByText(/标准模式/)).not.toBeInTheDocument();
  });
});

describe("deferred AI scoring", () => {
  test("hides 「开始新模考」 while scoring runs; a scored paper's checkpoint is cleared and stays cleared", async () => {
    const calls = [];
    evaluateWritingResponse.mockImplementation(() => { const d = deferred(); calls.push(d); return d.promise; });
    // A reload mid-scoring stored "pending": scoring resumes on mount.
    saveMockCheckpoint(unscoredSession(), "pending", SCOPE);
    renderShell();
    await flush();

    expect(screen.getByText("正在生成成绩…")).toBeInTheDocument();
    expect(startNewButton()).not.toBeInTheDocument();
    expect(screen.queryByTestId("real-mock-record-link")).not.toBeInTheDocument();

    await act(async () => { calls[0].resolve({ score: 4 }); });
    await flush();
    await act(async () => { calls[1].resolve({ score: 3 }); });
    await flush();

    expect(startNewButton()).toBeInTheDocument();
    expect(screen.getByText(/原始分：/)).toHaveTextContent("14");
    expect(screen.getByTestId("real-mock-record-link")).toHaveAttribute("href", `/real-bank/progress?mock=${encodeURIComponent(COMPLETED_AT)}`);
    expect(screen.queryByText(/首页/)).not.toBeInTheDocument();
    // Cleared by the final save, and the auto-checkpoint effect does not write it back.
    expect(loadMockCheckpoint(SCOPE)).toBeNull();
    const record = upsertMockSess.mock.calls.at(-1)[0];
    expect(record).toMatchObject({ date: COMPLETED_AT, score: 14, details: { mockSessionId: "mock-old", scoringPhase: "done" } });
    expect(finishRealMockExamReliably).toHaveBeenCalledWith(expect.objectContaining({ attemptId: "attempt-old" }));
  });

  test("a retry that resolves after 「开始新模考」 saves only the old record and leaves the new exam alone", async () => {
    const prepare = deferred();
    prepareRealMockExam.mockReturnValue(prepare.promise);
    const retry = deferred();
    evaluateWritingResponse.mockReturnValue(retry.promise);
    saveMockCheckpoint(failedScoringSession(), "error", SCOPE);
    renderShell();

    fireEvent.click(startNewButton());
    expect(prepareRealMockExam).toHaveBeenCalledWith("writing", { restartAttemptId: "attempt-old" });
    fireEvent.click(screen.getByRole("button", { name: "重试 AI 评分" }));
    await flush();
    expect(evaluateWritingResponse).toHaveBeenCalledTimes(1);

    await act(async () => { prepare.resolve(writingPaper("attempt-new")); });
    await flush();
    expect(screen.getByTestId("mock-transition-skip")).toBeInTheDocument();
    const newId = checkpointId();
    expect(newId).not.toBe("mock-old");

    await act(async () => { retry.resolve({ score: 3 }); });
    await flush();

    // The old exam's record is saved (and its paper finished)…
    const oldRecord = upsertMockSess.mock.calls.map(([record]) => record).find((record) => record.details.mockSessionId === "mock-old");
    expect(oldRecord).toMatchObject({ date: COMPLETED_AT, details: { scoringPhase: "done", attemptId: "attempt-old" } });
    expect(finishRealMockExamReliably).toHaveBeenCalledWith(expect.objectContaining({ attemptId: "attempt-old" }));
    // …but the page and the shared checkpoint stay with the new exam.
    expect(screen.getByTestId("mock-transition-skip")).toBeInTheDocument();
    expect(screen.queryByText("写作真题模考结果 · 本站估分")).not.toBeInTheDocument();
    expect(checkpointId()).toBe(newId);
  });

  test("scoring that resolves after the page unmounted does not touch a newer exam's checkpoint", async () => {
    const calls = [];
    evaluateWritingResponse.mockImplementation(() => { const d = deferred(); calls.push(d); return d.promise; });
    saveMockCheckpoint(unscoredSession(), "pending", SCOPE);
    const view = renderShell();
    await flush();
    view.unmount();
    // Meanwhile a new exam was started on a fresh mount of the page.
    saveMockCheckpoint(runningSession(writingPaper("attempt-new")), "idle", SCOPE);

    await act(async () => { calls[0].resolve({ score: 4 }); });
    await flush();
    await act(async () => { calls[1].resolve({ score: 3 }); });
    await flush();

    expect(upsertMockSess).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ mockSessionId: "mock-old", scoringPhase: "done" }) }), "mock-old");
    expect(checkpointId()).toBe("mock-run");
  });
});

describe("starting a new paper from the result page", () => {
  test("an exhausted bank is explained on the result page, without a retry or release button", async () => {
    prepareRealMockExam.mockRejectedValue(new RealMockError("未做真题数量不足", { code: "REAL_MOCK_EXHAUSTED", deficits: [{ taskType: "bs", need: 10, available: 4 }] }));
    saveMockCheckpoint(failedScoringSession(), "error", SCOPE);
    renderShell();
    fireEvent.click(startNewButton());
    await flush();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("你没做过的真题已经凑不齐一套完整试卷");
    expect(alert).toHaveTextContent("造句还差 6 题");
    expect(screen.queryByRole("button", { name: "释放上次未完成试卷，重新组卷" })).not.toBeInTheDocument();
    expect(screen.getByText("写作真题模考结果 · 本站估分")).toBeInTheDocument();
  });

  test("another unfinished paper can be released only after confirming", async () => {
    prepareRealMockExam.mockRejectedValueOnce(new RealMockError("另有正在进行的真题模考", { code: "ACTIVE_ATTEMPT", activeAttemptId: "attempt-other" }));
    saveMockCheckpoint(failedScoringSession(), "error", SCOPE);
    renderShell();
    fireEvent.click(startNewButton());
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("你还有一份没做完的同科真题模考");

    window.confirm = jest.fn(() => false);
    fireEvent.click(screen.getByRole("button", { name: "释放上次未完成试卷，重新组卷" }));
    expect(window.confirm).toHaveBeenCalledWith(RELEASE_ACTIVE_ATTEMPT_CONFIRM);
    expect(prepareRealMockExam).toHaveBeenCalledTimes(1);

    window.confirm = jest.fn(() => true);
    prepareRealMockExam.mockResolvedValueOnce(writingPaper("attempt-new"));
    fireEvent.click(screen.getByRole("button", { name: "释放上次未完成试卷，重新组卷" }));
    await flush();
    expect(prepareRealMockExam).toHaveBeenLastCalledWith("writing", { restartAttemptId: "attempt-other" });
    expect(screen.getByTestId("mock-transition-skip")).toBeInTheDocument();
  });

  test("clicks while a paper is being prepared are ignored", async () => {
    const prepare = deferred();
    prepareRealMockExam.mockReturnValue(prepare.promise);
    saveMockCheckpoint(failedScoringSession(), "error", SCOPE);
    renderShell();
    fireEvent.click(startNewButton());
    expect(screen.getByText("正在检查完整真题题量与未做记录…")).toBeInTheDocument();
    fireEvent.click(startNewButton());
    fireEvent.click(startNewButton());
    expect(prepareRealMockExam).toHaveBeenCalledTimes(1);
    await act(async () => { prepare.resolve(writingPaper("attempt-new")); });
    await flush();
  });
});

describe("abort", () => {
  test("asks first, then saves an aborted record and finishes the paper", async () => {
    const paper = writingPaper("attempt-old");
    saveMockCheckpoint(runningSession(paper, { deadline: Date.now() + 300_000 }), "idle", SCOPE);
    renderShell();
    await flush();
    expect(await screen.findByText("I can read book 1.")).toBeInTheDocument();

    window.confirm = jest.fn(() => false);
    fireEvent.click(screen.getByRole("button", { name: "中止" }));
    expect(window.confirm).toHaveBeenCalledWith("中止后本卷作废：已经展示过的题仍计为已做，不会给出成绩。确定中止吗？");
    expect(upsertMockSess).not.toHaveBeenCalled();
    expect(screen.queryByText("模考已中止")).not.toBeInTheDocument();

    window.confirm = jest.fn(() => true);
    fireEvent.click(screen.getByRole("button", { name: "中止" }));
    await flush();
    expect(screen.getByText("模考已中止")).toBeInTheDocument();
    const [record, mockSessionId] = upsertMockSess.mock.calls.at(-1);
    expect(mockSessionId).toBe("mock-run");
    expect(record).toMatchObject({ status: "aborted", score: null, band: null, details: { aborted: true, scoringPhase: "aborted", realMock: true } });
    expect(record.details.seenItemIds).toEqual(["real_mock_bs_1"]);
    expect(finishRealMockExamReliably).toHaveBeenCalledWith(expect.objectContaining({ attemptId: "attempt-old" }));
    expect(loadMockCheckpoint(SCOPE)).toBeNull();
  });
});

describe("task transition card", () => {
  test("a reload mid-task goes straight back to it (its deadline is already running)", async () => {
    const paper = writingPaper("attempt-old");
    saveMockCheckpoint(runningSession(paper, { taskIndex: 1, deadline: Date.now() + 200_000 }), "idle", SCOPE);
    renderShell();
    await flush();
    expect(await screen.findByText("Write an email to Jessica.")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-transition-skip")).not.toBeInTheDocument();
  });

  test("first entry into a task still shows the transition card", async () => {
    const paper = writingPaper("attempt-old");
    saveMockCheckpoint(runningSession(paper, { taskIndex: 1 }), "idle", SCOPE);
    renderShell();
    await flush();
    const card = await screen.findByTestId("mock-transition-skip");
    expect(within(card.parentElement.parentElement).getByText("7 min")).toBeInTheDocument();
  });
});
