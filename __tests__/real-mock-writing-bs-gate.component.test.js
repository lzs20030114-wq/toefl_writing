import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { BuildSentenceTask } from "../components/buildSentence/BuildSentenceTask";

// The real writing mock gates every BS question on a server "seen" call (beforeQuestion).
// A failed call used to show only 「返回」 wired to onExit — which the mock binds to 「中止」,
// so one network blip voided the whole paper.

const questions = [1, 2].map((n) => ({
  id: `real_mock_bs_${n}`, taskType: "bs", prompt: `I can read book ${n}.`, answer: `I can read book ${n}.`,
  chunks: ["I", "can", "read", "book", String(n)], prefilled: [], prefilled_positions: {}, distractor: null,
}));

async function flush() {
  // beforeQuestion runs inside a promise chain; let it settle.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

describe("BuildSentenceTask seen gate", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-04T08:00:00.000Z"));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("a failed check offers 重试 for the same question, never exits, and keeps the clock paused", async () => {
    const onExit = jest.fn();
    const onTimerChange = jest.fn();
    const beforeQuestion = jest.fn()
      .mockRejectedValueOnce(new Error("真题模考服务暂不可用，请稍后重试。"))
      .mockResolvedValue(undefined);
    render(
      <BuildSentenceTask
        embedded
        questions={questions}
        beforeQuestion={beforeQuestion}
        autoStartOnMount
        persistSession={false}
        recordGroupDone={false}
        onExit={onExit}
        onTimerChange={onTimerChange}
        timeLimitSeconds={60}
      />,
    );
    await flush();

    expect(await screen.findByText("真题模考服务暂不可用，请稍后重试。")).toBeInTheDocument();
    expect(screen.queryByText("I can read book 1.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回" })).not.toBeInTheDocument();
    expect(beforeQuestion).toHaveBeenCalledTimes(1);
    expect(beforeQuestion.mock.calls[0][0].id).toBe("real_mock_bs_1");

    // Paused while the gate is failed: 10 s pass, the remaining time does not move.
    const lastTimeLeft = () => onTimerChange.mock.calls.at(-1)[0].timeLeft;
    const pausedAt = lastTimeLeft();
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(lastTimeLeft()).toBe(pausedAt);

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await flush();

    expect(beforeQuestion).toHaveBeenCalledTimes(2);
    expect(beforeQuestion.mock.calls[1][0].id).toBe("real_mock_bs_1");
    expect(screen.getByText("I can read book 1.")).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();

    // Confirmed → the clock runs again from where it was paused.
    await act(async () => { jest.advanceTimersByTime(3_000); });
    expect(lastTimeLeft()).toBeLessThan(pausedAt);
    expect(lastTimeLeft()).toBeGreaterThanOrEqual(pausedAt - 4);
  });

  test("a check that keeps failing stays on the retry card (no exit, no question)", async () => {
    const onExit = jest.fn();
    const beforeQuestion = jest.fn().mockRejectedValue(new Error("记录已见状态失败"));
    render(
      <BuildSentenceTask
        embedded
        questions={questions}
        beforeQuestion={beforeQuestion}
        autoStartOnMount
        persistSession={false}
        recordGroupDone={false}
        onExit={onExit}
        timeLimitSeconds={60}
      />,
    );
    await flush();
    fireEvent.click(await screen.findByRole("button", { name: "重试" }));
    await flush();
    expect(beforeQuestion).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByText("I can read book 1.")).not.toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();
  });
});
