import { render, screen, fireEvent } from "@testing-library/react";
import MyBankImporter from "../components/userBank/MyBankImporter";

// MyBankImporter: the 日常阅读 (RDL) + 学术短文 (AP) cards are now live and selectable.
// Mirrors __tests__/my-bank-build-card.component.test.js conventions.
describe("MyBankImporter reading cards", () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items: [] }) })
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("日常阅读 card renders live (not 开发中) and is selectable", () => {
    render(<MyBankImporter code="ABC123" tier="pro" />);

    const rdlChip = screen.getByText("日常阅读").closest("button");
    expect(rdlChip).toBeTruthy();
    // Live => not disabled + exposes aria-pressed (dev-only chips omit it).
    expect(rdlChip.disabled).toBe(false);
    expect(rdlChip.getAttribute("aria-pressed")).not.toBeNull();

    fireEvent.click(rdlChip);
    expect(rdlChip.getAttribute("aria-pressed")).toBe("true");
    // 答案可缺 → AI 代解的引导文案（placeholder 引导贴"文+题"，不做"只给文章 AI 出题"）。
    const textarea = screen.getByPlaceholderText(/日常阅读材料.*AI 会代解/);
    expect(textarea).toBeTruthy();
  });

  test("学术短文 card renders live and is selectable, placeholder asks to keep paragraph breaks", () => {
    render(<MyBankImporter code="ABC123" tier="pro" />);

    const apChip = screen.getByText("学术短文").closest("button");
    expect(apChip).toBeTruthy();
    expect(apChip.disabled).toBe(false);
    expect(apChip.getAttribute("aria-pressed")).not.toBeNull();

    fireEvent.click(apChip);
    expect(apChip.getAttribute("aria-pressed")).toBe("true");
    const textarea = screen.getByPlaceholderText(/学术短文全文.*保留空行/);
    expect(textarea).toBeTruthy();
  });

  test("单词补全 (CTW) remains 开发中 (research verdict: 阅读只上 RDL+AP 这一批)", () => {
    render(<MyBankImporter code="ABC123" tier="pro" />);
    const ctwChip = screen.getByText("单词补全").closest("button");
    expect(ctwChip.disabled).toBe(true);
  });
});
