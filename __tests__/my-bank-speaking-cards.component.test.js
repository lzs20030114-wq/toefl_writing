import { render, screen, fireEvent } from "@testing-library/react";
import MyBankImporter from "../components/userBank/MyBankImporter";

// (c) MyBankImporter: the two speaking cards (听后复述 / 模拟面试) are now live and selectable.
// Mirrors __tests__/my-bank-section.component.test.js conventions (fetch mock + logged-in Pro).
describe("MyBankImporter speaking cards", () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items: [] }) })
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("听后复述 and 模拟面试 cards render as live (not 开发中) and are selectable", () => {
    render(<MyBankImporter code="ABC123" tier="pro" />);

    // Both speaking type chips are present.
    const repeatChip = screen.getByText("听后复述").closest("button");
    const interviewChip = screen.getByText("模拟面试").closest("button");
    expect(repeatChip).toBeTruthy();
    expect(interviewChip).toBeTruthy();

    // Live => not disabled, and expose aria-pressed (dev-only chips omit it).
    expect(repeatChip.disabled).toBe(false);
    expect(interviewChip.disabled).toBe(false);
    expect(repeatChip.getAttribute("aria-pressed")).not.toBeNull();
    expect(interviewChip.getAttribute("aria-pressed")).not.toBeNull();

    // Selecting the repeat card flips its pressed state and swaps the ② badge label.
    fireEvent.click(repeatChip);
    expect(repeatChip.getAttribute("aria-pressed")).toBe("true");
    // 「听后复述」now also appears as the selected ② section badge.
    expect(screen.getAllByText("听后复述").length).toBeGreaterThanOrEqual(2);

    // The importer core is still intact (regression文案).
    expect(screen.getByText("AI 抽取题目")).toBeTruthy();
  });

  test("selecting 模拟面试 shows its paste placeholder", () => {
    render(<MyBankImporter code="ABC123" tier="pro" />);
    fireEvent.click(screen.getByText("模拟面试").closest("button"));
    const textarea = screen.getByPlaceholderText(/粘贴 1-4 个英文面试问题/);
    expect(textarea).toBeTruthy();
  });
});
