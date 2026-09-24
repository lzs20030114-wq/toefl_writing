/**
 * Listen & Repeat 真考节奏 (2026-09-19):
 *   - 开始 asks for the microphone INSIDE that gesture and holds the intro until
 *     the prompt settles (10s cap), releasing the probe stream at once.
 *   - Entering the record phase opens the mic by itself — no 🎙️ tap.
 *   - Stopping a take (tap / 30s cap) moves straight to the next sentence: no
 *     per-sentence verdict, no replay, no Re-record, no Next button.
 *   - The last take enters a "正在完成识别" hold until STT settles (skippable),
 *     then the summary shows every sentence's accuracy.
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { RepeatTask } from "../components/speaking/RepeatTask";
import { warmUpMicrophone } from "../components/speaking/VoiceRecorder";

// Controllable STT: each call parks until the test resolves mockStt.resolve(...).
const mockStt = {};
jest.mock("../lib/speakingEval/serverStt", () => ({
  transcribeWithServer: jest.fn(() => new Promise((resolve) => { mockStt.resolve = resolve; })),
}));
const STT_OK = { ok: true, transcript: "the quick brown fox jumps over" };

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

let gum;   // { resolve, reject } for the most recent getUserMedia promise
let track; // the probe/recording stream's single track

const ITEMS = [{ id: "s1", sentence: "The quick brown fox jumps over.", difficulty: "easy" }];
const TWO_ITEMS = [
  ...ITEMS,
  { id: "s2", sentence: "Please sign in at the front desk.", difficulty: "medium" },
];
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function installMediaDevices() {
  track = { stop: jest.fn() };
  const stream = { getTracks: () => [track] };
  gum = {};
  const getUserMedia = jest.fn(() => new Promise((resolve, reject) => {
    gum.resolve = () => resolve(stream);
    gum.reject = (e) => reject(e);
  }));
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
}

beforeEach(() => {
  jest.useFakeTimers();
  installMediaDevices();
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
  delete navigator.mediaDevices;
});

// Reach the record phase: 开始 (grant the warm-up) → "Continue to Record"
// (no audio_url + no speechSynthesis in jsdom exposes that manual path).
async function enterRecordPhase(items = ITEMS, onComplete = jest.fn()) {
  render(<RepeatTask items={items} onComplete={onComplete} onExit={jest.fn()} isPractice />);
  await act(async () => { fireEvent.click(screen.getByText("开始")); gum.resolve(); await flush(); });
  act(() => { fireEvent.click(screen.getByText("Continue to Record")); });
}

// The red stop button has no accessible name; it is the only <button> in the
// recording-state column (next to the "录音中…点击停止" caption).
function stopButton() {
  return screen.getByText("录音中…点击停止").parentElement.querySelector("button");
}

describe("开始 = 麦克风预授权（在手势内）", () => {
  test("getUserMedia is called synchronously in the tap, the probe stream is released, then the task starts", async () => {
    render(<RepeatTask items={ITEMS} onComplete={jest.fn()} onExit={jest.fn()} isPractice />);
    act(() => { fireEvent.click(screen.getByText("开始")); });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    // Prompt still open: intro stays, button relabelled, no sentence yet.
    expect(screen.getByText("正在准备麦克风…")).toBeInTheDocument();
    expect(screen.queryByText(/Sentence 1 of 1/)).toBeNull();

    // Double-tap while the prompt is up must not re-prompt.
    act(() => { fireEvent.click(screen.getByText("正在准备麦克风…")); });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);

    await act(async () => { gum.resolve(); await flush(); });
    expect(track.stop).toHaveBeenCalledTimes(1); // probe released — mic light off
    expect(screen.getByText(/Sentence 1 of 1/)).toBeInTheDocument();
  });

  test("denied → still starts (the recorder's manual-tap hint takes over later)", async () => {
    render(<RepeatTask items={ITEMS} onComplete={jest.fn()} onExit={jest.fn()} isPractice />);
    await act(async () => {
      fireEvent.click(screen.getByText("开始"));
      gum.reject(new DOMException("denied", "NotAllowedError"));
      await flush();
    });
    expect(screen.getByText(/Sentence 1 of 1/)).toBeInTheDocument();
  });

  test("a hung getUserMedia can't strand the user: 10s cap, then the task starts", async () => {
    render(<RepeatTask items={ITEMS} onComplete={jest.fn()} onExit={jest.fn()} isPractice />);
    act(() => { fireEvent.click(screen.getByText("开始")); });
    await act(async () => { jest.advanceTimersByTime(9_999); await flush(); });
    expect(screen.queryByText(/Sentence 1 of 1/)).toBeNull();
    await act(async () => { jest.advanceTimersByTime(1); await flush(); });
    expect(screen.getByText(/Sentence 1 of 1/)).toBeInTheDocument();
  });

  test("no getUserMedia at all → synchronous start, exactly as before", () => {
    delete navigator.mediaDevices;
    render(<RepeatTask items={ITEMS} onComplete={jest.fn()} onExit={jest.fn()} isPractice />);
    act(() => { fireEvent.click(screen.getByText("开始")); });
    expect(screen.getByText(/Sentence 1 of 1/)).toBeInTheDocument();
  });

  test("warmUpMicrophone: null without the API; stream stopped even when the timeout won", async () => {
    delete navigator.mediaDevices;
    expect(warmUpMicrophone()).toBeNull();

    installMediaDevices();
    const p = warmUpMicrophone(1000);
    jest.advanceTimersByTime(1000);
    await expect(p).resolves.toBe(false);
    // Late grant after the cap: the stream must still be released.
    gum.resolve();
    await flush();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });
});

describe("录音阶段自动开麦", () => {
  test("no mic tap: recording starts on entering the record phase", async () => {
    await enterRecordPhase();
    // 1st call = warm-up, 2nd = the auto-started recording.
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.getByText("正在开启麦克风…")).toBeInTheDocument(); // not「点击录音」
    expect(screen.getByText(/the next one follows automatically/)).toBeInTheDocument();

    await act(async () => { gum.resolve(); await flush(); });
    expect(screen.getByText("录音中…点击停止")).toBeInTheDocument();
    expect(screen.queryByText(/录音未自动开始/)).toBeNull();
  });

  test("stop → the next sentence starts by itself: no Next tap, no review step", async () => {
    await enterRecordPhase(TWO_ITEMS);
    await act(async () => { gum.resolve(); await flush(); });
    expect(screen.getByText(/Sentence 1 of 2/)).toBeInTheDocument();

    await act(async () => { fireEvent.click(stopButton()); await flush(); });

    // Straight into sentence 2's listen phase.
    expect(screen.getByText(/Sentence 2 of 2/)).toBeInTheDocument();
    expect(screen.getByText("Get ready to listen")).toBeInTheDocument();
    expect(screen.queryByText("Re-record")).toBeNull();
    expect(screen.queryByText("Next Sentence")).toBeNull();
    expect(screen.queryByText("Recorded")).toBeNull();
    expect(screen.queryByText(/Accuracy/)).toBeNull();
    expect(screen.queryByText("The quick brown fox jumps over.")).toBeNull();
    // Sentence 1's STT is in flight in the background, not blocking anything.
    expect(typeof mockStt.resolve).toBe("function");

    // Sentence 2 auto-starts recording too (warm-up + s1 + s2 = 3 calls).
    act(() => { fireEvent.click(screen.getByText("Continue to Record")); });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(3);
  });
});

describe("最后一句录完 → 等识别 → 总结页", () => {
  test("hold shows no per-sentence verdict; the summary scores it once STT lands", async () => {
    const onComplete = jest.fn();
    await enterRecordPhase(ITEMS, onComplete);
    await act(async () => { gum.resolve(); await flush(); });
    await act(async () => { fireEvent.click(stopButton()); await flush(); });

    // STT hold — neutral, with the skip link; nothing about how the take went.
    expect(screen.getByText("All sentences recorded")).toBeInTheDocument();
    expect(screen.getByText(/正在完成识别… \(45s\)/)).toBeInTheDocument();
    expect(screen.getByText(/跳过等待，直接完成/)).toBeInTheDocument();
    expect(screen.queryByText(/Accuracy/)).toBeNull();
    expect(screen.queryByText("Well done!")).toBeNull();
    expect(screen.queryByText("Re-record")).toBeNull();
    expect(screen.queryByText("Finish")).toBeNull();
    expect(screen.queryByText("Skip this sentence")).toBeNull();
    expect(screen.queryByText("Session Complete")).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();

    // Transcript arrives → the hold settles into the summary by itself.
    await act(async () => { mockStt.resolve(STT_OK); await flush(); });
    expect(screen.getByText("Session Complete")).toBeInTheDocument();
    expect(screen.getByText(/% Accuracy/)).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
    const summary = onComplete.mock.calls[0][0];
    expect(summary.items[0].transcript).toBe("the quick brown fox jumps over");
    expect(summary.items[0].score).not.toBeNull();
    expect(summary.attempted).toBe(1);
  });

  test("跳过等待 → summary right away, the unresolved take unscored", async () => {
    const onComplete = jest.fn();
    await enterRecordPhase(ITEMS, onComplete);
    await act(async () => { gum.resolve(); await flush(); });
    await act(async () => { fireEvent.click(stopButton()); await flush(); });

    await act(async () => { fireEvent.click(screen.getByText(/跳过等待，直接完成/)); await flush(); });
    expect(screen.getByText("Session Complete")).toBeInTheDocument();
    expect(screen.queryByText(/% Accuracy/)).toBeNull();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].items[0].score).toBeNull();
  });

  test("45s cap: the hold never strands the user", async () => {
    const onComplete = jest.fn();
    await enterRecordPhase(ITEMS, onComplete);
    await act(async () => { gum.resolve(); await flush(); });
    await act(async () => { fireEvent.click(stopButton()); await flush(); });

    // One tick per act: each 1s timer re-arms from the effect after React
    // commits the decrement, so the ticks can't be batched into one advance.
    const tick = async () => act(async () => { jest.advanceTimersByTime(1_000); await flush(); });
    for (let i = 0; i < 44; i++) await tick();
    expect(screen.getByText(/正在完成识别… \(1s\)/)).toBeInTheDocument();
    expect(screen.queryByText("Session Complete")).toBeNull();
    await tick(); // → 0 → forceFinish
    await tick(); // the effect that reads 0 needs one more commit
    expect(screen.getByText("Session Complete")).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
