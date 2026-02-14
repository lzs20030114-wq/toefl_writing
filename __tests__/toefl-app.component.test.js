import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react-dom/test-utils";
import ToeflApp, { BuildSentenceTask, WritingTask } from "../components/ToeflApp";

const BUILD_TEST_Q = {
  id: "bs_test_001",
  difficulty: "easy",
  promptTokens: [
    { t: "text", v: "you should" },
    { t: "blank" },
    { t: "given", v: "for the" },
    { t: "blank" },
    { t: "blank" },
    { t: "blank" },
  ],
  bank: ["sign up", "lab section", "online", "today"],
  answerOrder: ["sign up", "lab section", "online", "today"],
};

describe("ToeflApp navigation", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("can open email task from menu", () => {
    render(<ToeflApp />);
    fireEvent.click(screen.getByTestId("task-email"));
    expect(screen.getByText("SCENARIO")).toBeInTheDocument();
    expect(screen.getByTestId("writing-start")).toBeInTheDocument();
  });

  test("build start double-click does not create multiple timers", () => {
    jest.useFakeTimers();
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_TEST_Q]} />);

    const startBtn = screen.getByTestId("build-start");
    fireEvent.click(startBtn);
    fireEvent.click(startBtn);

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText("05:59")).toBeInTheDocument();
  });

  test("given chunk stays fixed and correct order scores correct", () => {
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_TEST_Q]} />);
    fireEvent.click(screen.getByTestId("build-start"));

    expect(screen.getByTestId("given-token")).toHaveTextContent("for the");
    BUILD_TEST_Q.answerOrder.forEach((chunk) => {
      fireEvent.click(screen.getByRole("button", { name: chunk }));
    });
    fireEvent.click(screen.getByTestId("build-submit"));

    expect(screen.getByTestId("build-result-0")).toHaveAttribute("data-correct", "true");
  });

  test("submit is disabled until all slots are filled", () => {
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_TEST_Q]} />);
    fireEvent.click(screen.getByTestId("build-start"));

    const submit = screen.getByTestId("build-submit");
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: BUILD_TEST_Q.bank[0] }));
    expect(submit).toBeDisabled();
  });

  test("slot remove and replace behaviors work", () => {
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_TEST_Q]} />);
    fireEvent.click(screen.getByTestId("build-start"));

    fireEvent.click(screen.getByRole("button", { name: "sign up" }));
    expect(screen.getByTestId("slot-0")).toHaveTextContent("sign up");

    fireEvent.click(screen.getByTestId("slot-0"));
    expect(screen.getByTestId("slot-0")).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "sign up" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "sign up" }));
    const dragData = { setData: () => {}, getData: () => "" };
    fireEvent.dragStart(screen.getByRole("button", { name: "lab section" }), { dataTransfer: dragData });
    fireEvent.drop(screen.getByTestId("slot-0"), { dataTransfer: dragData });

    expect(screen.getByTestId("slot-0")).toHaveTextContent("lab section");
    expect(screen.getByRole("button", { name: "sign up" })).toBeInTheDocument();
  });

  test("wrong order is marked incorrect and shows expected order", () => {
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_TEST_Q]} />);
    fireEvent.click(screen.getByTestId("build-start"));

    [...BUILD_TEST_Q.answerOrder].reverse().forEach((chunk) => {
      fireEvent.click(screen.getByRole("button", { name: chunk }));
    });
    fireEvent.click(screen.getByTestId("build-submit"));

    expect(screen.getByTestId("build-result-0")).toHaveAttribute("data-correct", "false");
    expect(screen.getByTestId("build-correct-answer-0")).toBeInTheDocument();
  });

  test("writing duplicate submit only triggers one API call", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          score: 4,
          band: 4,
          goals_met: [true, true, true],
          summary: "ok",
          weaknesses: [],
          strengths: [],
          grammar_issues: [],
          vocabulary_note: "",
          next_steps: [],
          sample: "sample",
        }),
      }),
    });

    render(<WritingTask onExit={() => {}} type="email" />);
    fireEvent.click(screen.getByTestId("writing-start"));
    fireEvent.change(screen.getByTestId("writing-textarea"), {
      target: {
        value: "this response has enough words to pass submit threshold quickly",
      },
    });

    const submitBtn = screen.getByTestId("writing-submit");
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("manual submit at deadline edge still sends one request", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          score: 4,
          band: 4,
          goals_met: [true, true, true],
          summary: "ok",
          weaknesses: [],
          strengths: [],
          grammar_issues: [],
          vocabulary_note: "",
          next_steps: [],
          sample: "sample",
        }),
      }),
    });

    render(<WritingTask onExit={() => {}} type="email" />);
    fireEvent.click(screen.getByTestId("writing-start"));
    fireEvent.change(screen.getByTestId("writing-textarea"), {
      target: {
        value: "this response has enough words to pass submit threshold quickly",
      },
    });

    act(() => {
      jest.advanceTimersByTime(419000);
    });
    fireEvent.click(screen.getByTestId("writing-submit"));
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("shows categorized error reason when scoring request fails", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: "rate limited" }),
    });

    render(<WritingTask onExit={() => {}} type="email" />);
    fireEvent.click(screen.getByTestId("writing-start"));
    fireEvent.change(screen.getByTestId("writing-textarea"), {
      target: {
        value: "this response has enough words to pass submit threshold quickly",
      },
    });
    fireEvent.click(screen.getByTestId("writing-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("score-error-reason")).toHaveTextContent("429");
    });
  });
});
