/**
 * Regression locks for the listening-mock "做不了" fix (2026-06-26).
 *
 * The listening exam wedged because the answer phase was gated solely on the
 * audio 'ended' event, and AudioPlayer had no recovery when the clip never
 * played: (1) no 'error' listener, and the TTS fallback was unreachable while
 * `src` was set; (2) "completed" was conflated with "started", so a stalled
 * clip could disable the manual play button. These tests pin the fixes.
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AudioPlayer } from "../components/listening/AudioPlayer";

let spoken;

beforeEach(() => {
  spoken = [];
  // jsdom doesn't implement media playback — stub it.
  window.HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = jest.fn();
  window.HTMLMediaElement.prototype.load = jest.fn();
  // jsdom has no Web Speech API — stub a synchronous one with a ready voice list
  // so startTTS speaks immediately (no voiceschanged wait).
  global.SpeechSynthesisUtterance = function (t) { this.text = t; };
  global.speechSynthesis = {
    speak: jest.fn((u) => { spoken.push(u); }),
    cancel: jest.fn(),
    getVoices: () => [{ lang: "en-US", name: "Samantha" }],
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
});

test("a media 'error' (unreachable CDN) rescues via TTS and still fires onEnded", async () => {
  const onEnded = jest.fn();
  const { container } = render(
    <AudioPlayer src="https://cdn.example/clip.mp3" text="Where is the library?" onEnded={onEnded} maxReplays={0} />
  );
  const audioEl = container.querySelector("audio");
  expect(audioEl).toBeTruthy();

  // The mp3 fails to load — before the fix there was no 'error' listener, so
  // this dead-ended. Now it must fall back to speaking the text.
  await act(async () => { fireEvent.error(audioEl); });
  expect(global.speechSynthesis.speak).toHaveBeenCalledTimes(1);
  expect(spoken[0].text).toBe("Where is the library?");

  // When the spoken fallback finishes, the consumer's onEnded must fire so the
  // exam advances out of the listen phase.
  expect(onEnded).not.toHaveBeenCalled();
  await act(async () => { spoken[0].onend(); });
  expect(onEnded).toHaveBeenCalledTimes(1);
});

test("play-once rule: the button only locks AFTER a real 'ended', not on start", async () => {
  const onEnded = jest.fn();
  const { container } = render(
    <AudioPlayer src="https://cdn.example/clip.mp3" text="hi" onEnded={onEnded} maxReplays={0} />
  );
  const audioEl = container.querySelector("audio");
  const button = screen.getByRole("button");

  // Enabled before any playback.
  expect(button).not.toBeDisabled();

  // Start playback — disabled while sounding, but NOT permanently (no 'ended' yet).
  await act(async () => { fireEvent.click(button); });

  // Audio finishes → completed → onEnded fires and, in exam mode (maxReplays=0),
  // the play-once rule now locks the button.
  await act(async () => { fireEvent.ended(audioEl); });
  expect(onEnded).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
});

test("a blocked autoplay is recoverable: the manual play button still triggers play()", async () => {
  const playMock = window.HTMLMediaElement.prototype.play;
  // First (autoplay) attempt is blocked; a later user tap succeeds.
  playMock.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
  playMock.mockResolvedValue(undefined);

  const { container } = render(
    <AudioPlayer src="https://cdn.example/clip.mp3" text="hi" onEnded={jest.fn()} maxReplays={0} autoPlay />
  );
  // Let the rejected autoplay promise settle.
  await act(async () => { await Promise.resolve(); });

  const button = screen.getByRole("button");
  // Crucially, a blocked autoplay must NOT leave the button disabled.
  expect(button).not.toBeDisabled();

  await act(async () => { fireEvent.click(button); });
  // play() was attempted again by the manual tap (autoplay + tap = 2 calls).
  expect(playMock.mock.calls.length).toBeGreaterThanOrEqual(2);
});
