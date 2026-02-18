import { render, screen } from "@testing-library/react";
import { ScoringReport } from "../components/writing/ScoringReport";

describe("ScoringReport compact feedback", () => {
  test("renders AI disclaimer and caps key problems at 3", () => {
    const result = {
      score: 3.5,
      band: 4,
      summary: "Needs clearer grammar and wording.",
      rubric: {
        weighted_score: 3.7,
        method: "weighted_combination",
        dimensions: {
          task_fulfillment: { score: 4, weight: 0.4, definition: "Task coverage", reason: "Most goals addressed." },
          organization_coherence: { score: 3.5, weight: 0.3, definition: "Flow", reason: "Transitions can improve." },
          language_use: { score: 3.5, weight: 0.3, definition: "Language quality", reason: "Some grammar slips." },
        },
      },
      score_confidence: {
        reliable_aspects: ["task_fulfillment", "language_use"],
        uncertain_aspects: ["nuanced_argument_quality"],
        qualitative_only: true,
      },
      key_problems: [
        { explanation: "Verb tense is inconsistent.", example: "I receive your feedback yesterday", action: "Use past tense for past events." },
        { explanation: "Sentence is too vague.", example: "This is good for many things", action: "Replace vague words with one concrete detail." },
        { explanation: "Connector is missing.", example: "I agree this policy helps", action: "Add a reason connector like because/therefore." },
        { explanation: "Should not show", example: "extra", action: "extra" },
      ],
    };

    render(<ScoringReport result={result} type="email" uiLang="en" />);
    expect(screen.getByTestId("score-disclaimer-note")).toBeInTheDocument();
    expect(screen.getByText(/Scores are AI-assisted training estimates\./i)).toBeInTheDocument();
    expect(screen.getByText(/not official score prediction/i)).toBeInTheDocument();
    expect(screen.getByText(/Score Confidence/i)).toBeInTheDocument();
    expect(screen.getByText(/Reliable:/i)).toBeInTheDocument();
    expect(screen.getByText(/Uncertain:/i)).toBeInTheDocument();
    expect(screen.getByText(/Rubric Breakdown/i)).toBeInTheDocument();
    expect(screen.getByText(/Weighted score/i)).toBeInTheDocument();
    expect(screen.getByText(/Key Problems \(ranked by impact\)/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Diagnosis/i)).toHaveLength(3);
    expect(screen.queryByText("Should not show")).not.toBeInTheDocument();
  });

  test("shows compact no-problem state for discussion report", () => {
    const result = {
      score: 5,
      band: 5.5,
      summary: "Strong response.",
      key_problems: [],
    };
    render(<ScoringReport result={result} type="discussion" uiLang="en" />);
    expect(screen.getByText(/No major problems detected/i)).toBeInTheDocument();
    expect(screen.getByTestId("score-disclaimer-note")).toBeInTheDocument();
  });
});
