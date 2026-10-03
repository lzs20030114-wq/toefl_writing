import { fireEvent, render, screen, act, within } from "@testing-library/react";
import { ListeningVocabReview } from "../components/vocab/ListeningVocabReview";
import { RATING, STATE } from "../lib/vocab/srs";
import { canSpeak, cancelSpeakWord, speakWord } from "../lib/audio/speakWord";

jest.mock("../lib/audio/speakWord", () => ({ canSpeak: jest.fn(() => true), cancelSpeakWord: jest.fn(), speakWord: jest.fn() }));

const card = {
  word: "habitat", display: "habitat", phonetic: "ˈhæbɪtæt", def: "栖息地",
  sentence: "The habitat is fragile.", state: STATE.NEW,
};

let originalAudio;
let audios;
beforeEach(() => {
  originalAudio = global.Audio;
  audios = [];
  global.Audio = class {
    constructor(src) { this.src = src; this.currentTime = 0; this.pause = jest.fn(); this.load = jest.fn(); this.removeAttribute = jest.fn(); audios.push(this); }
    play() { return Promise.resolve(); }
  };
  canSpeak.mockReturnValue(true);
  speakWord.mockReset();
  speakWord.mockReturnValue(true);
  cancelSpeakWord.mockClear();
});
afterEach(() => { global.Audio = originalAudio; });

test("即使有完整原句音频也只自动播放单词，不创建 Audio 或显示原句", () => {
  const onGrade = jest.fn(() => null);
  render(<ListeningVocabReview initialQueue={[{ ...card, listeningContext: { audioUrl: "/api/audio/x.mp3", start: 1, end: 3, text: card.sentence } }]} onGrade={onGrade} onExit={jest.fn()} />);
  expect(audios).toHaveLength(0);
  expect(speakWord).toHaveBeenCalledWith("habitat", expect.any(Object));
  expect(screen.queryByText("habitat")).toBeNull();
  expect(screen.queryByText("栖息地")).toBeNull();
  expect(screen.queryByText(card.sentence)).toBeNull();
  expect(screen.queryByText(/hæbɪtæt/)).toBeNull();
  expect(screen.queryByRole("button", { name: "显示答案" })).toBeNull();
  act(() => speakWord.mock.calls[0][1].onStart());
  expect(screen.queryByRole("button", { name: "显示答案" })).toBeNull();
  act(() => speakWord.mock.calls[0][1].onEnd());
  fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
  expect(screen.getByText("habitat")).toBeInTheDocument();
  expect(screen.queryByText(card.sentence)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "听懂了" }));
  expect(onGrade).toHaveBeenCalledWith("habitat", RATING.GOOD, expect.any(Number), "listening");
});

test("无法出声时提示并可跳过，跳过与退出均不评分且停止声音", () => {
  canSpeak.mockReturnValue(false);
  const onGrade = jest.fn();
  const onExit = jest.fn();
  render(<ListeningVocabReview initialQueue={[card, { ...card, word: "forest", display: "forest" }]} onGrade={onGrade} onExit={onExit} />);
  fireEvent.click(screen.getByRole("button", { name: "播放单词发音" }));
  expect(screen.getByRole("status")).toHaveTextContent("无法播放");
  expect(screen.queryByRole("button", { name: "显示答案" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "跳过这张卡" }));
  expect(onGrade).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "退出复习" }));
  expect(onExit).toHaveBeenCalled();
  expect(cancelSpeakWord).toHaveBeenCalled();
});

test("单词发音中途失败不解锁，换卡后迟到的成功回调也不解锁", () => {
  const onGrade = jest.fn();
  render(<ListeningVocabReview initialQueue={[card, { ...card, word: "forest", display: "forest" }]} onGrade={onGrade} onExit={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "播放单词发音" }));
  const callbacks = speakWord.mock.calls[0][1];
  act(() => callbacks.onStart());
  act(() => callbacks.onError());
  expect(screen.queryByRole("button", { name: "显示答案" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "跳过这张卡" }));
  act(() => callbacks.onEnd());
  expect(screen.queryByRole("button", { name: "显示答案" })).not.toBeInTheDocument();
  expect(onGrade).not.toHaveBeenCalled();
});

test("暂停停止单词发音，迟到完成事件不解锁", () => {
  render(<ListeningVocabReview initialQueue={[card]} onGrade={jest.fn()} onExit={jest.fn()} />);
  const lateEnd = speakWord.mock.calls[0][1].onEnd;
  fireEvent.click(screen.getByRole("button", { name: "暂停播放" }));
  act(() => lateEnd());
  expect(screen.queryByRole("button", { name: "显示答案" })).toBeNull();
  expect(cancelSpeakWord).toHaveBeenCalled();
});

test("发音失败后的迟到成功不解锁，空格重试正常结束才解锁", () => {
  render(<ListeningVocabReview initialQueue={[card]} onGrade={jest.fn()} onExit={jest.fn()} />);
  const failed = speakWord.mock.calls[0][1];
  act(() => { failed.onError(); failed.onEnd(); });
  expect(screen.queryByRole("button", { name: "显示答案" })).toBeNull();
  fireEvent.keyDown(window, { key: " " });
  act(() => speakWord.mock.calls[1][1].onEnd());
  expect(screen.getByRole("button", { name: "显示答案" })).toBeInTheDocument();
});

test("收藏语境仍用于选义，不显示或播放该句", () => {
  const spoken = "The bank approved the loan.";
  const other = "The bank beside the river was quiet.";
  const entry = { ...card, word: "bank", display: "bank", def: "河岸专用义", sentence: other, contextSenses: [{ sentence: spoken, def: "银行专用义" }, { sentence: other, def: "河岸专用义" }], listeningContext: { audioUrl: "/api/audio/x.mp3", start: 0, end: 3, text: spoken } };
  render(<ListeningVocabReview initialQueue={[entry]} onGrade={() => null} onExit={() => {}} />);
  act(() => speakWord.mock.calls[0][1].onEnd());
  fireEvent.keyDown(window, { key: "Enter" });
  expect(screen.getByText("银行专用义")).toBeInTheDocument();
  expect(screen.queryByText("河岸专用义")).toBeNull();
  expect(screen.queryByText(spoken)).toBeNull();
  expect(audios).toHaveLength(0);
});

// ── 撤销 / 结算页 ──
const farFuture = () => new Date(Date.now() + 3 * 86400000).toISOString();
const forest = { ...card, word: "forest", display: "forest", def: "森林", phonetic: "ˈfɒrɪst" };
const hearAndReveal = () => {
  fireEvent.click(screen.getByRole("button", { name: "播放单词发音" }));
  const callbacks = speakWord.mock.calls[speakWord.mock.calls.length - 1][1];
  act(() => callbacks.onStart());
  act(() => callbacks.onEnd());
  fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
};
const gradedAs = (label) => { hearAndReveal(); fireEvent.click(screen.getByRole("button", { name: label })); };
const gradeMock = () => jest.fn((word) => ({ ...(word === "forest" ? forest : card), due: farFuture() }));

describe("听力复习 · 撤销上一张", () => {
  test("评分后可撤销：外面收到词名，回到那张卡且已翻面，不用重新听；撤销后按钮再次禁用", () => {
    const onUndo = jest.fn(() => ({}));
    const onGrade = gradeMock();
    render(<ListeningVocabReview initialQueue={[card, forest]} onGrade={onGrade} onUndo={onUndo} onExit={jest.fn()} />);
    expect(screen.getByRole("button", { name: /撤销上一张/ })).toBeDisabled();

    gradedAs("没听懂");
    expect(onGrade).toHaveBeenCalledWith("habitat", RATING.AGAIN, expect.any(Number), "listening");
    expect(screen.getByText("已答 1 · 剩 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "显示答案" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /撤销上一张/ }));
    expect(onUndo).toHaveBeenCalledWith("habitat");
    expect(screen.getByText("已答 0 · 剩 2")).toBeInTheDocument();
    // 已听过、已翻面：答案和评分键直接可用
    expect(screen.getByText("栖息地")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "听懂了" }));
    expect(onGrade).toHaveBeenLastCalledWith("habitat", RATING.GOOD, expect.any(Number), "listening");
    expect(screen.getByRole("button", { name: /撤销上一张/ })).toBeEnabled();
  });

  test("Z 键撤销；外面没撤成（返回 null）时界面不动；跳过不进撤销栈", () => {
    const onUndo = jest.fn(() => null);
    render(<ListeningVocabReview initialQueue={[card, forest]} onGrade={gradeMock()} onUndo={onUndo} onExit={jest.fn()} />);
    gradedAs("听懂了");
    act(() => { fireEvent.keyDown(window, { key: "z" }); });
    expect(onUndo).toHaveBeenCalledWith("habitat");
    expect(screen.getByText("已答 1 · 剩 1")).toBeInTheDocument();

    onUndo.mockReturnValue({});
    act(() => { fireEvent.keyDown(window, { key: "Z" }); });
    expect(screen.getByText("已答 0 · 剩 2")).toBeInTheDocument();
    // 刚撤销完栈空了；跳过也不会让它重新可撤销
    fireEvent.click(screen.getByRole("button", { name: "跳过这张卡" }));
    expect(screen.getByRole("button", { name: /撤销上一张/ })).toBeDisabled();
  });

  test("没有 onUndo 时不显示撤销按钮", () => {
    render(<ListeningVocabReview initialQueue={[card]} onGrade={gradeMock()} onExit={jest.fn()} />);
    expect(screen.queryByRole("button", { name: /撤销上一张/ })).not.toBeInTheDocument();
  });
});

describe("听力复习 · 结算页", () => {
  test("复盘：听懂比例、没听懂的词、前后变化、下一步（阅读复习）", () => {
    const onExportWords = jest.fn();
    const onStartNext = jest.fn();
    const onExit = jest.fn();
    const extras = { nextTask: { label: "阅读复习", todo: 9, minutes: 2 }, tomorrow: { n: 12, carried: 4 }, onStartNext, onExportWords };
    const props = { initialQueue: [card, forest], onGrade: gradeMock(), onExit, summaryExtras: extras };
    const { rerender } = render(<ListeningVocabReview {...props} statsNow={{ knowledge: 50, mature: 5, learning: 8 }} />);
    gradedAs("没听懂");
    rerender(<ListeningVocabReview {...props} statsNow={{ knowledge: 51, mature: 5, learning: 10 }} />);
    gradedAs("听懂了");

    expect(screen.getByText("这一轮听力复习完成")).toBeInTheDocument();
    expect(screen.getByText(/听力复习 · 用时 .* · 过了 2 个词，共 2 次提问/)).toBeInTheDocument();
    expect(screen.getByText("第一次就听懂")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 词")).toBeInTheDocument();
    expect(screen.getByText("50 →")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("这一轮没听懂的词")).toBeInTheDocument();
    expect(screen.getByText("栖息地")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导出这些词 PDF" }));
    expect(onExportWords).toHaveBeenCalledWith(["habitat"]);
    expect(screen.getByText("阅读复习还有 9 词")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始阅读复习" }));
    expect(onStartNext).toHaveBeenCalled();
    expect(screen.getByText("明天预计 12 词")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回单词本" }));
    expect(onExit).toHaveBeenCalled();
  });

  test("全部听懂时的文案；整轮都跳过则只给简短收尾", () => {
    const { unmount } = render(<ListeningVocabReview initialQueue={[card]} onGrade={gradeMock()} onExit={jest.fn()} />);
    gradedAs("听懂了");
    expect(screen.getByText("这一轮每个词都听懂了。")).toBeInTheDocument();
    unmount();

    const onGrade = jest.fn();
    render(<ListeningVocabReview initialQueue={[card, forest]} onGrade={onGrade} onExit={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "跳过这张卡" }));
    fireEvent.click(screen.getByRole("button", { name: "跳过这张卡" }));
    expect(screen.getByText("这一轮听力复习完成")).toBeInTheDocument();
    expect(screen.queryByText("第一次就听懂")).not.toBeInTheDocument();
    expect(onGrade).not.toHaveBeenCalled();
  });
});

// ── 分段存档 ──
const lcard = (i) => ({ ...card, word: `word${i}`, display: `word${i}`, def: `释义${i}`, phonetic: "" });
const lqueue = (n) => Array.from({ length: n }, (_, i) => lcard(i));
const lgrade = () => jest.fn((word) => ({ ...lcard(Number(word.slice(4))), due: farFuture() }));

describe("听力复习 · 分段存档", () => {
  test("每 10 个词弹小结并落存档；空格继续、下一段重新计数；存档点之后不能撤销", () => {
    const onCheckpoint = jest.fn();
    const onFinish = jest.fn();
    render(<ListeningVocabReview initialQueue={lqueue(12)} onGrade={lgrade()} onUndo={() => ({})} onCheckpoint={onCheckpoint} onFinish={onFinish} onExit={jest.fn()} />);
    expect(screen.getByText("本段 0 / 10")).toBeInTheDocument();
    for (let i = 0; i < 9; i += 1) gradedAs(i === 3 ? "没听懂" : "听懂了");
    expect(screen.getByText("本段 9 / 10")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    gradedAs("听懂了");

    const dialog = screen.getByRole("dialog", { name: "第 1 段复习完成" });
    expect(within(dialog).getByText("这 10 个词过完了")).toBeInTheDocument();
    expect(within(dialog).getByText("听懂了 9")).toBeInTheDocument();
    expect(within(dialog).getByText("没听懂 1")).toBeInTheDocument();
    expect(within(dialog).getByText("✓ 已存档")).toBeInTheDocument();
    expect(within(dialog).getByText(/没听懂的词已排到后面/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/^word\d$/)).toHaveLength(10);
    expect(onCheckpoint).toHaveBeenCalledTimes(1);
    expect(onCheckpoint.mock.calls[0][0]).toMatchObject({
      words: ["word10", "word11"], answered: 10, tally: { good: 9, again: 1 }, lost: ["word3"], segNo: 1,
      first: expect.objectContaining({ word3: false, word0: true }),
    });
    expect(screen.getByRole("button", { name: /撤销上一张/ })).toBeDisabled();
    expect(onFinish).not.toHaveBeenCalled();

    act(() => { fireEvent.keyDown(window, { key: " " }); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("本段 0 / 10")).toBeInTheDocument();
    expect(screen.getByText("已答 10 · 剩 2")).toBeInTheDocument();

    gradedAs("听懂了");
    gradedAs("听懂了");
    expect(screen.getByText("这一轮听力复习完成")).toBeInTheDocument();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  test("小结开着时不能评分也不能播放；先休息，退出 = 外面的退出并停止声音", () => {
    const onExit = jest.fn();
    const onGrade = lgrade();
    render(<ListeningVocabReview initialQueue={lqueue(11)} onGrade={onGrade} onExit={onExit} />);
    for (let i = 0; i < 10; i += 1) gradedAs("听懂了");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("✓ 已存档")).not.toBeInTheDocument(); // 没接存档回调，不谎称已存档
    const calls = speakWord.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "播放单词发音" }));
    expect(speakWord.mock.calls.length).toBe(calls);
    fireEvent.click(within(dialog).getByRole("button", { name: "先休息，退出" }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(cancelSpeakWord).toHaveBeenCalled();
    expect(onGrade).toHaveBeenCalledTimes(10);
  });

  test("从存档继续：带上已答张数、听懂/没听懂和段号，下一次存档的段号接着数", () => {
    const onCheckpoint = jest.fn();
    const resume = { answered: 10, tally: { good: 8, again: 2 }, first: { x: true }, seen: { x: 1 }, lost: ["y"], segNo: 1, elapsedMs: 60000, startStats: null };
    render(<ListeningVocabReview initialQueue={lqueue(11)} resume={resume} onGrade={lgrade()} onCheckpoint={onCheckpoint} onExit={jest.fn()} />);
    expect(screen.getByText("已从存档继续 · 第 2 段")).toBeInTheDocument();
    for (let i = 0; i < 10; i += 1) gradedAs("听懂了");
    expect(onCheckpoint.mock.calls[0][0]).toMatchObject({ answered: 20, tally: { good: 18, again: 2 }, segNo: 2, lost: ["y"] });
    expect(screen.getByRole("dialog", { name: "第 2 段复习完成" })).toBeInTheDocument();
  });

  test("一路跳过走到队尾也算结束，通知外面清存档", () => {
    const onFinish = jest.fn();
    render(<ListeningVocabReview initialQueue={lqueue(2)} onGrade={lgrade()} onFinish={onFinish} onExit={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "跳过这张卡" }));
    expect(onFinish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "跳过这张卡" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});


describe("听力操作与自动播放", () => {
  test("进入、评分、跳过、再次出现自动播；翻面、重渲染、撤销和结束不重播", () => {
    const onGrade = jest.fn((word) => ({ ...(word === "habitat" ? card : forest), due: new Date().toISOString() }));
    const props = { initialQueue: [card, forest, ...lqueue(10)], onGrade, onUndo: () => ({}), onExit: jest.fn() };
    const { rerender } = render(<ListeningVocabReview {...props} />);
    expect(speakWord).toHaveBeenCalledTimes(1);
    act(() => speakWord.mock.calls[0][1].onEnd());
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByText("栖息地")).toBeInTheDocument();
    rerender(<ListeningVocabReview {...props} statsNow={{ knowledge: 2 }} />);
    expect(speakWord).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "1" });
    expect(speakWord).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: "z" });
    expect(speakWord).toHaveBeenCalledTimes(2);
    expect(screen.getByText("栖息地")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "2" });
    expect(speakWord).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 10; i += 1) fireEvent.click(screen.getByRole("button", { name: "跳过这张卡" }));
    expect(speakWord).toHaveBeenLastCalledWith("habitat", expect.any(Object));
    expect(screen.getByText("再次出现 · 第 2 次")).toBeInTheDocument();
    while (screen.queryByRole("button", { name: "跳过这张卡" })) fireEvent.click(screen.getByRole("button", { name: "跳过这张卡" }));
    const calls = speakWord.mock.calls.length;
    fireEvent.keyDown(window, { key: " " });
    expect(speakWord).toHaveBeenCalledTimes(calls);
  });

  test("空格在评分按钮上只重播；Enter 留给原生按钮，数字评分及卡面翻面", () => {
    const onGrade = gradeMock();
    render(<ListeningVocabReview initialQueue={[card, forest]} onGrade={onGrade} onExit={jest.fn()} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.queryByText("栖息地")).toBeNull();
    act(() => speakWord.mock.calls[0][1].onEnd());
    fireEvent.click(screen.getByText("听词"));
    const good = screen.getByRole("button", { name: "听懂了" });
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    fireEvent(good, space);
    expect(space.defaultPrevented).toBe(true);
    expect(speakWord).toHaveBeenCalledTimes(2);
    expect(onGrade).not.toHaveBeenCalled();
    fireEvent.keyDown(good, { key: "Enter" });
    expect(onGrade).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onGrade).toHaveBeenCalledWith("habitat", RATING.GOOD, expect.any(Number), "listening");
  });

  test("忽略重复、修饰键、输入、可编辑区域及已处理事件", () => {
    render(<ListeningVocabReview initialQueue={[card]} onGrade={gradeMock()} onExit={jest.fn()} />);
    for (const extra of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }]) fireEvent.keyDown(window, { key: " ", ...extra });
    const input = document.createElement("input");
    const editable = document.createElement("div"); editable.contentEditable = "true"; editable.setAttribute("contenteditable", "true");
    document.body.append(input, editable);
    fireEvent.keyDown(input, { key: " " }); fireEvent.keyDown(editable, { key: " " });
    const prevented = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }); prevented.preventDefault(); fireEvent(window, prevented);
    expect(speakWord).toHaveBeenCalledTimes(1);
    input.remove(); editable.remove();
  });

  test("小结不自动播，继续仅播下一张；撤销仍受存档边界保护", () => {
    render(<ListeningVocabReview initialQueue={lqueue(12)} onGrade={lgrade()} onUndo={() => ({})} onExit={jest.fn()} />);
    for (let i = 0; i < 10; i += 1) {
      act(() => speakWord.mock.calls.at(-1)[1].onEnd());
      fireEvent.keyDown(window, { key: "Enter" });
      fireEvent.keyDown(window, { key: "2" });
    }
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(speakWord).toHaveBeenCalledTimes(10);
    fireEvent.keyDown(window, { key: "z" });
    expect(speakWord).toHaveBeenCalledTimes(10);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(speakWord).toHaveBeenCalledTimes(11);
    expect(speakWord).toHaveBeenLastCalledWith("word10", expect.any(Object));
  });

  test("背面可编辑释义且不重播，暂停移除同词并自动播放下一张", () => {
    const onEditDefinition = jest.fn(() => ({ ...card, def: "新的释义" }));
    const onSuspend = jest.fn(() => true);
    render(<ListeningVocabReview initialQueue={[card, forest]} onGrade={gradeMock()} onExit={jest.fn()} onEditDefinition={onEditDefinition} onSuspend={onSuspend} />);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.queryByRole("menuitem", { name: "编辑释义" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    act(() => speakWord.mock.calls[0][1].onEnd());
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "编辑释义" }));
    fireEvent.change(screen.getByRole("textbox", { name: "编辑释义" }), { target: { value: "新的释义" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: " " });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onEditDefinition).toHaveBeenCalledWith("habitat", "新的释义");
    expect(screen.getByText("新的释义")).toBeInTheDocument();
    expect(speakWord).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "暂停复习这个词" }));
    expect(onSuspend).toHaveBeenCalledWith("habitat");
    expect(speakWord).toHaveBeenCalledTimes(2);
    expect(speakWord).toHaveBeenLastCalledWith("forest", expect.any(Object));
  });
});


test("菜单打开时不评分，Escape 与点击卡面关闭；输入期不抢评分键", () => {
  const onGrade = gradeMock();
  render(<ListeningVocabReview initialQueue={[card, forest]} onGrade={onGrade} onExit={jest.fn()} onSuspend={() => true} onEditDefinition={() => card} />);
  act(() => speakWord.mock.calls[0][1].onEnd());
  fireEvent.keyDown(window, { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.keyDown(window, { key: "1" });
  expect(onGrade).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(screen.getByText("听词"));
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "编辑释义" }));
  fireEvent.keyDown(window, { key: "1" });
  expect(onGrade).not.toHaveBeenCalled();
});
