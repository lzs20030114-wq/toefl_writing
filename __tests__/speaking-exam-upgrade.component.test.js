/**
 * 升级按钮死 bug 回归测试 — 路径 B：独立路由 speaking-exam 自持 UpgradeModal。
 *
 * speaking-exam/page.js 是独立路由，不在首页根组件下，挂在 HomePageClient 上的
 * 全局 open-upgrade-modal 监听者到不了这里。此前它 dispatch 死事件 → 点了没反应。
 * 现改为自持 UpgradeModal：免费用户点「升级 Pro」→ 直接弹窗。
 */

import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("../components/shared/UpgradeModal", () => ({
  __esModule: true,
  default: ({ userCode, currentTier }) => (
    <div data-testid="upgrade-modal">code={String(userCode)} tier={String(currentTier)}</div>
  ),
}));

// 免费用户 → 命中 Pro gate，显示「升级 Pro」按钮
jest.mock("../lib/AuthContext", () => ({
  getSavedTier: () => "free",
  getSavedCode: () => "SPK001",
}));
jest.mock("../components/mockExam/SpeakingExamShell", () => ({
  SpeakingExamShell: () => <div>SHELL</div>,
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import SpeakingExamPage from "../app/speaking-exam/page";

describe("speaking-exam 独立页：自持 UpgradeModal", () => {
  test("免费用户点「升级 Pro」→ 弹出 UpgradeModal（带 userCode/tier）", async () => {
    render(<SpeakingExamPage />);

    const btn = await screen.findByRole("button", { name: /升级 Pro/ });
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();

    fireEvent.click(btn);

    const modal = screen.getByTestId("upgrade-modal");
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain("SPK001");
    expect(modal.textContent).toContain("free");
  });
});
