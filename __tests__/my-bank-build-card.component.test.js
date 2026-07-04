import { render, screen, fireEvent } from "@testing-library/react";
import MyBankImporter from "../components/userBank/MyBankImporter";

// (d) MyBankImporter: the 连词成句 (Build a Sentence) card is now live and selectable.
// Mirrors __tests__/my-bank-speaking-cards.component.test.js conventions.
describe("MyBankImporter build card", () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items: [] }) })
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("连词成句 card renders live (not 开发中) and is selectable", () => {
    render(<MyBankImporter code="ABC123" tier="pro" />);

    const buildChip = screen.getByText("连词成句").closest("button");
    expect(buildChip).toBeTruthy();
    // Live => not disabled + exposes aria-pressed (dev-only chips omit it).
    expect(buildChip.disabled).toBe(false);
    expect(buildChip.getAttribute("aria-pressed")).not.toBeNull();

    // Selecting flips pressed state and shows the build paste placeholder (真题三件套 wording).
    fireEvent.click(buildChip);
    expect(buildChip.getAttribute("aria-pressed")).toBe("true");
    const textarea = screen.getByPlaceholderText(/真题三件套/);
    expect(textarea).toBeTruthy();
  });
});
