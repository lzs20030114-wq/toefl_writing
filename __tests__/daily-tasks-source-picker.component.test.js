import { fireEvent, render, screen } from "@testing-library/react";
import { DailyTasksCard } from "../components/home/DailyTasksCard";

const NOW = new Date(2026, 8, 26, 12);
const TASK_KEY = "toefl-daily-tasks::user:U1";
const props = {
  userCode: "U1", isChallenge: false, sessions: [], now: NOW,
  modernCard: () => ({}), fadeIn: () => ({}),
};

function seed(tasks) {
  localStorage.setItem(TASK_KEY, JSON.stringify({ tasks, updatedAt: "x" }));
}

beforeEach(() => localStorage.clear());

test("桌面任务先选择来源，再分别进入对应的常规练习与真题题型", () => {
  seed([{ keys: ["ctw"], target: 1, freq: "daily" }]);
  render(<DailyTasksCard {...props} />);

  fireEvent.click(screen.getAllByRole("button", { name: "展开今日任务" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "选择阅读填词的题目来源" }));

  expect(screen.getByRole("dialog", { name: "练习阅读填词" })).toBeTruthy();
  expect(screen.getByRole("link", { name: /AI出题/ }).getAttribute("href")).toBe("/reading?type=ctw");
  expect(screen.getByRole("link", { name: /真题专区/ }).getAttribute("href")).toBe("/real-bank?type=ctw");

  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("任选其一点哪个题型，就打开该题型的真题", () => {
  seed([{ keys: ["email", "discussion"], target: 1, freq: "daily" }]);
  render(<DailyTasksCard {...props} />);

  fireEvent.click(screen.getAllByRole("button", { name: "展开今日任务" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "选择学术讨论的题目来源" }));
  expect(screen.getByRole("link", { name: /真题专区/ }).getAttribute("href")).toBe("/real-bank?type=discussion");
});

test("模考的真题选项进入真题专区选题页", () => {
  seed([{ keys: ["mock"], target: 1, freq: "daily" }]);
  render(<DailyTasksCard {...props} />);

  fireEvent.click(screen.getAllByRole("button", { name: "展开今日任务" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "选择模考（任意科目）的题目来源" }));
  expect(screen.getByRole("link", { name: /真题专区/ }).getAttribute("href")).toBe("/?section=real-bank");
});

test("手机端展开任务后也先选择来源", () => {
  seed([{ keys: ["bs"], target: 1, freq: "daily" }]);
  render(<DailyTasksCard {...props} variant="mobile" />);

  fireEvent.click(screen.getByText("今日任务"));
  fireEvent.click(screen.getByRole("button", { name: "选择拖拽造句的题目来源" }));
  expect(screen.getByRole("link", { name: /AI出题/ }).getAttribute("href")).toBe("/build-sentence");
  expect(screen.getByRole("link", { name: /真题专区/ }).getAttribute("href")).toBe("/real-bank?type=bs");
});
