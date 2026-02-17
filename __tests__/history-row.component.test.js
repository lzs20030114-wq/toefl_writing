import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { HistoryRow } from "../components/history/HistoryRow";

describe("HistoryRow", () => {
  test("renders summary and fires callbacks", () => {
    const onToggle = jest.fn();
    const onDelete = jest.fn();
    const entry = {
      sourceIndex: 3,
      session: {
        type: "mock",
        score: 80,
        date: "2026-02-16T00:00:00.000Z",
        details: { scoringPhase: "done", tasks: [] },
      },
    };

    render(<HistoryRow entry={entry} isExpanded={false} isLast={false} onToggle={onToggle} onDelete={onDelete} />);
    fireEvent.click(screen.getByText("Mock Exam"));
    expect(onToggle).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle("Delete this entry"));
    expect(onDelete).toHaveBeenCalledWith(3);
  });

  test("does not crash when mock task list contains malformed legacy items", () => {
    const entry = {
      sourceIndex: 1,
      session: {
        type: "mock",
        score: 70,
        date: "2026-02-16T00:00:00.000Z",
        details: {
          tasks: [null, { taskId: "email-writing", score: 3, maxScore: 5 }, { nope: true }],
        },
      },
    };

    render(<HistoryRow entry={entry} isExpanded={true} isLast={true} onToggle={() => {}} onDelete={() => {}} />);
    expect(screen.getByText("Mock Exam")).toBeInTheDocument();
    expect(screen.getByText(/Email 3\/5/)).toBeInTheDocument();
  });
});
