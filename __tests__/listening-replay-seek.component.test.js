/**
 * 练习记录里的听力 Replay 进度条（2026-09-18 用户需求）。
 *
 * 诉求：精听要反复听某一句/某一段，而紧凑播放器只有「从头再放一遍」——
 * 没有时间轴就只能整段重听。现在紧凑模式（有真实音频、非考试共享元素）
 * 多一条可拖动进度条，并把播放键从「停止归零」改成「暂停保位置」。
 *
 * 这里钉住三件事：
 *  1. 拖/点进度条真的改 currentTime，并在暂停态松手后自动开声；
 *  2. 播放中点按钮是暂停（位置留着），再点是续播而不是回到开头；
 *  3. 拖不动的场景不长出这条控件：TTS 兜底（无 src）、以及非紧凑的答题页播放器。
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AudioPlayer } from "../components/listening/AudioPlayer";

const CLIP = "https://cdn.example/clip.mp3";
const DURATION = 60;

let playMock;
let pauseMock;

beforeEach(() => {
  playMock = jest.fn().mockResolvedValue(undefined);
  pauseMock = jest.fn();
  window.HTMLMediaElement.prototype.play = playMock;
  window.HTMLMediaElement.prototype.pause = pauseMock;
  window.HTMLMediaElement.prototype.load = jest.fn();
  global.SpeechSynthesisUtterance = function (t) { this.text = t; };
  global.speechSynthesis = {
    speak: jest.fn(),
    cancel: jest.fn(),
    getVoices: () => [{ lang: "en-US", name: "Samantha" }],
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
});

// jsdom 不实现媒体：duration 恒为 NaN、currentTime 不真走。这里在元素实例上
// 补一对可读写的属性，让组件的定位逻辑有真实语义可断言。
function stubMedia(audioEl, { duration = DURATION } = {}) {
  let t = 0;
  Object.defineProperty(audioEl, "duration", { configurable: true, get: () => duration });
  Object.defineProperty(audioEl, "currentTime", {
    configurable: true,
    get: () => t,
    set: (v) => { t = v; },
  });
  return { get currentTime() { return t; } };
}

// 进度条宽 200px、左边界 0：clientX 即百分比 * 2。
function stubBar(el) {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 16, width: 200, height: 16, x: 0, y: 0 });
}

// jsdom 没有 PointerEvent 构造器；用 MouseEvent 发同名事件，React 照样能从
// nativeEvent 上读到 clientX。
function pointer(type, clientX, { buttons = 1 } = {}) {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX, buttons });
}

async function renderCompact() {
  const utils = render(<AudioPlayer compact src={CLIP} text="hi" isPractice />);
  const audioEl = utils.container.querySelector("audio");
  const media = stubMedia(audioEl);
  await act(async () => { fireEvent(audioEl, new Event("loadedmetadata")); });
  return { ...utils, audioEl, media };
}

test("点进度条中点 → 定位到一半，松手自动开声", async () => {
  const { media } = await renderCompact();

  const bar = screen.getByRole("slider");
  stubBar(bar);

  await act(async () => { fireEvent(bar, pointer("pointerdown", 100)); });
  expect(media.currentTime).toBe(DURATION / 2);

  // 暂停态下松手 = 「从这里再听一遍」，直接播放。
  playMock.mockClear();
  await act(async () => { fireEvent(bar, pointer("pointerup", 100)); });
  expect(playMock).toHaveBeenCalledTimes(1);
  expect(media.currentTime).toBe(DURATION / 2);
});

test("按住拖动时进度跟手，且不会退回原位", async () => {
  const { media } = await renderCompact();
  const bar = screen.getByRole("slider");
  stubBar(bar);

  await act(async () => { fireEvent(bar, pointer("pointerdown", 20)); });   // 10%
  await act(async () => { fireEvent(bar, pointer("pointermove", 150)); });  // 75%
  expect(media.currentTime).toBe(DURATION * 0.75);
  expect(bar).toHaveAttribute("aria-valuenow", "75");

  // 拖出进度条右侧仍被夹到末尾，不会算出 >100%。
  await act(async () => { fireEvent(bar, pointer("pointermove", 400)); });
  expect(media.currentTime).toBe(DURATION);
  expect(bar).toHaveAttribute("aria-valuenow", "100");
});

test("松手落在进度条外（指针捕获失效）后，再划过进度条不会误定位", async () => {
  const { media } = await renderCompact();
  const bar = screen.getByRole("slider");
  stubBar(bar);

  await act(async () => { fireEvent(bar, pointer("pointerdown", 100)); });
  expect(media.currentTime).toBe(DURATION / 2);

  // 没收到 pointerup（松手在条外），之后的移动是「没按着的划过」：buttons=0。
  await act(async () => { fireEvent(bar, pointer("pointermove", 20, { buttons: 0 })); });
  expect(media.currentTime).toBe(DURATION / 2);
  await act(async () => { fireEvent(bar, pointer("pointermove", 180, { buttons: 0 })); });
  expect(media.currentTime).toBe(DURATION / 2);
});

test("播放中点按钮是暂停（保位置），再点从原处续播", async () => {
  const { audioEl, media } = await renderCompact();
  const button = screen.getByRole("button");

  await act(async () => { fireEvent.click(button); });
  await act(async () => { fireEvent(audioEl, new Event("playing")); });
  expect(button).toHaveTextContent("Playing…");

  // 放到第 18 秒
  audioEl.currentTime = 18;
  await act(async () => { fireEvent(audioEl, new Event("timeupdate")); });

  await act(async () => { fireEvent.click(button); });
  expect(pauseMock).toHaveBeenCalled();
  expect(media.currentTime).toBe(18); // 关键：停止会归零，暂停不会
  expect(button).toHaveTextContent("继续");

  playMock.mockClear();
  await act(async () => { fireEvent.click(button); });
  expect(playMock).toHaveBeenCalledTimes(1);
  expect(media.currentTime).toBe(18); // 续播，不是从头
});

test("左右方向键各挪 5 秒（照着一句话的量级）", async () => {
  const { audioEl, media } = await renderCompact();
  const bar = screen.getByRole("slider");
  audioEl.currentTime = 30;
  await act(async () => { fireEvent(audioEl, new Event("timeupdate")); });

  await act(async () => { fireEvent.keyDown(bar, { key: "ArrowLeft" }); });
  expect(media.currentTime).toBe(25);
  await act(async () => { fireEvent.keyDown(bar, { key: "ArrowRight" }); });
  expect(media.currentTime).toBe(30);
  await act(async () => { fireEvent.keyDown(bar, { key: "Home" }); });
  expect(media.currentTime).toBe(0);
});

test("拖不动的场景不长出进度条：TTS 兜底（无 src）/ 非紧凑的答题页播放器", async () => {
  const tts = render(<AudioPlayer compact src={null} text="Could you review my essay?" isPractice />);
  expect(tts.queryByRole ? tts.queryByRole("slider") : screen.queryByRole("slider")).toBeNull();
  tts.unmount();

  const full = render(<AudioPlayer src={CLIP} text="hi" isPractice />);
  const audioEl = full.container.querySelector("audio");
  stubMedia(audioEl);
  await act(async () => { fireEvent(audioEl, new Event("loadedmetadata")); });
  expect(screen.queryByRole("slider")).toBeNull();
});
