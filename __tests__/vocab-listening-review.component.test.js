import { fireEvent, render, screen, act } from "@testing-library/react";
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

test("正面不泄词、音标、释义或原句；播放成功后才能翻面评分", () => {
  const onGrade = jest.fn(() => null);
  render(<ListeningVocabReview initialQueue={[{ ...card, listeningContext: { audioUrl: "/api/audio/x.mp3", start: 1, end: 3, text: card.sentence } }]} onGrade={onGrade} onExit={jest.fn()} />);
  expect(screen.queryByText("habitat")).not.toBeInTheDocument();
  expect(screen.queryByText("栖息地")).not.toBeInTheDocument();
  expect(screen.queryByText(card.sentence)).not.toBeInTheDocument();
  expect(screen.queryByText(/hæbɪtæt/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "显示答案" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "播放原句" }));
  expect(audios[0].src).toBe("/api/audio/x.mp3");
  act(() => audios[0].onloadedmetadata());
  expect(audios[0].currentTime).toBeLessThanOrEqual(1);
  expect(audios[0].currentTime).toBeGreaterThan(0.9);
  expect(screen.queryByRole("button", { name: "显示答案" })).not.toBeInTheDocument();
  act(() => audios[0].onplaying());
  expect(screen.queryByRole("button", { name: "显示答案" })).not.toBeInTheDocument();
  act(() => { audios[0].currentTime = 3; audios[0].ontimeupdate(); });
  fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
  expect(screen.getByText("habitat")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "听懂了" }));
  expect(onGrade).toHaveBeenCalledWith("habitat", RATING.GOOD, expect.any(Number), "listening");
  expect(audios[0].pause).toHaveBeenCalled();
});

test("原句失败回退单词发音；只有正常播完才能翻面", () => {
  const onGrade = jest.fn(() => null);
  render(<ListeningVocabReview initialQueue={[{ ...card, listeningContext: { audioUrl: "/api/audio/x.mp3", start: 0, end: 2, text: card.sentence } }]} onGrade={onGrade} onExit={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "播放原句" }));
  act(() => audios[0].onerror());
  expect(speakWord).toHaveBeenCalledWith("habitat", expect.objectContaining({ onStart: expect.any(Function) }));
  expect(screen.queryByRole("button", { name: "显示答案" })).not.toBeInTheDocument();
  act(() => speakWord.mock.calls[0][1].onStart());
  expect(screen.queryByRole("button", { name: "显示答案" })).not.toBeInTheDocument();
  act(() => speakWord.mock.calls[0][1].onEnd());
  expect(screen.getByRole("button", { name: "显示答案" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
  fireEvent.click(screen.getByRole("button", { name: "没听懂" }));
  expect(onGrade).toHaveBeenCalledWith("habitat", RATING.AGAIN, expect.any(Number), "listening");
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

test("原句加载超时回退；迟到的元数据事件不能再播放旧音频", () => {
  jest.useFakeTimers();
  const onGrade = jest.fn();
  render(<ListeningVocabReview initialQueue={[{ ...card, listeningContext: { audioUrl: "/api/audio/x.mp3", start: 0, end: 2, text: card.sentence } }]} onGrade={onGrade} onExit={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "播放原句" }));
  const late = audios[0].onloadedmetadata;
  act(() => jest.advanceTimersByTime(15000));
  expect(speakWord).toHaveBeenCalledTimes(1);
  act(() => late());
  expect(audios[0].currentTime).toBe(0);
  expect(onGrade).not.toHaveBeenCalled();
  jest.useRealTimers();
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

test("暂停后停止原句，迟到的完成事件不解锁", () => {
  const onGrade = jest.fn();
  render(<ListeningVocabReview initialQueue={[{ ...card, listeningContext: { audioUrl: "/api/audio/x.mp3", start: 0, end: 2, text: card.sentence } }]} onGrade={onGrade} onExit={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "播放原句" }));
  const latePlaying = audios[0].onplaying;
  fireEvent.click(screen.getByRole("button", { name: "暂停播放" }));
  expect(audios[0].pause).toHaveBeenCalled();
  act(() => latePlaying());
  expect(screen.queryByRole("button", { name: "显示答案" })).not.toBeInTheDocument();
  expect(onGrade).not.toHaveBeenCalled();
});


test("听力语境释义绑定实际原句，正面不泄露，翻面不误用另一句首选", () => {
  const spoken = "The bank approved the loan.";
  const other = "The bank beside the river was quiet.";
  const entry = { ...card, word: "bank", display: "bank", def: "河岸专用义", baseDef: "通用义", sentence: other, sentences: [spoken], contextSenses: [{ sentence: spoken, def: "银行专用义", updatedAt: "2026-10-01T10:00:00Z" }, { sentence: other, def: "河岸专用义", updatedAt: "2026-10-01T10:00:00Z" }], listeningContext: { audioUrl: "/api/audio/x.mp3", start: 0, end: 3, text: spoken } };
  render(<ListeningVocabReview initialQueue={[entry]} onGrade={() => null} onExit={() => {}} />);
  expect(screen.queryByText("银行专用义")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "播放原句" }));
  act(() => audios[0].onloadedmetadata());
  act(() => audios[0].onplaying());
  act(() => { audios[0].currentTime = 3; audios[0].ontimeupdate(); });
  fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
  expect(screen.getByText("银行专用义")).toBeTruthy();
  expect(screen.queryByText("河岸专用义")).toBeNull();
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
    expect(screen.getByText("听力复习 · 2 / 2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "显示答案" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /撤销上一张/ }));
    expect(onUndo).toHaveBeenCalledWith("habitat");
    expect(screen.getByText("听力复习 · 1 / 2")).toBeInTheDocument();
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
    expect(screen.getByText("听力复习 · 2 / 2")).toBeInTheDocument();

    onUndo.mockReturnValue({});
    act(() => { fireEvent.keyDown(window, { key: "Z" }); });
    expect(screen.getByText("听力复习 · 1 / 2")).toBeInTheDocument();
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
