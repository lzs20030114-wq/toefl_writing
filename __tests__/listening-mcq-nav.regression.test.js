/**
 * 听力选择题（LA / LC / LAT = 通知 / 对话 / 讲座）答题页的导航与收尾。
 *
 * 用户实测反馈（2026-09-14）：「讲座题做完点『完成』跳转不回去」「每一题都要点左下角的下一题」。
 * 这里锁四件事，全部挂真组件跑（不复刻 DOM）：
 *   ① 交卷那一刻就回调 onComplete（落库），不押在结果页按钮上 —— 点「退出」也不会丢记录；
 *   ② 结果页的「完成并返回」真的调 onExit（旧版它只调 onComplete，而调用方只存不跳 → 点了没反应）；
 *   ③ 主按钮（下一题/提交）在导航行右侧，左边是上一题；底部题号在计时模式下也能点着跳题；
 *   ④ 一次超时只前进一题（旧版两条 effect 在同一次 commit 里拿着 answerTimeLeft=0 连跳两题）。
 */
import { render, screen, fireEvent, act } from "@testing-library/react";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => null),
  getSavedTier: jest.fn(() => "pro"),
}));

// AudioPlayer 会碰 <audio> / TTS，jsdom 里不需要真播。
jest.mock("../components/listening/AudioPlayer", () => ({
  AudioPlayer: () => null,
  default: () => null,
}));

import { ListeningMCQTask } from "../components/listening/ListeningMCQTask";

const QUESTIONS = [
  { stem: "Q-ONE what does the professor emphasize?", options: { A: "one-A", B: "one-B" }, answer: "A" },
  { stem: "Q-TWO why are tree rings mentioned?", options: { A: "two-A", B: "two-B" }, answer: "B" },
  { stem: "Q-THREE what will the class do next?", options: { A: "three-A", B: "three-B" }, answer: "A" },
];

function makeItem(id) {
  return { id, transcript: "Coral skeletons grow in annual bands.", questions: QUESTIONS };
}

function startAnswering() {
  fireEvent.click(screen.getByRole("button", { name: /ready to answer|开始答题/i }));
}

beforeEach(() => {
  localStorage.clear();
});

describe("结果页：交卷即落库，「完成并返回」真的跳走", () => {
  test("练习模式：onComplete 在提交时就触发；完成并返回 → onExit", () => {
    const onComplete = jest.fn();
    const onExit = jest.fn();
    render(
      <ListeningMCQTask
        item={makeItem("lat-nav-1")}
        taskType="lat"
        onComplete={onComplete}
        onExit={onExit}
        isPractice
        title="Academic Talk"
      />
    );
    startAnswering();

    fireEvent.click(screen.getByText("one-A"));
    fireEvent.click(screen.getByRole("button", { name: "下一题" }));
    fireEvent.click(screen.getByText("two-B"));
    fireEvent.click(screen.getByRole("button", { name: "下一题" }));
    fireEvent.click(screen.getByText("three-B"));
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    // ① 提交即回调，不等结果页按钮
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toMatchObject({ correct: 2, total: 3 });

    // ② 结果页的主按钮必须跳走
    expect(onExit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /完成并返回/ }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1); // 不重复落库
  });

  test("练习模式没有「换一题」；计时模式给了 onNext 才有", () => {
    const onNext = jest.fn();
    const { unmount } = render(
      <ListeningMCQTask item={makeItem("lat-nav-2")} taskType="lat" onComplete={() => {}} onExit={() => {}} isPractice />
    );
    startAnswering();
    fireEvent.click(screen.getByText("one-A"));
    fireEvent.click(screen.getByRole("button", { name: "下一题" }));
    fireEvent.click(screen.getByText("two-B"));
    fireEvent.click(screen.getByRole("button", { name: "下一题" }));
    fireEvent.click(screen.getByText("three-A"));
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    expect(screen.queryByRole("button", { name: /换一题/ })).toBeNull();
    unmount();
    localStorage.clear();

    render(
      <ListeningMCQTask item={makeItem("lat-nav-3")} taskType="lat" onComplete={() => {}} onExit={() => {}} onNext={onNext} isPractice />
    );
    startAnswering();
    fireEvent.click(screen.getByText("one-A"));
    fireEvent.click(screen.getByRole("button", { name: "下一题" }));
    fireEvent.click(screen.getByText("two-B"));
    fireEvent.click(screen.getByRole("button", { name: "下一题" }));
    fireEvent.click(screen.getByText("three-A"));
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    fireEvent.click(screen.getByRole("button", { name: /换一题/ }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

describe("答题页导航", () => {
  test("主按钮在右、上一题在左（左下角那颗孤零零的下一题没了）", () => {
    render(
      <ListeningMCQTask item={makeItem("lat-nav-4")} taskType="lat" onComplete={() => {}} onExit={() => {}} isPractice />
    );
    startAnswering();
    const next = screen.getByRole("button", { name: "下一题" });
    const prev = screen.getByRole("button", { name: "上一题" });
    const row = next.parentElement;
    expect(row).toBe(prev.parentElement);
    expect(row.style.justifyContent).toBe("space-between");
    expect(row.firstElementChild).toBe(prev);
    expect(row.lastElementChild).toBe(next);
  });

  test("计时模式：底部题号可点跳题，跳走的题被锁定（只可回看）", () => {
    render(
      <ListeningMCQTask item={makeItem("lat-nav-5")} taskType="lat" onComplete={() => {}} onExit={() => {}} isPractice={false} />
    );
    startAnswering();

    // 没作答之前不给跳（跳走即锁定，不能把空白题锁死）
    const jumpTo3 = () => screen.getByRole("button", { name: "第 3 题" });
    expect(jumpTo3()).toBeDisabled();

    fireEvent.click(screen.getByText("one-A"));
    expect(jumpTo3()).not.toBeDisabled();
    fireEvent.click(jumpTo3());
    expect(screen.getByText(/Q3\./)).toBeInTheDocument();

    // 回看第 1 题：已锁定，选项不可改
    fireEvent.click(screen.getByText("three-A"));
    fireEvent.click(screen.getByRole("button", { name: "第 1 题 · 已作答" }));
    expect(screen.getByText(/Q1\./)).toBeInTheDocument();
    expect(screen.getByText("one-B").closest("button")).toBeDisabled();
    expect(screen.getByText(/本题已锁定/)).toBeInTheDocument();
  });

  test("练习模式：题号随便跳，最后一题会提示还有几题没作答", () => {
    render(
      <ListeningMCQTask item={makeItem("lat-nav-6")} taskType="lat" onComplete={() => {}} onExit={() => {}} isPractice />
    );
    startAnswering();
    fireEvent.click(screen.getByRole("button", { name: "第 3 题" }));
    expect(screen.getByText(/Q3\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
    expect(screen.getByText(/还有 3 题没作答/)).toBeInTheDocument();
  });
});

describe("计时模式：一次超时只跳一题", () => {
  test("30 秒到 → 停在第 2 题，不是第 3 题", () => {
    jest.useFakeTimers();
    try {
      render(
        <ListeningMCQTask item={makeItem("lat-nav-7")} taskType="lat" onComplete={() => {}} onExit={() => {}} isPractice={false} />
      );
      startAnswering();
      expect(screen.getByText(/Q1\./)).toBeInTheDocument();
      act(() => { jest.advanceTimersByTime(31000); });
      expect(screen.getByText(/Q2\./)).toBeInTheDocument();
      expect(screen.queryByText(/Q3\./)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
