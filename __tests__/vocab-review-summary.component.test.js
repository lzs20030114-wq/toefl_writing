import { render, screen } from "@testing-library/react";
import ReviewSummary from "../components/vocab/ReviewSummary";

const summary = { duration: "1 分", words: 1, asks: 1, good: 1, again: 0, firstRate: 100, firstGood: 1, lost: [], changes: null };
test("复习小结双轨预测以任务计，单轨默认保留词数措辞", () => {
  const view = render(<ReviewSummary summary={summary} tomorrow={{ n: 2, carried: 1, unit: "项" }} />);
  expect(screen.getByText("明天预计 2 项")).toBeInTheDocument();
  expect(screen.getByText("含今天顺延的 1 项到期复习")).toBeInTheDocument();
  view.rerender(<ReviewSummary summary={summary} tomorrow={{ n: 2, carried: 1 }} />);
  expect(screen.getByText("明天预计 2 词")).toBeInTheDocument();
  expect(screen.getByText("含今天顺延的 1 个到期词")).toBeInTheDocument();
});
