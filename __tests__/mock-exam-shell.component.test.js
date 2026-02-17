import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MockExamShell } from "../components/mockExam/MockExamShell";

describe("MockExamShell", () => {
  test("renders start view", () => {
    render(<MockExamShell onExit={() => {}} />);
    expect(screen.getByText("Mock Exam Runner")).toBeInTheDocument();
    expect(screen.getByText("Start Mock Exam")).toBeInTheDocument();
  });

  test("shows transition page before each task starts", () => {
    render(<MockExamShell onExit={() => {}} />);
    fireEvent.click(screen.getByText("Start Mock Exam"));
    expect(screen.getByText("Upcoming section")).toBeInTheDocument();
    expect(screen.getByTestId("mock-transition-skip")).toBeInTheDocument();
  });
});
