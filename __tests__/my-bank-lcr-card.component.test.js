import { render, screen, fireEvent } from "@testing-library/react";
import MyBankImporter from "../components/userBank/MyBankImporter";

// MyBankImporter: the 听力选择回应 (LCR) card is now live and selectable.
// Mirrors __tests__/my-bank-reading-cards.component.test.js conventions.
describe("MyBankImporter LCR card", () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items: [] }) })
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("选择回应 card renders live (not 开发中) and is selectable", () => {
    render(<MyBankImporter code="ABC123" tier="pro" />);

    const lcrChip = screen.getByText("选择回应").closest("button");
    expect(lcrChip).toBeTruthy();
    // Live => not disabled + exposes aria-pressed (dev-only chips omit it).
    expect(lcrChip.disabled).toBe(false);
    expect(lcrChip.getAttribute("aria-pressed")).not.toBeNull();

    fireEvent.click(lcrChip);
    expect(lcrChip.getAttribute("aria-pressed")).toBe("true");
    // Placeholder guides the user to paste 口播句 + 选项 + 答案 (答案可缺).
    const textarea = screen.getByPlaceholderText(/口播的那句英文/);
    expect(textarea).toBeTruthy();
  });

  // LA (听公告) + LAT (学术讲座) went live in phase 3-2; only LC (听对话) remains 开发中.
  test("听对话 (LC) remains a 开发中 placeholder", () => {
    render(<MyBankImporter code="ABC123" tier="pro" />);
    const chip = screen.getByText("听对话").closest("button");
    expect(chip.disabled).toBe(true);
    expect(chip.getAttribute("aria-pressed")).toBeNull();
  });
});
