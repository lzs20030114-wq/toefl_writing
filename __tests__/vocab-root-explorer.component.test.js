import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import RootExplorer from "../components/vocab/RootExplorer";
import { callAI } from "../lib/ai/client";
import { getSavedCode } from "../lib/AuthContext";
import { isSaved, saveWord } from "../lib/vocab/vocabStore";
import { speakWord } from "../lib/audio/speakWord";

jest.mock("../lib/ai/client", () => ({ callAI: jest.fn() }));
jest.mock("../lib/AuthContext", () => ({ getSavedCode: jest.fn() }));
jest.mock("../lib/vocab/vocabStore", () => ({ isSaved: jest.fn(), saveWord: jest.fn() }));
jest.mock("../lib/audio/speakWord", () => ({ canSpeak: () => true, speakWord: jest.fn(() => true) }));

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  getSavedCode.mockReturnValue("ABC123");
  isSaved.mockReturnValue(false);
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
  expect(screen.getByText("构词：organ + ism")).toBeInTheDocument();
  expect(screen.getByText("区别：指完整的生物，而非单个器官")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "收藏" }));
  expect(saveWord).toHaveBeenCalledWith(expect.objectContaining({ word: "organism", source: "root-explorer" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "已收藏" })).toBeDisabled());
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
