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
