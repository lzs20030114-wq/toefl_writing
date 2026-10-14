import { render, fireEvent } from "@testing-library/react";
import MyBankPage from "../app/my-bank/page";
import { SECTIONS } from "../components/home/sections";
import { MobileHomePage } from "../components/home/MobileHomePage";
import fs from "fs";
import path from "path";

jest.mock("../components/home/HomePageClient", () => ({ PromoBanner: () => null }));
jest.mock("../components/home/DailyTasksCard", () => ({ DailyTasksCard: () => null }));
jest.mock("../components/vocab/MobileVocabEntry", () => ({ MobileVocabEntry: () => null }));
jest.mock("../components/mistakes/MobileMistakeEntry", () => ({ MobileMistakeEntry: () => null }));
const mockRedirect = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (...args) => mockRedirect(...args) }));

test("旧个人题库地址重定向回首页，不挂载导入器", () => {
  expect(MyBankPage()).toBeUndefined();
  expect(mockRedirect).toHaveBeenCalledWith("/");
});

test("桌面和移动端共用导航不再注册个人题库，其余五科入口保留", () => {
  expect(SECTIONS.map(({ id }) => id)).toEqual(["writing", "reading", "listening", "speaking", "real-bank"]);
  for (const name of ["HomePageClient", "MobileHomePage", "SectionContent"]) {
    const src = fs.readFileSync(path.join(__dirname, "../components/home", `${name}.js`), "utf8");
    expect(src).not.toMatch(/MyBankImporter|MyBankSectionContent|bankSpotlight|MobileMyBankSection/);
  }
});

 test("移动端真实首页仅呈现保留的五个 tab，仍能切换科目", () => {
  const onSectionChange = jest.fn();
  const { container } = render(<MobileHomePage
    activeSection="writing" onSectionChange={onSectionChange} isChallenge={false} isPractice={false}
    mode="standard" switchMode={jest.fn()} gridItems={[]} postWritingCounts={{ total: 0 }}
    sessions={[]} fbHistory={[]} fadeIn={() => ({})} querySuffix="" showLoginModal={jest.fn()}
    userTier="free" isLoggedIn={false} onOpenReferral={jest.fn()}
  />);
  expect(container.querySelector('[data-section-id="my-bank"]')).toBeNull();
  expect(container.textContent).not.toMatch(/My Bank|我的题库|粘贴文字|上传题目截图/);
  for (const id of ["writing", "reading", "listening", "speaking", "real-bank"]) {
    fireEvent.click(container.querySelector(`[data-section-id="${id}"]`));
    expect(onSectionChange).toHaveBeenLastCalledWith(id);
  }
});
