import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import EM_DATA from "../data/emailWriting/prompts.json";
import { WritingTask } from "../components/writing/WritingTask";

// "em1" exists in BOTH the old (V1) and current (V2) email banks with different
// content — the exact collision the retry-snapshot fix exists to handle.
const COLLIDING_ID = EM_DATA[0].id; // "em1"
const SNAPSHOT_KEY = "toefl-retry-snapshot";
const OLD_SCENARIO = "ZZZ_OLD_V1_UNIQUE_SCENARIO recycling program";

function seedSnapshot() {
  sessionStorage.setItem(
    SNAPSHOT_KEY,
    JSON.stringify({
      id: COLLIDING_ID,
      type: "email",
      promptData: {
        id: COLLIDING_ID,
        to: "Professor Lin",
        scenario: OLD_SCENARIO,
        direction: "Reply to the professor about the recycling plan.",
        goals: ["Mention the cost", "Suggest a schedule", "Offer to volunteer"],
      },
    })
  );
}

describe("WritingTask retry-from-history snapshot", () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  test("renders the practiced V1 snapshot, winning over the colliding live (V2) id", () => {
    seedSnapshot();
    render(<WritingTask type="email" initialPromptId={COLLIDING_ID} showTaskIntro={false} persistSession={false} />);

    // The old (snapshot) prompt is shown, NOT the live em1 ("You are a second-year student…").
    expect(screen.getByText(OLD_SCENARIO)).toBeInTheDocument();
    expect(screen.getByText("Offer to volunteer")).toBeInTheDocument();
    expect(screen.queryByText(/second-year student/i)).toBeNull();

    // One-shot handoff is consumed.
    expect(sessionStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });

  test("without a snapshot, the same id resolves from the live bank (no stale carryover)", () => {
    render(<WritingTask type="email" initialPromptId={COLLIDING_ID} showTaskIntro={false} persistSession={false} />);

    expect(screen.queryByText(OLD_SCENARIO)).toBeNull();
    expect(screen.getByText(/second-year student/i)).toBeInTheDocument();
  });
});
