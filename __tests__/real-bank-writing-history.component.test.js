import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WritingTask } from "../components/writing/WritingTask";
import { RealBankProgressView } from "../components/realBank/RealBankProgressView";
import { getRealDiscussionPrompts, getRealEmailPrompts } from "../lib/realBank";
import { stashPromptSnapshot } from "../lib/history/retry";
import { loadHist } from "../lib/sessionStore";
import { buildRealBankEntries } from "../lib/realBankHistory";
import { evaluateWritingResponse } from "../lib/ai/writingEval";

// Keep the actual task, persistence and history UI. Only the external services
// are replaced so submitting this regression test costs no AI calls.
jest.mock("../lib/supabase", () => ({ supabase: null, isSupabaseConfigured: false }));
jest.mock("../lib/ai/writingEval", () => ({ evaluateWritingResponse: jest.fn() }));
jest.mock("../lib/ai/writingLesson", () => ({ generateWritingLesson: jest.fn(async () => null) }));

const REPORT = {
  score: 4, band: "4", summary: "清楚表达了观点。", goals: [], actions: [], patterns: [],
  annotationSegments: [], comparison: { modelEssay: "", points: [] },
};
const ESSAY = "Students benefit from opportunities to apply their knowledge. For example, working together on a practical project helps them understand difficult ideas and communicate clearly. ".repeat(5);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  evaluateWritingResponse.mockReset().mockResolvedValue(REPORT);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

async function submitWriting() {
  fireEvent.click(screen.getByTestId("writing-intro-start"));
  fireEvent.change(screen.getByTestId("writing-textarea"), { target: { value: ESSAY } });
  fireEvent.click(screen.getByTestId("writing-submit"));
  await screen.findByRole("button", { name: "下一题" });
}

test.each([
  ["discussion", getRealDiscussionPrompts, "学术讨论真题"],
  ["email", getRealEmailPrompts, "邮件真题"],
])("真题 %s 连续提交两道题，两次都保留在真题练习记录", async (type, getPrompts, label) => {
  const prompts = getPrompts().slice(0, 2);
  stashPromptSnapshot(type, prompts[0]);
  const task = render(<WritingTask type={type} prompts={prompts} initialPromptId={prompts[0].id} practiceMode="practice" />);

  await submitWriting();
  fireEvent.click(screen.getByRole("button", { name: "下一题" }));
  await submitWriting();
  await waitFor(() => expect(loadHist().sessions).toHaveLength(2));

  const sessions = loadHist().sessions;
  expect(sessions.map((s) => s.details.promptId)).toEqual(prompts.map((p) => p.id));
  expect(sessions.every((s) => s.type === type && s.details.userText === ESSAY)).toBe(true);
  expect(buildRealBankEntries(sessions)).toHaveLength(2);

  task.unmount();
  render(<RealBankProgressView />);
  const rows = await screen.findAllByTestId("real-entry-row");
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.textContent.includes(label))).toBe(true);
});

test("真题题池做完时提示完成，不自动落入常规题池", async () => {
  const prompts = getRealDiscussionPrompts().slice(0, 1);
  stashPromptSnapshot("discussion", prompts[0]);
  render(<WritingTask type="discussion" prompts={prompts} initialPromptId={prompts[0].id} practiceMode="practice" />);
  await submitWriting();
  fireEvent.click(screen.getByRole("button", { name: "下一题" }));
  expect(screen.queryByTestId("writing-intro-start")).not.toBeInTheDocument();
  expect(screen.getByText("题库中没有新题了，你已完成该题库全部题目。")).toBeInTheDocument();
  expect(loadHist().sessions).toHaveLength(1);
});

test.each(["email", "discussion"])("常规 %s 未传题池时仍可连续练习并保存普通记录", async (type) => {
  render(<WritingTask type={type} practiceMode="practice" />);
  await submitWriting();
  fireEvent.click(screen.getByRole("button", { name: "下一题" }));
  await submitWriting();
  const sessions = loadHist().sessions;
  expect(sessions).toHaveLength(2);
  expect(new Set(sessions.map((s) => s.details.promptId)).size).toBe(2);
  expect(buildRealBankEntries(sessions)).toHaveLength(0);
});

test("显式空题池显示不可用，不自动换成普通题库", () => {
  render(<WritingTask type="discussion" prompts={[]} practiceMode="practice" />);
  expect(screen.getByText("题库为空或数据异常。")).toBeInTheDocument();
  expect(screen.queryByTestId("writing-intro-start")).not.toBeInTheDocument();
});
