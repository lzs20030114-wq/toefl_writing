import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ListeningResultReview } from "../components/listening/ListeningResultReview";

jest.mock("../lib/AuthContext", () => ({ getSavedCode: () => null, getSavedTier: () => "free" }));
jest.mock("../components/listening/AudioPlayer", () => ({
  AudioPlayer: require("react").forwardRef(({ text, playbackRateControl }, ref) => <div data-testid="review-audio" data-rate-control={String(playbackRateControl)}>{text}</div>),
}));
const questions = [0, 1].map((i) => ({ stem: `Question ${i}`, options: { A: `Answer ${i}`, B: `Wrong ${i}` }, answer: "A" }));
const mixed = [{ selected: null, correct: "A", isCorrect: false }, { selected: "A", correct: "A", isCorrect: true }];

test.each(["lc", "la", "lat"])("%s交卷复盘保留原文重听/倍速，未答归错题，筛选折叠使用原下标", (subtype) => {
  const item = { id: subtype, questions, announcement: "Announcement source.", lecture: "Lecture source.", conversation: [{ speaker: "Woman", text: "Conversation source." }] };
  render(<ListeningResultReview subtype={subtype} results={mixed} item={item} />);
  expect(screen.getByTestId("mcq-context")).toBeInTheDocument();
  expect(screen.getByTestId("review-audio")).toHaveAttribute("data-rate-control", "true");
  expect(screen.getByRole("button", { name: /Q1/ })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: /Q2/ })).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(screen.getByRole("button", { name: "答对 1" }));
  expect(screen.queryByRole("button", { name: /Q1/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "全部展开" }));
  expect(screen.getByText("Answer 1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "全部收起" }));
  expect(screen.queryByText("Answer 1")).not.toBeInTheDocument();
});

test("LCR全对默认展开首题，每题单独重听，错题筛选为空", () => {
  const items = questions.map((q, i) => ({ ...q, id: `lcr-${i}`, speaker: `Speaker ${i}.` }));
  render(<ListeningResultReview subtype="lcr" items={items} results={items.map(() => ({ selected: "A", correct: "A", isCorrect: true }))} />);
  expect(screen.queryByTestId("mcq-context")).not.toBeInTheDocument();
  expect(screen.getByTestId("review-audio")).toHaveTextContent("Speaker 0.");
  fireEvent.click(screen.getByRole("button", { name: "错题 0" }));
  expect(screen.getByText("没有错题。")).toBeInTheDocument();
});
