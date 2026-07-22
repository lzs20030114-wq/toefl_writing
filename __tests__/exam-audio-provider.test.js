/**
 * Locks for components/shared/ExamAudioProvider.js — the recovery overlay
 * and the kill switch.
 *
 * - A blocked play must surface the one-tap overlay, and its button must call
 *   controller.retry() (synchronously in the click = fresh gesture).
 * - NEXT_PUBLIC_EXAM_AUDIO_DISABLED=1 must yield a null context so every
 *   consumer takes its legacy audio path.
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ExamAudioProvider, useExamAudio } from "../components/shared/ExamAudioProvider";
import { AudioPlayer } from "../components/listening/AudioPlayer";

let playMock;
let audioEl; // the provider controller's detached element

beforeEach(() => {
  playMock = jest.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.play = playMock;
  window.HTMLMediaElement.prototype.pause = jest.fn();
  window.HTMLMediaElement.prototype.load = jest.fn();
  audioEl = null;
  const origCreate = document.createElement.bind(document);
  jest.spyOn(document, "createElement").mockImplementation((tag, ...rest) => {
    const el = origCreate(tag, ...rest);
    if (tag === "audio") audioEl = el;
    return el;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_EXAM_AUDIO_DISABLED;
});

// Exposes the context value to the test without extra rendering.
function makeConsumer(ref) {
  return function Consumer() {
    ref.ctx = useExamAudio();
    return null;
  };
}

test("blocked play → overlay appears → 继续考试 calls controller.retry()", async () => {
  playMock.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
  const ref = {};
  const Consumer = makeConsumer(ref);
  render(
    <ExamAudioProvider>
      <Consumer />
    </ExamAudioProvider>
  );
  expect(ref.ctx).toBeTruthy();
  expect(ref.ctx.controller).toBeTruthy();

  // Trigger a blocked play (autoplay rejected mid-exam).
  await act(async () => {
    ref.ctx.controller.play("https://cdn.example/clip.mp3", { section: "listening" });
  });

  // Overlay is up, with the not-allowed copy, and holdTimers is signalled.
  expect(screen.getByText("音频播放被浏览器暂停")).toBeInTheDocument();
  expect(ref.ctx.holdTimers).toBe(true);
  // 远程排障诊断行随弹窗渲染(用户截图即现场)。
  expect(screen.getByText(/诊断 c0722/)).toBeInTheDocument();
  expect(screen.getByText(/reason=not-allowed/)).toBeInTheDocument();

  const retrySpy = jest.spyOn(ref.ctx.controller, "retry");
  await act(async () => {
    fireEvent.click(screen.getByText("继续考试"));
  });
  expect(retrySpy).toHaveBeenCalledTimes(1);
});

test("overlay closes and holdTimers releases once playback actually starts", async () => {
  playMock.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
  const ref = {};
  const Consumer = makeConsumer(ref);
  render(
    <ExamAudioProvider>
      <Consumer />
    </ExamAudioProvider>
  );
  await act(async () => {
    ref.ctx.controller.play("https://cdn.example/clip.mp3");
  });
  expect(screen.getByText("音频播放被浏览器暂停")).toBeInTheDocument();

  // The retry succeeds this time: play resolves, then 'playing' fires on the
  // controller's detached element (captured via the createElement spy).
  await act(async () => {
    fireEvent.click(screen.getByText("继续考试"));
  });
  await act(async () => {
    audioEl.dispatchEvent(new Event("playing"));
  });
  expect(screen.queryByText("音频播放被浏览器暂停")).toBeNull();
  expect(ref.ctx.holdTimers).toBe(false);
});

test("kill switch NEXT_PUBLIC_EXAM_AUDIO_DISABLED=1 → useExamAudio() is null", () => {
  process.env.NEXT_PUBLIC_EXAM_AUDIO_DISABLED = "1";
  const ref = { ctx: "unset" };
  const Consumer = makeConsumer(ref);
  render(
    <ExamAudioProvider>
      <Consumer />
    </ExamAudioProvider>
  );
  expect(ref.ctx).toBeNull();
});

test("first document interaction unlocks the shared controller (WebKit per-element unlock)", () => {
  const ref = {};
  const Consumer = makeConsumer(ref);
  render(
    <ExamAudioProvider>
      <Consumer />
    </ExamAudioProvider>
  );
  expect(ref.ctx.controller).toBeTruthy();
  // Practice pages have no "start exam" button, so the Provider arms a
  // capture-phase listener on document: the user's first tap anywhere completes
  // the unlock. Spy on the live controller and fire a click on the page body.
  const unlockSpy = jest.spyOn(ref.ctx.controller, "unlock");
  fireEvent.click(document.body);
  expect(unlockSpy).toHaveBeenCalled();
});

test("first-interaction listener is removed only after the unlock ACTUALLY lands", async () => {
  const ref = {};
  const Consumer = makeConsumer(ref);
  render(
    <ExamAudioProvider>
      <Consumer />
    </ExamAudioProvider>
  );
  const controller = ref.ctx.controller;
  const unlockSpy = jest.spyOn(controller, "unlock");
  // Idle controller → unlock starts on the first tap…
  fireEvent.click(document.body);
  expect(unlockSpy).toHaveBeenCalledTimes(1);
  // …but listeners survive until the 'unlocked' event (async settle). 解锁被
  // 同 tick 播放腰斩时旧逻辑就地拆监听、再也不重试——所以拆除必须等真成功。
  await act(async () => {}); // unlock promise resolves → 'unlocked' → teardown
  expect(controller.isUnlocked()).toBe(true);
  fireEvent.click(document.body);
  expect(unlockSpy).toHaveBeenCalledTimes(1); // removed — no re-invoke
});

test("first-interaction listener is RETAINED while a clip is loading (unlock gated), retries on next gesture", async () => {
  const ref = {};
  const Consumer = makeConsumer(ref);
  render(
    <ExamAudioProvider>
      <Consumer />
    </ExamAudioProvider>
  );
  const controller = ref.ctx.controller;

  // Drive the controller into 'loading' (no 'playing' yet) so a tap is gated.
  await act(async () => {
    controller.play("https://cdn.example/clip.mp3", { section: "listening" });
  });
  expect(controller.getState()).toBe("loading");

  const unlockSpy = jest.spyOn(controller, "unlock");
  // First gesture lands mid-load → unlock skipped (false) → listener stays.
  fireEvent.click(document.body);
  expect(unlockSpy).toHaveBeenCalledTimes(1);
  expect(controller.isUnlocked()).toBe(false);

  // The clip errors out → state leaves 'loading'.
  await act(async () => {
    audioEl.dispatchEvent(new Event("error"));
  });

  // Second gesture: listener still attached, so unlock fires again — now it runs.
  fireEvent.click(document.body);
  expect(unlockSpy).toHaveBeenCalledTimes(2);
});

test("恢复弹窗开着时,全局首次交互监听让路 — 手势整支留给「继续考试」", async () => {
  // iOS 一次手势只祝福一次播放:弹窗期间若捕获监听抢跑播解锁静音片,恢复按钮
  // 的正片播放就又沦为无手势调用(真机实锤的按钮失效根因)。
  playMock.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
  const ref = {};
  const Consumer = makeConsumer(ref);
  render(
    <ExamAudioProvider>
      <Consumer />
    </ExamAudioProvider>
  );
  const controller = ref.ctx.controller;
  await act(async () => {
    controller.play("https://cdn.example/clip.mp3", { section: "listening" });
  });
  expect(screen.getByText("音频播放被浏览器暂停")).toBeInTheDocument();

  const unlockSpy = jest.spyOn(controller, "unlock");
  const retrySpy = jest.spyOn(controller, "retry");
  await act(async () => {
    fireEvent.click(screen.getByText("继续考试"));
  });
  expect(unlockSpy).not.toHaveBeenCalled(); // 捕获监听让路,没有静音片抢跑
  expect(retrySpy).toHaveBeenCalledTimes(1); // 手势进了恢复按钮
  // 元素 src 从未被解锁静音片(data:)污染 — 正片保持在位,play 直接发生在手势内。
  expect(audioEl.src.startsWith("data:")).toBe(false);
  expect(audioEl.src).toBe("https://cdn.example/clip.mp3");
});

test("a clip reaching 'playing' unlocks the element and tears the listener down without any unlock() call", async () => {
  // 用户第一下点的就是播放键:手势直接花在正片上,SILENT_WAV 从未播过。真出声
  // 即视为解锁完成,后续点击不得再去动共享元素。
  const ref = {};
  const Consumer = makeConsumer(ref);
  render(
    <ExamAudioProvider>
      <Consumer />
    </ExamAudioProvider>
  );
  const controller = ref.ctx.controller;
  await act(async () => {
    controller.play("https://cdn.example/clip.mp3", { section: "listening" });
  });
  await act(async () => {
    audioEl.dispatchEvent(new Event("playing"));
  });
  expect(controller.isUnlocked()).toBe(true);

  const unlockSpy = jest.spyOn(controller, "unlock");
  fireEvent.click(document.body);
  expect(unlockSpy).not.toHaveBeenCalled(); // listener already removed on 'playing'
});

test("an autoPlay AudioPlayer under the Provider plays through the shared element, not its own <audio>", async () => {
  const { container } = render(
    <ExamAudioProvider>
      <AudioPlayer src="https://cdn.example/clip.mp3" text="hi" onEnded={jest.fn()} maxReplays={0} autoPlay />
    </ExamAudioProvider>
  );
  // Let the autoplay play() promise settle.
  await act(async () => { await Promise.resolve(); });

  // In controller mode AudioPlayer renders NO <audio> of its own — the shared
  // detached element (captured via the createElement spy) is what plays.
  expect(container.querySelector("audio")).toBeNull();
  expect(audioEl).toBeTruthy();
  // The shared element received the clip src → playback was routed to it.
  expect(audioEl.getAttribute("src")).toBe("https://cdn.example/clip.mp3");
});
