import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import MeaningExplorer from "../components/vocab/MeaningExplorer";
import { callAI } from "../lib/ai/client";
import { getVocabAccountKey, getCard, saveWord, getVocabStorageStatus, loadBook, writeBook } from "../lib/vocab/vocabStore";
import { speakWord } from "../lib/audio/speakWord";
jest.mock("../lib/ai/client", () => ({ callAI: jest.fn() }));
jest.mock("../lib/AuthContext", () => ({ getSavedCode: () => "ABC123", AUTH_CHANGED_EVENT: "toefl-auth-changed" }));
jest.mock("../lib/vocab/vocabStore", () => ({ getVocabAccountKey: jest.fn(), getCard: jest.fn(), saveWord: jest.fn(), loadBook: jest.fn(), writeBook: jest.fn(), getVocabStorageStatus: jest.fn(), VOCAB_UPDATED_EVENT: "toefl-vocab-updated" }));
jest.mock("../lib/audio/speakWord", () => ({ canSpeak: () => true, speakWord: jest.fn(() => true) }));
const word = { word: "hinder", partOfSpeech: "v.", meaning: "妨碍进展", usage: "进展受到阻碍", difference: "强调拖慢进展", collocations: ["hinder progress"], example: "Noise can hinder progress.", translation: "噪声会妨碍进展。" };
const payload = () => JSON.stringify({ summary: "比较不同程度的阻碍", memoryTip: "先看是否完全阻止", words: [word, { ...word, word: "prevent", difference: "强调阻止发生", example: "We prevent errors." }] });
let cards;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); jest.clearAllMocks(); cards = {};
  getVocabAccountKey.mockReturnValue("ABC123"); getCard.mockImplementation((w) => cards[w] || null);
  getVocabStorageStatus.mockReturnValue({ persisted: true });
  saveWord.mockImplementation((entry) => { cards[entry.word] = entry; return entry; });
  loadBook.mockImplementation(() => Object.values(cards));
  writeBook.mockImplementation((book) => book);
  callAI.mockResolvedValue(payload());
});
async function search() {
  fireEvent.change(screen.getByRole("textbox", { name: "输入中文词或短语" }), { target: { value: "妨碍" } });
  fireEvent.click(screen.getByRole("button", { name: "找英文表达" }));
  return screen.findByRole("article", { name: "hinder" });
}
test("展示辨析、搭配、中英例句，朗读与收藏保留结果查询", async () => {
  render(<MeaningExplorer />); const card = await search();
  expect(within(card).getByText(word.usage)).toBeInTheDocument();
  expect(within(card).getByText(word.difference)).toBeInTheDocument();
  expect(within(card).getByText(word.example)).toBeInTheDocument();
  expect(within(card).getByText(word.translation)).toBeInTheDocument();
  fireEvent.click(within(card).getByRole("button", { name: "朗读 hinder" })); expect(speakWord).toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "坚持" } });
  fireEvent.click(within(card).getByRole("button", { name: "☆ 收藏" }));
  expect(saveWord).toHaveBeenCalledWith(expect.objectContaining({ word: "hinder", sentence: word.example, tag: expect.stringContaining("妨碍") }));
});
test("最近查询重挂载直接显示缓存，支持收起展开", async () => {
  const view = render(<MeaningExplorer />); await search(); view.unmount();
  render(<MeaningExplorer />); expect(screen.getByText("已保存的查询")).toBeInTheDocument();
  expect(callAI).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "收起" }));
  expect(screen.getByRole("button", { name: "展开" })).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(screen.getByRole("button", { name: "展开" }));
  expect(screen.getByRole("article", { name: "hinder" })).toBeInTheDocument();
});
test("整组收藏跳过已有词，一起背传本组模式和账户", async () => {
  cards.hinder = { word: "hinder", def: "原释义", reviewMode: "reading", suspended: true, reps: 8 };
  const onStudyGroup = jest.fn(() => ({ started: true, count: 1, skipped: 1 }));
  render(<MeaningExplorer onStudyGroup={onStudyGroup} />); await search();
  fireEvent.click(screen.getByRole("button", { name: "听力词" }));
  fireEvent.click(screen.getByRole("button", { name: "整组收藏" }));
  expect(saveWord).toHaveBeenCalledTimes(1); expect(cards.hinder.def).toBe("原释义"); expect(cards.hinder.reps).toBe(8);
  fireEvent.click(screen.getByRole("button", { name: "一起背" }));
  expect(onStudyGroup).toHaveBeenCalledWith({ words: ["hinder", "prevent"], mode: "listening", account: "ABC123", query: "妨碍" });
});
test("输入变化使旧响应失效，切账号不缓存旧响应", async () => {
  let resolve; callAI.mockReturnValue(new Promise((r) => { resolve = r; }));
  const view = render(<MeaningExplorer accountKey="ABC123" />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "妨碍" } }); fireEvent.click(screen.getByRole("button", { name: "找英文表达" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "坚持" } });
  await act(async () => resolve(payload())); expect(screen.queryByText(word.example)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "找英文表达" }));
  getVocabAccountKey.mockReturnValue("XYZ789"); view.rerender(<MeaningExplorer accountKey="XYZ789" />);
  await act(async () => resolve(payload())); expect(screen.queryByText(word.example)).not.toBeInTheDocument();
});
test("未知错误不展示上游内容，存储失败如实提示并不开始复习", async () => {
  callAI.mockRejectedValueOnce(new Error("secret upstream body"));
  const onStudyGroup = jest.fn(); render(<MeaningExplorer onStudyGroup={onStudyGroup} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "妨碍" } }); fireEvent.click(screen.getByRole("button", { name: "找英文表达" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("AI 暂时不可用");
  await search(); getVocabStorageStatus.mockReturnValue({ persisted: false });
  fireEvent.click(screen.getByRole("button", { name: "一起背" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("尚未可靠保存")); expect(onStudyGroup).not.toHaveBeenCalled();
});
test("外部删除刷新收藏状态，空缓存不会自动调用 AI", async () => {
  render(<MeaningExplorer />); expect(callAI).not.toHaveBeenCalled();
  const card = await search();
  fireEvent.click(within(card).getByRole("button", { name: "☆ 收藏" }));
  expect(within(card).getByRole("button", { name: "✓ 已收藏" })).toBeDisabled();
  delete cards.hinder;
  act(() => window.dispatchEvent(new Event("toefl-vocab-updated")));
  expect(within(card).getByRole("button", { name: "☆ 收藏" })).toBeEnabled();
});
test("释放空间后可重试内存收藏的持久化，保留原卡片", async () => {
  render(<MeaningExplorer />); await search();
  getVocabStorageStatus.mockReturnValue({ persisted: false });
  fireEvent.click(screen.getByRole("button", { name: "整组收藏" }));
  expect(screen.getByRole("status")).toHaveTextContent("尚未可靠保存");
  const snapshot = Object.values(cards);
  const saves = saveWord.mock.calls.length;
  writeBook.mockImplementation((book) => { getVocabStorageStatus.mockReturnValue({ persisted: true }); return book; });
  fireEvent.click(screen.getByRole("button", { name: "整组收藏" }));
  expect(writeBook).toHaveBeenLastCalledWith(snapshot);
  expect(saveWord).toHaveBeenCalledTimes(saves);
  expect(screen.getByRole("status")).toHaveTextContent("保留原设置");
});
test("查看旧查询后重挂载仍恢复该组，缓存查找也记住选择", async () => {
  let view = render(<MeaningExplorer />); await search();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "坚持" } });
  fireEvent.click(screen.getByRole("button", { name: "找英文表达" }));
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("坚持"));
  await waitFor(() => expect(callAI).toHaveBeenCalledTimes(2));
  await screen.findByRole("article", { name: "hinder" });
  fireEvent.click(within(screen.getByLabelText("最近中文查询")).getByRole("button", { name: "妨碍" }));
  view.unmount(); view = render(<MeaningExplorer />);
  expect(screen.getByRole("textbox")).toHaveValue("妨碍");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "坚持" } });
  fireEvent.click(screen.getByRole("button", { name: "找英文表达" }));
  view.unmount(); render(<MeaningExplorer />);
  expect(screen.getByRole("textbox")).toHaveValue("坚持");
  expect(callAI).toHaveBeenCalledTimes(2);
});
