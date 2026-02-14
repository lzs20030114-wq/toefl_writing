import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react-dom/test-utils";
import ToeflApp, { BuildSentenceTask, WritingTask } from "../components/ToeflApp";

const BUILD_TEST_Q = {
  id: "bs2_test_001",
  difficulty: "easy",
  context: "You missed class and need your classmate's slides.",
  responseSuffix: "?",
  given: "Could you",
  __givenInsertIndex: 2,
  bank: ["send me", "the slides", "after class", "today"],
  answerOrder: ["send me", "the slides", "after class", "today"],
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

    expect(screen.getByText("05:49")).toBeInTheDocument();
  });

  test("renders context, given token and slots", () => {
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_TEST_Q]} />);
    fireEvent.click(screen.getByTestId("build-start"));

    expect(screen.getByText(BUILD_TEST_Q.context)).toBeInTheDocument();
    expect(screen.getByTestId("given-token")).toHaveTextContent("Could you");
    expect(screen.getByTestId("slot-0")).toHaveTextContent("1");
    expect(screen.getByTestId("slot-3")).toHaveTextContent("4");
  });

  test("build directions are readable and match iBT wording", () => {
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_TEST_Q]} />);

    const directionsText = screen.getByText(/Directions:/);
    const directionsBlock = directionsText.closest("div");
    expect(directionsBlock).toHaveTextContent("Directions:");
    expect(directionsBlock).toHaveTextContent("Move the words");
    expect(directionsBlock.textContent).not.toMatch(/[\uFFFD]{2,}/);
  });

  test("given stays fixed and correct order scores correct", () => {
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_TEST_Q]} />);
    fireEvent.click(screen.getByTestId("build-start"));

    expect(screen.getByTestId("given-token")).toHaveTextContent("Could you");
    BUILD_TEST_Q.answerOrder.forEach((chunk) => {
      fireEvent.click(screen.getByRole("button", { name: chunk }));
    });
    fireEvent.click(screen.getByTestId("build-submit"));

    expect(screen.getByTestId("build-result-0")).toHaveAttribute("data-correct", "true");
    expect(screen.getByTestId("build-correct-answer-0")).toHaveTextContent(
      "Correct full response sentence: Send me the slides Could you after class today?"
    );
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

    fireEvent.click(screen.getByRole("button", { name: "send me" }));
    expect(screen.getByTestId("slot-0")).toHaveTextContent("send me");

    fireEvent.click(screen.getByTestId("slot-0"));
    expect(screen.getByTestId("slot-0")).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "send me" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "send me" }));
    const dragData = { setData: () => {}, getData: () => "" };
    fireEvent.dragStart(screen.getByRole("button", { name: "the slides" }), { dataTransfer: dragData });
    fireEvent.drop(screen.getByTestId("slot-0"), { dataTransfer: dragData });

    expect(screen.getByTestId("slot-0")).toHaveTextContent("the slides");
    expect(screen.getByRole("button", { name: "send me" })).toBeInTheDocument();
  });

  test("wrong order is marked incorrect and review shows full sentences", () => {
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_TEST_Q]} />);
    fireEvent.click(screen.getByTestId("build-start"));

    [...BUILD_TEST_Q.answerOrder].reverse().forEach((chunk) => {
      fireEvent.click(screen.getByRole("button", { name: chunk }));
    });
    fireEvent.click(screen.getByTestId("build-submit"));

    expect(screen.getByTestId("build-result-0")).toHaveAttribute("data-correct", "false");
    expect(screen.getByTestId("build-your-sentence-0")).toHaveTextContent(
      "Your full response sentence: Today after class Could you the slides send me?"
    );
    expect(screen.getByTestId("build-correct-answer-0")).toHaveTextContent(
      "Correct full response sentence: Send me the slides Could you after class today?"
    );
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
