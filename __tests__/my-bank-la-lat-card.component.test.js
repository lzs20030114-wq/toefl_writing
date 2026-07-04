import { render, screen, fireEvent } from "@testing-library/react";
import MyBankImporter from "../components/userBank/MyBankImporter";

// MyBankImporter: the 听公告 (LA) and 学术讲座 (LAT) cards are now live and selectable.
// Mirrors __tests__/my-bank-lcr-card.component.test.js conventions.
describe("MyBankImporter LA/LAT cards", () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items: [] }) })
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("听公告 card renders live (not 开发中) and is selectable", () => {
    render(<MyBankImporter code="ABC123" tier="pro" />);
    const chip = screen.getByText("听公告").closest("button");
    expect(chip.disabled).toBe(false);
    expect(chip.getAttribute("aria-pressed")).not.toBeNull();

    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    // Placeholder guides pasting the announcement (公告全文); questions optional (AI补).
    expect(screen.getByPlaceholderText(/公告全文/)).toBeTruthy();
  });

  test("学术讲座 card renders live and is selectable", () => {
    render(<MyBankImporter code="ABC123" tier="pro" />);
    const chip = screen.getByText("学术讲座").closest("button");
    expect(chip.disabled).toBe(false);
    expect(chip.getAttribute("aria-pressed")).not.toBeNull();

    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    // Placeholder mentions the long real-exam transcript (500-800 词).
    expect(screen.getByPlaceholderText(/讲座文字稿/)).toBeTruthy();
  });

  test("听对话 (LC) remains a 开发中 placeholder (not wired this phase)", () => {
    render(<MyBankImporter code="ABC123" tier="pro" />);
    const chip = screen.getByText("听对话").closest("button");
    expect(chip.disabled).toBe(true);
    expect(chip.getAttribute("aria-pressed")).toBeNull();
  });
});
