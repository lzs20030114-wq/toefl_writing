/**
 * Unit locks for lib/audio/examAudioController.js — the persistent exam
 * audio element that survives WebKit's per-element autoplay rules.
 *
 * Covers: gesture unlock (ok/blocked), play lifecycle (playing/ended/error),
 * NotAllowedError → blocked, AbortError swallowed-but-counted, the silence
 * watchdog (4s → blocked, extended to 15s while NETWORK_LOADING), preload
 * never interrupting playback, and retry reusing the last play.
 */
import { createExamAudioController } from "../lib/audio/examAudioController";

const SRC_A = "https://cdn.example/clip-a.mp3";
const SRC_B = "https://cdn.example/clip-b.mp3";

let playMock;
let audioEl; // the controller's detached element, captured via createElement

// Settle pending promise callbacks (play().then/.catch chains).
const flush = () => Promise.resolve().then(() => Promise.resolve());

beforeEach(() => {
  // jsdom doesn't implement media playback — stub it (same approach as
  // audio-player.regression.test.js).
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
  jest.useRealTimers();
});

function makeController(opts) {
  const c = createExamAudioController(opts);
  const events = [];
  c.subscribe((e) => events.push(e));
  return { c, events };
}

function setNetworkState(value) {
  Object.defineProperty(audioEl, "networkState", { value, configurable: true });
}

test("unlock success → 'unlocked' event, idempotent (no second play)", async () => {
  const { c, events } = makeController();
  expect(c.isUnlocked()).toBe(false);
  c.unlock();
  await flush();
  expect(events.some((e) => e.type === "unlocked")).toBe(true);
  expect(c.isUnlocked()).toBe(true);
  const calls = playMock.mock.calls.length;
  c.unlock(); // already unlocked — must be a no-op
  expect(playMock.mock.calls.length).toBe(calls);
});

test("unlock rejected with NotAllowedError → 'unlock-blocked' event", async () => {
  playMock.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
  const { c, events } = makeController();
  c.unlock();
  await flush();
  expect(events.some((e) => e.type === "unlock-blocked")).toBe(true);
  expect(c.isUnlocked()).toBe(false);
});

test("play → 'playing' event carries firstFrameMs and meta", async () => {
  const { c, events } = makeController();
  const meta = { section: "listening", taskType: "lcr", itemId: "x1" };
  c.play(SRC_A, meta);
  await flush();
  audioEl.dispatchEvent(new Event("playing"));
  const playing = events.find((e) => e.type === "playing");
  expect(playing).toBeTruthy();
  expect(typeof playing.firstFrameMs).toBe("number");
  expect(playing.meta).toEqual(meta);
  expect(c.getState()).toBe("playing");
  expect(c.getCurrentSrc()).toBe(SRC_A);
});

test("play rejected with NotAllowedError → blocked(not-allowed)", async () => {
  playMock.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
  const { c, events } = makeController();
  c.play(SRC_A);
  await flush();
  const blocked = events.find((e) => e.type === "blocked");
  expect(blocked).toBeTruthy();
  expect(blocked.reason).toBe("not-allowed");
  expect(c.getState()).toBe("blocked");
});

test("AbortError is swallowed (no blocked/error event) but counted", async () => {
  playMock.mockRejectedValueOnce(new DOMException("interrupted", "AbortError"));
  const { c, events } = makeController();
  c.play(SRC_A);
  await flush();
  expect(events.filter((e) => e.type === "blocked" || e.type === "error")).toHaveLength(0);
  expect(c._getAbortErrorCount()).toBe(1);
});

test("media 'error' → error event with diagnostic fields", async () => {
  const { c, events } = makeController();
  c.play(SRC_A);
  await flush();
  audioEl.dispatchEvent(new Event("error"));
  const err = events.find((e) => e.type === "error");
  expect(err).toBeTruthy();
  expect(err.errorName).toBe("MediaError");
  expect(err).toHaveProperty("mediaErrorCode");
  expect(err).toHaveProperty("readyState");
  expect(err).toHaveProperty("networkState");
  expect(c.getState()).toBe("error");
});

test("watchdog: 4s with no 'playing' and not loading → blocked(silent-timeout)", () => {
  jest.useFakeTimers();
  const { c, events } = makeController();
  c.play(SRC_A);
  setNetworkState(1); // NETWORK_IDLE — not fetching, genuinely silent
  jest.advanceTimersByTime(4000);
  const blocked = events.find((e) => e.type === "blocked");
  expect(blocked).toBeTruthy();
  expect(blocked.reason).toBe("silent-timeout");
});

test("watchdog: extends while NETWORK_LOADING (buffering), then times out at 15s", () => {
  jest.useFakeTimers();
  const { c, events } = makeController();
  c.play(SRC_A);
  setNetworkState(2); // NETWORK_LOADING — still fetching
  jest.advanceTimersByTime(4000);
  expect(events.some((e) => e.type === "buffering")).toBe(true);
  expect(events.some((e) => e.type === "blocked")).toBe(false);
  jest.advanceTimersByTime(11000); // 15s total budget spent
  const blocked = events.find((e) => e.type === "blocked");
  expect(blocked).toBeTruthy();
  expect(blocked.reason).toBe("silent-timeout");
});

test("watchdog: cleared by the 'playing' event", () => {
  jest.useFakeTimers();
  const { c, events } = makeController();
  c.play(SRC_A);
  audioEl.dispatchEvent(new Event("playing"));
  jest.advanceTimersByTime(20000);
  expect(events.some((e) => e.type === "blocked")).toBe(false);
});

test("preload is ignored while playing, allowed after ended", async () => {
  const loadMock = window.HTMLMediaElement.prototype.load;
  const { c } = makeController();
  c.play(SRC_A);
  await flush();
  audioEl.dispatchEvent(new Event("playing"));
  const loadsWhilePlaying = loadMock.mock.calls.length;
  c.preload(SRC_B); // must NOT interrupt the sounding clip
  expect(loadMock.mock.calls.length).toBe(loadsWhilePlaying);
  expect(c.getCurrentSrc()).toBe(SRC_A);

  audioEl.dispatchEvent(new Event("ended"));
  c.preload(SRC_B); // idle again — preloading is allowed now
  expect(loadMock.mock.calls.length).toBe(loadsWhilePlaying + 1);
});

test("retry replays the last src (fresh-gesture recovery path)", async () => {
  playMock.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
  const { c, events } = makeController();
  const meta = { section: "speaking", taskType: "repeat", itemId: "s3" };
  c.play(SRC_A, meta);
  await flush();
  expect(c.getState()).toBe("blocked");

  events.length = 0;
  c.retry();
  const loading = events.find((e) => e.type === "loading");
  expect(loading).toBeTruthy();
  expect(loading.src).toBe(SRC_A);
  expect(loading.meta).toEqual(meta);
});

test("onTelemetry receives lifecycle events", async () => {
  const onTelemetry = jest.fn();
  const c = createExamAudioController({ onTelemetry });
  c.play(SRC_A);
  await flush();
  audioEl.dispatchEvent(new Event("playing"));
  const types = onTelemetry.mock.calls.map(([e]) => e.type);
  expect(types).toContain("loading");
  expect(types).toContain("playing");
});
