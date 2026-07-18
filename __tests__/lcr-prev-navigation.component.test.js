import { render, screen, fireEvent } from "@testing-library/react";
import { LCRTask } from "../components/listening/LCRTask";

// AudioPlayer is network/audio-driven; stub it out. The task exposes an
// "I'm ready — show options" button that advances listen → choose without any
// audio, so the tests never depend on onEnded firing.
jest.mock("../components/listening/AudioPlayer", () => ({
  AudioPlayer: () => null,
}));

// 3-question practice batch. Option texts are distinct so getByText is unambiguous.
const batchItems = [
  {
    id: "lcr-1",
    speaker: "Where should I submit the form?",
    situation: "At the registrar office",
    options: { A: "By the side door.", B: "At the front desk.", C: "It was yesterday.", D: "It looks blue." },
    answer: "B",
    explanation: "B answers the where question.",
  },
  {
    id: "lcr-2",
    speaker: "When does the library close tonight?",
    situation: "Near the entrance",
    options: { A: "At nine tonight.", B: "Inside the library.", C: "Very quiet here.", D: "About ten books." },
    answer: "A",
    explanation: "A answers the when question.",
  },
  {
    id: "lcr-3",
    speaker: "How was the midterm exam?",
    situation: "After the lecture",
    options: { A: "In room five.", B: "It was really hard.", C: "Sometime next week.", D: "The economics professor." },
    answer: "B",
    explanation: "B answers the how question.",
  },
];

// Advance from the listen phase into the choose phase for the current question.
function showOptions() {
  fireEvent.click(screen.getByText(/I'm ready/));
}

function pickOption(text) {
  fireEvent.click(screen.getByText(text).closest("button"));
}

beforeEach(() => {
  // Drafts are keyed by batch scope in localStorage — clear so scenarios don't bleed.
  localStorage.clear();
});

describe("LCRTask 练习模式「上一题」导航", () => {
  test("第 1 题 choose 阶段「上一题」按钮禁用", () => {
    render(<LCRTask batchItems={batchItems} isPractice onComplete={jest.fn()} onExit={jest.fn()} />);

    showOptions(); // Q1 listen → choose
    const prevBtn = screen.getByText("上一题").closest("button");
    expect(prevBtn.disabled).toBe(true);
  });

  test("答完第 1 题进入第 2 题后，点「上一题」回到第 1 题且原选择被预选", () => {
    render(<LCRTask batchItems={batchItems} isPractice onComplete={jest.fn()} onExit={jest.fn()} />);

    // Q1: pick A, submit → Q2
    showOptions();
    pickOption("By the side door."); // A
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Now on Q2 (listen phase). Go back from the listen-phase 上一题.
    fireEvent.click(screen.getByText("上一题").closest("button"));

    // Back on Q1, choose phase, option A restored as selected.
    const optionA = screen.getByText("By the side door.").closest("button");
    expect(optionA.style.fontWeight).toBe("700"); // selected styling
    // And the forward button is enabled because a selection is present.
    expect(screen.getByRole("button", { name: "Next" }).disabled).toBe(false);
  });

  test("回退后改答案再前进，最终提交后 results 用改后的答案", () => {
    const onComplete = jest.fn();
    render(<LCRTask batchItems={batchItems} isPractice onComplete={onComplete} onExit={jest.fn()} />);

    // Q1: originally pick A (wrong), submit → Q2
    showOptions();
    pickOption("By the side door."); // A (answer is B)
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Q2 listen → go back to Q1 via 上一题
    fireEvent.click(screen.getByText("上一题").closest("button"));

    // Change Q1 answer to B (correct), submit → Q2 (fresh, never answered)
    pickOption("At the front desk."); // B
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Q2: pick A (correct), submit → Q3
    showOptions();
    pickOption("At nine tonight."); // A (answer is A)
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Q3: pick B (correct), submit all
    showOptions();
    pickOption("It was really hard."); // B (answer is B)
    fireEvent.click(screen.getByRole("button", { name: "Submit All" }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    const payload = onComplete.mock.calls[0][0];
    expect(payload.total).toBe(3);
    // Q1 reflects the CHANGED answer (B), not the original (A).
    expect(payload.results[0].selected).toBe("B");
    expect(payload.results[0].isCorrect).toBe(true);
    expect(payload.correct).toBe(3);
  });

  test("计时模式（isPractice=false）choose 阶段不渲染「上一题」", () => {
    render(<LCRTask batchItems={batchItems} isPractice={false} onComplete={jest.fn()} onExit={jest.fn()} />);

    // Timed mode: the ready button reads 开始答题.
    fireEvent.click(screen.getByText("开始答题"));
    expect(screen.queryByText("上一题")).toBeNull();
  });
});
