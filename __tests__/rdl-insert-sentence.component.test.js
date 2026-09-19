/**
 * RDLTask · 插入句题（insert_text）题干三段式渲染。
 *
 * 之前题干是一整段 16px 黑体：ETS 指令 + 待插入句 + 提问堆在一起，用户得自己在段落里找哪一句是要插的。
 * 现在待插入句单独成段（data-testid=insert-stem-sentence），指令 / 提问各自一段、降一档字重。
 *
 * 锁的事：
 *   1. 插入句题：句子单独一个元素，元素文本就是句子本身，指令和提问元素里不含句子；
 *   2. 拆不出句子（数据缺陷：题干只剩套话）时回落整段原样渲染，不出空白块；
 *   3. 普通选择题不受影响（题干整段照旧）；
 *   4. 四选一作答、提交、复盘照常 —— 三段式只是题干的展示，不动作答逻辑。
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { RDLTask } from "../components/reading/RDLTask";

const noop = () => {};
const SENT = "Changes in educational practices or shifts in societal values could account for the downturn.";
const LEAD = "There are four locations in the passage that indicate where the following sentence could be added.";
const TAIL = "Where would the sentence best fit? Select a location to add the sentence in the passage.";

const INSERT_Q = {
  question_type: "insert_text",
  stem: `${LEAD} ${SENT} ${TAIL}`,
  options: { A: "[A]", B: "[B]", C: "[C]", D: "[D]" },
  correct_answer: "D",
};
const MCQ_Q = {
  question_type: "factual_detail",
  stem: "According to paragraph 1, what did researchers observe?",
  options: { A: "A rise in scores", B: "A drop in scores", C: "No change", D: "Regional differences" },
  correct_answer: "A",
};
const BROKEN_INSERT_Q = {
  question_type: "insert_text",
  stem: `${LEAD} ${TAIL}`,
  options: { A: "[A]", B: "[B]", C: "[C]", D: "[D]" },
  correct_answer: "B",
};

function makeItem(questions) {
  return {
    id: "test-ap-insert",
    genre: "Academic",
    text: "The Flynn Effect\n\nResearchers have observed a rise in IQ scores. ■ However, scores have recently dipped. ■ Some argue this reflects test familiarity. ■ Others disagree. ■",
    questions,
  };
}

function renderTask(questions) {
  return render(
    <RDLTask item={makeItem(questions)} onExit={noop} onComplete={noop} isPractice title="Academic Passage" section="Reading | Task 3" />
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("RDLTask 插入句题干三段式", () => {
  test("待插入句单独成段，指令 / 提问各自一段且不含句子", () => {
    renderTask([INSERT_Q]);
    const sentence = screen.getByTestId("insert-stem-sentence");
    expect(sentence).toHaveTextContent(SENT);
    expect(sentence.textContent.trim()).toBe(SENT);
    expect(screen.getByTestId("insert-stem-lead").textContent.trim()).toBe(LEAD);
    expect(screen.getByTestId("insert-stem-tail").textContent.trim()).toBe(TAIL);
    expect(screen.getByTestId("insert-stem-lead").textContent).not.toContain(SENT);
    // 题号行的题型标签照旧
    expect(screen.getByText("(插入句)")).toBeInTheDocument();
    // 原来那种「整段堆一起」的题干不再出现
    expect(screen.queryByText(INSERT_Q.stem)).toBeNull();
  });

  test("题干只剩套话（拆不出句子）→ 回落整段原样，不出空白块", () => {
    renderTask([BROKEN_INSERT_Q]);
    expect(screen.queryByTestId("insert-stem")).toBeNull();
    expect(screen.getByText(BROKEN_INSERT_Q.stem)).toBeInTheDocument();
  });

  test("普通选择题题干整段照旧，不套三段式", () => {
    renderTask([MCQ_Q]);
    expect(screen.queryByTestId("insert-stem")).toBeNull();
    expect(screen.getByText(MCQ_Q.stem)).toBeInTheDocument();
  });

  test("切题时三段式跟着题走；作答 / 提交 / 复盘照常", () => {
    renderTask([MCQ_Q, INSERT_Q]);
    expect(screen.queryByTestId("insert-stem")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByTestId("insert-stem-sentence")).toHaveTextContent(SENT);

    // 第 2 题选 [D]（正确答案），回第 1 题选 A，再翻到末题提交（提交键只在最后一题出现）
    fireEvent.click(screen.getByText("[D]"));
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    fireEvent.click(screen.getByText("A rise in scores"));
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    fireEvent.click(screen.getByText("提交全部"));

    // 复盘：翻到第 2 题，三段式仍在，且正确项标绿（通过题号圆点的 ✓ 判断）
    fireEvent.click(screen.getByText("下一题 →"));
    expect(screen.getByTestId("insert-stem-sentence")).toHaveTextContent(SENT);
    expect(screen.getAllByText("✓").length).toBeGreaterThanOrEqual(2);
  });
});
