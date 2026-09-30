import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import RootExplorer from "../components/vocab/RootExplorer";
import { callAI } from "../lib/ai/client";
import { getSavedCode } from "../lib/AuthContext";
import { getCard, isSaved, saveWord } from "../lib/vocab/vocabStore";
import { speakWord } from "../lib/audio/speakWord";

jest.mock("../lib/ai/client", () => ({ callAI: jest.fn() }));
jest.mock("../lib/AuthContext", () => ({ getSavedCode: jest.fn() }));
jest.mock("../lib/vocab/vocabStore", () => ({ getCard: jest.fn(), isSaved: jest.fn(), saveWord: jest.fn() }));
jest.mock("../lib/audio/speakWord", () => ({ canSpeak: () => true, speakWord: jest.fn(() => true) }));

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  getSavedCode.mockReturnValue("ABC123");
  isSaved.mockReturnValue(false);
  getCard.mockReturnValue(null);
  saveWord.mockImplementation((entry) => entry);
});

test("输入 organ 后显示词性、释义、构词、区别，并可收藏", async () => {
  callAI.mockResolvedValue(JSON.stringify({
    rootMeaning: "器官；组织",
    memoryTip: "组织起来",
    words: [{ word: "organism", partOfSpeech: "n.", meaning: "生物体", formation: "organ + ism", difference: "指完整的生物，而非单个器官" }],
  }));
  render(<RootExplorer />);
  fireEvent.change(screen.getByRole("textbox", { name: "输入词根" }), { target: { value: "organ" } });
  fireEvent.click(screen.getByRole("button", { name: "查词根" }));
  expect(await screen.findByText("organism")).toBeInTheDocument();
  expect(screen.getByText("生物体")).toBeInTheDocument();
  const card = screen.getByRole("article", { name: "organism" });
  expect(within(card).getByText("构词").nextElementSibling).toHaveTextContent("organ + ism");
  expect(within(card).getByText("区别").nextElementSibling).toHaveTextContent("指完整的生物，而非单个器官");
  fireEvent.click(screen.getByRole("button", { name: "收藏" }));
  expect(saveWord).toHaveBeenCalledWith(expect.objectContaining({ word: "organism", source: "root-explorer" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "已收藏" })).toBeDisabled());
});

test("词根结果可选择听力词，默认是阅读词", async () => {
  callAI.mockResolvedValue(JSON.stringify({ words: [
    { word: "organism", partOfSpeech: "n.", meaning: "生物体", formation: "organ + ism", difference: "生物" },
    { word: "organic", partOfSpeech: "adj.", meaning: "有机的", formation: "organ + ic", difference: "形容词" },
  ] }));
  render(<RootExplorer />);
  fireEvent.change(screen.getByRole("textbox", { name: "输入词根" }), { target: { value: "organ" } });
  fireEvent.click(screen.getByRole("button", { name: "查词根" }));
  await screen.findByText("organism");
  fireEvent.click(screen.getByRole("group", { name: "organism 复习类型" }).querySelector('[aria-pressed="false"]'));
  fireEvent.click(screen.getAllByRole("button", { name: "收藏" })[0]);
  expect(saveWord).toHaveBeenCalledWith(expect.objectContaining({ word: "organism", reviewMode: "listening" }));
  fireEvent.click(screen.getAllByRole("button", { name: "收藏" })[0]);
  expect(saveWord).toHaveBeenCalledWith(expect.objectContaining({ word: "organic", reviewMode: "reading" }));
});

test("同一词根再次查询从本地缓存读取，不重复调用 AI", async () => {
  callAI.mockResolvedValue(JSON.stringify({
    words: [{ word: "organ", partOfSpeech: "n.", meaning: "器官", formation: "核心词", difference: "指单个器官" }],
  }));
  const { unmount } = render(<RootExplorer />);
  fireEvent.change(screen.getByRole("textbox", { name: "输入词根" }), { target: { value: "organ" } });
  fireEvent.click(screen.getByRole("button", { name: "查词根" }));
  expect(await screen.findByText("器官")).toBeInTheDocument();
  unmount();
  render(<RootExplorer />);
  fireEvent.change(screen.getByRole("textbox", { name: "输入词根" }), { target: { value: "organ" } });
  fireEvent.click(screen.getByRole("button", { name: "查词根" }));
  expect(screen.getByText("已保存的查询")).toBeInTheDocument();
  expect(callAI).toHaveBeenCalledTimes(1);
});

test("每个词的朗读按钮会念对应词，不影响收藏", async () => {
  callAI.mockResolvedValue(JSON.stringify({
    words: [
      { word: "lose", partOfSpeech: "v.", meaning: "失去", formation: "核心词", difference: "动词" },
      { word: "loss", partOfSpeech: "n.", meaning: "损失", formation: "同源词", difference: "名词" },
    ],
  }));
  render(<RootExplorer />);
  fireEvent.change(screen.getByRole("textbox", { name: "输入词根" }), { target: { value: "los" } });
  fireEvent.click(screen.getByRole("button", { name: "查词根" }));
  fireEvent.click(await screen.findByRole("button", { name: "朗读 loss" }));
  expect(speakWord).toHaveBeenCalledWith("loss", expect.objectContaining({ onDone: expect.any(Function) }));
  expect(saveWord).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "朗读 lose" }));
  expect(speakWord).toHaveBeenLastCalledWith("lose", expect.objectContaining({ onDone: expect.any(Function) }));
});

test("结果面板可收起和展开，收起后细栏仍留着词根与词数", async () => {
  callAI.mockResolvedValue(JSON.stringify({ rootMeaning: "器官；组织", words: [
    { word: "organism", partOfSpeech: "n.", meaning: "生物体", formation: "organ + ism", difference: "完整生物" },
  ] }));
  render(<RootExplorer />);
  expect(screen.getByRole("heading", { name: "词根查询" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /收起|展开/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "输入词根" }), { target: { value: "organ" } });
  fireEvent.click(screen.getByRole("button", { name: "查词根" }));
  expect(await screen.findByText("organism")).toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: "收起" });
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(toggle).toHaveAttribute("aria-controls", "root-explorer-results");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle).toHaveTextContent("展开");
  expect(document.getElementById("root-explorer-results")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByText(/1 个词 · 器官；组织/)).toBeInTheDocument();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
});

test("结果底部也能收起，并把视口带回面板顶部", async () => {
  callAI.mockResolvedValue(JSON.stringify({ words: [
    { word: "organism", partOfSpeech: "n.", meaning: "生物体", formation: "organ + ism", difference: "完整生物" },
  ] }));
  const scrollIntoView = jest.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  render(<RootExplorer />);
  fireEvent.change(screen.getByRole("textbox", { name: "输入词根" }), { target: { value: "organ" } });
  fireEvent.click(screen.getByRole("button", { name: "查词根" }));
  fireEvent.click(await screen.findByRole("button", { name: "收起 organ 词族" }));
  expect(screen.getByRole("button", { name: "展开" })).toHaveAttribute("aria-expanded", "false");
  expect(document.getElementById("root-explorer-results")).toHaveAttribute("aria-hidden", "true");
  expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
  delete Element.prototype.scrollIntoView;
});

test("改输入不收起已有结果，下一次查询才替换", async () => {
  callAI.mockResolvedValueOnce(JSON.stringify({ words: [
    { word: "organism", partOfSpeech: "n.", meaning: "生物体", formation: "organ + ism", difference: "完整生物" },
  ] }));
  callAI.mockResolvedValueOnce(JSON.stringify({ words: [
    { word: "structure", partOfSpeech: "n.", meaning: "结构", formation: "struct + ure", difference: "名词" },
  ] }));
  render(<RootExplorer />);
  const input = screen.getByRole("textbox", { name: "输入词根" });
  fireEvent.change(input, { target: { value: "organ" } });
  fireEvent.click(screen.getByRole("button", { name: "查词根" }));
  expect(await screen.findByText("organism")).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "str" } });
  expect(screen.getByText("organism")).toBeInTheDocument();
  expect(document.getElementById("root-explorer-results")).toHaveAttribute("aria-hidden", "false");
  fireEvent.change(input, { target: { value: "struct" } });
  fireEvent.click(screen.getByRole("button", { name: "查词根" }));
  expect(await screen.findByText("structure")).toBeInTheDocument();
  expect(screen.queryByText("organism")).not.toBeInTheDocument();
});

test("新查询失败时清掉旧结果，并忽略过时请求", async () => {
  let resolveOld;
  callAI.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  callAI.mockRejectedValueOnce(new Error("API timeout"));
  render(<RootExplorer />);
  const input = screen.getByRole("textbox", { name: "输入词根" });
  fireEvent.change(input, { target: { value: "organ" } });
  fireEvent.click(screen.getByRole("button", { name: "查词根" }));
  expect(screen.getByRole("status")).toHaveTextContent("正在整理词族");
  expect(screen.getByRole("button", { name: "整理中…" })).toBeDisabled();
  fireEvent.change(input, { target: { value: "struct" } });
  fireEvent.click(screen.getByRole("button", { name: "查词根" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("查询超时");
  await act(async () => resolveOld(JSON.stringify({ words: [
    { word: "organism", partOfSpeech: "n.", meaning: "生物体", formation: "organ + ism", difference: "完整生物" },
  ] })));
  expect(screen.queryByText("organism")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("查询超时");
});

test("已有结果后查询另一个词根失败，不保留旧词条", async () => {
  callAI.mockResolvedValueOnce(JSON.stringify({ words: [
    { word: "organism", partOfSpeech: "n.", meaning: "生物体", formation: "organ + ism", difference: "完整生物" },
  ] }));
  callAI.mockRejectedValueOnce(new Error("API timeout"));
  render(<RootExplorer />);
  const input = screen.getByRole("textbox", { name: "输入词根" });
  fireEvent.change(input, { target: { value: "organ" } });
  fireEvent.click(screen.getByRole("button", { name: "查词根" }));
  expect(await screen.findByText("organism")).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "struct" } });
  fireEvent.click(screen.getByRole("button", { name: "查词根" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("查询超时");
  expect(screen.queryByText("organism")).not.toBeInTheDocument();
});
