import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MockExamShell } from "../components/mockExam/MockExamShell";

describe("MockExamShell", () => {
  test("renders start view", () => {
    render(<MockExamShell onExit={() => {}} />);
    expect(screen.getByText("整套模考")).toBeInTheDocument();
    expect(screen.getByText("开始模考")).toBeInTheDocument();
  });

  test("shows transition page before each task starts", () => {
    render(<MockExamShell onExit={() => {}} />);
    fireEvent.click(screen.getByText("开始模考"));
    expect(screen.getByText("Up Next")).toBeInTheDocument();
    expect(screen.getByTestId("mock-transition-skip")).toBeInTheDocument();
  });
});
