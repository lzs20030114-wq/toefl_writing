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
    expect(screen.getByText(/Band 4.5/)).toBeInTheDocument();
    expect(screen.getByText(/Goal1:/)).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "I am a subscriber of" })).toBeInTheDocument();
    expect(screen.getByText("介词搭配")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "I am a subscriber of" }));
    expect(screen.getByText("修改建议（中文）")).toBeInTheDocument();
    expect(screen.getByText("I am a subscriber to")).toBeInTheDocument();
    expect(screen.getByText("介词搭配错误")).toBeInTheDocument();
  });
});

