import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MockExamShell } from "../components/mockExam/MockExamShell";

describe("MockExamShell", () => {
  test("renders start view", () => {
    render(<MockExamShell onExit={() => {}} />);
    expect(screen.getByText("整套模考")).toBeInTheDocument();
    expect(screen.getByText("开始模考")).toBeInTheDocument();
  });

  test("shows start card with exam button", () => {
    render(<MockExamShell onExit={() => {}} />);
    // Start card should display the exam button (clicking may trigger cost/usage modal)
    const btn = screen.getByText("开始模考");
    expect(btn).toBeInTheDocument();
    expect(btn.tagName === "BUTTON" || btn.closest("button")).toBeTruthy();
  });
});
