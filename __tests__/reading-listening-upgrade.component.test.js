/**
 * 升级按钮死 bug 回归测试 — 独立路由 reading / listening 锁定屏自持 UpgradeModal。
 *
 * app/reading/page.js 与 app/listening/page.js 是独立路由，不在 HomePageClient 树下，
 * 挂在 HomePageClient 上的全局 open-upgrade-modal 监听者到不了这里。此前它们的 Pro
 * 锁定屏只有「返回首页」，没有升级入口 → 付费转化断头路。现改为锁定屏自持 UpgradeModal：
 * 免费用户点「升级 Pro」→ 直接弹窗（带 userCode / tier）。
 *
 * mock 手法照搬 __tests__/speaking-exam-upgrade.component.test.js。
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
  getSavedCode: () => "RDG001",
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// 锁定屏在 task 组件之前 return，这些组件不会渲染；mock 掉只为避免拉入重依赖树。
jest.mock("../components/reading/CTWTask", () => ({ CTWTask: () => <div>CTW</div> }));
jest.mock("../components/reading/RDLTask", () => ({ RDLTask: () => <div>RDL</div> }));
jest.mock("../components/listening/LCRTask", () => ({ LCRTask: () => <div>LCR</div> }));
jest.mock("../components/listening/ListeningMCQTask", () => ({ ListeningMCQTask: () => <div>MCQ</div> }));
jest.mock("../components/shared/TopicPicker", () => ({ TopicPicker: () => <div>PICKER</div> }));
// 听力默认导出用 ExamAudioProvider 包裹 client；mock 成透传 children。
jest.mock("../components/shared/ExamAudioProvider", () => ({ ExamAudioProvider: ({ children }) => <>{children}</> }));

import ReadingPage from "../app/reading/page";
import ListeningPage from "../app/listening/page";

describe("阅读独立页：Pro 锁定屏自持 UpgradeModal", () => {
  test("免费用户点「升级 Pro」→ 弹出 UpgradeModal（带 userCode/tier）", async () => {
    render(<ReadingPage />);

    const btn = await screen.findByRole("button", { name: /升级 Pro/ });
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();

    fireEvent.click(btn);

    const modal = screen.getByTestId("upgrade-modal");
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain("RDG001");
    expect(modal.textContent).toContain("free");
  });
});

describe("听力独立页：Pro 锁定屏自持 UpgradeModal", () => {
  test("免费用户点「升级 Pro」→ 弹出 UpgradeModal（带 userCode/tier）", async () => {
    render(<ListeningPage />);

    const btn = await screen.findByRole("button", { name: /升级 Pro/ });
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();

    fireEvent.click(btn);

    const modal = screen.getByTestId("upgrade-modal");
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain("RDG001");
    expect(modal.textContent).toContain("free");
  });
});
