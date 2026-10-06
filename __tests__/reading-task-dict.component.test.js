import { act, fireEvent, render, screen } from "@testing-library/react";
import { CTWTask } from "../components/reading/CTWTask";
import { RDLTask } from "../components/reading/RDLTask";
import { loadBook } from "../lib/vocab/vocabStore";

const fetchBefore = global.fetch;
const caretBefore = document.caretRangeFromPoint;
const rectBefore = Range.prototype.getBoundingClientRect;
beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ bank: { p: "", t: "n. 河岸" } }) }));
  Range.prototype.getBoundingClientRect = () => ({ top: 20, bottom: 35, left: 20, right: 55, width: 35, height: 15 });
});
afterEach(() => {
  global.fetch = fetchBefore;
  document.caretRangeFromPoint = caretBefore;
  Range.prototype.getBoundingClientRect = rectBefore;
});
function pick(target, offset = 2) {
  document.caretRangeFromPoint = () => {
    const range = document.createRange();
    const node = [...target.childNodes].find(n => n.nodeType === 3 && /bank/.test(n.textContent)) || target.firstChild;
    range.setStart(node, offset);
    range.collapse(true);
    return range;
  };
  fireEvent.mouseUp(target, { clientX: 40, clientY: 25 });
}

test("CTW 作答时不查词，交卷后完整填空词收藏到正确原句", async () => {
  localStorage.setItem("toefl-user-tier", "pro");
  const onComplete = jest.fn();
  const { container } = render(<CTWTask onComplete={onComplete} item={{ id: "dict-ctw", passage: "The bank was crowded. The bank was quiet.", blanks: [{ position: 5, original_word: "bank", displayed_fragment: "ba" }] }} />);
  pick(screen.getByText("bank"));
  expect(screen.queryByRole("button", { name: "收藏到单词本" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "xx" } });
  fireEvent.click(screen.getByRole("button", { name: "提交答案" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.mouseUp(container.querySelector('[data-dict-word="bank"]'), { clientX: 40, clientY: 25 });
  fireEvent.click(await screen.findByRole("button", { name: "收藏到单词本" }));
  expect(loadBook().find(card => card.word === "bank")).toMatchObject({ source: "reading", sentence: "The bank was quiet." });
  expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ correct: 0, total: 1, results: [expect.objectContaining({ fullWord: "baxx", isCorrect: false })] }));
  const card = container.querySelector("button[data-q]");
  fireEvent.click(card);
  expect(card.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText(/第\s*1\s*空/)).toBeTruthy();
  expect(screen.getByText("baxx")).toBeTruthy();
  expect(screen.getByRole("button", { name: /AI 讲解/ })).toBeTruthy();
  fireEvent.click(card);
  expect(card.getAttribute("aria-expanded")).toBe("false");
});

test("RDL 提交后选项只读且可收藏，语境不混入题干和相邻选项", async () => {
  const item = { id: "dict-rdl", text: "The building closed.", questions: [{ stem: "Where is it?", options: { A: "The bank was crowded", B: "A small store", C: "A nearby school", D: "A quiet park" }, correct_answer: "A", explanation: "Review the building." }] };
  render(<RDLTask item={item} />);
  const answer = screen.getByRole("button", { name: "The bank was crowded" });
  pick(answer.querySelector("span:last-child"), 6);
  expect(screen.queryByRole("button", { name: "收藏到单词本" })).toBeNull();
  fireEvent.click(answer);
  fireEvent.click(screen.getByRole("button", { name: "提交全部" }));
  expect(screen.queryByRole("button", { name: /The bank was crowded/ })).toBeNull();
  pick(screen.getByText("The bank was crowded"), 6);
  fireEvent.click(await screen.findByRole("button", { name: "收藏到单词本" }));
  expect(loadBook().find(card => card.word === "bank")).toMatchObject({ source: "reading", sentence: "The bank was crowded" });
});


test("CTW 超时报告与重做都复用完整回顾，重做重新计时", () => {
  jest.useFakeTimers();
  try {
    const onComplete = jest.fn();
    render(<CTWTask onComplete={onComplete} timeLimit={1} item={{ id: "timed-ctw", passage: "The bank was quiet.", blanks: [{ position: 1, original_word: "bank", displayed_fragment: "ba" }] }} />);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText("逐题回顾")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新作答" }));
    expect(screen.getByRole("textbox").value).toBe("");
    expect(screen.queryByText("逐题回顾")).toBeNull();
    act(() => { jest.advanceTimersByTime(1000); });
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(screen.getByText("逐题回顾")).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});
