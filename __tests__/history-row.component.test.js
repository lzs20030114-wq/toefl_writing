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
});
