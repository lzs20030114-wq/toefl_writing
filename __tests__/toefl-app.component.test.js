import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import ToeflApp from "../components/ToeflApp";
import { BuildSentenceTask } from "../components/buildSentence/BuildSentenceTask";
import { WritingTask } from "../components/writing/WritingTask";

const BUILD_TEST_Q = {
  id: "ets_test_001",
  prompt: "You missed class and need your classmate's slides.",
  answer: "Could you send the slides after class today please?",
  chunks: ["could", "send", "the", "slides", "after", "class", "today", "please"],
  prefilled: ["you"],
  prefilled_positions: { you: 1 },
  distractor: null,
  has_question_mark: true,
  grammar_points: ["embedded question (whether)"],
};
const BUILD_ALT_Q = {
  id: "ets_test_alt_001",
  prompt: "You need your classmate to upload a file tonight.",
  answer: "Could you upload the file tonight please now.",
  chunks: ["could", "upload", "the", "file", "tonight", "please", "now"],
  prefilled: ["you"],
  prefilled_positions: { you: 1 },
  distractor: null,
  has_question_mark: false,
  grammar_points: ["statement order in embedded clause"],
};

function makeLegacyQ(i) {
  const answerOrder = ["send", "me", "the", "slides", "after", "class", "today"];
  const bank = [...answerOrder].sort(() => Math.random() - 0.5);
  return {
    id: `legacy_${i}`,
    context: `Legacy prompt ${i}`,
    given: "Could you",
    givenIndex: 0,
    responseSuffix: "?",
    answerOrder,
    bank,
    grammar_points: [],
  };
}

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

  test("renders prompt and slots", () => {
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_TEST_Q]} />);
    fireEvent.click(screen.getByTestId("build-start"));

    expect(screen.getByText(BUILD_TEST_Q.prompt)).toBeInTheDocument();
    expect(screen.getByTestId("slot-0")).toHaveTextContent("1");
    expect(screen.getByTestId("slot-7")).toHaveTextContent("8");
  });

  test("build directions are readable and match iBT wording", () => {
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_TEST_Q]} />);

    const directionsText = screen.getByText(/Directions:/);
    const directionsBlock = directionsText.closest("div");
    expect(directionsBlock).toHaveTextContent("Directions:");
    expect(directionsBlock).toHaveTextContent("word chunks");
    expect(directionsBlock.textContent).not.toMatch(/[\uFFFD]{2,}/);
  });

  test("prefilled token stays fixed and correct order scores correct", () => {
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_TEST_Q]} />);
    fireEvent.click(screen.getByTestId("build-start"));

    ["could", "send", "the", "slides", "after", "class", "today", "please"].forEach((chunk) => {
      fireEvent.click(screen.getByRole("button", { name: chunk }));
    });
    fireEvent.click(screen.getByTestId("build-submit"));

    expect(screen.getByTestId("build-result-0")).toHaveAttribute("data-correct", "true");
    expect(screen.getByTestId("build-correct-answer-0")).toHaveTextContent(
      "Correct answer: Could you send the slides after class today please?"
    );
  });

  test("submit is disabled until all slots are filled", () => {
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_TEST_Q]} />);
    fireEvent.click(screen.getByTestId("build-start"));

    const submit = screen.getByTestId("build-submit");
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    expect(submit).toBeDisabled();
  });

  test("slot remove and replace behaviors work", () => {
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_TEST_Q]} />);
    fireEvent.click(screen.getByTestId("build-start"));

    fireEvent.click(screen.getByRole("button", { name: "send" }));
    expect(screen.getByTestId("slot-0")).toHaveTextContent("send");

    fireEvent.click(screen.getByTestId("slot-0"));
    expect(screen.getByTestId("slot-0")).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "send" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "send" }));
    const dragData = { setData: () => {}, getData: () => "x" };
    fireEvent.dragStart(screen.getByRole("button", { name: "the" }), { dataTransfer: dragData });
    fireEvent.drop(screen.getByTestId("slot-0"), { dataTransfer: dragData });

    expect(screen.getByTestId("slot-0")).toHaveTextContent("the");
    expect(screen.getByRole("button", { name: "send" })).toBeInTheDocument();
  });

  test("wrong order is marked incorrect and review shows full sentences", () => {
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_TEST_Q]} />);
    fireEvent.click(screen.getByTestId("build-start"));

    [...["could", "send", "the", "slides", "after", "class", "today", "please"]].reverse().forEach((chunk) => {
      fireEvent.click(screen.getByRole("button", { name: chunk }));
    });
    fireEvent.click(screen.getByTestId("build-submit"));

    expect(screen.getByTestId("build-result-0")).toHaveAttribute("data-correct", "false");
    expect(screen.getByTestId("build-your-sentence-0")).toHaveTextContent(
      "Your answer: Please you today class after slides the send could?"
    );
    expect(screen.getByTestId("build-correct-answer-0")).toHaveTextContent(
      "Correct answer: Could you send the slides after class today please?"
    );
  });

  test("alternate order is not accepted automatically", () => {
    render(<BuildSentenceTask onExit={() => {}} questions={[BUILD_ALT_Q]} />);
    fireEvent.click(screen.getByTestId("build-start"));

    ["upload", "the", "file", "please", "tonight", "now", "could"].forEach((chunk) => {
      fireEvent.click(screen.getByRole("button", { name: chunk }));
    });
    fireEvent.click(screen.getByTestId("build-submit"));

    expect(screen.getByTestId("build-result-0")).toHaveAttribute("data-correct", "false");
    expect(screen.getByTestId("build-correct-answer-0")).toHaveTextContent(
      "Correct answer: Could you upload the file tonight please now."
    );
  });

  test("20-question loop: when bank is empty submit is enabled", () => {
    const questions = Array.from({ length: 20 }, (_, i) => makeLegacyQ(i + 1));
    render(<BuildSentenceTask onExit={() => {}} questions={questions} />);
    fireEvent.click(screen.getByTestId("build-start"));

    for (let i = 0; i < 20; i++) {
      let guard = 0;
      while (true) {
        const bankButtons = screen.queryAllByTestId(/bank-chunk-/);
        if (bankButtons.length === 0) break;
        fireEvent.click(bankButtons[0]);
        guard += 1;
        if (guard > 50) throw new Error("bank did not drain as expected");
      }
      const submit = screen.getByTestId("build-submit");
      expect(submit).not.toBeDisabled();
      fireEvent.click(submit);
    }

    expect(screen.getByTestId("build-result-0")).toBeInTheDocument();
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

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("score-panel")).toBeInTheDocument();
    });
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

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("score-panel")).toBeInTheDocument();
    });
  });

  test("shows categorized error reason when scoring request fails", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
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
