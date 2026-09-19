/**
 * 听力逐句点播（docs/listening-sentence-timings.md，2026-09-18）：
 *   点原文里的一句 → 播放器只放音频里对应的那一句。
 *
 * 钉住：
 *  1. AudioPlayer.playRange：定位到 start 提前 60ms、开声、到 end 就停；整段播放不受上一次 end 约束；
 *  2. SentenceTranscript：有时间戳的句子前面一个 ▶ 播放键、null 句没有键、没时间戳退回原样文字 / 气泡；
 *  3. 手势分工（2026-09-19 改）：点 ▶ 键 = 播放这一句且词典不弹；点文字里的词 = 弹词典且不播；
 *     词典弹窗在可播放句里打开时多一颗「听这一句」，阅读场景（没传 onPlaySentence）没有这颗；
 *  4. 历史页 LADetail / LCDetail 与练习结果页接上了：点键 → currentTime 落到那一句、play 被调。
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createRef } from "react";
import { AudioPlayer } from "../components/listening/AudioPlayer";
import { SentenceTranscript, activeSentenceIndex, pinnedSentenceIndex, sentenceAt } from "../components/listening/SentenceTranscript";
import { WordLookupLayer } from "../components/reading/WordLookupLayer";
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
/** 句前的 ▶ 播放键，按可播放句在 DOM 里的先后顺序。 */
const playKeys = () => screen.queryAllByRole("button", { name: "播放这一句" });

// 句子 span 里是「nowrap(▶ 键 + 首词)」+「其余文字」两段，整句文本要按 textContent 找。
function sentenceEl(text) {
  const el = [...document.querySelectorAll("[data-sentence-index]")].find((e) => e.textContent === text);
  if (!el) throw new Error("找不到句子: " + text);
  return el;
}

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

describe("sentenceAt", () => {
  test("按下标取回体检后的那一句；越界 / 没时间戳返回 null", () => {
    expect(sentenceAt(TIMINGS, 1)).toEqual(expect.objectContaining({ start: 2.42, end: 3.5 }));
    expect(sentenceAt(TIMINGS, 9)).toBeNull();
    expect(sentenceAt(null, 0)).toBeNull();
  });
});

describe("SentenceTranscript", () => {
  test("有时间戳：可播放句前面一个 ▶ 键，null 句没有；点键回调下标", () => {
    const onPick = jest.fn();
    render(<SentenceTranscript timings={TIMINGS} transcript="whole" onPick={onPick} />);
    expect(playKeys()).toHaveLength(3);
    // 文字本身不再是按钮，事件全留给外层词典
    expect(sentenceEl("Did you find the book?")).not.toHaveAttribute("role");
    expect(sentenceEl("Not yet.")).not.toHaveAttribute("role");
    fireEvent.click(playKeys()[1]);
    expect(onPick).toHaveBeenCalledWith(1, expect.objectContaining({ start: 2.42, end: 3.5 }));
    expect(screen.getByText(/点 ▶ 播放该句/)).toBeInTheDocument();
  });

  test("没时间戳：paragraph 退回整段文字，turns 退回原对话气泡，都没有提示行", () => {
    const { unmount } = render(<SentenceTranscript timings={null} transcript="Plain text here." />);
    expect(screen.getByText("Plain text here.")).toBeInTheDocument();
    expect(screen.queryByText(/点 ▶ 播放该句/)).toBeNull();
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
    expect(playKeys()).toHaveLength(3);
  });

  test("文字上不挂事件：mouseup 照常冒泡给外层词典层", () => {
    const outerUp = jest.fn();
    render(<div onMouseUp={outerUp}><SentenceTranscript timings={TIMINGS} onPick={() => {}} /></div>);
    fireEvent.mouseUp(sentenceEl("Did you find the book?"));
    expect(outerUp).toHaveBeenCalledTimes(1);
  });

  test("activeIndex 那句：文字高亮 + 播放键激活态", () => {
    render(<SentenceTranscript timings={TIMINGS} activeIndex={1} onPick={() => {}} />);
    expect(sentenceEl("Did you find the book?")).toHaveStyle({ background: "#F3E8FF" });
    expect(sentenceEl("Hey, I just got back from the library.")).toHaveStyle({ background: "transparent" });
    expect(playKeys()[1]).toHaveStyle({ background: "#8B5CF6" });
    expect(playKeys()[0]).toHaveStyle({ background: "#fff" });
  });
});

// 2026-09-19：听力原文上「点键播放 / 点词查词」两件事共存，靠的是播放键带 data-no-dict。
// 这一组挂真的 WordLookupLayer，而不是模拟一个 onMouseUp —— 分工判错就是从这里漏的。
describe("与划词词典共存", () => {
  const realCaret = document.caretRangeFromPoint;
  const realRect = Range.prototype.getBoundingClientRect;
  let caretHost = null; // 让 caretRangeFromPoint 落到哪个文本节点上

  beforeEach(() => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    document.caretRangeFromPoint = () => {
      if (!caretHost || !caretHost.lastChild) return null;
      const r = document.createRange();
      // 句子 = [nowrap(▶ + 首词 "Did")][" you find the book?"]，落点在后一个文本节点里的 you 上
      r.setStart(caretHost.lastChild, 2);
      r.collapse(true);
      return r;
    };
    Range.prototype.getBoundingClientRect = () => ({ top: 100, bottom: 116, left: 40, right: 100, width: 60, height: 16 });
  });
  afterEach(() => {
    document.caretRangeFromPoint = realCaret;
    Range.prototype.getBoundingClientRect = realRect;
    caretHost = null;
  });

  function mount({ onPick = jest.fn(), onPlaySentence } = {}) {
    render(
      <WordLookupLayer passage={TIMINGS.map((t) => t.text).join(" ")} source="listening" onPlaySentence={onPlaySentence}>
        <SentenceTranscript timings={TIMINGS} onPick={onPick} />
      </WordLookupLayer>
    );
    caretHost = sentenceEl("Did you find the book?");
    return { onPick };
  }

  test("点 ▶ 键：播放回调被调，词典不弹", async () => {
    const { onPick } = mount();
    const key = playKeys()[1];
    fireEvent.click(key);
    fireEvent.mouseUp(key, { clientX: 50, clientY: 108 });
    expect(onPick).toHaveBeenCalledWith(1, expect.objectContaining({ start: 2.42 }));
    await act(async () => {});
    expect(screen.queryByText("you")).toBeNull();
  });

  test("点句子文字里的词：词典弹出，播放回调不被调", async () => {
    const { onPick } = mount();
    fireEvent.mouseUp(caretHost, { clientX: 50, clientY: 108 });
    expect(await screen.findByText("you")).toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
  });

  test("可播放句里查词 → 弹窗有「听这一句」，点它拿到该句下标且弹窗不关", async () => {
    const onPlaySentence = jest.fn();
    mount({ onPlaySentence });
    fireEvent.mouseUp(caretHost, { clientX: 50, clientY: 108 });
    const btn = await screen.findByText(/听这一句/);
    fireEvent.click(btn);
    expect(onPlaySentence).toHaveBeenCalledWith(1);
    expect(screen.getByText("you")).toBeInTheDocument(); // 弹窗还开着
  });

  test("没传 onPlaySentence（阅读复盘）→ 弹窗里没有「听这一句」", async () => {
    mount();
    fireEvent.mouseUp(caretHost, { clientX: 50, clientY: 108 });
    expect(await screen.findByText("you")).toBeInTheDocument();
    expect(screen.queryByText(/听这一句/)).toBeNull();
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

  test("LADetail：点某句的 ▶ 键 → 播放器定位到那一句并开声；播放位置变化时高亮跟着走", () => {
    render(<LADetail session={laSession()} />);
    const media = stubMedia(audioEl());
    fireEvent.click(playKeys()[2]); // 可播放句是 0/1/3，第三个键 = 第 4 句
    expect(media.currentTime).toBeCloseTo(3.9 - SENTENCE_SEEK_LEAD_SEC, 3);
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(sentenceEl("The librarian said it might be on hold.")).toHaveStyle({ background: "#F3E8FF" });
    media.currentTime = 3.0;
    act(() => { fireEvent(audioEl(), new Event("timeupdate")); });
    expect(sentenceEl("Did you find the book?")).toHaveStyle({ background: "#F3E8FF" });
    // 播放头落进句间静音（3.5–3.9）：高亮留在刚放完的那句，不清空
    media.currentTime = 3.6;
    act(() => { fireEvent(audioEl(), new Event("timeupdate")); });
    expect(sentenceEl("Did you find the book?")).toHaveStyle({ background: "#F3E8FF" });
  });

  test("LADetail：老记录没有 sentence_timings → 原文照旧整段显示，没有播放键", () => {
    render(<LADetail session={laSession({ sentence_timings: undefined })} />);
    expect(playKeys()).toHaveLength(0);
    expect(screen.getByText(/Hey, I just got back from the library\. Did you find/)).toBeInTheDocument();
  });

  test("LADetail：有时间戳但没有真实音频（TTS 兜底）→ 不逐句", () => {
    render(<LADetail session={laSession({ audio_url: null })} />);
    expect(playKeys()).toHaveLength(0);
  });

  test("LCDetail：气泡里每句一个 ▶ 键", () => {
    const conv = [{ speaker: "Woman", text: "Hi there. Quick question." }, { speaker: "Man", text: "Sure." }];
    const timings = [
      { text: "Hi there.", start: 0, end: 1, turn: 0, speaker: "Woman" },
      { text: "Quick question.", start: 1.1, end: 2, turn: 0, speaker: "Woman" },
      { text: "Sure.", start: 2.3, end: 2.8, turn: 1, speaker: "Man" },
    ];
    render(<LCDetail session={{ id: 2, type: "listening", date: "2026-09-18T10:00:00.000Z", details: { subtype: "lc", itemIds: ["lc-1"], conversation: conv, questions: [], results: [], audio_url: CLIP, sentence_timings: timings } }} />);
    const media = stubMedia(audioEl());
    expect(playKeys()).toHaveLength(3);
    fireEvent.click(playKeys()[2]);
    expect(media.currentTime).toBeCloseTo(2.3 - SENTENCE_SEEK_LEAD_SEC, 3);
    expect(playMock).toHaveBeenCalledTimes(1);
  });
});

describe("pinnedSentenceIndex —— 点播期间高亮钉在被点的那一句", () => {
  const pin = { index: 3, start: 19.5, end: 26 };
  test("句内、提前量、句末过冲都还算这一句；出了范围 / 没点播过 → -1", () => {
    expect(pinnedSentenceIndex(pin, 19.44)).toBe(3);
    expect(pinnedSentenceIndex(pin, 22)).toBe(3);
    // 下一句 start === 这句 end 时，刹车停在 26.01 不能让高亮滑到下一句
    expect(pinnedSentenceIndex(pin, 26.01)).toBe(3);
    expect(pinnedSentenceIndex(pin, 26.18)).toBe(3);
    expect(pinnedSentenceIndex(pin, 27)).toBe(-1);
    expect(pinnedSentenceIndex(pin, 5)).toBe(-1);
    expect(pinnedSentenceIndex(null, 22)).toBe(-1);
    expect(pinnedSentenceIndex(pin, NaN)).toBe(-1);
  });
});

describe("播放键与首词粘连", () => {
  test("键和首词在同一个 nowrap 里，按空白切（不是按字母）；整句 textContent 不变", () => {
    const timings = [{ text: "We're bringing together advisors.", start: 0, end: 2 }, { text: "Thanks.", start: 2, end: 3 }];
    const { container } = render(<SentenceTranscript timings={timings} onPick={() => {}} />);
    const keys = container.querySelectorAll('button[data-sentence-play="1"]');
    expect(keys[0].nextSibling.textContent).toBe("We're");
    expect(keys[0].parentElement.style.whiteSpace).toBe("nowrap");
    expect(keys[1].nextSibling.textContent).toBe("Thanks.");
    const spans = container.querySelectorAll("[data-sentence-index]");
    expect(spans[0].textContent).toBe("We're bringing together advisors.");
    expect(spans[1].textContent).toBe("Thanks.");
  });
});
