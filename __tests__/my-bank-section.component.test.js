import { render, screen } from "@testing-library/react";
import { MyBankSectionContent } from "../components/home/MyBankSectionContent";

// Regression: a logged-in user must see the importer, NOT the login gate.
// The original bug was HomePageClient not forwarding userCode to <SectionContent>,
// so the panel computed code="" and showed 「请先登录」 even when logged in.
// This locks the panel contract: given isLoggedIn + a code, render the importer.
describe("MyBankSectionContent gating", () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items: [] }) })
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const baseProps = { isChallenge: false, fadeIn: () => ({}), showLoginModal: () => {} };

  test("logged-in user with a code sees the importer, not the login gate", async () => {
    render(<MyBankSectionContent {...baseProps} userCode="TEST12" userTier="legacy" isLoggedIn={true} />);
    expect(await screen.findByText("AI 抽取题目")).toBeTruthy();
    expect(screen.getByText("学术讨论")).toBeTruthy();
    expect(screen.getByText("点击选择或拖入图片")).toBeTruthy();
    expect(screen.queryByText("请先登录")).toBeNull();
  });

  test("logged-out shows the login gate, not the importer", () => {
    render(<MyBankSectionContent {...baseProps} userCode="" userTier="free" isLoggedIn={false} />);
    expect(screen.getByText("请先登录")).toBeTruthy();
    expect(screen.queryByText("AI 抽取题目")).toBeNull();
  });

  test("logged-in but userCode missing (the exact bug) → gate, proving code must be threaded", () => {
    // isLoggedIn true but userCode undefined (what a missing prop looks like) → gate.
    render(<MyBankSectionContent {...baseProps} userCode={undefined} userTier="legacy" isLoggedIn={true} />);
    expect(screen.getByText("请先登录")).toBeTruthy();
  });
});
