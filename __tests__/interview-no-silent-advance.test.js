/**
 * Regression lock: in exam-controller mode a blocked question clip must NOT
 * silently advance InterviewTask into the answer phase.
 *
 * The old per-instance path did exactly that — play() rejected with
 * NotAllowedError and the .catch() called advance(), so the student was
 * dropped into recording without ever hearing the question. With the
 * ExamAudioProvider mounted (mock exam), a blocked play now keeps the task
 * in the prep phase and surfaces the one-tap recovery overlay instead.
 */
import { render, screen, act } from "@testing-library/react";
import { ExamAudioProvider } from "../components/shared/ExamAudioProvider";
import { InterviewTask } from "../components/speaking/InterviewTask";

const ITEMS = [
  {
    id: "iv-q1",
    question: "Describe a teacher who influenced you.",
    category: "personal",
    difficulty: "easy",
    audio_url: "https://xyz.supabase.co/storage/v1/object/public/listening_audio/iv-q1.mp3",
  },
  {
    id: "iv-q2",
    question: "Do you prefer studying alone or in groups?",
    category: "opinion",
    difficulty: "medium",
    audio_url: "https://xyz.supabase.co/storage/v1/object/public/listening_audio/iv-q2.mp3",
  },
];

let playMock;

beforeEach(() => {
  playMock = jest.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.play = playMock;
  window.HTMLMediaElement.prototype.pause = jest.fn();
  window.HTMLMediaElement.prototype.load = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
});

test("blocked question audio keeps the prep phase and shows the overlay (no silent advance)", async () => {
  jest.useFakeTimers();
  // Every play attempt is autoplay-blocked (worst-case iOS WebView).
  playMock.mockRejectedValue(new DOMException("denied", "NotAllowedError"));

  render(
    <ExamAudioProvider>
      <InterviewTask items={ITEMS} onComplete={jest.fn()} onExit={jest.fn()} isPractice={false} />
    </ExamAudioProvider>
  );

  // Prep phase on Q1.
  expect(screen.getByText(/Listening to the question/)).toBeInTheDocument();

  // The auto-play timer (600ms) fires playQuestion → controller.play → rejected.
  await act(async () => {
    jest.advanceTimersByTime(600);
    await Promise.resolve();
    await Promise.resolve();
  });

  // STILL in prep — the blocked clip must not have advanced into recording.
  expect(screen.getByText(/Listening to the question/)).toBeInTheDocument();
  expect(screen.queryByText(/点击录音|点击开始录音|Waiting\.\.\./)).toBeNull();

  // And the recovery overlay is up for a one-tap resume.
  expect(screen.getByText("音频播放被浏览器暂停")).toBeInTheDocument();
});

test("recovered playback (retry → playing → ended) advances to the answer phase", async () => {
  jest.useFakeTimers();
  // Capture the controller's detached element to fire media events on it.
  let audioEl = null;
  const origCreate = document.createElement.bind(document);
  const spy = jest.spyOn(document, "createElement").mockImplementation((tag, ...rest) => {
    const el = origCreate(tag, ...rest);
    if (tag === "audio") audioEl = el;
    return el;
  });

  playMock.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));

  render(
    <ExamAudioProvider>
      <InterviewTask items={ITEMS} onComplete={jest.fn()} onExit={jest.fn()} isPractice={false} />
    </ExamAudioProvider>
  );

  await act(async () => {
    jest.advanceTimersByTime(600);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByText("音频播放被浏览器暂停")).toBeInTheDocument();

  // User taps 继续考试 (fresh gesture) → retry succeeds → clip plays → ends.
  await act(async () => {
    screen.getByText("继续考试").click();
    await Promise.resolve();
  });
  await act(async () => {
    audioEl.dispatchEvent(new Event("playing"));
  });
  expect(screen.queryByText("音频播放被浏览器暂停")).toBeNull();
  await act(async () => {
    audioEl.dispatchEvent(new Event("ended"));
  });

  // NOW the task advances into the answer phase (recorder UI mounts).
  expect(screen.queryByText(/Listening to the question/)).toBeNull();

  spy.mockRestore();
});
