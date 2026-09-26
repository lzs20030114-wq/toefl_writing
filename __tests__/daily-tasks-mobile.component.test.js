import { render, screen, fireEvent } from "@testing-library/react";
import { DailyTasksCard, DAILY_TASKS_MOBILE_OPEN_KEY } from "../components/home/DailyTasksCard";

/**
 * 今日任务卡 · 手机端紧凑变体（variant="mobile"）。
 * 桌面变体的数据口径由 __tests__/daily-tasks.test.js 覆盖，这里只锁「紧凑壳」的行为：
 * 空态细行 / 默认收起 / 头部 n-m / 点头部展开 / 展开状态落 localStorage。
 */

const TASK_KEY = "toefl-daily-tasks::user:U1";
const NOW = new Date(2026, 8, 16, 14, 0, 0); // 周三，与纯函数测试同一锚点
const todayISO = new Date(2026, 8, 16, 10, 0, 0).toISOString();

function seedTasks(tasks) {
  localStorage.setItem(TASK_KEY, JSON.stringify({ tasks, updatedAt: "x" }));
}

const baseProps = { variant: "mobile", userCode: "U1", isChallenge: false, now: NOW };

describe("DailyTasksCard · 手机端紧凑变体", () => {
  beforeEach(() => { localStorage.clear(); });

  test("没有任务时只渲染一条「设置」细行，不出现桌面大空态", () => {
    render(<DailyTasksCard {...baseProps} sessions={[]} />);
    expect(screen.getByText("给自己定个每日任务")).toBeTruthy();
    expect(screen.getByText("设置 ›")).toBeTruthy();
    expect(screen.queryByText("今日任务")).toBeNull();
    expect(screen.queryByText("设置每日任务")).toBeNull(); // 桌面空态按钮
  });

  test("点空态细行打开编辑弹窗", () => {
    render(<DailyTasksCard {...baseProps} sessions={[]} />);
    fireEvent.click(screen.getByText("给自己定个每日任务"));
    expect(screen.getByText("设置每日任务")).toBeTruthy(); // 弹窗标题
  });

  test("有任务时默认收起，头部显示 已达标/应练 数字", () => {
    seedTasks([
      { keys: ["bs"], target: 1, freq: "daily" },
      { keys: ["ctw"], target: 1, freq: "daily" },
    ]);
    const sessions = [{ type: "bs", date: todayISO, details: [{ qid: "bs_1" }] }];
    const { container } = render(<DailyTasksCard {...baseProps} sessions={sessions} />);

    expect(screen.getByText("今日任务")).toBeTruthy();
    expect(screen.getByText("1/2")).toBeTruthy();

    // 收起态：展开容器的 grid 行高为 0fr（内容存在但不占高）
    const collapsible = container.querySelector('[style*="grid-template-rows: 0fr"]');
    expect(collapsible).toBeTruthy();
    expect(screen.getByRole("button", { expanded: false })).toBeTruthy();
  });

  test("点头部展开后能看到任务名与「编辑任务」按钮，并写入 localStorage", () => {
    seedTasks([{ keys: ["bs"], target: 2, freq: "daily" }]);
    const { container } = render(<DailyTasksCard {...baseProps} sessions={[]} />);

    fireEvent.click(screen.getByText("今日任务"));

    expect(screen.getByText("拖拽造句")).toBeTruthy();
    expect(screen.getByText("编辑任务")).toBeTruthy();
    expect(container.querySelector('[style*="grid-template-rows: 1fr"]')).toBeTruthy();
    expect(localStorage.getItem(DAILY_TASKS_MOBILE_OPEN_KEY)).toBe("1");

    // 再点一次收起，状态也落盘
    fireEvent.click(screen.getByText("今日任务"));
    expect(localStorage.getItem(DAILY_TASKS_MOBILE_OPEN_KEY)).toBe("0");
  });

  test("localStorage 记着展开 → 进来就是展开态", () => {
    seedTasks([{ keys: ["bs"], target: 1, freq: "daily" }]);
    localStorage.setItem(DAILY_TASKS_MOBILE_OPEN_KEY, "1");
    const { container } = render(<DailyTasksCard {...baseProps} sessions={[]} />);
    expect(container.querySelector('[style*="grid-template-rows: 1fr"]')).toBeTruthy();
    expect(screen.getByRole("button", { expanded: true })).toBeTruthy();
  });

  test("全部达标 → 头部数字变绿态；全部休息 → 显示「休息日」", () => {
    seedTasks([{ keys: ["bs"], target: 1, freq: "daily" }]);
    const done = [{ type: "bs", date: todayISO, details: [] }];
    const { unmount } = render(<DailyTasksCard {...baseProps} sessions={done} />);
    // 「1/1」在头部与（收起但仍在 DOM 里的）任务行各出现一次
    expect(screen.getAllByText("1/1").length).toBeGreaterThanOrEqual(1);
    unmount();

    // 隔天任务：昨天已达标 + 今天没练 → 全休息
    seedTasks([{ keys: ["bs"], target: 1, freq: "alternate" }]);
    const yesterday = [{ type: "bs", date: new Date(2026, 8, 15, 10, 0, 0).toISOString(), details: [] }];
    render(<DailyTasksCard {...baseProps} sessions={yesterday} />);
    expect(screen.getByText("休息日")).toBeTruthy();
  });

  test("展开后点「编辑任务」打开同一个编辑弹窗", () => {
    seedTasks([{ keys: ["bs"], target: 1, freq: "daily" }]);
    localStorage.setItem(DAILY_TASKS_MOBILE_OPEN_KEY, "1");
    render(<DailyTasksCard {...baseProps} sessions={[]} />);
    fireEvent.click(screen.getByText("编辑任务"));
    expect(screen.getByText("设置每日任务")).toBeTruthy();
    expect(screen.getByText("+ 添加任务")).toBeTruthy();
  });
});
