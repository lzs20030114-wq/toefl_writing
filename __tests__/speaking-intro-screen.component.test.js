/**
 * Component locks for the Speaking intro screens + Interview题面隐藏/失败链 (2026-07-16).
 *
 *  - Both tasks open on a setting/intro screen; the 开始 gesture unlocks the
 *    shared exam audio element and only then does the task begin.
 *  - Interview hides the question面 during prep/answer (audio-only, like the
 *    real exam), reveals it in the summary, and never dead-ends on audio failure
 *    (retry / skip, and the question is read aloud via TTS — audible, not shown).
 */
import { render, screen, act, fireEvent } from "@testing-library/react";

// Configurable exam-audio mock: null = legacy per-<Audio> path; object = controller mode.
const mockExamAudioHolder = { value: null };
jest.mock("../components/shared/ExamAudioProvider", () => ({
  __esModule: true,
  useExamAudio: () => mockExamAudioHolder.value,
  ExamAudioProvider: ({ children }) => children,
}));

import { RepeatTask } from "../components/speaking/RepeatTask";
import { InterviewTask } from "../components/speaking/InterviewTask";
import { SpeakingIntroScreen } from "../components/speaking/SpeakingIntroScreen";

function makeController() {
  return {
    unlock: jest.fn(() => true),
    play: jest.fn(),
    preload: jest.fn(),
    retry: jest.fn(),
    stop: jest.fn(),
    subscribe: jest.fn(() => () => {}),
    getState: jest.fn(() => "idle"),
    getCurrentSrc: jest.fn(() => null),
    isUnlocked: jest.fn(() => false),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockExamAudioHolder.value = null;
  // Keep VoiceRecorder harmless if the answer phase ever mounts.
  const getUserMedia = jest.fn(() => new Promise(() => {})); // never resolves
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  class FakeMediaRecorder { constructor() { this.state = "inactive"; } start() {} stop() {} static isTypeSupported() { return true; } }
  global.MediaRecorder = FakeMediaRecorder;
  window.HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = jest.fn();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete global.MediaRecorder;
  delete window.speechSynthesis;
  delete global.SpeechSynthesisUtterance;
});

// ── RepeatTask intro screen ──

test("RepeatTask opens on the setting screen and 开始 unlocks the exam audio", () => {
  const ctrl = makeController();
  mockExamAudioHolder.value = { controller: ctrl };

  const items = [{ id: "s1", sentence: "Printers are near the entrance.", difficulty: "easy" }];
  render(
    <RepeatTask
      items={items}
      setInfo={{ id: "rpt_x", scenario: "Library Orientation", speaker_role: "librarian" }}
      onComplete={jest.fn()}
      onExit={jest.fn()}
      isPractice
    />,
  );

  // Setting screen up: the fixed "Repeat only once." tail is shown; no sentence yet.
  expect(screen.getByText(/Repeat only once\./)).toBeInTheDocument();
  expect(screen.queryByText(/Sentence 1 of 1/)).toBeNull();
  expect(ctrl.unlock).not.toHaveBeenCalled();

  // 开始 → unlock + enter the task.
  act(() => { fireEvent.click(screen.getByText("开始")); });
  expect(ctrl.unlock).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Sentence 1 of 1/)).toBeInTheDocument();
});

// ── InterviewTask intro + hidden question ──

const IV_ITEMS = [
  { id: "q1", question: "What is your favorite hobby, and why?", category: "personal", difficulty: "easy" },
];

test("InterviewTask hides the question面 in prep and reveals it only in the summary", () => {
  // Non-controller path; no audio + no speech engine → deterministic prep.
  const items = IV_ITEMS;
  render(<InterviewTask items={items} setInfo={{ intro: "You have agreed to participate in a study about hobbies." }} onComplete={jest.fn()} onExit={jest.fn()} isPractice={false} />);

  // Intro/setting screen first — the logistics line is shown, the question is not.
  expect(screen.getByText(/short online interview with a researcher/)).toBeInTheDocument();
  expect(screen.queryByText(/favorite hobby/)).toBeNull();

  act(() => { fireEvent.click(screen.getByText("开始")); });

  // Prep phase: question面 HIDDEN, neutral placeholder shown.
  expect(screen.getByText("Please answer the interviewer's question.")).toBeInTheDocument();
  expect(screen.queryByText(/favorite hobby/)).toBeNull();

  // Skip through to the summary — now the question text IS shown (feedback area).
  act(() => { fireEvent.click(screen.getByText("Skip this question")); });
  expect(screen.getByText(/favorite hobby/)).toBeInTheDocument();
});

test("InterviewTask failure chain: no audio + no TTS → error + retry/skip, question stays hidden", () => {
  // No speechSynthesis defined → ttsSupported=false. Items have no audio_url.
  render(<InterviewTask items={IV_ITEMS} setInfo={{ intro: "You have agreed to participate in a study about hobbies." }} onComplete={jest.fn()} onExit={jest.fn()} isPractice={false} />);
  act(() => { fireEvent.click(screen.getByText("开始")); });

  // Auto-play timer (600ms) → playViaTTS → no engine → terminal failure screen.
  act(() => { jest.advanceTimersByTime(600); });

  expect(screen.getByText("问题音频无法播放")).toBeInTheDocument();
  expect(screen.getByText("重试播放")).toBeInTheDocument();
  expect(screen.getByText("跳过本题")).toBeInTheDocument();
  // The question面 is never revealed on the failure screen.
  expect(screen.queryByText(/favorite hobby/)).toBeNull();
});

test("InterviewTask failure chain middle rung: the question is READ ALOUD via TTS, never shown", () => {
  // A speech engine exists but our stub never fires onend → the utterance is
  // spoken (records the call) and we stay in prep (no advance, no recorder).
  const speak = jest.fn();
  window.speechSynthesis = {
    speak,
    cancel: jest.fn(),
    getVoices: () => [{ lang: "en-US", name: "TestVoice" }],
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  global.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; this.lang = ""; this.rate = 1; }
  };

  render(<InterviewTask items={IV_ITEMS} setInfo={{ intro: "You have agreed to participate in a study about hobbies." }} onComplete={jest.fn()} onExit={jest.fn()} isPractice={false} />);
  act(() => { fireEvent.click(screen.getByText("开始")); });
  act(() => { jest.advanceTimersByTime(600); });

  // The interviewer question was spoken aloud with the real question text …
  expect(speak).toHaveBeenCalled();
  const spokenTexts = speak.mock.calls.map((c) => c[0] && c[0].text);
  expect(spokenTexts).toContain("What is your favorite hobby, and why?");
  // … but never rendered on screen.
  expect(screen.queryByText(/favorite hobby/)).toBeNull();
});

// ── Intro narration: iOS zero-gesture drop → re-speak inside the next tap ──

function installSpeechMock({ startsOnSpeak }) {
  const synth = {
    speaking: false,
    pending: false,
    cancel: jest.fn(() => { synth.speaking = false; synth.pending = false; }),
    getVoices: () => [],
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  synth.speak = jest.fn(() => { if (startsOnSpeak) synth.speaking = true; });
  window.speechSynthesis = synth;
  global.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; this.lang = ""; this.rate = 1; }
  };
  return synth;
}

test("intro 旁白被零手势静默丢弃时，在下一次点击的手势内重读", () => {
  // iOS 情形：mount 时 speak() 被丢弃（speaking 一直是 false）。
  const synth = installSpeechMock({ startsOnSpeak: false });

  render(<SpeakingIntroScreen title="t" lines={["Hello there."]} onStart={jest.fn()} onExit={jest.fn()} />);
  expect(synth.speak).toHaveBeenCalledTimes(1); // mount 照常尝试

  act(() => { jest.advanceTimersByTime(600); }); // 探测：没开口 → 挂手势监听
  act(() => { fireEvent.click(document.body); }); // 用户第一次触屏（真实手势）
  expect(synth.speak).toHaveBeenCalledTimes(2); // 手势内重读

  // 一次性监听：后续点击不再重复朗读。
  act(() => { fireEvent.click(document.body); });
  expect(synth.speak).toHaveBeenCalledTimes(2);
});

test("intro 旁白正常开口时，探测与后续点击都不打断它", () => {
  const synth = installSpeechMock({ startsOnSpeak: true });

  render(<SpeakingIntroScreen title="t" lines={["Hello there."]} onStart={jest.fn()} onExit={jest.fn()} />);
  expect(synth.speak).toHaveBeenCalledTimes(1);

  act(() => { jest.advanceTimersByTime(600); });
  act(() => { fireEvent.click(document.body); });
  expect(synth.speak).toHaveBeenCalledTimes(1); // 没有多余的重读
});

// ── RepeatTask legacy path: autoplay blocked → visible manual-play hint ──

test("RepeatTask 无 Provider 路径 autoplay 被拒时给出手动播放提示", async () => {
  mockExamAudioHolder.value = null; // legacy per-Audio path
  window.HTMLMediaElement.prototype.play = jest.fn(() =>
    Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" })),
  );

  const items = [{
    id: "s1",
    sentence: "Printers are near the entrance.",
    audio_url: "https://xyz.supabase.co/storage/v1/object/public/listening_audio/x.mp3",
    difficulty: "easy",
  }];
  render(
    <RepeatTask
      items={items}
      setInfo={{ id: "rpt_x", scenario: "Library Orientation", speaker_role: "librarian" }}
      onComplete={jest.fn()}
      onExit={jest.fn()}
      isPractice
    />,
  );

  act(() => { fireEvent.click(screen.getByText("开始")); });
  // 500ms 自动播放计时器 → play() 被拒 → 提示出现，Play Again 仍可点。
  await act(async () => { jest.advanceTimersByTime(500); });

  expect(screen.getByText(/浏览器拦截了自动播放/)).toBeInTheDocument();
  expect(screen.getByText("Play Again")).toBeInTheDocument();
});
