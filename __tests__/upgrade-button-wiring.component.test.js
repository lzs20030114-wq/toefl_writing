/**
 * 升级按钮死 bug 回归测试（HomePageClient 全局监听者 + speaking-exam 自持弹窗）。
 *
 * 背景：全项目多处「升级 Pro」按钮 dispatch 全局 open-upgrade-modal 事件，
 * 但此前 0 个监听者 → 按钮点了没反应，付费转化断掉。
 *
 * 本文件锁住路径 A（首页根组件挂唯一全局监听者：dispatch → 弹 UpgradeModal）。
 * 路径 B（独立路由 speaking-exam 自持 UpgradeModal）见 speaking-exam-upgrade.component.test.js。
 *
 * 所有 mock 用顶层 jest.mock（hoisted），不 resetModules，避免 React 实例被重置。
 */

import { render, screen, act } from "@testing-library/react";

jest.mock("../components/shared/UpgradeModal", () => ({
  __esModule: true,
  default: ({ userCode, currentTier }) => (
    <div data-testid="upgrade-modal">code={String(userCode)} tier={String(currentTier)}</div>
  ),
}));

// 重型子组件替换成空壳，隔离出监听者逻辑
jest.mock("../hooks/useIsMobile", () => ({ useIsMobile: () => false }));
jest.mock("../components/home/NavSidebar", () => ({ NavSidebar: () => null }));
jest.mock("../components/home/SectionContent", () => ({ SectionContent: () => null }));
jest.mock("../components/home/StudyPlanColumn", () => ({ StudyPlanColumn: () => null }));
jest.mock("../components/home/MobileHomePage", () => ({ MobileHomePage: () => null }));
jest.mock("../components/home/ChallengeEffects", () => ({ ChallengeEffects: () => null }));
jest.mock("../components/home/AnnouncementModal", () => ({ AnnouncementButton: () => null }));
jest.mock("../components/home/BankUpdateModal", () => ({ BankUpdateModal: () => null }));
jest.mock("../components/home/FeatureSpotlight", () => ({
  FeatureSpotlight: () => null,
  useSpotlightGate: () => ({ open: false, close: () => {} }),
}));
jest.mock("../components/home/MyReferralModal", () => ({ MyReferralModal: () => null }));
jest.mock("../components/referral/ReferralToasts", () => ({
  InvitationCapturedToast: () => null,
  ActivatedToast: () => null,
}));
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("../lib/sessionStore", () => ({
  loadHist: () => ({ sessions: [] }),
  SESSION_STORE_EVENTS: { HISTORY_UPDATED_EVENT: "history-updated" },
}));

import HomePageClient from "../components/home/HomePageClient";

describe("HomePageClient：全局 open-upgrade-modal 事件监听者", () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, sessions: [], rows: [] }) })
    );
  });
  afterEach(() => jest.restoreAllMocks());

  function renderHome(props) {
    return render(<HomePageClient {...props} />);
  }

  test("登录用户 dispatch open-upgrade-modal → 弹出 UpgradeModal（带 userCode/tier）", () => {
    renderHome({
      userCode: "HOME01", userTier: "free", userEmail: "a@b.c", authMethod: "code",
      isLoggedIn: true, showLoginModal: jest.fn(), onLogout: jest.fn(),
    });

    expect(screen.queryByTestId("upgrade-modal")).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent("open-upgrade-modal"));
    });

    const modal = screen.getByTestId("upgrade-modal");
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain("HOME01");
    expect(modal.textContent).toContain("free");
  });

  test("未登录用户 dispatch open-upgrade-modal → 走登录，不弹升级弹窗", () => {
    const showLoginModal = jest.fn();
    renderHome({
      userCode: "", userTier: "free", userEmail: "", authMethod: "",
      isLoggedIn: false, showLoginModal, onLogout: jest.fn(),
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("open-upgrade-modal"));
    });

    expect(showLoginModal).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });
});
