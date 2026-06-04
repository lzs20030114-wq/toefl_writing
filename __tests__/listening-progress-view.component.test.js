import { render, screen, fireEvent } from "@testing-library/react";
import { ListeningProgressView } from "../components/listening/ListeningProgressView";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => null),
}));

// One LCR session saved exactly the way app/listening/page.js → saveListeningSession
// writes it: the per-item snapshot lives under details.items (NOT details.questions),
// and details.results carries only the choice + correctness.
jest.mock("../lib/sessionStore", () => ({
  loadHist: jest.fn(() => ({
    sessions: [
      {
        type: "listening",
        mode: "practice",
        date: "2026-02-12T10:00:00.000Z",
        correct: 0,
        total: 1,
        band: 2,
        details: {
          subtype: "lcr",
          itemIds: ["lcr-1"],
          results: [{ itemId: "lcr-1", selected: "A", correct: "C", isCorrect: false }],
          items: [
            {
              id: "lcr-1",
              speaker: "Could you review my essay before Friday?",
              options: { A: "I already left.", B: "It is raining.", C: "Sure, send it over.", D: "The library is closed." },
              answer: "C",
              explanation: "Option C directly responds to the request.",
            },
          ],
        },
      },
    ],
  })),
  deleteSession: jest.fn(() => ({ sessions: [] })),
  clearAllSessions: jest.fn(() => ({ sessions: [] })),
  setCurrentUser: jest.fn(),
  SESSION_STORE_EVENTS: { HISTORY_UPDATED_EVENT: "toefl-history-updated" },
}));

describe("ListeningProgressView — LCR review", () => {
  test("expanding an LCR record shows the question content from details.items", () => {
    render(<ListeningProgressView onBack={() => {}} />);

    // The row renders before expansion; the question content does not.
    expect(screen.queryByText(/Could you review my essay/)).not.toBeInTheDocument();

    // Expand the LCR session row (click bubbles to the toggle button).
    fireEvent.click(screen.getByText("选择回应"));

    // Regression guard: if LCRDetail read details.questions (the old bug) instead
    // of details.items, the speaker prompt + options + explanation would all be
    // blank. They must render.
    expect(screen.getByText(/Could you review my essay/)).toBeInTheDocument();
    expect(screen.getByText(/Sure, send it over\./)).toBeInTheDocument();
    expect(screen.getByText(/Option C directly responds/)).toBeInTheDocument();
    expect(screen.queryByText("暂无详细题目数据")).not.toBeInTheDocument();
  });
});
