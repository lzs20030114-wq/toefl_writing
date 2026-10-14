import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { RDLTask } from "../components/reading/RDLTask";

const item = {
  id: "ap-review", text: "The bank was crowded. Trees grew nearby.", genre: "Ecology",
  questions: [
    { qid: "ap-q1", stem: "Where did trees grow?", options: { A: "Nearby", B: "Far away", C: "Inside", D: "Nowhere" }, correct_answer: "A", explanation: "Trees grew nearby." },
    { qid: "ap-q2", stem: "How was the bank?", options: { A: "Empty", B: "Crowded", C: "Closed", D: "Quiet" }, correct_answer: "B", explanation: "The bank was crowded." },
  ],
};
const originalFetch = global.fetch;
const originalCaret = document.caretRangeFromPoint;
const originalRect = Range.prototype.getBoundingClientRect;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("toefl-user-tier", "pro");
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ bank: { p: "", t: "n. 河岸" } }) }));
  Range.prototype.getBoundingClientRect = () => ({ top: 20, bottom: 35, left: 20, right: 55, width: 35, height: 15 });
});
afterEach(() => {
  global.fetch = originalFetch;
  document.caretRangeFromPoint = originalCaret;
  Range.prototype.getBoundingClientRect = originalRect;
});

test("AP submits mixed answers into the real history review with passage lookup and expandable AI explanation", async () => {
  const onComplete = jest.fn();
  const { container } = render(<RDLTask item={item} subtype="ap" onComplete={onComplete} />);
  fireEvent.click(screen.getByRole("button", { name: "Nearby" }));
  fireEvent.click(screen.getByRole("button", { name: "下一题 →" }));
  fireEvent.click(screen.getByRole("button", { name: "Empty" }));
  fireEvent.click(screen.getByRole("button", { name: "提交全部" }));
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(onComplete).toHaveBeenCalledWith({ correct: 1, total: 2, results: [
    { selected: "A", correct: "A", isCorrect: true }, { selected: "A", correct: "B", isCorrect: false },
  ] });
  expect(screen.getByText("逐题回顾")).toBeTruthy();
  expect(container.querySelector(".tp-reading-split")).toBeNull();
  const passage = screen.getByTestId("mcq-context");
  expect(within(passage).getByText("点任意词查释义")).toBeTruthy();
  const paragraph = passage.querySelector("p");
  document.caretRangeFromPoint = () => {
    const range = document.createRange();
    range.setStart(paragraph.firstChild, 5);
    range.collapse(true);
    return range;
  };
  fireEvent.mouseUp(paragraph, { clientX: 40, clientY: 25 });
  expect(await screen.findByRole("button", { name: "收藏到单词本" })).toBeTruthy();
  const cards = container.querySelectorAll('button[aria-expanded]');
  expect(cards).toHaveLength(2);
  fireEvent.click(cards[1]);
  expect(cards[1].getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("正确答案")).toBeTruthy();
  expect(screen.getByRole("button", { name: /AI 讲解/ })).toBeTruthy();
  fireEvent.click(cards[1]);
  expect(cards[1].getAttribute("aria-expanded")).toBe("false");
});

test("AP timeout saves unanswered results once and redo resets timer, answers and expansion", () => {
  jest.useFakeTimers();
  try {
    const onComplete = jest.fn();
    const { container } = render(<RDLTask item={item} subtype="ap" timeLimit={2} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: "Nearby" }));
    act(() => jest.advanceTimersByTime(2000));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].results[1]).toEqual({ selected: null, correct: "B", isCorrect: false });
    fireEvent.click(container.querySelector('button[aria-expanded]'));
    act(() => jest.advanceTimersByTime(5000));
    expect(onComplete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "重新作答" }));
    expect(screen.queryByText("逐题回顾")).toBeNull();
    expect(screen.getByText("已作答 0/2")).toBeTruthy();
    expect(screen.getByText("第 1 题 / 共 2 题")).toBeTruthy();
    act(() => jest.advanceTimersByTime(1000));
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(1000));
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete.mock.calls[1][0].results.every(r => r.selected === null)).toBe(true);
    expect(container.querySelector('button[aria-expanded="true"]')).toBeNull();
    act(() => jest.advanceTimersByTime(5000));
    expect(onComplete).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});
