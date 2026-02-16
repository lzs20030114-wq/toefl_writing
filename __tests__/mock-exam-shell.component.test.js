import React from "react";
import { render, screen } from "@testing-library/react";
import { MockExamShell } from "../components/mockExam/MockExamShell";

describe("MockExamShell", () => {
  test("renders start view", () => {
    render(<MockExamShell onExit={() => {}} />);
    expect(screen.getByText("Mock Exam Runner")).toBeInTheDocument();
    expect(screen.getByText("Start Mock Exam")).toBeInTheDocument();
  });
});
