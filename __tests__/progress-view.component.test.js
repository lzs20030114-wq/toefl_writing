import { render, screen } from "@testing-library/react";
import { ProgressView } from "../components/ProgressView";

jest.mock("../lib/sessionStore", () => ({
  loadHist: jest.fn(() => ({
    sessions: [
      {
        type: "mock",
        date: "2026-02-15T10:00:00.000Z",
        band: 4.5,
        scaledScore: 24,
        details: {
          tasks: [null, { taskId: "email-writing", score: 3, maxScore: 5 }],
        },
      },
      {
        type: "bs",
        date: "2026-02-14T10:00:00.000Z",
        correct: 0,
        total: 0,
        details: [],
      },
    ],
  })),
  deleteSession: jest.fn(() => ({ sessions: [] })),
  clearAllSessions: jest.fn(() => ({ sessions: [] })),
  SESSION_STORE_EVENTS: { HISTORY_UPDATED_EVENT: "toefl-history-updated" },
}));

describe("ProgressView", () => {
  test("renders with malformed history data without crashing", () => {
    render(<ProgressView onBack={() => {}} />);
    expect(screen.getByText("Practice History")).toBeInTheDocument();
    expect(screen.getByText("Mock Exams")).toBeInTheDocument();
    expect(screen.getByText("Practice")).toBeInTheDocument();
  });
});
