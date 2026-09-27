import { fireEvent, render, screen } from "@testing-library/react";
import { VocabHomeNavigationProvider } from "../components/vocab/VocabHomeNavigation";
import { VocabNavItem } from "../components/vocab/VocabNavItem";
import { VocabLinkCard } from "../components/vocab/VocabLinkCard";
import { MobileVocabEntry } from "../components/vocab/MobileVocabEntry";

jest.mock("../components/vocab/useVocabSummary", () => ({
  useVocabSummary: () => ({ total: 12, todo: 3, ready: true }),
}));

test("首页三个单词本入口使用同一个原地切换回调", () => {
  const navigate = jest.fn();
  render(
    <VocabHomeNavigationProvider navigate={navigate}>
      <VocabNavItem isChallenge={false} isActive />
      <VocabLinkCard hoverKey="" setHoverKey={() => {}} isChallenge={false} />
      <MobileVocabEntry isChallenge={false} querySuffix="?mode=practice" />
    </VocabHomeNavigationProvider>
  );

  const links = screen.getAllByRole("link", { name: /单词本/ });
  expect(links).toHaveLength(3);
  expect(links[0]).toHaveAttribute("aria-current", "page");
  expect(links[0]).toHaveAttribute("href", "/?section=vocab");
  expect(links[2]).toHaveAttribute("href", "/?section=vocab&mode=practice");
  links.forEach((link) => fireEvent.click(link));
  expect(navigate).toHaveBeenCalledTimes(3);
});

test("首页之外的入口仍有可刷新的目标地址", () => {
  render(<VocabNavItem isChallenge={false} />);
  expect(screen.getByRole("link", { name: /单词本/ })).toHaveAttribute("href", "/?section=vocab");
});
