import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import VocabNotebook from "../components/vocab/VocabNotebook";
import VocabImportDialog from "../components/vocab/VocabImportDialog";
import VocabExportDialog from "../components/vocab/VocabExportDialog";
import { useVocabBook } from "../components/vocab/useVocabBook";
import { getVocabAccountKey, importWords } from "../lib/vocab/vocabStore";
import { enrichVocabularyItems } from "../lib/vocab/importVocabulary";
import { readVocabularyFile, extractVocabularyImages } from "../lib/vocab/readVocabularyFile";
import { createVocabularyPdf } from "../lib/vocab/exportVocabularyPdf";

jest.mock("../components/vocab/useVocabBook", () => ({ useVocabBook: jest.fn() }));
jest.mock("../components/vocab/RootExplorer", () => () => null);
jest.mock("../components/vocab/DailyQuotaCard", () => () => null);
jest.mock("../components/shared/SpeakButton", () => ({ SpeakButton: () => null }));
jest.mock("../components/vocab/VocabReview", () => ({ VocabReview: () => null }));
jest.mock("../components/vocab/ListeningVocabReview", () => ({ ListeningVocabReview: () => null }));
jest.mock("../lib/vocab/vocabStore", () => ({ getVocabAccountKey: jest.fn(), importWords: jest.fn() }));
jest.mock("../lib/vocab/importVocabulary", () => ({ ...jest.requireActual("../lib/vocab/importVocabulary"), enrichVocabularyItems: jest.fn() }));
jest.mock("../lib/vocab/readVocabularyFile", () => ({ readVocabularyFile: jest.fn(), extractVocabularyImages: jest.fn() }));
jest.mock("../lib/vocab/exportVocabularyPdf", () => ({ createVocabularyPdf: jest.fn(), vocabularyPdfFilename: jest.fn(() => "words.pdf") }));

const word = (i) => `word${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + i % 26)}`;
const cards = Array.from({ length: 75 }, (_, i) => ({ word: word(i), def: "词义", state: 0, due: new Date().toISOString(), reviewMode: i < 65 ? "reading" : "listening" }));
const book = (items = cards) => ({ cards: items, ready: true, accountKey: "guest", isLoggedIn: false, storageStatus: { persisted: true },
  stats: { total: items.length }, statsByMode: {}, limits: {}, schedule: {}, setLimits: jest.fn(), makeQueue: jest.fn(), grade: jest.fn(), remove: jest.fn(), reset: jest.fn(), setProductive: jest.fn(), setReviewMode: jest.fn() });
beforeEach(() => {
  jest.clearAllMocks(); localStorage.clear(); getVocabAccountKey.mockReturnValue("guest"); useVocabBook.mockReturnValue(book());
  enrichVocabularyItems.mockImplementation(async (items) => items);
  importWords.mockReturnValue({ added: 1, duplicates: 0, invalid: 0, persisted: true });
  createVocabularyPdf.mockResolvedValue(new Uint8Array([1, 2, 3]));
  URL.createObjectURL = jest.fn(() => "blob:test"); URL.revokeObjectURL = jest.fn();
});

test("空词库可导入，弹窗支持Escape关闭、焦点恢复和滚动还原", () => {
  useVocabBook.mockReturnValue(book([])); render(<VocabNotebook embedded />);
  const trigger = screen.getByRole("button", { name: "导入词表" }); trigger.focus(); fireEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "导入自己的词表" })).toBeInTheDocument();
  expect(document.body.style.overflow).toBe("hidden");
  const close = screen.getByRole("button", { name: "关闭窗口" }); expect(close).toHaveFocus();
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(trigger).toHaveFocus(); expect(document.body.style.overflow).toBe("");
});

test("全选包括当前筛选超过60的词，跨筛选保留，移除词会从导出中剔除", async () => {
  const view = render(<VocabNotebook embedded />);
  fireEvent.click(screen.getByRole("button", { name: /导出 PDF/ }));
  fireEvent.click(screen.getByRole("button", { name: "阅读" }));
  expect(screen.getAllByRole("checkbox")).toHaveLength(60);
  fireEvent.click(screen.getByRole("button", { name: "全选当前筛选（65 词）" }));
  expect(screen.getByText("已选 65 个词")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "听力" }));
  fireEvent.click(screen.getByRole("checkbox", { name: `选择 ${word(65)}` }));
  expect(screen.getByText("已选 66 个词")).toBeInTheDocument();
  useVocabBook.mockReturnValue(book(cards.filter((card) => card.word !== word(0)))); view.rerender(<VocabNotebook embedded />);
  await waitFor(() => expect(screen.getByText("已选 65 个词")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "预览并导出 65 词" }));
  expect(screen.getByRole("dialog", { name: "导出单词 PDF" })).toBeInTheDocument();
  const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: "下载 PDF" }));
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  const exported = createVocabularyPdf.mock.calls[0][0]; expect(exported).toHaveLength(65);
  expect(exported.some((card) => card.word === word(0))).toBe(false);
  expect(exported.some((card) => card.word === word(65))).toBe(true); click.mockRestore();
});

test("StrictMode 仍可完成PDF下载，关闭后完成的生成不会下载", async () => {
  const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const view = render(<StrictMode><VocabExportDialog cards={cards.slice(0, 2)} accountKey="guest" onClose={() => {}} /></StrictMode>);
  fireEvent.click(screen.getByRole("button", { name: "下载 PDF" }));
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1)); view.unmount();
  let resolvePdf; createVocabularyPdf.mockImplementation(() => new Promise((resolve) => { resolvePdf = resolve; }));
  const next = render(<VocabExportDialog cards={cards.slice(0, 2)} accountKey="guest" onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "下载 PDF" }));
  await waitFor(() => expect(resolvePdf).toBeDefined()); next.unmount();
  await act(async () => resolvePdf(new Uint8Array([1])));
  expect(click).toHaveBeenCalledTimes(1); click.mockRestore();
});

test("导入预览不写入，已有词禁选，确认后按所选类型保存", async () => {
  render(<StrictMode><VocabImportDialog cards={[{ word: "apple", reps: 8 }]} accountKey="guest" onClose={() => {}} /></StrictMode>);
  fireEvent.change(screen.getByRole("textbox", { name: "或粘贴词表" }), { target: { value: "apple\t苹果\nresilient\t有韧性的" } });
  fireEvent.click(screen.getByRole("button", { name: "预览粘贴的词表" }));
  expect(importWords).not.toHaveBeenCalled(); expect(screen.getByRole("checkbox", { name: "导入 apple" })).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox", { name: "加入哪类复习" }), { target: { value: "listening" } });
  fireEvent.click(screen.getByRole("button", { name: "确认导入 1 个词" }));
  await waitFor(() => expect(importWords).toHaveBeenCalledTimes(1));
  expect(importWords.mock.calls[0][0].map((item) => item.word)).toEqual(["resilient"]);
  expect(importWords.mock.calls[0][1]).toMatchObject({ expectedAccount: "guest", reviewMode: "listening", source: "粘贴词表" });
  expect(screen.getByText("已保存 1 个新词")).toBeInTheDocument();
});

test.each([0, 1])("编辑成重复词后可取消并保留第%s条候选的释义", async (retained) => {
  render(<VocabImportDialog cards={[]} accountKey="guest" onClose={() => {}} />);
  fireEvent.change(screen.getByRole("textbox", { name: "或粘贴词表" }), { target: { value: "apple\t错误释义\nbanana\t香蕉" } });
  fireEvent.click(screen.getByRole("button", { name: "预览粘贴的词表" }));
  fireEvent.change(screen.getByRole("textbox", { name: "第 1 行单词" }), { target: { value: "banana" } });
  const choices = screen.getAllByRole("checkbox", { name: "导入 banana" });
  expect(choices[0]).toBeChecked(); expect(choices[1]).toBeDisabled();
  fireEvent.click(choices[0]);
  choices.forEach((choice) => { expect(choice).not.toBeDisabled(); expect(choice).not.toBeChecked(); });
  expect(screen.getByRole("button", { name: "确认导入 0 个词" })).toBeDisabled();
  fireEvent.click(choices[retained]);
  expect(choices[retained]).toBeChecked(); expect(choices[1 - retained]).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "确认导入 1 个词" }));
  await waitFor(() => expect(importWords).toHaveBeenCalledTimes(1));
  expect(importWords.mock.calls[0][0]).toEqual([expect.objectContaining({ word: "banana", def: retained ? "香蕉" : "错误释义" })]);
});

test("重复候选全选保留手选条目，清空后全选按行序选第一条，已有词仍禁选", () => {
  render(<VocabImportDialog cards={[{ word: "pear" }]} accountKey="guest" onClose={() => {}} />);
  fireEvent.change(screen.getByRole("textbox", { name: "或粘贴词表" }), { target: { value: "apple\t错误释义\nbanana\t香蕉\npear\t梨" } });
  fireEvent.click(screen.getByRole("button", { name: "预览粘贴的词表" }));
  fireEvent.change(screen.getByRole("textbox", { name: "第 1 行单词" }), { target: { value: "banana" } });
  const choices = screen.getAllByRole("checkbox", { name: "导入 banana" });
  fireEvent.click(choices[0]); fireEvent.click(choices[1]);
  fireEvent.click(screen.getByRole("button", { name: "全选可导入词" }));
  expect(choices[0]).not.toBeChecked(); expect(choices[1]).toBeChecked();
  expect(screen.getByRole("button", { name: "确认导入 1 个词" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "清空选择" }));
  choices.forEach((choice) => expect(choice).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "全选可导入词" }));
  expect(choices[0]).toBeChecked(); expect(choices[1]).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "导入 pear" })).toBeDisabled();
});

test("超长候选保留全文并显示校验，编辑缩短后可以勾选导入", async () => {
  const longWord = "a".repeat(70);
  render(<VocabImportDialog cards={[]} accountKey="guest" onClose={() => {}} />);
  fireEvent.change(screen.getByRole("textbox", { name: "或粘贴词表" }), { target: { value: `${longWord}\t原始释义` } });
  fireEvent.click(screen.getByRole("button", { name: "预览粘贴的词表" }));
  const wordInput = screen.getByRole("textbox", { name: "第 1 行单词" });
  expect(wordInput).toHaveValue(longWord);
  expect(screen.getByRole("checkbox", { name: `导入 ${longWord}` })).toBeDisabled();
  expect(screen.getAllByText(/单词或短语最多 60 个字符/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "全选可导入词" }));
  expect(screen.getByRole("button", { name: "确认导入 0 个词" })).toBeDisabled();
  fireEvent.change(wordInput, { target: { value: "apple" } });
  const choice = screen.getByRole("checkbox", { name: "导入 apple" });
  expect(choice).toBeEnabled(); fireEvent.click(choice);
  fireEvent.click(screen.getByRole("button", { name: "确认导入 1 个词" }));
  await waitFor(() => expect(importWords).toHaveBeenCalledTimes(1));
  expect(importWords.mock.calls[0][0]).toEqual([expect.objectContaining({ word: "apple", def: "原始释义" })]);
});

test("PDF生成延迟期间锁定标题和原句选项，完成后恢复编辑", async () => {
  let finish;
  createVocabularyPdf.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<VocabExportDialog cards={cards.slice(0, 2)} accountKey="guest" onClose={() => {}} />);
  const title = screen.getByRole("textbox", { name: "标题" });
  const sentences = screen.getByRole("checkbox", { name: "包含已保存的原句" });
  fireEvent.change(title, { target: { value: "本次导出" } }); fireEvent.click(sentences);
  fireEvent.click(screen.getByRole("button", { name: "下载 PDF" }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(title).toBeDisabled(); expect(sentences).toBeDisabled();
  expect(screen.getByRole("button", { name: "正在生成…" })).toBeDisabled();
  expect(createVocabularyPdf.mock.calls[0][1]).toMatchObject({ title: "本次导出", includeSentences: false });
  expect(screen.getByRole("heading", { name: "本次导出" })).toBeInTheDocument();
  await act(async () => finish(new Uint8Array([1])));
  expect(click).toHaveBeenCalledTimes(1); expect(title).toBeEnabled(); expect(sentences).toBeEnabled();
  click.mockRestore();
});

test.each(["close", "account"])("词典补全期间%s不会向旧账号写入", async (action) => {
  let finish; enrichVocabularyItems.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<VocabImportDialog cards={[]} accountKey="guest" onClose={() => {}} />);
  fireEvent.change(screen.getByRole("textbox", { name: "或粘贴词表" }), { target: { value: "resilient\t有韧性的" } });
  fireEvent.click(screen.getByRole("button", { name: "预览粘贴的词表" }));
  fireEvent.click(screen.getByRole("button", { name: "确认导入 1 个词" }));
  await waitFor(() => expect(finish).toBeDefined());
  if (action === "close") view.unmount(); else getVocabAccountKey.mockReturnValue("NEW123");
  await act(async () => finish([{ word: "resilient", def: "有韧性的" }]));
  expect(importWords).not.toHaveBeenCalled();
});


test("混合PDF仅在点击后识图，保留文字预览编辑与选择", async () => {
  localStorage.setItem("toefl-user-code", "DEMO12"); localStorage.setItem("toefl-user-tier", "pro");
  getVocabAccountKey.mockReturnValue("DEMO12");
  readVocabularyFile.mockResolvedValue({ items: [{ word: "apple", def: "苹果" }], images: [new Blob(["image"])], warnings: [], skipped: 0, duplicates: 0 });
  extractVocabularyImages.mockResolvedValue({ items: [{ word: "resilient", def: "有韧性的" }], warnings: [] });
  render(<VocabImportDialog cards={[]} accountKey="DEMO12" onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("选择词表文件"), { target: { files: [new File(["pdf"], "mixed.pdf", { type: "application/pdf" })] } });
  await waitFor(() => expect(screen.getByRole("textbox", { name: "第 1 行单词" })).toBeInTheDocument());
  expect(extractVocabularyImages).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "第 1 行释义" }), { target: { value: "自己核对的释义" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "导入 apple" }));
  fireEvent.click(screen.getByRole("button", { name: "用 AI 识别图片" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "第 2 行单词" })).toBeInTheDocument());
  expect(screen.getByRole("textbox", { name: "第 1 行释义" })).toHaveValue("自己核对的释义");
  expect(screen.getByRole("checkbox", { name: "导入 apple" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "导入 resilient" })).toBeChecked();
  expect(extractVocabularyImages).toHaveBeenCalledTimes(1);
});

test("编辑重复候选改选第二条后，识图合并保留选中释义与选择", async () => {
  localStorage.setItem("toefl-user-code", "DEMO12"); localStorage.setItem("toefl-user-tier", "pro");
  getVocabAccountKey.mockReturnValue("DEMO12");
  readVocabularyFile.mockResolvedValue({ items: [{ word: "apple", def: "错误释义" }, { word: "banana", def: "香蕉" }], images: [new Blob(["image"])], warnings: [], skipped: 0, duplicates: 0 });
  extractVocabularyImages.mockResolvedValue({ items: [{ word: "resilient", def: "有韧性的" }], warnings: [] });
  render(<VocabImportDialog cards={[]} accountKey="DEMO12" onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("选择词表文件"), { target: { files: [new File(["pdf"], "mixed.pdf", { type: "application/pdf" })] } });
  await waitFor(() => expect(screen.getByRole("textbox", { name: "第 2 行单词" })).toBeInTheDocument());
  fireEvent.change(screen.getByRole("textbox", { name: "第 1 行单词" }), { target: { value: "banana" } });
  const choices = screen.getAllByRole("checkbox", { name: "导入 banana" });
  fireEvent.click(choices[0]); fireEvent.click(choices[1]);
  fireEvent.click(screen.getByRole("button", { name: "用 AI 识别图片" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "导入 resilient" })).toBeInTheDocument());
  expect(screen.getByRole("checkbox", { name: "导入 banana" })).toBeChecked();
  expect(screen.getByRole("textbox", { name: "第 1 行释义" })).toHaveValue("香蕉");
  fireEvent.click(screen.getByRole("button", { name: "确认导入 2 个词" }));
  await waitFor(() => expect(importWords).toHaveBeenCalledTimes(1));
  expect(importWords.mock.calls[0][0]).toContainEqual(expect.objectContaining({ word: "banana", def: "香蕉" }));
});

test("无词文件明确提示，不显示可确认的空导入", async () => {
  readVocabularyFile.mockResolvedValue({ items: [], images: [], warnings: [], skipped: 0, duplicates: 0 });
  render(<VocabImportDialog cards={[]} accountKey="guest" onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("选择词表文件"), { target: { files: [new File(["123"], "empty.txt", { type: "text/plain" })] } });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("未找到可导入的单词"));
  expect(screen.getByRole("button", { name: "确认导入 0 个词" })).toBeDisabled();
  expect(importWords).not.toHaveBeenCalled();
});


test("不确定英文短句默认不选且全选跳过，核对后可手动勾选", async () => {
  render(<VocabImportDialog cards={[]} accountKey="guest" onClose={() => {}} />);
  fireEvent.change(screen.getByRole("textbox", { name: "或粘贴词表" }), { target: { value: "Birds migrate every autumn\napple" } });
  fireEvent.click(screen.getByRole("button", { name: "预览粘贴的词表" }));
  const uncertain = screen.getByRole("checkbox", { name: "导入 birds migrate every autumn" });
  expect(uncertain).not.toBeChecked(); expect(uncertain).not.toBeDisabled();
  expect(screen.getByText("无法确定是词组还是句子，请核对后勾选")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "导入 apple" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "清空选择" }));
  fireEvent.click(screen.getByRole("button", { name: "全选可导入词" }));
  expect(uncertain).not.toBeChecked();
  fireEvent.click(uncertain);
  fireEvent.click(screen.getByRole("button", { name: "确认导入 2 个词" }));
  await waitFor(() => expect(importWords).toHaveBeenCalledTimes(1));
  expect(importWords.mock.calls[0][0].map((item) => item.word)).toEqual(["birds migrate every autumn", "apple"]);
});
