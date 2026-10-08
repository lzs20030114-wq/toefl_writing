import { act, fireEvent, render, screen } from "@testing-library/react";
import { VocabReview } from "../components/vocab/VocabReview";
import { callAI, AI_HELPER_MAX_TOKENS } from "../lib/ai/client";
import { AUTH_CHANGED_EVENT } from "../lib/AuthContext";
import { editDefinition, getCard, saveWord } from "../lib/vocab/vocabStore";
import { STATE } from "../lib/vocab/srs";

jest.mock("../lib/ai/client", () => ({ ...jest.requireActual("../lib/ai/client"), callAI: jest.fn() }));
jest.mock("../lib/dict/lookup", () => ({ lookupWord: jest.fn(async () => null) }));
jest.mock("../components/shared/SpeakButton", () => ({ SpeakButton: () => null }));

const SENTENCE = "Critical thinking allows students to approach problems systematically.";
const SECOND = "The airplane began its final approach to the runway.";
const DEFINITION = "vi. 靠近";
const SENSE = "vt. 处理；着手解决";
const card = (extra = {}) => ({
  word: "approach", display: "approach", def: DEFINITION,
  defFull: "n. 接近；方法\nvt. 接近；处理\nvi. 靠近", sentence: SENTENCE,
  source: "reading", productive: false, state: STATE.LEARNING, ...extra,
});
const openEditor = () => {
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "编辑释义" }));
};
const generate = () => fireEvent.click(screen.getByRole("button", { name: "AI 生成释义" }));
const box = () => screen.getByRole("textbox", { name: "编辑释义" });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
function mount(initialQueue = [card()], extras = {}) {
  const onEditDefinition = jest.fn((word, text) => ({ ...card(), word, def: text }));
  const onGrade = jest.fn((word) => ({ ...card(), word, due: "2030-01-01T00:00:00.000Z" }));
  const view = render(<VocabReview initialQueue={initialQueue} onEditDefinition={onEditDefinition}
    onGrade={onGrade} onExit={jest.fn()} {...extras} />);
  openEditor();
  return { ...view, onEditDefinition, onGrade };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("toefl-user-tier", "pro");
  callAI.mockReset();
  callAI.mockResolvedValue(JSON.stringify({ sense: SENSE, explanation: "这里是处理问题的意思。" }));
});

test("点击才请求当前完整原句和词典备份，生成只填草稿，可修改后保存且保留复习进度", async () => {
  const longSentence = SENTENCE + " while " + "considering all the available evidence ".repeat(6) + "carefully.";
  const stored = saveWord(card({ sentence: longSentence, reps: 7, stability: 12, difficulty: 4, due: "2030-01-01T00:00:00.000Z" }));
  const onEditDefinition = jest.fn(editDefinition);
  mount([stored], { onEditDefinition });
  expect(callAI).not.toHaveBeenCalled();
  generate();
  expect(screen.getByRole("button", { name: "AI 生成中…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  expect(box()).toBeDisabled();
  await screen.findByDisplayValue(SENSE);
  expect(callAI).toHaveBeenCalledTimes(1);
  expect(callAI).toHaveBeenCalledWith(expect.any(String), expect.stringContaining(longSentence), AI_HELPER_MAX_TOKENS, 60000, 0.3);
  expect(callAI.mock.calls[0][1]).toContain("学生查的词：approach");
  expect(callAI.mock.calls[0][1]).toContain("词典释义：n. 接近；方法；vt. 接近；处理；vi. 靠近");
  expect(onEditDefinition).not.toHaveBeenCalled();
  expect(getCard("approach").def).toBe(DEFINITION);
  fireEvent.change(box(), { target: { value: "vt. 处理问题" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(onEditDefinition).toHaveBeenCalledWith("approach", "vt. 处理问题");
  expect(getCard("approach")).toMatchObject({ def: "vt. 处理问题", reps: stored.reps, stability: stored.stability, difficulty: stored.difficulty, due: stored.due });
  expect(screen.queryByRole("textbox", { name: "编辑释义" })).toBeNull();
});

test("多语境轮换使用当前第二句，生成失败保留草稿并允许重试", async () => {
  const { onEditDefinition } = mount([card({ sentences: [SENTENCE, SECOND], reps: 1 })]);
  fireEvent.change(box(), { target: { value: "正在修改的草稿" } });
  callAI.mockRejectedValueOnce(new Error("API timeout"));
  generate();
  expect(await screen.findByRole("alert")).toHaveTextContent("AI 响应超时，请重试");
  expect(box()).toHaveValue("正在修改的草稿");
  expect(box()).toBeEnabled();
  expect(callAI.mock.calls[0][1]).toContain(`句子：${SECOND}\n`);
  generate();
  await screen.findByDisplayValue(SENSE);
  expect(callAI).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(onEditDefinition).not.toHaveBeenCalled();
});

test.each([
  "这是旧版自由文本讲解，没有短释义。",
  JSON.stringify({ sense: "", explanation: "解释" }),
  JSON.stringify({ sense: "释".repeat(301), explanation: "解释" }),
  "{broken JSON",
])("没有可用短释义时保留原草稿：%s", async (response) => {
  mount();
  callAI.mockResolvedValueOnce(response);
  generate();
  expect(await screen.findByRole("alert")).toHaveTextContent("AI 这次没返回可用的短释义，请重试。");
  expect(box()).toHaveValue(DEFINITION);
  expect(screen.getByRole("button", { name: "AI 生成释义" })).toBeEnabled();
});

test("取消后重新打开同词，旧响应不能覆盖新草稿或触发保存", async () => {
  const pending = deferred();
  callAI.mockReturnValueOnce(pending.promise);
  const { onEditDefinition } = mount();
  generate();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  openEditor();
  fireEvent.change(box(), { target: { value: "重新打开后的草稿" } });
  await act(async () => { pending.resolve(JSON.stringify({ sense: SENSE })); });
  expect(box()).toHaveValue("重新打开后的草稿");
  expect(onEditDefinition).not.toHaveBeenCalled();
});

test("生成时切到下一词，旧响应不污染下一词编辑框", async () => {
  const pending = deferred();
  callAI.mockReturnValueOnce(pending.promise);
  const next = card({ word: "systematically", display: "systematically", def: "adv. 有条理地" });
  const { onEditDefinition } = mount([card(), next]);
  generate();
  fireEvent.click(screen.getByRole("button", { name: /显示答案/ }));
  fireEvent.click(screen.getByRole("button", { name: /^忘了/ }));
  openEditor();
  await act(async () => { pending.resolve(JSON.stringify({ sense: SENSE })); });
  expect(box()).toHaveValue(next.def);
  expect(onEditDefinition).not.toHaveBeenCalled();
});

test("账号切换后再切回，旧响应不能写进重新打开的编辑框", async () => {
  const pending = deferred();
  callAI.mockReturnValueOnce(pending.promise);
  mount();
  generate();
  act(() => {
    localStorage.setItem("toefl-user-code", "SECOND");
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
    localStorage.removeItem("toefl-user-code");
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  });
  openEditor();
  await act(async () => { pending.resolve(JSON.stringify({ sense: SENSE })); });
  expect(box()).toHaveValue(DEFINITION);
});

test("同账号刷新登录信息不会关闭编辑器或丢弃生成结果", async () => {
  const pending = deferred();
  callAI.mockReturnValueOnce(pending.promise);
  mount();
  generate();
  act(() => { window.dispatchEvent(new Event(AUTH_CHANGED_EVENT)); });
  expect(box()).toBeDisabled();
  await act(async () => { pending.resolve(JSON.stringify({ sense: SENSE })); });
  expect(box()).toHaveValue(SENSE);
});

test("没有原句语境时不发请求，仍可手写和保存", () => {
  const { onEditDefinition } = mount([card({ sentence: "" })]);
  expect(screen.getByRole("button", { name: "AI 生成释义" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "AI 生成释义" })).toHaveAttribute("title", "这个词没有原句语境");
  generate();
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(callAI).not.toHaveBeenCalled();
  expect(onEditDefinition).toHaveBeenCalledWith("approach", DEFINITION);
});

test("沿用词典 AI 的 Pro 权限，免费账号可手写编辑", () => {
  localStorage.setItem("toefl-user-tier", "free");
  mount();
  expect(screen.getByRole("button", { name: "AI 生成释义" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "AI 生成释义" })).toHaveAttribute("title", "AI 释义需 Pro");
  expect(box()).toBeEnabled();
  generate();
  expect(callAI).not.toHaveBeenCalled();
});
