/**
 * 「跳过等待」在真题模考里的后果和练习不同：录了音还没识别 / 评完的题无法评分，整场不出估分
 * （scoreRealSpeaking 把它记作 unscored）。RepeatTask / InterviewTask 收到 realMock 时照实说；
 * 练习与常规模考的文案保持原样。两边都真走一遍：开始 → 录最后一题 → 识别永远在路上 → 等待态。
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { RepeatTask } from "../components/speaking/RepeatTask";
import { InterviewTask } from "../components/speaking/InterviewTask";

// STT 永远不落地 → 最后一题交完就停在「正在完成识别」的等待态。
jest.mock("../lib/speakingEval/serverStt", () => ({ transcribeWithServer: jest.fn(() => new Promise(() => {})) }));

const REAL_COPY = "跳过等待，直接完成（未识别的题目无法评分，本次模考将不出估分）";
const PRACTICE_COPY = "跳过等待，直接完成（未识别的题目不计分）";

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

let gum; // resolve() for the most recent getUserMedia promise
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
// The red stop button has no accessible name; it sits next to the "录音中…点击停止" caption.
const stopButton = () => screen.getByText("录音中…点击停止").parentElement.querySelector("button");

beforeEach(() => {
  jest.useFakeTimers();
  const stream = { getTracks: () => [{ stop: jest.fn() }] };
  gum = {};
  const getUserMedia = jest.fn(() => new Promise((resolve) => { gum.resolve = () => resolve(stream); }));
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
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
  delete window.speechSynthesis;
  delete global.SpeechSynthesisUtterance;
});

describe("Listen & Repeat：最后一句的识别还没回来", () => {
  test.each([
    ["真题模考", true, REAL_COPY],
    ["练习 / 常规模考", false, PRACTICE_COPY],
  ])("%s", async (_label, realMock, copy) => {
    const items = [{ id: "s1", sentence: "The quick brown fox jumps over.", difficulty: "easy" }];
    render(<RepeatTask items={items} onComplete={jest.fn()} onExit={jest.fn()} isPractice={false} realMock={realMock} />);
    // 开始（麦克风预授权）→ 无 audio_url 且 jsdom 没有语音引擎 → 手动「Continue to Record」→ 自动开麦 → 停止。
    await act(async () => { fireEvent.click(screen.getByText("开始")); gum.resolve(); await flush(); });
    act(() => { fireEvent.click(screen.getByText("Continue to Record")); });
    await act(async () => { gum.resolve(); await flush(); });
    await act(async () => { fireEvent.click(stopButton()); await flush(); });

    expect(screen.getByText(/正在完成识别/)).toBeInTheDocument();
    expect(screen.getByText(copy)).toBeInTheDocument();
  });
});

describe("Take an Interview：最后一题的识别 / 评分还没回来", () => {
  beforeEach(() => {
    // jsdom 没有语音引擎：给一个「立刻读完」的假引擎，读完题就进入作答并自动开麦。
    global.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) { this.text = text; };
    window.speechSynthesis = {
      getVoices: () => [{ lang: "en-US", name: "Samantha" }],
      speak: (utterance) => { if (utterance.onend) utterance.onend(); },
      cancel: () => {},
      speaking: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });

  test.each([
    ["真题模考", true, REAL_COPY],
    ["练习 / 常规模考", false, PRACTICE_COPY],
  ])("%s", async (_label, realMock, copy) => {
    const items = [{ id: "q1", question: "What do you like to study?", category: "personal", difficulty: "easy" }];
    render(<InterviewTask items={items} onComplete={jest.fn()} onExit={jest.fn()} isPractice={false} realMock={realMock} />);
    await act(async () => { fireEvent.click(screen.getByText("开始")); await flush(); });
    await act(async () => { jest.advanceTimersByTime(600); await flush(); }); // 自动读题 → 读完 → 作答
    await act(async () => { gum.resolve(); await flush(); });
    await act(async () => { fireEvent.click(stopButton()); await flush(); });
    await act(async () => { fireEvent.click(screen.getByText("Finish Interview")); await flush(); });

    expect(screen.getByText(/正在完成识别与评分/)).toBeInTheDocument();
    expect(screen.getByText(copy)).toBeInTheDocument();
  });
});
