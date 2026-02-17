import { fireEvent, render, screen } from "@testing-library/react";
import { ScoringReport } from "../components/writing/ScoringReport";

describe("ScoringReport annotation rendering", () => {
  test("does not render raw <n> tags and uses parsed counts", () => {
    const result = {
      score: 4,
      band: 4,
      summary: "Good response overall.",
      goals: [],
      actions: [],
      patterns: [],
      comparison: { modelEssay: "", points: [] },
      annotationRaw:
        'Dear Professor, <r>I receive your feedback.</r><n level="red" fix="I have received your feedback.">tense</n> Also, <n level="blue" fix="I would appreciate your advice.">please advise.</n>',
      annotationSegments: [],
      annotationCounts: { red: 0, orange: 0, blue: 0 },
      taskId: "email-writing",
      sessionId: "sess-1",
    };

    render(<ScoringReport result={result} type="email" />);

    expect(
      screen.getByText(/1 条语法问题 \| 0 条措辞建议 \| 1 条升级建议/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /句子级批注/i }));
    expect(screen.queryByText(/<n/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/<r/i)).not.toBeInTheDocument();
    expect(screen.getByText(/I receive your feedback\./i)).toBeInTheDocument();
  });

  test("shows no-issues message when annotation list is empty", () => {
    const result = {
      score: 5,
      band: 5.5,
      summary: "Strong.",
      goals: [],
      actions: [],
      patterns: [],
      comparison: { modelEssay: "", points: [] },
      annotationParsed: { plainText: "Clean response.", annotations: [] },
    };
    render(<ScoringReport result={result} type="discussion" />);
    expect(screen.getByText(/未检测到句子级问题/i)).toBeInTheDocument();
  });
});
