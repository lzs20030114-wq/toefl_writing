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
