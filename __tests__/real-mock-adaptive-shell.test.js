import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// Real reading mock (AdaptiveExamShell, source="real-bank") driven through the
// real component with the cloud client mocked: record-first finishing, error
// cards that never destroy progress, seen-gate classification, the clock hold
// during answer sync, unreached-item stubs and throttled checkpoint writes.

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => "ABC123"),
  getSavedTier: jest.fn(() => "pro"),
}));
// Reading plays no audio; skip the persistent exam-audio element jsdom can't play.
jest.mock("../components/shared/ExamAudioProvider", () => ({
  ExamAudioProvider: ({ children }) => children,
  useExamAudio: () => null,
}));
jest.mock("../lib/sessionStore", () => ({
  saveSess: jest.fn(),
  loadDoneIds: jest.fn(() => []),
  addDoneIds: jest.fn(),
  setCurrentUser: jest.fn(),
}));
jest.mock("../lib/realMockExam/client", () => ({
  RealMockError: jest.requireActual("../lib/realMockExam/client").RealMockError,
  prepareRealMockExam: jest.fn(),
  markRealMockSeen: jest.fn(),
  routeRealMockExam: jest.fn(),
  finishRealMockExam: jest.fn(),
  finishRealMockExamReliably: jest.fn(),
}));

import { AdaptiveExamShell, buildRealMockRecord } from "../components/mockExam/AdaptiveExamShell";
import { saveSess } from "../lib/sessionStore";
import {
  RealMockError, prepareRealMockExam, markRealMockSeen, routeRealMockExam, finishRealMockExamReliably,
} from "../lib/realMockExam/client";
import { RELEASE_ACTIVE_ATTEMPT_CONFIRM } from "../lib/realMockExam/messages";

const KEY = "toefl-adaptive-checkpoint:real-bank:ABC123:2026-full-v1:reading";

function ctw(id, role) {
  const words = Array.from({ length: 10 }, (_, i) => `word${i}`);
  return {
    id, taskType: "ctw", realMockKey: id, realMockRole: role, passage: words.join(" "),
    blanks: words.map((word, position) => ({ position, original_word: word, displayed_fragment: word.slice(0, 2) })),
  };
}
function mcq(id, type, count, role) {
  return {
    id, taskType: type, realMockKey: id, realMockRole: role, text: `Passage ${id}`, passage: `Passage ${id}`,
    questions: Array.from({ length: count }, (_, i) => ({ stem: `Question ${i + 1} ${id}`, options: { A: "One", B: "Two", C: "Three", D: "Four" }, correct_answer: "A" })),
  };
}
function readingPaper({ attemptId = "attempt-1", m1Seconds = 600, m2Seconds = 600 } = {}) {
  return {
    attemptId, userCode: "ABC123", section: "reading", templateVersion: "2026-full-v1", routeThreshold: 0.6,
    timing: { module1Seconds: m1Seconds, module2Seconds: { upper: m2Seconds, lower: m2Seconds } },
    m1Items: [
      ctw("r-sc-ctw", "scored"), mcq("r-sc-rdl2", "rdl", 2, "scored"), mcq("r-sc-rdl3", "rdl", 3, "scored"), mcq("r-sc-ap", "ap", 5, "scored"),
      ctw("r-extra-ctw", "practice-extra"), mcq("r-extra-rdl2", "rdl", 2, "practice-extra"), mcq("r-extra-rdl3", "rdl", 3, "practice-extra"),
    ],
    m2ByPath: {
      upper: [ctw("r-up-ctw", "scored"), mcq("r-up-ap", "ap", 5, "scored")],
      lower: [ctw("r-lo-ctw", "scored"), mcq("r-lo-rdl2", "rdl", 2, "scored"), mcq("r-lo-rdl3", "rdl", 3, "scored")],
    },
  };
}
function seedCheckpoint(paper) {
  localStorage.setItem(KEY, JSON.stringify({
    phase: "module1", m1Items: paper.m1Items, m2Items: null, m1Results: [], m2Results: [],
    currentItemIndex: 0, routePath: null, timeLeft: 500,
    usedIds: paper.m1Items.map((it) => it.id), seenItemIds: [paper.m1Items[0].id],
    paper, source: "real-bank", userCode: "ABC123", templateVersion: paper.templateVersion, savedAt: Date.now(),
  }));
}
const checkpoint = () => JSON.parse(localStorage.getItem(KEY) || "null");
const ok = () => Promise.resolve({ ok: true });
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
async function advance(ms) {
  await act(async () => { jest.advanceTimersByTime(ms); });
  await flush();
}
async function click(el) {
  await act(async () => { fireEvent.click(el); });
  await flush();
}
function renderShell() {
  const onExit = jest.fn();
  render(<AdaptiveExamShell section="reading" source="real-bank" onExit={onExit} />);
  return { onExit };
}
async function startExam() {
  await click(screen.getByRole("button", { name: /开始考试|重新开始/ }));
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  jest.clearAllMocks();
  markRealMockSeen.mockImplementation(ok);
  routeRealMockExam.mockImplementation(ok);
  finishRealMockExamReliably.mockImplementation(() => new Promise(() => {})); // never settles
});
afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("buildRealMockRecord", () => {
  const paper = readingPaper();
  const m1Items = paper.m1Items;
  const m2Items = paper.m2ByPath.lower;
  const answered = (item) => ({ item, correct: 1, total: item.taskType === "ctw" ? 10 : item.questions.length, results: [{ isCorrect: true }] });
  const unreached = (item) => ({ item, correct: 0, total: item.taskType === "ctw" ? 10 : item.questions.length, results: [{ isCorrect: false }], timedOut: true, unanswered: 1 });

  test("items never shown keep only a stub — no passage, questions or answers", () => {
    const record = buildRealMockRecord({
      m1Items, m2Items,
      m1Results: m1Items.map((it, i) => (i === 0 ? answered(it) : unreached(it))),
      m2Results: m2Items.map((it, i) => (i === 0 ? answered(it) : unreached(it))),
      seenItemIds: ["r-sc-ctw", "r-lo-ctw"],
    });
    expect(record.tasks).toHaveLength(10);
    expect(record.tasks.find((t) => t.itemId === "r-sc-ap")).toEqual({
      taskType: "ap", itemId: "r-sc-ap", realMockRole: "scored",
      unreached: true, timedOut: true, correct: 0, total: 5, unanswered: 5, results: [],
    });
    expect(record.tasks.find((t) => t.itemId === "r-extra-ctw")).toMatchObject({ unreached: true, total: 10, unanswered: 10 });
    expect(record.items.find((it) => it.id === "r-lo-rdl3")).toEqual({ id: "r-lo-rdl3", taskType: "rdl", realMockRole: "scored", unreached: true });
    // Shown items keep their full snapshot for the per-question review.
    expect(record.tasks[0]).toMatchObject({ itemId: "r-sc-ctw", passage: m1Items[0].passage, blanks: m1Items[0].blanks, correct: 1 });
    expect(record.items[0]).toBe(m1Items[0]);
    const json = JSON.stringify(record);
    for (const id of ["r-sc-rdl2", "r-sc-rdl3", "r-sc-ap", "r-extra-rdl2", "r-extra-rdl3", "r-lo-rdl2", "r-lo-rdl3"]) {
      expect(json).not.toContain(`Passage ${id}`);
      expect(json).not.toContain(`Question 1 ${id}`);
    }
  });

  test("a fully shown exam keeps every snapshot", () => {
    const record = buildRealMockRecord({
      m1Items, m2Items, m1Results: m1Items.map(answered), m2Results: m2Items.map(answered),
      seenItemIds: [...m1Items, ...m2Items].map((it) => it.id),
    });
    expect(record.tasks.some((t) => t.unreached)).toBe(false);
    expect(record.items).toEqual([...m1Items, ...m2Items]);
  });
});

describe("real reading mock shell", () => {
  test("the intro tells that shown items count as done and how resuming works", () => {
    renderShell();
    expect(screen.getByText(/开考后展示过的题会永久计为已做/)).toBeInTheDocument();
    expect(screen.getByText(/中途离开 2 小时内可在本设备点「继续上次模考」/)).toBeInTheDocument();
  });

  test("a plain start never sends a restart id; 重新开始 over this device's checkpoint sends its own", async () => {
    prepareRealMockExam.mockRejectedValue(new RealMockError("无法连接真题模考服务，请稍后重试。", { code: "NETWORK_ERROR" }));
    renderShell();
    await startExam();
    expect(prepareRealMockExam).toHaveBeenLastCalledWith("reading", undefined);
    cleanup();
    seedCheckpoint(readingPaper({ attemptId: "own-attempt" }));
    renderShell();
    await startExam();
    expect(prepareRealMockExam).toHaveBeenLastCalledWith("reading", { restartAttemptId: "own-attempt" });
  });

  test("ACTIVE_ATTEMPT is never released by a retry, only by the confirmed release button", async () => {
    prepareRealMockExam.mockRejectedValueOnce(new RealMockError("已有正在进行的真题模考，请续考或选择重新开始。", { code: "ACTIVE_ATTEMPT", activeAttemptId: "other-device" }));
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    renderShell();
    await startExam();
    expect(screen.getByText(/你还有一份没做完的同科真题模考/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    const release = screen.getByRole("button", { name: "放弃那份试卷并重新组卷" });
    await click(release);
    expect(confirm).toHaveBeenCalledWith(RELEASE_ACTIVE_ATTEMPT_CONFIRM);
    expect(prepareRealMockExam).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true);
    prepareRealMockExam.mockResolvedValueOnce(readingPaper());
    await click(release);
    expect(prepareRealMockExam).toHaveBeenCalledTimes(2);
    expect(prepareRealMockExam).toHaveBeenLastCalledWith("reading", { restartAttemptId: "other-device" });
    expect(await screen.findByText("Complete the Words")).toBeInTheDocument();
    confirm.mockRestore();
  });

  test("an exhausted bank offers 返回真题专区, and 关闭 keeps the resumable checkpoint", async () => {
    seedCheckpoint(readingPaper({ attemptId: "own-attempt" }));
    prepareRealMockExam.mockRejectedValue(new RealMockError("x", { code: "REAL_MOCK_EXHAUSTED", deficits: [{ taskType: "ap", need: 2, available: 1 }] }));
    const { onExit } = renderShell();
    await startExam();
    expect(screen.getByText(/学术阅读还差 1 篇/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    await click(screen.getByRole("button", { name: "返回真题专区" }));
    expect(onExit).toHaveBeenCalledTimes(1);
    await click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("button", { name: "继续上次模考" })).toBeInTheDocument();
    expect(checkpoint()?.paper?.attemptId).toBe("own-attempt");
  });

  test("a paper finished elsewhere offers 重新组卷 instead of an endless 重试加载", async () => {
    prepareRealMockExam.mockResolvedValueOnce(readingPaper());
    markRealMockSeen.mockRejectedValueOnce(new RealMockError("这份试卷已结束。", { code: "ATTEMPT_FINISHED" }));
    const { onExit } = renderShell();
    await startExam();
    expect(screen.getByText(/这份试卷已结束。本卷无法继续作答/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试加载" })).toBeNull();
    expect(checkpoint()).toBeNull();
    // Nothing deferred (5 s interval, partial save, page hide) may bring it back.
    await advance(6000);
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(checkpoint()).toBeNull();
    await click(screen.getByRole("button", { name: "返回真题专区" }));
    expect(onExit).toHaveBeenCalledTimes(1);
    prepareRealMockExam.mockResolvedValueOnce(readingPaper({ attemptId: "attempt-2" }));
    await click(screen.getByRole("button", { name: "重新组卷" }));
    expect(prepareRealMockExam).toHaveBeenLastCalledWith("reading", undefined);
    expect(await screen.findByText("Complete the Words")).toBeInTheDocument();
  });

  test("a transient seen failure retries or saves and exits; an account failure only exits", async () => {
    prepareRealMockExam.mockResolvedValue(readingPaper());
    markRealMockSeen.mockRejectedValueOnce(new RealMockError("记录暂时失败", { code: "REAL_MOCK_ERROR" }));
    const { onExit } = renderShell();
    await startExam();
    expect(screen.getByText("记录暂时失败")).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "保存进度并退出" }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(checkpoint()?.paper?.attemptId).toBe("attempt-1");
    await click(screen.getByRole("button", { name: "重试加载" }));
    expect(screen.getByText("Complete the Words")).toBeInTheDocument();
    cleanup();
    markRealMockSeen.mockRejectedValueOnce(new RealMockError("真题模考需要 Pro 权限。", { code: "PRO_REQUIRED" }));
    renderShell();
    await click(screen.getByRole("button", { name: "继续上次模考" }));
    expect(screen.getByText("真题模考需要 Pro 权限。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试加载" })).toBeNull();
    expect(screen.getByRole("button", { name: "保存进度并退出" })).toBeInTheDocument();
  });

  test("the clock holds while an answer syncs; a failed sync offers 重试同步 and keeps holding", async () => {
    prepareRealMockExam.mockResolvedValue(readingPaper());
    const answer = deferred();
    markRealMockSeen.mockImplementation((paper, items, opts) => (opts?.answered ? answer.promise : ok()));
    renderShell();
    await startExam();
    await advance(2000);
    expect(screen.getByText("09:58")).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "提交" }));
    await advance(800); // the submit animation, then onComplete starts the answered sync
    const frozen = screen.getByText(/^\d\d:\d\d$/).textContent;
    await advance(5000);
    expect(screen.getByText(frozen)).toBeInTheDocument();
    await act(async () => { answer.reject(new RealMockError("无法连接真题模考服务，请稍后重试。", { code: "NETWORK_ERROR" })); });
    await flush();
    expect(screen.getByText("无法连接真题模考服务，请稍后重试。")).toBeInTheDocument();
    await advance(5000);
    expect(screen.getByText(frozen)).toBeInTheDocument();
    markRealMockSeen.mockImplementation(ok);
    await click(screen.getByRole("button", { name: "重试同步" }));
    expect(await screen.findByText("Question 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("2 / 7")).toBeInTheDocument();
  });

  test("an answered sync on a dead paper drops the checkpoint and offers 重新组卷", async () => {
    prepareRealMockExam.mockResolvedValue(readingPaper());
    markRealMockSeen.mockImplementation((paper, items, opts) => (opts?.answered
      ? Promise.reject(new RealMockError("试卷预留已过期，请重新开始。", { code: "ATTEMPT_EXPIRED" }))
      : ok()));
    renderShell();
    await startExam();
    expect(checkpoint()).not.toBeNull();
    await click(screen.getByRole("button", { name: "提交" }));
    await advance(800);
    expect(screen.getByRole("button", { name: "重新组卷" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试同步" })).toBeNull();
    expect(checkpoint()).toBeNull();
  });

  test("a failed route keeps the exam: 重试 re-routes, 保存进度并退出 keeps the checkpoint", async () => {
    prepareRealMockExam.mockResolvedValue(readingPaper({ m1Seconds: 2 }));
    routeRealMockExam.mockRejectedValueOnce(new RealMockError("真题模考服务暂不可用，请稍后重试。", { code: "REAL_MOCK_ERROR" }));
    const { onExit } = renderShell();
    await startExam();
    await advance(1000);
    await advance(1000); // Module 1 times out → routing
    await advance(2500);
    expect(screen.getByText("进入 Module 2 失败")).toBeInTheDocument();
    // The card's old 「返回」 cleared the checkpoint and every result; only the top bar's 返回 is left.
    expect(screen.getAllByRole("button", { name: "返回" })).toHaveLength(1);
    await click(screen.getByRole("button", { name: "保存进度并退出" }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(checkpoint()?.paper?.attemptId).toBe("attempt-1");
    await click(screen.getByRole("button", { name: "重试" }));
    await advance(2500);
    expect(routeRealMockExam).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("Module 2 · 普通").length).toBeGreaterThan(0);
  });

  test("the record is saved before finish, and a finish that never lands cannot hold the results back", async () => {
    prepareRealMockExam.mockResolvedValue(readingPaper({ m1Seconds: 2, m2Seconds: 2 }));
    renderShell();
    await startExam();
    await advance(1000);
    await advance(1000); // Module 1 times out on the first CTW
    await advance(2500); // routing → lower
    expect(screen.getAllByText("Module 2 · 普通").length).toBeGreaterThan(0);
    await advance(1000);
    await advance(1000); // Module 2 times out on its first CTW
    expect(screen.getByText("真题阅读模考结果")).toBeInTheDocument();

    expect(saveSess).toHaveBeenCalledTimes(1);
    expect(finishRealMockExamReliably).toHaveBeenCalledTimes(1);
    expect(finishRealMockExamReliably).toHaveBeenCalledWith(expect.objectContaining({ attemptId: "attempt-1" }));
    expect(saveSess.mock.invocationCallOrder[0]).toBeLessThan(finishRealMockExamReliably.mock.invocationCallOrder[0]);

    const record = saveSess.mock.calls[0][0];
    const d = record.details;
    expect(record).toMatchObject({ realMock: true, correct: 0, total: 35 });
    expect(d.seenItemIds).toEqual(["r-sc-ctw", "r-lo-ctw"]);
    expect(d.itemIds).toHaveLength(10);
    expect(d.paperSnapshot).toBeUndefined();
    expect(d.m1).toEqual({ correct: 0, total: 20, extraCorrect: 0, extraTotal: 15, accuracy: 0 });
    expect(d.m2.tasks).toBeUndefined();
    expect(d.tasks.filter((t) => t.unreached).map((t) => t.itemId)).toEqual(
      ["r-sc-rdl2", "r-sc-rdl3", "r-sc-ap", "r-extra-ctw", "r-extra-rdl2", "r-extra-rdl3", "r-lo-rdl2", "r-lo-rdl3"],
    );
    const json = JSON.stringify(record);
    expect(json).not.toContain("r-up-");
    expect(json).not.toContain("Passage r-sc-ap");

    // The exam is over: nothing deferred may re-create its checkpoint.
    expect(checkpoint()).toBeNull();
    await advance(6000);
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(checkpoint()).toBeNull();

    expect(screen.getByText("真题练习记录")).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "查看本次逐题解析" }));
    expect(mockPush).toHaveBeenCalledWith(`/real-bank/progress?mock=${encodeURIComponent(record.date)}`);
  });

  test("typing saves the answer at most once per 800 ms; hiding the page saves at once", async () => {
    prepareRealMockExam.mockResolvedValue(readingPaper());
    renderShell();
    await startExam();
    await advance(1000); // let the mount-time partial save settle
    const setItem = jest.spyOn(Storage.prototype, "setItem");
    const writes = () => setItem.mock.calls.filter(([key]) => key === KEY).length;
    const input = document.querySelector("input[maxlength]");
    await act(async () => { fireEvent.change(input, { target: { value: "r" } }); });
    await advance(300);
    await act(async () => { fireEvent.change(input, { target: { value: "rd" } }); });
    await advance(300);
    await act(async () => { fireEvent.change(input, { target: { value: "rd0" } }); });
    expect(writes()).toBe(0);
    await advance(200);
    expect(writes()).toBe(1);
    expect(checkpoint().currentPartial.data.answers[0]).toBe("rd0");
    await act(async () => { fireEvent.change(input, { target: { value: "rd" } }); });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(writes()).toBe(2);
    expect(checkpoint().currentPartial.data.answers[0]).toBe("rd");
    delete document.visibilityState;
    setItem.mockRestore();
  });
});
