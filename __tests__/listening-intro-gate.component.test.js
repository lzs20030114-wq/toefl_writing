/**
 * 听力标准模式「准备」门回归测试（2026-09-18）。
 *
 * 用户反馈：从首页「今日任务」点「选择回应」直接跳进 /listening?type=lcr，落地时第一题
 * 已经在放（甚至放完了）。根因：标准模式下 LCRTask / ListeningMCQTask 随路由一起挂载，
 * AudioPlayer 的 autoPlay 立刻开播，用户还没看清页面；标准模式每段只播一遍 + 作答限时，
 * 等于白丢一题。练习模式有 TopicPicker 挡着（点题就是手势），标准模式此前没有任何门。
 *
 * 修法：标准模式先停在 ListeningIntroScreen，用户点「开始」（真实手势，顺带 unlock 共享
 * 考试音频元素）后才挂载任务组件。这组测试钉住：
 *  - 标准模式落地 = 准备页，任务组件不挂载（不会 autoPlay）
 *  - 点「开始」→ 先 unlock 再挂载任务；四个 type 都走这道门
 *  - 练习模式不受影响：直接是 TopicPicker
 *  - ExamAudio kill switch（useExamAudio 为 null）下点「开始」不炸
 *
 * mock 手法照搬 __tests__/reading-listening-upgrade.component.test.js。
 */

import { render, screen, fireEvent } from "@testing-library/react";

const searchHolder = { value: "" };
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(searchHolder.value),
}));

// Pro 用户 → 越过锁定屏，进到任务分支
jest.mock("../lib/AuthContext", () => ({
  getSavedTier: () => "pro",
  getSavedCode: () => "LSN001",
}));

jest.mock("../lib/userBank/personalBank", () => ({
  fetchPersonalBank: () => Promise.resolve([]),
  mapPersonalToPicker: () => [],
}));

// 任务组件 mock 成可探测的桩：它们一旦挂载就意味着 autoPlay 已经触发。
jest.mock("../components/listening/LCRTask", () => ({
  LCRTask: () => <div data-testid="lcr-task">LCR</div>,
}));
jest.mock("../components/listening/ListeningMCQTask", () => ({
  ListeningMCQTask: () => <div data-testid="mcq-task">MCQ</div>,
}));
jest.mock("../components/shared/TopicPicker", () => ({
  TopicPicker: () => <div data-testid="topic-picker">PICKER</div>,
}));

// 可配置的考试音频上下文：null = kill switch；对象 = controller 模式
const examAudioHolder = { value: null };
jest.mock("../components/shared/ExamAudioProvider", () => ({
  __esModule: true,
  ExamAudioProvider: ({ children }) => <>{children}</>,
  useExamAudio: () => examAudioHolder.value,
}));

import ListeningPage from "../app/listening/page";

function makeController() {
  return {
    unlock: jest.fn(() => true),
    play: jest.fn(),
    preload: jest.fn(),
    retry: jest.fn(),
    stop: jest.fn(),
    subscribe: jest.fn(() => () => {}),
    getState: jest.fn(() => "idle"),
    getCurrentSrc: jest.fn(() => null),
    isUnlocked: jest.fn(() => false),
  };
}

beforeEach(() => {
  searchHolder.value = "";
  examAudioHolder.value = null;
  localStorage.clear();
});

describe("听力标准模式：进入先停在准备页，点「开始」才挂任务（才会 autoPlay）", () => {
  test("lcr 标准模式（今日任务的链接形状 /listening?type=lcr）：落地是准备页，不挂 LCRTask", async () => {
    searchHolder.value = "type=lcr";
    render(<ListeningPage />);

    const start = await screen.findByRole("button", { name: "开始" });
    expect(start).toBeTruthy();
    expect(screen.queryByTestId("lcr-task")).toBeNull();
    expect(screen.queryByTestId("topic-picker")).toBeNull();
    // 说明文字点明「只播一遍 / 点开始才播」，用户知道为什么要多点一下
    expect(screen.getByText(/第一题会立刻自动播放/)).toBeTruthy();
  });

  test("点「开始」→ 先在手势里 unlock 共享音频元素，再挂载 LCRTask", async () => {
    searchHolder.value = "type=lcr&mode=standard";
    const controller = makeController();
    examAudioHolder.value = { controller, holdTimers: false };
    render(<ListeningPage />);

    fireEvent.click(await screen.findByRole("button", { name: "开始" }));

    expect(controller.unlock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("lcr-task")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "开始" })).toBeNull();
  });

  test.each(["la", "lc", "lat"])("%s 标准模式同样过门：准备页 → 开始 → ListeningMCQTask", async (type) => {
    searchHolder.value = `type=${type}`;
    const controller = makeController();
    examAudioHolder.value = { controller, holdTimers: false };
    render(<ListeningPage />);

    expect(await screen.findByRole("button", { name: "开始" })).toBeTruthy();
    expect(screen.queryByTestId("mcq-task")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "开始" }));

    expect(controller.unlock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("mcq-task")).toBeTruthy();
  });

  test("kill switch（useExamAudio 为 null）：点「开始」不报错，任务照常挂载", async () => {
    searchHolder.value = "type=lc";
    examAudioHolder.value = null;
    render(<ListeningPage />);

    fireEvent.click(await screen.findByRole("button", { name: "开始" }));

    expect(screen.getByTestId("mcq-task")).toBeTruthy();
  });

  test("练习模式不受影响：直接是 TopicPicker，没有准备页", async () => {
    searchHolder.value = "type=lcr&mode=practice";
    render(<ListeningPage />);

    expect(await screen.findByTestId("topic-picker")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "开始" })).toBeNull();
    expect(screen.queryByTestId("lcr-task")).toBeNull();
  });
});
