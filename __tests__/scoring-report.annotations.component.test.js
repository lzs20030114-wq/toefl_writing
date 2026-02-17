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
        'Dear Professor, <n level="red" fix="I have received your feedback.">I receive your feedback.</n> Also, <n level="blue" fix="I would appreciate your advice.">please advise.</n>',
      annotationSegments: [],
      annotationCounts: { red: 0, orange: 0, blue: 0 },
      taskId: "email-writing",
      sessionId: "sess-1",
    };

    render(<ScoringReport result={result} type="email" />);

    expect(
      screen.getByText(/1 grammar errors \| 0 wording suggestions \| 1 upgrade suggestions/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Sentence Annotations/i }));
    expect(screen.queryByText(/<n/i)).not.toBeInTheDocument();
    expect(screen.getByText(/I receive your feedback\./i)).toBeInTheDocument();
  });
});
