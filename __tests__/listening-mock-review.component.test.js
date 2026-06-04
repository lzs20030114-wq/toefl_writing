import { render, screen, fireEvent } from "@testing-library/react";
import { ListeningProgressView } from "../components/listening/ListeningProgressView";

jest.mock("../lib/AuthContext", () => ({ getSavedCode: jest.fn(() => null) }));

// A listening MOCK session shaped the way AdaptiveExamShell → buildTaskSnapshots
// persists it: per-task snapshots under details.m1.tasks / details.m2.tasks.
// The per-result objects intentionally OMIT `.correct` to exercise the adapter's
// normalization (it must fall back to the item/question answer).
jest.mock("../lib/sessionStore", () => ({
  loadHist: jest.fn(() => ({
    sessions: [
      {
        type: "listening",
        mode: "mock",
        date: "2026-02-10T10:00:00.000Z",
        correct: 1,
        total: 2,
        band: 3.5,
        details: {
          subtype: "mock",
          band: 3.5,
          cefr: "B1",
          path: "lower",
          m1: {
            correct: 1,
            total: 2,
            tasks: [
              {
                taskType: "lcr",
                itemId: "m-lcr-1",
                topic: "Campus",
                speaker: "Where do I hand in the form?",
                options: { A: "By email.", B: "At the front desk.", C: "Tomorrow.", D: "It is fine." },
                answer: "B",
                explanation: "B answers the where question.",
                correct: 0,
                total: 1,
                results: [{ selected: "A", isCorrect: false }],
              },
              {
                taskType: "la",
                itemId: "m-la-1",
                topic: "Library",
                announcement: "The library will close early today.",
                questions: [
                  { stem: "When does the library close?", options: { A: "Early", B: "Late", C: "Never", D: "Noon" }, answer: "A" },
                ],
                correct: 1,
                total: 1,
                results: [{ selected: "A", isCorrect: true }],
              },
            ],
          },
          m2: { correct: 0, total: 0, tasks: [] },
        },
      },
    ],
  })),
  deleteSession: jest.fn(() => ({ sessions: [] })),
  clearAllSessions: jest.fn(() => ({ sessions: [] })),
  setCurrentUser: jest.fn(),
  SESSION_STORE_EVENTS: { HISTORY_UPDATED_EVENT: "toefl-history-updated" },
}));

describe("ListeningProgressView — mock review", () => {
  test("expanding a mock record reveals per-task question review", () => {
    render(<ListeningProgressView onBack={() => {}} />);

    // Old behavior showed only a Band/M1/M2 summary. Expand the mock row.
    fireEvent.click(screen.getByText("听力模考"));
    expect(screen.getByText(/题目回顾/)).toBeInTheDocument();

    // Expand the LCR task card; the speaker prompt, options, and explanation
    // must render — driven by the saved snapshot, with the correct answer
    // recovered by the adapter even though the result omitted `.correct`.
    fireEvent.click(screen.getByText("选择回应"));
    expect(screen.getAllByText(/Where do I hand in the form/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/At the front desk\./).length).toBeGreaterThan(0);
    expect(screen.getByText("B answers the where question.")).toBeInTheDocument();
  });
});
