/**
 * 听力逐句点播（docs/listening-sentence-timings.md，2026-09-18）：
 *   点原文里的一句 → 播放器只放音频里对应的那一句。
 *
 * 钉住：
 *  1. AudioPlayer.playRange：定位到 start 提前 60ms、开声、到 end 就停；整段播放不受上一次 end 约束；
 *  2. SentenceTranscript：有时间戳逐句可点、null 句不可点、没时间戳退回原样文字 / 气泡；
 *     点句子时截住 mouseup（词典不弹），有选区时不截、不播（划词查词照常）；
 *  3. 历史页 LADetail / LCDetail 与练习结果页接上了：点句 → currentTime 落到那一句、play 被调。
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createRef } from "react";
import { AudioPlayer } from "../components/listening/AudioPlayer";
import { SentenceTranscript, activeSentenceIndex } from "../components/listening/SentenceTranscript";
import { LADetail, LCDetail } from "../components/listening/ListeningProgressView";
import { SENTENCE_SEEK_LEAD_SEC } from "../lib/listening/sentenceTimings";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => null),
  getSavedTier: jest.fn(() => "free"),
}));
jest.mock("../lib/dict/lookup", () => ({
  lookupWord: jest.fn(async () => null),
  normalizeWord: (w) => String(w || "").toLowerCase(),
  prefetchShards: jest.fn(),
}));

const CLIP = "https://cdn.example/clip.mp3";
const TIMINGS = [
  { text: "Hey, I just got back from the library.", start: 0, end: 2.3 },
  { text: "Did you find the book?", start: 2.42, end: 3.5 },
  { text: "Not yet.", start: null, end: null },
  { text: "The librarian said it might be on hold.", start: 3.9, end: 6.1 },
];

let playMock, pauseMock, rafCbs;
beforeEach(() => {
  playMock = jest.fn().mockResolvedValue(undefined);
  pauseMock = jest.fn();
  window.HTMLMediaElement.prototype.play = playMock;
  window.HTMLMediaElement.prototype.pause = pauseMock;
  window.HTMLMediaElement.prototype.load = jest.fn();
  global.SpeechSynthesisUtterance = function (t) { this.text = t; };
  global.speechSynthesis = { speak: jest.fn(), cancel: jest.fn(), getVoices: () => [{ lang: "en-US", name: "Samantha" }], addEventListener: jest.fn(), removeEventListener: jest.fn() };
  // rAF 手动驱动：逐句刹车靠它轮询 currentTime
  rafCbs = [];
  window.requestAnimationFrame = (cb) => { rafCbs.push(cb); return rafCbs.length; };
  window.cancelAnimationFrame = jest.fn();
});
function flushRaf() { const cbs = rafCbs; rafCbs = []; cbs.forEach((cb) => cb(0)); }

// jsdom 不实现媒体：补可读写的 currentTime / duration / readyState。
function stubMedia(audioEl, { duration = 60 } = {}) {
  let t = 0;
  Object.defineProperty(audioEl, "duration", { configurable: true, get: () => duration });
  Object.defineProperty(audioEl, "readyState", { configurable: true, get: () => 1 });
  Object.defineProperty(audioEl, "currentTime", { configurable: true, get: () => t, set: (v) => { t = v; } });
  return { get currentTime() { return t; }, set currentTime(v) { t = v; } };
}
const audioEl = () => document.querySelector("audio");

describe("activeSentenceIndex", () => {
  test("start ≤ t < end 命中；间隙 / null 句 / 坏列表 → -1", () => {
    expect(activeSentenceIndex(TIMINGS, 0)).toBe(0);
    expect(activeSentenceIndex(TIMINGS, 2.35)).toBe(-1);
    expect(activeSentenceIndex(TIMINGS, 3.0)).toBe(1);
    expect(activeSentenceIndex(TIMINGS, 5)).toBe(3);
    expect(activeSentenceIndex(null, 1)).toBe(-1);
    expect(activeSentenceIndex([{ text: "" }], 1)).toBe(-1);
  });
});

describe("AudioPlayer.playRange —— 只放一句", () => {
  test("定位到 start-提前量、开声、播到 end 就 pause；onTime 回报位置", () => {
    const ref = createRef();
    const onTime = jest.fn();
    render(<AudioPlayer ref={ref} compact src={CLIP} text="x" isPractice onTime={onTime} />);
    const media = stubMedia(audioEl());
    act(() => { fireEvent(audioEl(), new Event("loadedmetadata")); });
    pauseMock.mockClear(); // 挂载时的重置 effect 会 pause 一次，与逐句刹车无关

    let ok;
    act(() => { ok = ref.current.playRange(2.42, 3.5); });
    expect(ok).toBe(true);
    expect(media.currentTime).toBeCloseTo(2.42 - SENTENCE_SEEK_LEAD_SEC, 3);
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /缓冲中|Playing/ })).toBeInTheDocument();

    // 还没到 end：不停
    media.currentTime = 3.0;
    act(() => { flushRaf(); });
    expect(pauseMock).not.toHaveBeenCalled();
    expect(onTime).toHaveBeenCalledWith(3.0);
    // 到 end：刹车
    media.currentTime = 3.51;
    act(() => { flushRaf(); });
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /继续|Replay/ })).toBeInTheDocument();
  });

  test("timeupdate 是兜底刹车（后台标签页 rAF 挂起时）", () => {
    const ref = createRef();
    render(<AudioPlayer ref={ref} compact src={CLIP} text="x" isPractice />);
    const media = stubMedia(audioEl());
    pauseMock.mockClear();
    act(() => { ref.current.playRange(0, 2.3); });
    media.currentTime = 2.31;
    act(() => { fireEvent(audioEl(), new Event("timeupdate")); });
    expect(pauseMock).toHaveBeenCalledTimes(1);
  });

  test("整段播放不受上一次逐句 end 约束：点 Replay 后越过旧 end 也不停", () => {
    const ref = createRef();
    render(<AudioPlayer ref={ref} compact src={CLIP} text="x" isPractice />);
    const media = stubMedia(audioEl());
    pauseMock.mockClear();
    act(() => { ref.current.playRange(0, 2.3); });
    media.currentTime = 2.31;
    act(() => { flushRaf(); });
    expect(pauseMock).toHaveBeenCalledTimes(1);
    // 整段重放
    fireEvent.click(screen.getByRole("button", { name: /继续|Replay/ }));
    media.currentTime = 10;
    act(() => { fireEvent(audioEl(), new Event("timeupdate")); flushRaf(); });
    expect(pauseMock).toHaveBeenCalledTimes(1); // 没再刹
  });

  test("start-提前量不会跌到负数；非法区间返回 false；不可定位（无 src）返回 false", () => {
    const ref = createRef();
    const { unmount } = render(<AudioPlayer ref={ref} compact src={CLIP} text="x" isPractice />);
    const media = stubMedia(audioEl());
    let ok;
    act(() => { ok = ref.current.playRange(0.02, 1); });
    expect(ok).toBe(true);
    expect(media.currentTime).toBe(0);
    act(() => { ok = ref.current.playRange(3, 2); });
    expect(ok).toBe(false);
    unmount();
    const ref2 = createRef();
    render(<AudioPlayer ref={ref2} compact src={null} text="spoken" isPractice />);
    expect(ref2.current.seekable).toBe(false);
    act(() => { ok = ref2.current.playRange(0, 1); });
    expect(ok).toBe(false);
  });
});

describe("SentenceTranscript", () => {
  test("有时间戳：逐句渲染，可点句是 button，null 句不是；点句回调下标", () => {
    const onPick = jest.fn();
    render(<SentenceTranscript timings={TIMINGS} transcript="whole" onPick={onPick} />);
    const buttons = screen.getAllByRole("button", { name: "播放这一句" });
    expect(buttons).toHaveLength(3);
    expect(screen.getByText("Not yet.")).not.toHaveAttribute("role");
    fireEvent.click(screen.getByText("Did you find the book?"));
    expect(onPick).toHaveBeenCalledWith(1, expect.objectContaining({ start: 2.42, end: 3.5 }));
    expect(screen.getByText(/点句子播放该句/)).toBeInTheDocument();
  });

  test("没时间戳：paragraph 退回整段文字，turns 退回原对话气泡，都没有提示行", () => {
    const { unmount } = render(<SentenceTranscript timings={null} transcript="Plain text here." />);
    expect(screen.getByText("Plain text here.")).toBeInTheDocument();
    expect(screen.queryByText(/点句子播放该句/)).toBeNull();
    unmount();
    render(<SentenceTranscript variant="turns" timings={undefined} conversation={[{ speaker: "Woman", text: "Hi there." }, { speaker: "Man", text: "Hello." }]} />);
    expect(screen.getByText("Woman")).toBeInTheDocument();
    expect(screen.getByText("Hello.")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  test("turns：按 turn 分组成气泡，同一轮的句子在同一个气泡里", () => {
    const conv = [
      { text: "Hi there.", start: 0, end: 1, turn: 0, speaker: "Woman" },
      { text: "Quick question.", start: 1.1, end: 2, turn: 0, speaker: "Woman" },
      { text: "Sure.", start: 2.3, end: 2.8, turn: 1, speaker: "Man" },
    ];
    render(<SentenceTranscript variant="turns" timings={conv} onPick={() => {}} />);
    expect(screen.getAllByText("Woman")).toHaveLength(1);
    expect(screen.getByText("Man")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "播放这一句" })).toHaveLength(3);
  });

  test("点句截住 mouseup（词典不弹）；有选区时不截也不播", () => {
    const onPick = jest.fn();
    const outerUp = jest.fn();
    render(<div onMouseUp={outerUp}><SentenceTranscript timings={TIMINGS} onPick={onPick} /></div>);
    const el = screen.getByText("Did you find the book?");
    fireEvent.mouseUp(el);
    expect(outerUp).not.toHaveBeenCalled();
    // 模拟划词：有非空选区
    const orig = window.getSelection;
    window.getSelection = () => ({ isCollapsed: false, toString: () => "book" });
    fireEvent.mouseUp(el);
    expect(outerUp).toHaveBeenCalledTimes(1);
    fireEvent.click(el);
    expect(onPick).not.toHaveBeenCalled();
    window.getSelection = orig;
  });

  test("activeIndex 那句带高亮（aria-pressed）", () => {
    render(<SentenceTranscript timings={TIMINGS} activeIndex={1} onPick={() => {}} />);
    expect(screen.getByText("Did you find the book?")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Hey, I just got back from the library.")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("历史页接线", () => {
  const laSession = (over = {}) => ({
    id: 1, type: "listening", date: "2026-09-18T10:00:00.000Z",
    details: {
      subtype: "lat", itemIds: ["lat-1"],
      transcript: TIMINGS.map((t) => t.text).join(" "),
      questions: [], results: [], audio_url: CLIP, sentence_timings: TIMINGS, ...over,
    },
  });

  test("LADetail：点一句 → 播放器定位到那一句并开声；播放位置变化时高亮跟着走", () => {
    render(<LADetail session={laSession()} />);
    const media = stubMedia(audioEl());
    fireEvent.click(screen.getByText("The librarian said it might be on hold."));
    expect(media.currentTime).toBeCloseTo(3.9 - SENTENCE_SEEK_LEAD_SEC, 3);
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("The librarian said it might be on hold.")).toHaveAttribute("aria-pressed", "true");
    media.currentTime = 3.0;
    act(() => { fireEvent(audioEl(), new Event("timeupdate")); });
    expect(screen.getByText("Did you find the book?")).toHaveAttribute("aria-pressed", "true");
    // 播放头落进句间静音（3.5–3.9）：高亮留在刚放完的那句，不清空
    media.currentTime = 3.6;
    act(() => { fireEvent(audioEl(), new Event("timeupdate")); });
    expect(screen.getByText("Did you find the book?")).toHaveAttribute("aria-pressed", "true");
  });

  test("LADetail：老记录没有 sentence_timings → 原文照旧整段显示，没有可点句", () => {
    render(<LADetail session={laSession({ sentence_timings: undefined })} />);
    expect(screen.queryAllByRole("button", { name: "播放这一句" })).toHaveLength(0);
    expect(screen.getByText(/Hey, I just got back from the library\. Did you find/)).toBeInTheDocument();
  });

  test("LADetail：有时间戳但没有真实音频（TTS 兜底）→ 不逐句", () => {
    render(<LADetail session={laSession({ audio_url: null })} />);
    expect(screen.queryAllByRole("button", { name: "播放这一句" })).toHaveLength(0);
  });

  test("LCDetail：气泡里逐句可点", () => {
    const conv = [{ speaker: "Woman", text: "Hi there. Quick question." }, { speaker: "Man", text: "Sure." }];
    const timings = [
      { text: "Hi there.", start: 0, end: 1, turn: 0, speaker: "Woman" },
      { text: "Quick question.", start: 1.1, end: 2, turn: 0, speaker: "Woman" },
      { text: "Sure.", start: 2.3, end: 2.8, turn: 1, speaker: "Man" },
    ];
    render(<LCDetail session={{ id: 2, type: "listening", date: "2026-09-18T10:00:00.000Z", details: { subtype: "lc", itemIds: ["lc-1"], conversation: conv, questions: [], results: [], audio_url: CLIP, sentence_timings: timings } }} />);
    const media = stubMedia(audioEl());
    fireEvent.click(screen.getByText("Sure."));
    expect(media.currentTime).toBeCloseTo(2.3 - SENTENCE_SEEK_LEAD_SEC, 3);
    expect(playMock).toHaveBeenCalledTimes(1);
  });
});
