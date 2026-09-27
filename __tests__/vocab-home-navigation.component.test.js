import { fireEvent, render, screen } from "@testing-library/react";
import { VocabHomeNavigationProvider } from "../components/vocab/VocabHomeNavigation";
import { VocabNavItem } from "../components/vocab/VocabNavItem";
import { MobileVocabEntry } from "../components/vocab/MobileVocabEntry";

jest.mock("../components/vocab/useVocabSummary", () => ({
  useVocabSummary: () => ({ total: 12, todo: 3, ready: true }),
}));

test("桌面侧边栏和移动端导航的单词本入口使用同一个原地切换回调", () => {
  const navigate = jest.fn();
  render(
    <VocabHomeNavigationProvider navigate={navigate}>
      <VocabNavItem isChallenge={false} isActive />
      <MobileVocabEntry isChallenge={false} querySuffix="?mode=practice" />
    </VocabHomeNavigationProvider>
  );

  const links = screen.getAllByRole("link", { name: /单词本/ });
  expect(links).toHaveLength(2);
  expect(links[0]).toHaveAttribute("aria-current", "page");
  expect(links[0]).toHaveAttribute("href", "/?section=vocab");
  expect(links[1]).toHaveAttribute("href", "/?section=vocab&mode=practice");
  links.forEach((link) => fireEvent.click(link));
  expect(navigate).toHaveBeenCalledTimes(2);
});

test("首页之外的入口仍有可刷新的目标地址", () => {
  render(<VocabNavItem isChallenge={false} />);
  expect(screen.getByRole("link", { name: /单词本/ })).toHaveAttribute("href", "/?section=vocab");
});
