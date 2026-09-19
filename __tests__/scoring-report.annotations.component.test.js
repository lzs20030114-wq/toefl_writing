import { fireEvent, render, screen } from "@testing-library/react";
import { ScoringReport } from "../components/writing/ScoringReport";

describe("ScoringReport redesigned layout", () => {
  test("renders score card, goals, and action cards", () => {
    const result = {
      score: 4,
      band: 4.5,
      summary: "三个目标完成了，但礼貌语域不足。",
      goals: [
        { index: 1, status: "OK", reason: "说明了写信目的" },
        { index: 2, status: "PARTIAL", reason: "请求细节不完整" },
        { index: 3, status: "MISSING", reason: "未说明截止时间" },
      ],
      actions: [
        {
          title: "邮件语域偏口语化",
          importance: "语域不当会拉低任务完成度。",
          action: "下次至少使用 3 个礼貌句型：I would appreciate it if... / Could you kindly... / I look forward to hearing from you.",
        },
      ],
      annotationCounts: { red: 1, orange: 2, blue: 1 },
      annotationSegments: [{ type: "text", text: "plain" }],
      patterns: [{ tag: "礼貌用语缺失", count: 2, summary: "正式礼貌表达不足" }],
      comparison: { modelEssay: "model", points: [] },
      sectionStates: {
        ACTION: { ok: true },
        ANNOTATION: { ok: true },
        PATTERNS: { ok: true },
        COMPARISON: { ok: true },
      },
    };

    render(<ScoringReport result={result} type="email" />);
    expect(screen.getByTestId("score-panel")).toBeInTheDocument();
    expect(screen.getByText("/ 5")).toBeInTheDocument();
    expect(screen.getByText("4.5")).toBeInTheDocument();
    expect(screen.getByText(/目标1：/)).toBeInTheDocument();
    expect(screen.getByText(/薄弱点修改建议/)).toBeInTheDocument();
    expect(screen.getByText(/现在可做的/)).toBeInTheDocument();
  });

  test("shows fallback message when a section fails", () => {
    const result = {
      score: 3,
      band: 3.5,
      summary: "总评",
      actions: [],
      annotationCounts: { red: 0, orange: 0, blue: 0 },
      annotationSegments: [],
      patterns: [],
      comparison: { modelEssay: "", points: [] },
      sectionStates: {
        ACTION: { ok: false },
        ANNOTATION: { ok: false },
        PATTERNS: { ok: false },
        COMPARISON: { ok: false },
      },
    };

    render(<ScoringReport result={result} type="discussion" />);
    expect(screen.getAllByText("此部分暂时无法加载").length).toBeGreaterThan(0);
  });

  test("one failed section does not block other sections", () => {
    const result = {
      score: 4,
      band: 4.5,
      summary: "总评",
      actions: [],
      annotationCounts: { red: 1, orange: 0, blue: 0 },
      annotationSegments: [
        { type: "text", text: "Dear Editor, " },
        { type: "mark", text: "I am a subscriber of", level: "red", fix: "I am a subscriber to", note: "介词搭配错误" },
      ],
      patterns: [{ tag: "介词搭配", count: 1, summary: "固定搭配错误" }],
      comparison: { modelEssay: "sample", points: [] },
      sectionStates: {
        ACTION: { ok: false },
        ANNOTATION: { ok: true },
        PATTERNS: { ok: true },
        COMPARISON: { ok: true },
      },
    };

    render(<ScoringReport result={result} type="email" />);
    expect(screen.getByText("此部分暂时无法加载")).toBeInTheDocument();
    // Expand collapsed disclosure sections to access their content
    fireEvent.click(screen.getByText("逐句批注").closest("button"));
    expect(screen.getByRole("button", { name: "I am a subscriber of" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("模式总结").closest("button"));
    expect(screen.getByText("介词搭配")).toBeInTheDocument();
  });

  test("renders the three rubric dimensions with their one-line reasons", () => {
    const result = {
      score: 4.5,
      band: 4.5,
      summary: "总评",
      rubric: {
        dimensions: {
          task_fulfillment: { score: 5, reason: "三个目标均完成且有细节" },
          organization_coherence: { score: 4.5, reason: "结构清晰衔接自然" },
          language_use: { score: 3.5, reason: "" },
        },
      },
      actions: [],
      annotationCounts: { red: 0, orange: 0, blue: 0 },
      annotationSegments: [],
      patterns: [],
      comparison: { modelEssay: "", points: [] },
      sectionStates: {},
    };
    render(<ScoringReport result={result} type="discussion" />);
    expect(screen.getByText("任务完成")).toBeInTheDocument();
    expect(screen.getByText("组织连贯")).toBeInTheDocument();
    expect(screen.getByText("语言使用")).toBeInTheDocument();
    expect(screen.getByText("三个目标均完成且有细节")).toBeInTheDocument();
    expect(screen.getByText("结构清晰衔接自然")).toBeInTheDocument();
    // 英文 definition / note 不渲染
    expect(screen.queryByText(/How fully and accurately/)).toBeNull();
  });

  test("renders the ===ERRORS=== triage block with impede / systemic tags", () => {
    const result = {
      score: 3.5,
      band: 3.5,
      summary: "总评",
      errorTriage: {
        capped: [
          { quote: "the radiators is still cold", issue: "主谓一致反复出错", impedes: false, systemic: true },
          { quote: "I have trouble to concentrate", issue: "动词搭配错误", impedes: true, systemic: false },
        ],
        minorSummary: "约 6-8 处拼写小错",
        verdict: "语言使用维度定为 3.5。",
      },
      actions: [],
      annotationCounts: { red: 0, orange: 0, blue: 0 },
      annotationSegments: [],
      patterns: [],
      comparison: { modelEssay: "", points: [] },
      sectionStates: {},
    };
    render(<ScoringReport result={result} type="discussion" />);
    expect(screen.getByText("影响分数的错误")).toBeInTheDocument();
    expect(screen.getByText("the radiators is still cold")).toBeInTheDocument();
    expect(screen.getByText("妨碍理解")).toBeInTheDocument();
    expect(screen.getByText("系统性失控")).toBeInTheDocument();
    expect(screen.getByText(/不压分的限时小错：约 6-8 处拼写小错/)).toBeInTheDocument();
    expect(screen.getByText(/ETS 官方 5 分样文同样含约十处这类小错/)).toBeInTheDocument();
  });

  test("empty capped list still says no score-lowering grammar errors", () => {
    const result = {
      score: 5,
      band: 5,
      summary: "总评",
      errorTriage: { capped: [], minorSummary: "无", verdict: "" },
      actions: [],
      annotationCounts: { red: 0, orange: 0, blue: 0 },
      annotationSegments: [],
      patterns: [],
      comparison: { modelEssay: "", points: [] },
      sectionStates: {},
    };
    render(<ScoringReport result={result} type="discussion" />);
    expect(screen.getByText("没有真正拉低分数的语法错误")).toBeInTheDocument();
  });

  test("legacy records without rubric / errorTriage render neither block", () => {
    const result = {
      score: 4,
      band: 4,
      summary: "总评",
      actions: [],
      annotationCounts: { red: 0, orange: 0, blue: 0 },
      annotationSegments: [],
      patterns: [],
      comparison: { modelEssay: "sample", points: [] },
      sectionStates: {},
    };
    render(<ScoringReport result={result} type="discussion" />);
    expect(screen.queryByText("影响分数的错误")).toBeNull();
    expect(screen.queryByText("任务完成")).toBeNull();
    // 范文标签诚实化：不再自称官方 5 分范文
    expect(screen.queryByText(/Official Band/)).toBeNull();
    fireEvent.click(screen.getByText("范文对比").closest("button"));
    expect(screen.getByText("查看 AI 参考范文")).toBeInTheDocument();
  });

  test("annotation mark click shows note card", () => {
    const result = {
      score: 4,
      band: 4.5,
      summary: "总评",
      actions: [],
      annotationCounts: { red: 1, orange: 0, blue: 0 },
      annotationSegments: [
        { type: "text", text: "Dear Editor, " },
        { type: "mark", text: "I am a subscriber of", level: "red", fix: "I am a subscriber to", note: "介词搭配错误" },
      ],
      patterns: [],
      comparison: { modelEssay: "", points: [] },
      sectionStates: {
        ACTION: { ok: true },
        ANNOTATION: { ok: true },
        PATTERNS: { ok: true },
        COMPARISON: { ok: true },
      },
    };

    render(<ScoringReport result={result} type="email" />);
    fireEvent.click(screen.getByText("逐句批注").closest("button"));
    fireEvent.click(screen.getByRole("button", { name: "I am a subscriber of" }));
    expect(screen.getByText("修改建议（中文）")).toBeInTheDocument();
    expect(screen.getByText("I am a subscriber to")).toBeInTheDocument();
    expect(screen.getByText("介词搭配错误")).toBeInTheDocument();
  });
});

