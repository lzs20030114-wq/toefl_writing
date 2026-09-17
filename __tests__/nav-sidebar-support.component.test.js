/**
 * 首页侧栏交互回归：反馈/微信群不再在 sticky 侧栏里折叠展开，而是走弹窗；
 * 退出登录/续费/绑定邮箱收进账户「···」菜单。
 *
 * 背景：侧栏 sticky 贴顶，折叠区一展开高度超出视口就被裁掉，用户反馈「反馈都看不见了」。
 */
import { render, screen, fireEvent, act, within } from "@testing-library/react";

jest.mock("../components/shared/UpgradeModal", () => ({
  __esModule: true,
  default: () => <div data-testid="upgrade-modal" />,
}));
jest.mock("../components/shared/WechatQrImage", () => ({ WechatQrImage: () => <img alt="微信群二维码" /> }));
jest.mock("../components/vocab/VocabNavItem", () => ({ VocabNavItem: () => null }));
jest.mock("../lib/dailyUsage", () => ({ checkCanPractice: () => Promise.resolve({ remaining: 3 }), FREE_DAILY_LIMIT: 3 }));

import { NavSidebar } from "../components/home/NavSidebar";
import { FEEDBACK_SEEN_KEY } from "../lib/feedback/replySeen";

function renderSidebar(over = {}) {
  const props = {
    activeSection: "writing", onSectionChange: jest.fn(), isChallenge: false,
    userCode: "ABC123", userTier: "pro", userEmail: "", authMethod: "code",
    isLoggedIn: true, showLoginModal: jest.fn(), onLogout: jest.fn(),
    fbOpen: false, setFbOpen: jest.fn(), fbText: "", setFbText: jest.fn(),
    fbBusy: false, fbSent: false, feedbackMsg: null, submitFeedback: jest.fn(),
    fbHistory: [],
    copied: false, copyCode: jest.fn(),
    onOpenReferral: jest.fn(),
    fadeIn: () => ({}),
    ...over,
  };
  const utils = render(<NavSidebar {...props} />);
  return { ...utils, props };
}

beforeEach(() => {
  window.localStorage.removeItem(FEEDBACK_SEEN_KEY);
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ tier_expires_at: null }) }));
});

describe("NavSidebar：反馈与交流走弹窗", () => {
  test("侧栏里不再内联反馈表单 / 二维码；点入口才打开弹窗", () => {
    const { props } = renderSidebar();
    expect(screen.queryByPlaceholderText(/遇到问题|某道听力题/)).toBeNull();
    expect(screen.queryByAltText("微信群二维码")).toBeNull();
    fireEvent.click(screen.getByTestId("support-entry"));
    expect(props.setFbOpen).toHaveBeenCalledWith(true);
  });

  test("fbOpen=true 渲染弹窗，三个页签都能切到", () => {
    renderSidebar({ fbOpen: true });
    const modal = screen.getByTestId("support-modal");
    expect(modal).toBeTruthy();
    expect(screen.getByPlaceholderText(/某道听力题/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /微信群/ }));
    expect(screen.getByAltText("微信群二维码")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /反馈记录/ }));
    expect(screen.getByText("还没有反馈记录。")).toBeTruthy();
  });

  test("有作者回复且未读 → 入口显示角标；看过记录页后角标消失并持久化", () => {
    const fbHistory = [
      { id: 11, content: "音频放不出来", status: "resolved", admin_reply: "已修复", created_at: "2026-09-01T00:00:00Z" },
      { id: 12, content: "想要夜间模式", status: "open", admin_reply: null, created_at: "2026-09-02T00:00:00Z" },
    ];
    const { rerender, props } = renderSidebar({ fbHistory });
    expect(screen.getByText("作者回复了你的反馈")).toBeTruthy();

    rerender(<NavSidebar {...props} fbOpen={true} />);
    fireEvent.click(screen.getByRole("tab", { name: /反馈记录/ }));
    expect(screen.getByText(/已修复/)).toBeTruthy();

    rerender(<NavSidebar {...props} fbOpen={false} />);
    expect(screen.queryByText("作者回复了你的反馈")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(FEEDBACK_SEEN_KEY))).toEqual(["11"]);
  });

  test("未登录：弹窗反馈页签提示登录，微信群页签仍可用", () => {
    const { props } = renderSidebar({ isLoggedIn: false, userCode: "", fbOpen: true });
    const modal = screen.getByTestId("support-modal");
    fireEvent.click(within(modal).getByRole("button", { name: "登录 / 注册" }));
    expect(props.showLoginModal).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: /微信群/ }));
    expect(screen.getByAltText("微信群二维码")).toBeTruthy();
  });
});

describe("NavSidebar：账户操作收进「···」菜单", () => {
  test("退出登录不在侧栏平铺；菜单里点它才弹确认", () => {
    const { props } = renderSidebar();
    expect(screen.queryByText("退出登录")).toBeNull();
    act(() => { fireEvent.click(screen.getByTestId("account-menu-btn")); });
    const menu = screen.getByTestId("account-menu");
    expect(menu.textContent).toContain("续费 Pro");
    expect(menu.textContent).toContain("绑定邮箱");
    fireEvent.click(screen.getByRole("menuitem", { name: /退出登录/ }));
    expect(screen.getByText("确认退出登录？")).toBeTruthy();
    fireEvent.click(screen.getByText("确认退出"));
    expect(props.onLogout).toHaveBeenCalled();
  });

  test("免费用户：升级 Pro 仍平铺在账户卡上（转化入口不藏）", () => {
    renderSidebar({ userTier: "free" });
    fireEvent.click(screen.getByRole("button", { name: "升级 Pro" }));
    expect(screen.getByTestId("upgrade-modal")).toBeTruthy();
  });

  test("Pro 剩余天数多时账户卡不平铺续费；快到期才提上来", async () => {
    const soon = new Date(Date.now() + 3 * 86400000).toISOString();
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ tier_expires_at: soon }) }));
    const first = renderSidebar();
    expect(await screen.findByText(/Pro 还剩 \d+ 天 · 续费/)).toBeTruthy();
    first.unmount();

    const far = new Date(Date.now() + 200 * 86400000).toISOString();
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ tier_expires_at: far }) }));
    renderSidebar({ userCode: "XYZ789" });
    await screen.findByText(/剩余 200 天/);
    expect(screen.queryByText(/天 · 续费/)).toBeNull();
  });
});
