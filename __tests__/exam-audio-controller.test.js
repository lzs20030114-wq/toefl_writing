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
const UNLOCK_SAFETY_MS = 1000; // 与 examAudioController.js 的 UNLOCK_FLUSH_SAFETY_MS 一致

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
  // 排障诊断字段(弹窗诊断行 + 遥测用)。
  expect(blocked).toHaveProperty("networkState");
  expect(blocked).toHaveProperty("readyState");
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

// ── unlock() anti-interrupt gate ───────────────────────────────────────────
// The gate skips ONLY while a clip is loading/playing (a mid-playback unlock
// would swap in SILENT_WAV and 腰斩 the题干); every other state unlocks and
// returns true so a first-interaction listener knows to stop retrying.

test("unlock is skipped (returns false) while a clip is loading", () => {
  const { c } = makeController();
  c.play(SRC_A); // state → loading (no 'playing' event yet)
  expect(c.getState()).toBe("loading");
  expect(c.unlock()).toBe(false);
  expect(c.isUnlocked()).toBe(false);
  c.destroy(); // clear the armed silence watchdog
});

test("a clip actually playing marks the element unlocked; unlock() becomes a no-op", async () => {
  // 'playing' = WebKit 已放行这个元素(手势直接花在正片上的场景)——等价于解锁
  // 完成,unlock() 不得再碰元素(碰 = 播放中换 SILENT_WAV 腰斩题干)。
  const { c } = makeController();
  c.play(SRC_A);
  await flush();
  audioEl.dispatchEvent(new Event("playing"));
  expect(c.getState()).toBe("playing");
  expect(c.isUnlocked()).toBe(true);
  const calls = playMock.mock.calls.length;
  expect(c.unlock()).toBe(true); // already unlocked — early return
  expect(playMock.mock.calls.length).toBe(calls); // element untouched
});

test("unlock executes (returns true) from idle", () => {
  const { c } = makeController();
  expect(c.getState()).toBe("idle");
  expect(c.unlock()).toBe(true);
});

test("unlock executes (returns true) from ended", async () => {
  const { c } = makeController();
  c.play(SRC_A);
  await flush();
  audioEl.dispatchEvent(new Event("ended"));
  expect(c.getState()).toBe("ended");
  expect(c.unlock()).toBe(true);
});

test("unlock executes (returns true) from blocked — iOS autoplay-block stays unlockable (no persistent-player regression)", async () => {
  playMock.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
  const { c } = makeController();
  c.play(SRC_A);
  await flush();
  expect(c.getState()).toBe("blocked");
  expect(c.unlock()).toBe(true);
});

test("unlock executes (returns true) from error", async () => {
  const { c } = makeController();
  c.play(SRC_A);
  await flush();
  audioEl.dispatchEvent(new Event("error"));
  expect(c.getState()).toBe("error");
  expect(c.unlock()).toBe(true);
});

test("unlock returns true when already unlocked (idempotent, no second play)", async () => {
  const { c } = makeController();
  c.unlock();
  await flush();
  expect(c.isUnlocked()).toBe(true);
  const calls = playMock.mock.calls.length;
  expect(c.unlock()).toBe(true);
  expect(playMock.mock.calls.length).toBe(calls);
});

// ── unlock ↔ play 同手势不互相踩踏（「继续考试」失效的根因修复） ──────────────
// 旧行为:retry() 里 unlock() 刚把 SILENT_WAV 播下去,同 tick 的 play() 立刻
// pause+换 src,解锁被腰斩成 AbortError → unlocked 永远置不上;而手势已被静音片
// 消耗,正片 play() 沦为无手势调用,iOS 加载完才拒绝 → 弹窗反复出现,按钮像坏的。

test("play() during an in-flight unlock queues instead of trampling it, then flushes", async () => {
  const { c, events } = makeController();
  const meta = { section: "listening", taskType: "lcr", itemId: "q1" };
  c.unlock();          // 手势内:静音片开始播,promise 未落定
  c.play(SRC_A, meta); // 同 tick 到达 → 必须排队,不许换 src
  expect(audioEl.src.startsWith("data:audio/wav")).toBe(true); // 静音片还在
  // 排队期间对外仍表现为 loading(UI 显示加载态)。
  expect(events.some((e) => e.type === "loading" && e.src === SRC_A)).toBe(true);

  await flush(); // 解锁 promise 落定
  expect(c.isUnlocked()).toBe(true); // 解锁真的完成了(旧版这里是 false)
  expect(audioEl.src).toBe(SRC_A);   // 排队的正片已续播
  expect(playMock.mock.calls.length).toBe(2); // 静音片 1 次 + 正片 1 次
  expect(events.some((e) => e.type === "unlocked")).toBe(true);
  c.destroy(); // 清掉正片 play armed 的看门狗
});

test("retry() while locked completes the unlock AND replays the clip (继续考试恢复)", async () => {
  playMock.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
  const { c, events } = makeController();
  const meta = { section: "speaking", taskType: "repeat", itemId: "s1" };
  c.play(SRC_A, meta);
  await flush();
  expect(c.getState()).toBe("blocked"); // 弹窗场景就绪

  events.length = 0;
  c.retry(); // 「继续考试」点击:解锁 + 排队重播
  await flush();
  expect(c.isUnlocked()).toBe(true);
  expect(audioEl.src).toBe(SRC_A);
  expect(events.some((e) => e.type === "unlocked")).toBe(true);
  expect(events.some((e) => e.type === "loading" && e.src === SRC_A)).toBe(true);
  c.destroy();
});

test("safety valve: a hung unlock promise still flushes the queued play after 1s", () => {
  jest.useFakeTimers();
  playMock.mockImplementationOnce(() => new Promise(() => {})); // 解锁悬死
  const { c } = makeController();
  c.unlock();
  c.play(SRC_A);
  expect(audioEl.src.startsWith("data:audio/wav")).toBe(true);
  jest.advanceTimersByTime(UNLOCK_SAFETY_MS);
  expect(audioEl.src).toBe(SRC_A); // 排队的播放没有被永久卡死
  c.destroy();
});

test("stop() clears a queued play (mic must not fight a late flush)", async () => {
  playMock.mockImplementationOnce(() => new Promise(() => {})); // 解锁挂起
  const { c } = makeController();
  c.unlock();
  c.play(SRC_A); // 排队
  c.stop();      // 录音开始前的静音调用
  await flush();
  expect(audioEl.src.startsWith("data:audio/wav")).toBe(true); // 没有被补播
});
