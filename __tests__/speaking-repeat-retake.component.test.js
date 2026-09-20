/**
 * 「点句重录」回归锁（Listen & Repeat 复盘 / 历史页）。
 *
 * 红线：重录**绝不覆盖最初的结果**——原始每句准确率、总结页横幅、
 * 以及写进历史的 onComplete payload 都必须原样不动，重录只是往下追加一条。
 *
 * 顺带锁住 NOT_PRO 的 sticky 语义（照搬 RepeatTask：服务端说过一次就不再上传）。
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { RepeatRetake } from "../components/speaking/RepeatRetake";
import { RepeatTask } from "../components/speaking/RepeatTask";
import { RepeatDetail } from "../components/speaking/SpeakingProgressView";
import { transcribeWithServer } from "../lib/speakingEval/serverStt";

jest.mock("../lib/speakingEval/serverStt", () => ({ transcribeWithServer: jest.fn() }));

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
  transcribeWithServer.mockReset();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete global.MediaRecorder;
});

const flushMicrotasks = async () => { await Promise.resolve(); await Promise.resolve(); };

const SENTENCE = "The quick brown fox jumps.";
// scoreRepeat(SENTENCE, "the quick brown")            → accuracy 60  (LCS 3 / 5)
// scoreRepeat(SENTENCE, "the quick brown fox jumps")  → accuracy 100
const PARTIAL_TRANSCRIPT = "the quick brown";
const PARTIAL_ACCURACY = 60;
const FULL_TRANSCRIPT = "the quick brown fox jumps";

/** 走完一整次录音：点麦克风 → getUserMedia 落地 → 点停止 → 冲掉 STT 的 microtask。 */
async function recordOnce() {
  const mic = screen.getByRole("img", { name: "microphone" }).closest("button");
  act(() => { fireEvent.click(mic); });
  await act(async () => { gum.resolve(); await flushMicrotasks(); });
  const stopBtn = screen.getByText("录音中…点击停止").closest("div").querySelector("button");
  await act(async () => {
    fireEvent.click(stopBtn);
    await flushMicrotasks();
  });
}

/** 展开重录面板并录一次。 */
async function retakeOnce() {
  act(() => { fireEvent.click(screen.getByText("🎙 重录这句")); });
  await recordOnce();
}

describe("RepeatRetake", () => {
  test("多次重录都保留，不互相覆盖，并给出与原始成绩的差值", async () => {
    transcribeWithServer.mockResolvedValueOnce({ ok: true, transcript: FULL_TRANSCRIPT });
    render(<RepeatRetake sentenceText={SENTENCE} questionId="s1" originalAccuracy={PARTIAL_ACCURACY} />);

    await retakeOnce();

    expect(screen.getByText("重录 #1")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("+40")).toBeInTheDocument();
    expect(screen.getAllByTestId("repeat-retake-attempt")).toHaveLength(1);

    transcribeWithServer.mockResolvedValueOnce({ ok: true, transcript: PARTIAL_TRANSCRIPT });
    await retakeOnce();

    // 第二条追加进来，第一条原封不动还在
    expect(screen.getByText("重录 #1")).toBeInTheDocument();
    expect(screen.getByText("重录 #2")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getAllByTestId("repeat-retake-attempt")).toHaveLength(2);
  });

  test("NOT_PRO 是 sticky 的：之后的重录不再上传", async () => {
    transcribeWithServer.mockResolvedValueOnce({ ok: false, code: "NOT_PRO", error: "x" });
    render(<RepeatRetake sentenceText={SENTENCE} questionId="s1" />);

    await retakeOnce();
    expect(transcribeWithServer).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("🔒 语音识别为 Pro 专属，录音已保留可自行对照")).toHaveLength(1);

    await retakeOnce();
    // 第二次直接本地判失败，没有再发请求
    expect(transcribeWithServer).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("repeat-retake-attempt")).toHaveLength(2);
    expect(screen.getAllByText("🔒 语音识别为 Pro 专属，录音已保留可自行对照")).toHaveLength(2);
  });
});

describe("RepeatTask 总结页", () => {
  test("重录不覆盖原始成绩，也不会二次上报 onComplete", async () => {
    const items = [{ id: "s1", sentence: SENTENCE, difficulty: "easy" }];
    const onComplete = jest.fn();
    transcribeWithServer.mockResolvedValueOnce({ ok: true, transcript: PARTIAL_TRANSCRIPT });

    render(<RepeatTask items={items} onComplete={onComplete} onExit={jest.fn()} isPractice />);

    // 无 audio_url + jsdom 没有 speechSynthesis → 走手动 Continue to Record 路径
    act(() => { fireEvent.click(screen.getByText("开始")); });
    act(() => { fireEvent.click(screen.getByText("Continue to Record")); });
    await recordOnce();

    await act(async () => {
      fireEvent.click(screen.getByText("Finish"));
      await flushMicrotasks();
    });

    // 原始成绩：写进历史的那一份
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].items[0].score.accuracy).toBe(PARTIAL_ACCURACY);
    expect(screen.getByText(`${PARTIAL_ACCURACY}% Accuracy`)).toBeInTheDocument();
    expect(screen.getByText(`${PARTIAL_ACCURACY}%`)).toBeInTheDocument(); // 横幅 Avg Accuracy

    // 在总结页重录一次，这次全对
    transcribeWithServer.mockResolvedValueOnce({ ok: true, transcript: FULL_TRANSCRIPT });
    await retakeOnce();

    expect(screen.getByText("重录 #1")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    // 原始成绩、总分、onComplete 一律不变
    expect(screen.getByText(`${PARTIAL_ACCURACY}% Accuracy`)).toBeInTheDocument();
    expect(screen.getByText(`${PARTIAL_ACCURACY}%`)).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("RepeatDetail (历史页)", () => {
  test("有句子的条目才挂重录入口", () => {
    const session = {
      details: {
        total: 2,
        attempted: 1,
        elapsed: 30,
        items: [
          {
            id: "a1", sentence: SENTENCE, difficulty: "easy", recorded: true,
            transcript: PARTIAL_TRANSCRIPT,
            score: { accuracy: PARTIAL_ACCURACY, matchedWords: ["the", "quick", "brown"], missedWords: ["fox", "jumps"], extraWords: [] },
          },
          { id: "a2", sentence: "", difficulty: "easy", recorded: false, transcript: null, score: null },
        ],
      },
    };
    render(<RepeatDetail session={session} />);

    expect(screen.getAllByText("🎙 重录这句")).toHaveLength(1);
    expect(screen.getAllByTestId("repeat-retake")).toHaveLength(1);
  });
});
