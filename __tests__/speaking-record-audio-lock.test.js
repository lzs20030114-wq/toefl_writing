/**
 * Locks for the "reference audio must not leak into the mic while recording"
 * fix (Listen & Repeat).
 *
 * VoiceRecorder: onRecordingStateChange must fire true SYNCHRONOUSLY at the
 * start of a record attempt (before getUserMedia resolves) and false on every
 * exit path (normal stop, getUserMedia rejection, unmount). Omitting the prop
 * (Interview's usage) must be a no-op.
 *
 * RepeatTask: while recording, the "Replay original sentence" button is
 * disabled and a hint appears — the user can't re-sound the original into STT.
 * Recording now starts by itself on entering the record phase (真考节奏), so
 * the lock engages without any mic tap; a refused auto-start falls back to the
 * manual button + hint.
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { VoiceRecorder } from "../components/speaking/VoiceRecorder";
import { RepeatTask } from "../components/speaking/RepeatTask";

// Minimal MediaRecorder stub with manual event triggers (jsdom has none).
class FakeMediaRecorder {
  constructor(stream, opts) {
    this.stream = stream;
    this.state = "inactive";
    this.mimeType = (opts && opts.mimeType) || "audio/webm";
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
  }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    if (this.ondataavailable) this.ondataavailable({ data: new Blob(["x"], { type: this.mimeType }) });
    if (this.onstop) this.onstop();
  }
  static isTypeSupported() { return true; }
}

let gum; // { resolve, reject } for the pending getUserMedia promise

beforeEach(() => {
  jest.useFakeTimers();
  const track = { stop: jest.fn() };
  const stream = { getTracks: () => [track] };
  gum = {};
  const getUserMedia = jest.fn(() => new Promise((resolve, reject) => {
    gum.resolve = () => resolve(stream);
    gum.reject = (e) => reject(e);
  }));
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  global.MediaRecorder = FakeMediaRecorder;
  window.HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = jest.fn();
  URL.createObjectURL = jest.fn(() => "blob:fake");
  URL.revokeObjectURL = jest.fn();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete global.MediaRecorder;
});

const flushMicrotasks = async () => { await Promise.resolve(); await Promise.resolve(); };

test("VoiceRecorder: onRecordingStateChange fires true synchronously — before getUserMedia resolves", () => {
  const onChange = jest.fn();
  render(<VoiceRecorder onRecordingComplete={jest.fn()} onRecordingStateChange={onChange} />);
  act(() => { fireEvent.click(screen.getByRole("button")); });
  // getUserMedia is still pending (gum.resolve never called), yet true has fired.
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
  expect(onChange).toHaveBeenCalledWith(true);
  expect(onChange).toHaveBeenCalledTimes(1);
});

test("VoiceRecorder: onRecordingStateChange fires false when recording stops", async () => {
  const onChange = jest.fn();
  render(<VoiceRecorder onRecordingComplete={jest.fn()} onRecordingStateChange={onChange} />);
  act(() => { fireEvent.click(screen.getByRole("button")); });         // start
  await act(async () => { gum.resolve(); await flushMicrotasks(); });  // recorder starts
  expect(onChange).toHaveBeenLastCalledWith(true);
  await act(async () => { fireEvent.click(screen.getByRole("button")); }); // stop button
  expect(onChange).toHaveBeenLastCalledWith(false);
});

test("VoiceRecorder: onRecordingStateChange resets to false when getUserMedia is rejected", async () => {
  const onChange = jest.fn();
  render(<VoiceRecorder onRecordingComplete={jest.fn()} onRecordingStateChange={onChange} />);
  act(() => { fireEvent.click(screen.getByRole("button")); });
  expect(onChange).toHaveBeenLastCalledWith(true);
  await act(async () => {
    gum.reject(new DOMException("denied", "NotAllowedError"));
    await flushMicrotasks();
  });
  expect(onChange).toHaveBeenLastCalledWith(false);
});

test("VoiceRecorder: onRecordingStateChange resets to false on unmount while recording", async () => {
  const onChange = jest.fn();
  const { unmount } = render(<VoiceRecorder onRecordingComplete={jest.fn()} onRecordingStateChange={onChange} />);
  act(() => { fireEvent.click(screen.getByRole("button")); });
  await act(async () => { gum.resolve(); await flushMicrotasks(); });
  onChange.mockClear();
  act(() => { unmount(); });
  expect(onChange).toHaveBeenCalledWith(false);
});

test("VoiceRecorder: omitting onRecordingStateChange is a no-op (Interview backward-compat)", () => {
  render(<VoiceRecorder onRecordingComplete={jest.fn()} />);
  expect(() => {
    act(() => { fireEvent.click(screen.getByRole("button")); });
  }).not.toThrow();
});

// Drain a longer microtask chain (warmUpMicrophone → race → finally → then).
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test("RepeatTask: entering the record phase auto-starts recording — replay locked + hint, no mic tap", async () => {
  // No audio_url + jsdom has no speechSynthesis → the listen phase exposes the
  // manual "Continue to Record" path, letting us reach the record phase.
  const items = [{ id: "s1", sentence: "The quick brown fox jumps over.", difficulty: "easy" }];
  render(<RepeatTask items={items} onComplete={jest.fn()} onExit={jest.fn()} isPractice />);

  // 开始 asks for the mic inside the gesture and holds the intro until it settles.
  await act(async () => { fireEvent.click(screen.getByText("开始")); gum.resolve(); await flush(); });
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);

  act(() => { fireEvent.click(screen.getByText("Continue to Record")); });

  // Nobody tapped the mic: the recorder opened it by itself (2nd getUserMedia)
  // and record-intent fired synchronously → replay locked + hint shown.
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Replay original sentence").closest("button")).toBeDisabled();
  expect(screen.getByText("录音中不可重放")).toBeInTheDocument();
});

test("RepeatTask: auto-start refused → manual mic + hint, replay unlocked; a tap re-locks it", async () => {
  const items = [{ id: "s1", sentence: "The quick brown fox jumps over.", difficulty: "easy" }];
  render(<RepeatTask items={items} onComplete={jest.fn()} onExit={jest.fn()} isPractice />);
  await act(async () => { fireEvent.click(screen.getByText("开始")); gum.resolve(); await flush(); });
  act(() => { fireEvent.click(screen.getByText("Continue to Record")); });

  // The auto-start's getUserMedia is rejected (iOS Safari without a grant, denied…).
  await act(async () => {
    gum.reject(new DOMException("denied", "NotAllowedError"));
    await flush();
  });
  expect(screen.getByText(/录音未自动开始/)).toBeInTheDocument();
  expect(screen.getByText("点击开始录音")).toBeInTheDocument();
  expect(screen.getByText("Replay original sentence").closest("button")).not.toBeDisabled();
  expect(screen.queryByText("录音中不可重放")).toBeNull();

  // Manual tap on the mic retries and re-locks the replay button.
  const mic = screen.getByRole("img", { name: "microphone" }).closest("button");
  act(() => { fireEvent.click(mic); });
  expect(screen.getByText("Replay original sentence").closest("button")).toBeDisabled();
  expect(screen.getByText("录音中不可重放")).toBeInTheDocument();
  expect(screen.queryByText(/录音未自动开始/)).toBeNull();
});
