/**
 * 浏览器朗读兜底 · 对话两声（2026-09-07 用户反馈）。
 *
 * 没有 audio_url 时 ListeningMCQTask 之前把对话拼成「Man: …. Woman: …」一整段交给一个音色念，
 * 角色名被念出来、男女一个声。锁：兜底按轮次逐句念、不念角色名、按性别选不同音色、
 * 轮次间留间隔，最后一轮念完才触发 onEnded。
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AudioPlayer } from "../components/listening/AudioPlayer";
import { ListeningMCQTask } from "../components/listening/ListeningMCQTask";

let spoken;
beforeEach(() => {
  jest.useFakeTimers();
  spoken = [];
  window.HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = jest.fn();
  window.HTMLMediaElement.prototype.load = jest.fn();
  global.SpeechSynthesisUtterance = function (t) { this.text = t; };
  global.speechSynthesis = {
    speak: jest.fn((u) => { spoken.push(u); }),
    cancel: jest.fn(),
    getVoices: () => [{ lang: "en-US", name: "Samantha" }, { lang: "en-US", name: "Alex" }],
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
});
afterEach(() => { jest.useRealTimers(); });

const turns = [
  { text: "Should we take the train?", gender: "male" },
  { text: "Just be ready to leave at seven a.m.", gender: "female" },
];

test("对话兜底：逐轮朗读、不含角色名、男女音色不同、最后一轮才 onEnded", async () => {
  const onEnded = jest.fn();
  render(<AudioPlayer src={null} text="ignored when turns given" turns={turns} onEnded={onEnded} isPractice />);
  await act(async () => { fireEvent.click(screen.getByRole("button")); });

  expect(spoken).toHaveLength(1);
  expect(spoken[0].text).toBe("Should we take the train?");
  expect(spoken[0].text).not.toMatch(/Man:|Woman:/);
  expect(spoken[0].voice.name).toBe("Alex");

  await act(async () => { spoken[0].onend(); });
  expect(onEnded).not.toHaveBeenCalled();          // 还没念完
  expect(spoken).toHaveLength(1);                   // 轮次间隔里还没开口
  await act(async () => { jest.advanceTimersByTime(400); });
  expect(spoken).toHaveLength(2);
  expect(spoken[1].text).toBe("Just be ready to leave at seven a.m.");
  expect(spoken[1].voice.name).toBe("Samantha");

  await act(async () => { spoken[1].onend(); });
  expect(onEnded).toHaveBeenCalledTimes(1);
});

test("浏览器只有一个英文音色时用音高区分男女", async () => {
  global.speechSynthesis.getVoices = () => [{ lang: "en-US", name: "Samantha" }];
  render(<AudioPlayer src={null} turns={turns} onEnded={() => {}} isPractice />);
  await act(async () => { fireEvent.click(screen.getByRole("button")); });
  expect(spoken[0].pitch).toBeCloseTo(0.85);
  await act(async () => { spoken[0].onend(); jest.advanceTimersByTime(400); });
  expect(spoken[1].pitch).toBeCloseTo(1.15);
});

test("ListeningMCQTask 把对话拆成带性别的 turns，且 text 不含角色名", async () => {
  const item = {
    id: "lc_x", audio_url: null,
    speakers: [{ name: "Man", gender: "male" }, { name: "Woman", gender: "female" }],
    conversation: [{ speaker: "Man", text: "Hi there." }, { speaker: "Woman", text: "Hello." }],
    questions: [{ stem: "Q?", options: { A: "a", B: "b", C: "c", D: "d" }, answer: "A" }],
  };
  render(<ListeningMCQTask item={item} taskType="lc" onComplete={() => {}} onExit={() => {}} isPractice />);
  // autoPlay 兜底会立刻开口（音色列表已就绪）
  await act(async () => { jest.advanceTimersByTime(50); });
  expect(spoken.length).toBeGreaterThanOrEqual(1);
  expect(spoken[0].text).toBe("Hi there.");
  expect(spoken[0].voice.name).toBe("Alex");
});
