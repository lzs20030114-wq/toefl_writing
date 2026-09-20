// 讲评(lesson)在批改报告里的呈现。三条锁：
//   1) 有 lesson 时宏观页是「分数三行 → 本课只讲一件事 → 先改这几处语言 → 现在动手」，
//      评分那一路的短板卡降级进折叠区；
//   2) 讲评在路上/失败时只影响自己这一块（骨架 / 重试按钮），报告其余部分照常；
//   3) 没有 lesson 的旧记录（历史页）与改造前逐块一致，不渲染任何讲评占位。
import { render, screen, fireEvent } from "@testing-library/react";
import { WritingFeedbackPanel } from "../components/writing/WritingFeedbackPanel";

const BASE_FB = {
  score: 3.5,
  band: "Intermediate+",
  summary: "总评一句话",
  goals: [],
  actions: [
    { title: "短板一", importance: "会压任务完成分", action: "补一个具体后果" },
  ],
  patterns: [],
  annotationSegments: [],
  comparison: { modelEssay: "Model essay text", points: [{ index: 1, title: "旧对比点", yours: "y", model: "m", difference: "d" }] },
};

const LESSON = {
  ok: true,
  verdict: { goal: "5 分要求每个理由写到为什么最重要", now: '你写到 "A" 就停了', next: "把最后一条理由再推一层" },
  focus: {
    strategy: "理由要到「为什么最重要」这一层",
    evidence: '"Light bulbs are safer than candles." 之后直接收尾',
    missing: "缺比较：没说明安全性为何比便利更关键",
    rewrite: "Light bulbs are safer because an open flame can ignite curtains overnight.",
    transfer: "下次写作前先问自己：最后一条理由说清为什么最重要了吗",
  },
  language: [
    { quote: "it is produce high tempreture", kind: "treatable", fix: "改成 it produces" },
    { quote: "don't need to storage", kind: "untreatable", fix: "地道说法是 store" },
  ],
  compare: [
    { index: 1, dim: "立场与贡献", yours: "讲评版-你的", model: "讲评版-范文", gap: "讲评版-差在" },
  ],
  next: { task: '把 "A" 这一句展开成两句', checks: ["有没有具体后果", "有没有说明为什么更重要", "有没有因果连接"] },
};

function renderPanel(props = {}) {
  return render(
    <WritingFeedbackPanel fb={BASE_FB} type="discussion" pd={null} userText="hello" {...props} />
  );
}

describe("WritingFeedbackPanel 讲评区块", () => {
  test("有 lesson：分数卡三行 + 四段讲评 + 自查可勾选 + 短板卡进折叠区", () => {
    renderPanel({ fb: { ...BASE_FB, lesson: LESSON }, lessonState: "done" });

    // 分数卡：三行取代原来的一句话总评
    expect(screen.getByText("目标：")).toBeInTheDocument();
    expect(screen.getByText("现状：")).toBeInTheDocument();
    expect(screen.getByText("下一步：")).toBeInTheDocument();
    expect(screen.getByText("5 分要求每个理由写到为什么最重要")).toBeInTheDocument();
    expect(screen.queryByText("总评一句话")).toBeNull();

    // 本课只讲一件事：策略名 + 证据 + 缺的是 + 示范改写 + 迁移
    expect(screen.getByText("本课只讲一件事")).toBeInTheDocument();
    expect(screen.getByText(LESSON.focus.strategy)).toBeInTheDocument();
    expect(screen.getByText(LESSON.focus.evidence)).toBeInTheDocument();
    expect(screen.getByText(LESSON.focus.missing)).toBeInTheDocument();
    expect(screen.getByText("示范改写")).toBeInTheDocument();
    expect(screen.getByText(LESSON.focus.rewrite)).toBeInTheDocument();
    expect(screen.getByText(LESSON.focus.transfer)).toBeInTheDocument();

    // 先改这几处语言
    expect(screen.getByText("先改这几处语言")).toBeInTheDocument();
    expect(screen.getByText("可治")).toBeInTheDocument();
    expect(screen.getByText("不可治")).toBeInTheDocument();

    // 现在动手：任务 + 三条自查（checkbox，纯本地）
    expect(screen.getByText("现在动手")).toBeInTheDocument();
    expect(screen.getByText(LESSON.next.task)).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    expect(boxes[0].checked).toBe(false);
    fireEvent.click(boxes[0]);
    expect(boxes[0].checked).toBe(true);

    // 评分那一路的短板卡降级成折叠区
    expect(screen.getByText("评分时给出的短板卡")).toBeInTheDocument();
    expect(screen.queryByText("结构与语域优化建议")).toBeNull();
  });

  test("有 lesson.compare：范文对比页用讲评版对比点", () => {
    renderPanel({ fb: { ...BASE_FB, lesson: LESSON }, lessonState: "done" });
    fireEvent.click(screen.getByText("范文对比分析"));
    expect(screen.getByText("核心差异分析")).toBeInTheDocument();
    expect(screen.getByText("1. 立场与贡献")).toBeInTheDocument();
    expect(screen.getByText("讲评版-差在")).toBeInTheDocument();
    expect(screen.queryByText("1. 旧对比点")).toBeNull();
    // 范文正文本身不变
    expect(screen.getByText("AI 参考范文 · 众多可行写法之一")).toBeInTheDocument();
  });

  test("lesson.compare 为空时回落到评分报告的对比点", () => {
    renderPanel({ fb: { ...BASE_FB, lesson: { ...LESSON, compare: [] } }, lessonState: "done" });
    fireEvent.click(screen.getByText("范文对比分析"));
    expect(screen.getByText("1. 旧对比点")).toBeInTheDocument();
  });

  test("loading：骨架卡 + 文案，报告其余部分照常", () => {
    renderPanel({ lessonState: "loading" });
    expect(screen.getByText("本课只讲一件事")).toBeInTheDocument();
    expect(screen.getByText("讲评生成中，约 30 秒，可以先看逐句批注")).toBeInTheDocument();
    // 没有 verdict 时分数卡仍显示原来的一句话总评
    expect(screen.getByText("总评一句话")).toBeInTheDocument();
    // 短板卡还是原样展开
    expect(screen.getByText("结构与语域优化建议")).toBeInTheDocument();
  });

  test("error：一行失败提示 + 重新生成讲评按钮", () => {
    const onRetryLesson = jest.fn();
    renderPanel({ lessonState: "error", onRetryLesson });
    expect(screen.getByText("讲评生成失败")).toBeInTheDocument();
    fireEvent.click(screen.getByText("重新生成讲评"));
    expect(onRetryLesson).toHaveBeenCalledTimes(1);
  });

  test("历史记录（无 lessonState 也无 lesson）：不渲染任何讲评占位，布局与改造前一致", () => {
    renderPanel();
    expect(screen.queryByText("本课只讲一件事")).toBeNull();
    expect(screen.queryByText("讲评生成中，约 30 秒，可以先看逐句批注")).toBeNull();
    expect(screen.queryByText("讲评生成失败")).toBeNull();
    expect(screen.queryByText("先改这几处语言")).toBeNull();
    expect(screen.queryByText("现在动手")).toBeNull();
    expect(screen.queryByText("评分时给出的短板卡")).toBeNull();
    expect(screen.getByText("总评一句话")).toBeInTheDocument();
    expect(screen.getByText("结构与语域优化建议")).toBeInTheDocument();
    expect(screen.getByText("短板一")).toBeInTheDocument();
  });
});
