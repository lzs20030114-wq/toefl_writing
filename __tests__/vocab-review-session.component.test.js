import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { VocabReview } from "../components/vocab/VocabReview";
import { STATE } from "../lib/vocab/srs";

jest.mock("../lib/vocab/vocabStore", () => ({
  ...jest.requireActual("../lib/vocab/vocabStore"),
  getCard: jest.fn(() => null),
  adoptDictEntry: jest.fn(),
}));

const farFuture = () => new Date(Date.now() + 3 * 86400000).toISOString();
const mk = (i) => ({ word: `word${i}`, display: `word${i}`, def: `释义${i}`, state: STATE.LEARNING, productive: false, source: "reading" });
const queueOf = (n) => Array.from({ length: n }, (_, i) => mk(i));
// 评分回调：返回「已排到几天后」的卡，所以本场不会回插
const gradeMock = () => jest.fn((word) => ({ ...mk(Number(word.slice(4))), due: farFuture() }));
const reveal = () => fireEvent.click(screen.getByRole("button", { name: /显示答案/ }));
const good = () => { reveal(); fireEvent.click(screen.getByRole("button", { name: /记得/ })); };
const again = () => { reveal(); fireEvent.click(screen.getByRole("button", { name: /忘了/ })); };

describe("撤销上一张", () => {
  test("评分后可撤销：外面收到词名、卡片摆回已翻面、记得/忘了计数退回", () => {
    const onUndo = jest.fn(() => ({}));
    render(<VocabReview initialQueue={queueOf(3)} onGrade={gradeMock()} onUndo={onUndo} onExit={jest.fn()} />);
    expect(screen.getByRole("button", { name: /撤销上一张/ })).toBeDisabled();

    again();
    expect(screen.getByText("记得 0")).toBeInTheDocument();
    expect(screen.getByText("忘了 1")).toBeInTheDocument();
    expect(screen.getByText("已答 1 · 剩 2")).toBeInTheDocument();
    expect(screen.getByText("word1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /撤销上一张/ }));
    expect(onUndo).toHaveBeenCalledWith("word0");
    expect(screen.getByText("忘了 0")).toBeInTheDocument();
    expect(screen.getByText("已答 0 · 剩 3")).toBeInTheDocument();
    expect(screen.getByText("word0")).toBeInTheDocument();
    // 认词卡摆回已翻面，释义可见，直接能重新评
    expect(screen.getByText("释义0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /记得/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /撤销上一张/ })).toBeDisabled();
  });

  test("Z 键同样撤销；外面没撤成（返回 null）时界面不动", () => {
    const onUndo = jest.fn(() => null);
    render(<VocabReview initialQueue={queueOf(2)} onGrade={gradeMock()} onUndo={onUndo} onExit={jest.fn()} />);
    good();
    act(() => { fireEvent.keyDown(window, { key: "z" }); });
    expect(onUndo).toHaveBeenCalledWith("word0");
    expect(screen.getByText("记得 1")).toBeInTheDocument();
    expect(screen.getByText("word1")).toBeInTheDocument();

    onUndo.mockReturnValue({});
    act(() => { fireEvent.keyDown(window, { key: "Z" }); });
    expect(screen.getByText("记得 0")).toBeInTheDocument();
    expect(screen.getByText("word0")).toBeInTheDocument();
  });

  test("拼写卡撤销后要重新拼，不带着旧的拼写结果", () => {
    const spell = { word: "approximately", display: "approximately", def: "大约", defFull: "adv. 大约", sentence: "About approximately ten.", state: STATE.REVIEW };
    const onGrade = jest.fn(() => ({ ...spell, due: farFuture() }));
    render(<VocabReview initialQueue={[spell, mk(1)]} onGrade={onGrade} onUndo={() => ({})} onExit={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "想不起来，显示答案" }));
    fireEvent.click(screen.getByRole("button", { name: "忘了，下一词" }));
    fireEvent.click(screen.getByRole("button", { name: /撤销上一张/ }));
    expect(screen.getByRole("textbox", { name: "拼写英文单词" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "想不起来，显示答案" })).toBeInTheDocument();
  });

  test("没有 onUndo 时不显示撤销按钮", () => {
    render(<VocabReview initialQueue={queueOf(2)} onGrade={gradeMock()} onExit={jest.fn()} />);
    expect(screen.queryByRole("button", { name: /撤销上一张/ })).not.toBeInTheDocument();
  });
});

describe("分段存档", () => {
  test("每 10 个词弹小结并落存档；空格继续，下一段重新计数；先休息会退出", () => {
    const onCheckpoint = jest.fn();
    const onExit = jest.fn();
    render(<VocabReview initialQueue={queueOf(12)} onGrade={gradeMock()} onUndo={() => ({})} onCheckpoint={onCheckpoint} onExit={onExit} />);
    expect(screen.getByText("本段 0 / 10")).toBeInTheDocument();
    for (let i = 0; i < 9; i += 1) (i === 3 ? again : good)();
    expect(screen.getByText("本段 9 / 10")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    good();

    const dialog = screen.getByRole("dialog", { name: "第 1 段复习完成" });
    expect(within(dialog).getByText("这 10 个词过完了")).toBeInTheDocument();
    expect(within(dialog).getByText("记得 9")).toBeInTheDocument();
    expect(within(dialog).getByText("忘了 1")).toBeInTheDocument();
    expect(within(dialog).getByText("✓ 已存档")).toBeInTheDocument();
    expect(within(dialog).getAllByText(/^word\d$/)).toHaveLength(10);
    expect(onCheckpoint).toHaveBeenCalledTimes(1);
    expect(onCheckpoint.mock.calls[0][0]).toMatchObject({
      words: ["word10", "word11"], answered: 10, tally: { good: 9, again: 1 }, lost: ["word3"], segNo: 1,
      first: expect.objectContaining({ word3: false, word0: true }),
    });
    // 存档点之后不能再撤销，也不能评分
    expect(screen.getByRole("button", { name: /撤销上一张/ })).toBeDisabled();

    act(() => { fireEvent.keyDown(window, { key: " " }); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("本段 0 / 10")).toBeInTheDocument();
    expect(screen.getByText("word10")).toBeInTheDocument();

    for (let i = 0; i < 2; i += 1) good();
    expect(screen.getByText("这一轮复习完成")).toBeInTheDocument();
  });

  test("先休息，退出 = 外面的退出；没接存档回调时不谎称已存档", () => {
    const onExit = jest.fn();
    render(<VocabReview initialQueue={queueOf(11)} onGrade={gradeMock()} onExit={onExit} />);
    for (let i = 0; i < 10; i += 1) good();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("✓ 已存档")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "先休息，退出" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test("从存档继续：带上已答张数、记得/忘了和段号", () => {
    const resume = { answered: 10, tally: { good: 8, again: 2 }, first: { a: true }, seen: { a: 1 }, lost: ["b"], segNo: 1, elapsedMs: 60000, startStats: null };
    render(<VocabReview initialQueue={queueOf(3)} resume={resume} onGrade={gradeMock()} onExit={jest.fn()} />);
    expect(screen.getByText("已从存档继续 · 第 2 段")).toBeInTheDocument();
    expect(screen.getByText("已答 10 · 剩 3")).toBeInTheDocument();
    expect(screen.getByText("记得 8")).toBeInTheDocument();
    expect(screen.getByText("忘了 2")).toBeInTheDocument();
  });
});

describe("结算页", () => {
  test("复盘：首次想起来比例、忘了的词、前后变化、下一步", () => {
    const onFinish = jest.fn();
    const onExportWords = jest.fn();
    const onStartNext = jest.fn();
    const onExit = jest.fn();
    const extras = {
      nextTask: { label: "听力复习", todo: 7, minutes: 2 },
      tomorrow: { n: 12, carried: 4 },
      onStartNext, onExportWords,
    };
    const props = { initialQueue: queueOf(3), onGrade: gradeMock(), onFinish, onExit, summaryExtras: extras };
    const { rerender } = render(<VocabReview {...props} statsNow={{ knowledge: 96, mature: 41, learning: 14 }} />);
    good();
    again();
    rerender(<VocabReview {...props} statsNow={{ knowledge: 98, mature: 41, learning: 16 }} />);
    good();

    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(screen.getByText("这一轮复习完成")).toBeInTheDocument();
    expect(screen.getByText(/过了 3 个词，共 3 次提问/)).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("2 / 3 词")).toBeInTheDocument();
    // 前后变化
    expect(screen.getByText("96 →")).toBeInTheDocument();
    expect(screen.getByText("98")).toBeInTheDocument();
    expect(screen.getAllByText("+2")).toHaveLength(2); // 预计记得 +2、学习中 +2
    expect(screen.getByText("±0")).toBeInTheDocument(); // 已记牢
    // 忘了的词
    expect(screen.getByText("这一轮忘了的词")).toBeInTheDocument();
    expect(screen.getByText("释义1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导出这些词 PDF" }));
    expect(onExportWords).toHaveBeenCalledWith(["word1"]);
    // 下一步
    expect(screen.getByText("听力复习还有 7 词")).toBeInTheDocument();
    expect(screen.getByText("明天预计 12 词")).toBeInTheDocument();
    expect(screen.getByText("含今天顺延的 4 个到期词")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始听力复习" }));
    expect(onStartNext).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "返回单词本" }));
    expect(onExit).toHaveBeenCalled();
  });

  test("一个都没忘、没有后续任务时的文案", () => {
    render(<VocabReview initialQueue={queueOf(1)} onGrade={gradeMock()} onExit={jest.fn()} summaryExtras={{ nextTask: { label: "听力复习", todo: 0, minutes: 0 }, tomorrow: null }} />);
    good();
    expect(screen.getByText("这一轮一个都没忘。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出这些词 PDF" })).not.toBeInTheDocument();
    expect(screen.getByText("今天的复习任务清空了")).toBeInTheDocument();
    expect(screen.getByText("明天见")).toBeInTheDocument();
  });
});

describe("卡片菜单", () => {
  test("暂停复习这个词：不评分直接跳到下一张，并提示可恢复", () => {
    const onSuspend = jest.fn(() => ({}));
    const onGrade = gradeMock();
    render(<VocabReview initialQueue={queueOf(2)} onGrade={onGrade} onSuspend={onSuspend} onExit={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "暂停复习这个词" }));
    expect(onSuspend).toHaveBeenCalledWith("word0");
    expect(onGrade).not.toHaveBeenCalled();
    expect(screen.getByText("word1")).toBeInTheDocument();
    expect(screen.getByText("已暂停「word0」，可在词库里恢复。")).toBeInTheDocument();
    expect(screen.getByText("已答 0 · 剩 1")).toBeInTheDocument();
  });

  test("暂停最后一张直接进入结算", () => {
    const onFinish = jest.fn();
    render(<VocabReview initialQueue={queueOf(1)} onGrade={gradeMock()} onSuspend={() => ({})} onFinish={onFinish} onExit={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "暂停复习这个词" }));
    expect(screen.getByText("这一轮复习完成")).toBeInTheDocument();
    expect(onFinish).toHaveBeenCalled();
  });

  test("编辑释义：保存后当前卡立刻换成新释义；报错时留在编辑框里", () => {
    const onEditDefinition = jest.fn((word, text) => {
      if (text === "炸") throw new Error("释义太短");
      return { ...mk(0), def: text, defFull: "旧释义", definitionLocked: true };
    });
    render(<VocabReview initialQueue={queueOf(2)} onGrade={gradeMock()} onEditDefinition={onEditDefinition} onExit={jest.fn()} />);
    reveal();
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "编辑释义" }));
    const box = screen.getByRole("textbox", { name: "编辑释义" });
    expect(box).toHaveValue("释义0");

    fireEvent.change(box, { target: { value: "炸" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert")).toHaveTextContent("释义太短");

    fireEvent.change(box, { target: { value: "我自己写的释义" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onEditDefinition).toHaveBeenLastCalledWith("word0", "我自己写的释义");
    expect(screen.queryByRole("textbox", { name: "编辑释义" })).not.toBeInTheDocument();
    expect(screen.getByText("我自己写的释义")).toBeInTheDocument();
  });

  test("没传暂停/编辑回调时菜单里只有「要会写」", () => {
    render(<VocabReview initialQueue={queueOf(1)} onGrade={gradeMock()} onExit={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "word0需要会写" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("徽章", () => {
  test("新词卡带「新词」标", () => {
    render(<VocabReview initialQueue={[{ ...mk(0), state: STATE.NEW }]} onGrade={gradeMock()} onExit={jest.fn()} />);
    expect(screen.getByText("新词")).toBeInTheDocument();
  });

  test("同场回访带「再次出现 · 第 N 次」", () => {
    // 12 张里第一张评「忘了」且学习步很快到期 → 隔 10 张后回插
    const soon = () => new Date(Date.now() + 60000).toISOString();
    const onGrade = jest.fn((word) => ({ ...mk(Number(word.slice(4))), due: word === "word0" ? soon() : farFuture() }));
    render(<VocabReview initialQueue={queueOf(12)} onGrade={onGrade} onExit={jest.fn()} />);
    again();
    expect(screen.queryByText(/再次出现/)).not.toBeInTheDocument();
    for (let i = 0; i < 9; i += 1) good();
    fireEvent.keyDown(window, { key: " " });
    // 越过存档点后的队列是 word10、word0（回访）、word11
    good();
    expect(screen.getByText("word0")).toBeInTheDocument();
    expect(screen.getByText("再次出现 · 第 2 次")).toBeInTheDocument();
  });
});
