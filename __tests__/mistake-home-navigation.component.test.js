/**
 * 错题本入口（2026-10 改版）：从首页中栏三张卡挪进左侧栏 + 移动端顶部，首页内嵌 section=mistakes。
 * 照单词本入口的做法：真 <Link>，普通左键原地切换；旧地址 /mistake-notebook 服务端重定向。
 */
import fs from "fs";
import path from "path";
import { fireEvent, render, screen } from "@testing-library/react";
import { MistakeHomeNavigationProvider } from "../components/mistakes/MistakeHomeNavigation";
import { MistakeNavItem } from "../components/mistakes/MistakeNavItem";
import { MobileMistakeEntry } from "../components/mistakes/MobileMistakeEntry";

jest.mock("../components/mistakes/useMistakePool", () => ({
  useMistakeSummary: () => ({ total: 128, bySubject: { bs: 100, reading: 20, listening: 8 }, ready: true }),
}));

jest.mock("next/navigation", () => ({ redirect: jest.fn() }));

test("桌面侧栏和移动端的错题本入口共用同一个原地切换回调", () => {
  const navigate = jest.fn();
  render(
    <MistakeHomeNavigationProvider navigate={navigate}>
      <MistakeNavItem isChallenge={false} isActive />
      <MobileMistakeEntry isChallenge={false} querySuffix="?mode=practice" />
    </MistakeHomeNavigationProvider>
  );
  const links = screen.getAllByRole("link", { name: /错题本/ });
  expect(links).toHaveLength(2);
  expect(links[0]).toHaveAttribute("aria-current", "page");
  expect(links[0]).toHaveAttribute("href", "/?section=mistakes");
  expect(links[1]).toHaveAttribute("href", "/?section=mistakes&mode=practice");
  // 角标超过 99 收成 99+
  expect(links[0].textContent).toContain("99+");
  links.forEach((link) => fireEvent.click(link));
  expect(navigate).toHaveBeenCalledTimes(2);
});

test("首页之外的入口仍有可刷新的目标地址", () => {
  render(<MistakeNavItem isChallenge={false} />);
  expect(screen.getByRole("link", { name: /错题本/ })).toHaveAttribute("href", "/?section=mistakes");
});

test("旧地址 /mistake-notebook?section=reading 重定向到首页内嵌错题本并保留科目与模式", () => {
  const { redirect } = require("next/navigation");
  const Page = require("../app/mistake-notebook/page").default;
  Page({ searchParams: { section: "reading", mode: "practice" } });
  expect(redirect).toHaveBeenLastCalledWith("/?section=mistakes&sub=reading&mode=practice");
  Page({ searchParams: { section: "bogus" } });
  expect(redirect).toHaveBeenLastCalledWith("/?section=mistakes");
});

test("首页白名单收了 mistakes，侧栏挂了错题本入口，中栏旧卡已删", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  const client = read("components/home/HomePageClient.js");
  expect(client.match(/\["writing",[^\]]*\]/)[0]).toContain('"mistakes"');
  expect(client).toContain("<MistakeNotebook embedded");
  expect(read("components/home/NavSidebar.js")).toContain("<MistakeNavItem");
  const mobile = read("components/home/MobileHomePage.js");
  expect(mobile).toContain("<MobileMistakeEntry");
  expect(mobile).toContain('activeSection === "mistakes"');
  // 旧版的「我的题库」聚光灯 CTA 调了本文件不存在的 setActiveSection
  expect(mobile).not.toMatch(/\bsetActiveSection\(/);
  for (const f of ["components/home/SectionContent.js", "components/home/ReadingSectionContent.js", "components/home/ListeningSectionContent.js", "components/home/MobileHomePage.js"]) {
    expect(read(f)).not.toContain('href="/mistake-notebook');
    expect(read(f)).not.toContain("href={`/mistake-notebook");
  }
  expect(read("components/home/sections.js")).not.toMatch(/export const TOOLS/);
});
