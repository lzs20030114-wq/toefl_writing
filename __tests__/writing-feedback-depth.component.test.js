// 锁住 2026-09-19「批改报告代码层改造」的三件事：三维度理由被渲染、===ERRORS===
// 分级被渲染、范文标签不再自称官方 5 分范文。老记录（无 rubric / errorTriage）
// 两块都不渲染。
import { render, screen, fireEvent } from "@testing-library/react";
import { WritingFeedbackPanel } from "../components/writing/WritingFeedbackPanel";

const FB = {
  score: 3.5,
  band: "Intermediate+",
  summary: "总评内容",
  rubric: {
    dimensions: {
      task_fulfillment: { score: 5, reason: "三个目标均完成且有细节", definition: "How fully..." },
      organization_coherence: { score: 4.5, reason: "结构清晰衔接自然" },
      language_use: { score: 3.5, reason: "" },
    },
  },
  errorTriage: {
    capped: [{ quote: "the radiators is still cold", issue: "主谓一致反复出错", impedes: false, systemic: true }],
    minorSummary: "约 6-8 处拼写小错",
    verdict: "语言使用维度定为 3.5。",
  },
  goals: [],
  actions: [],
  patterns: [],
  annotationSegments: [],
  comparison: { modelEssay: "Dear Professor, ...", points: [] },
};

test("renders the three rubric dimensions, the ERRORS triage block and an honest sample label", () => {
  render(<WritingFeedbackPanel fb={FB} type="discussion" pd={null} userText="hello" />);
  expect(screen.getByText("任务完成")).toBeInTheDocument();
  expect(screen.getByText("三个目标均完成且有细节")).toBeInTheDocument();
  expect(screen.queryByText(/How fully/)).toBeNull();
  fireEvent.click(screen.getByText("逐句批注大纲"));
  expect(screen.getByText("影响分数的错误")).toBeInTheDocument();
  expect(screen.getByText("系统性失控")).toBeInTheDocument();
  expect(screen.getByText(/不压分的限时小错：约 6-8 处拼写小错/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("范文对比分析"));
  expect(screen.getByText("AI 参考范文 · 众多可行写法之一")).toBeInTheDocument();
  expect(screen.queryByText(/Official Band/)).toBeNull();
});

test("legacy records without rubric / errorTriage render neither block", () => {
  render(<WritingFeedbackPanel fb={{ score: 4, summary: "x", annotationSegments: [] }} type="discussion" pd={null} userText="hello" />);
  expect(screen.queryByText("任务完成")).toBeNull();
  fireEvent.click(screen.getByText("逐句批注大纲"));
  expect(screen.queryByText("影响分数的错误")).toBeNull();
  expect(screen.getByText("暂无逐句批注数据。")).toBeInTheDocument();
});
