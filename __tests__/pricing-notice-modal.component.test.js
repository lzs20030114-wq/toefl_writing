/**
 * 进站公告弹窗「Pro 服务与价格调整」— 展示逻辑 + 登录态自持 UpgradeModal 回归测试。
 *
 * PricingNoticeModal 全站挂载在 app/layout.js。它自带展示门（dismiss / 过期 / kill switch）
 * 与页内自持 UpgradeModal（严禁 dispatch 全局 open-upgrade-modal——挂载点不在 HomePageClient
 * 树下，那是历史死按钮的根源）。mock 手法照搬 __tests__/reading-listening-upgrade.component.test.js。
 */

import { render, screen, fireEvent } from "@testing-library/react";

// UpgradeModal mock：渲染带 userCode / tier 的探针，避免拉入 qrcode/portal 依赖树。
jest.mock("../components/shared/UpgradeModal", () => ({
  __esModule: true,
  default: ({ userCode, currentTier }) => (
    <div data-testid="upgrade-modal">code={String(userCode)} tier={String(currentTier)}</div>
  ),
}));

// AuthContext mock：可变，逐测试改登录态。
let mockCode = "";
let mockTier = "free";
jest.mock("../lib/AuthContext", () => ({
  getSavedCode: () => mockCode,
  getSavedTier: () => mockTier,
}));

import PricingNoticeModal from "../components/pricing/PricingNoticeModal";

const DISMISS_KEY = "pricing_notice_20260801_dismissed";
const IN_WINDOW = new Date("2026-07-20T10:00:00+08:00"); // 窗口内
const AFTER_EXPIRY = new Date("2026-08-02T00:30:00+08:00"); // 过期后

beforeEach(() => {
  localStorage.clear();
  mockCode = "";
  mockTier = "free";
});

describe("PricingNoticeModal 展示逻辑", () => {
  test("未 dismiss + 未过期 → 弹窗渲染，含「8 月 1 日」与「¥59.90」", () => {
    render(<PricingNoticeModal now={IN_WINDOW} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("8 月 1 日");
    expect(dialog.textContent).toContain("¥59.90");
  });

  test("点「知道了」→ 弹窗消失且 localStorage 写入 dismiss", () => {
    render(<PricingNoticeModal now={IN_WINDOW} />);
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "知道了" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  test("已 dismiss → 不渲染", () => {
    localStorage.setItem(DISMISS_KEY, "1");
    render(<PricingNoticeModal now={IN_WINDOW} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("过期（2026-08-02 后）→ 不渲染", () => {
    render(<PricingNoticeModal now={AFTER_EXPIRY} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("未登录（getSavedCode 为空）→ 不显示「按现价购买 / 续费」次按钮", () => {
    render(<PricingNoticeModal now={IN_WINDOW} />);
    expect(screen.queryByRole("button", { name: /按现价购买/ })).toBeNull();
  });
});

describe("PricingNoticeModal 登录态自持 UpgradeModal", () => {
  test("登录态点「按现价购买 / 续费」→ 弹出 UpgradeModal（带 userCode/tier），公告收起", () => {
    mockCode = "ABC123";
    mockTier = "pro";
    render(<PricingNoticeModal now={IN_WINDOW} />);

    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
    const buyBtn = screen.getByRole("button", { name: /按现价购买/ });

    fireEvent.click(buyBtn);

    const modal = screen.getByTestId("upgrade-modal");
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain("ABC123");
    expect(modal.textContent).toContain("pro");
    // 公告先收起
    expect(screen.queryByRole("dialog")).toBeNull();
    // 已触达 → 写 dismiss
    expect(localStorage.getItem(DISMISS_KEY)).toBe("1");
  });
});
