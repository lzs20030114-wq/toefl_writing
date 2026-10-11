const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let preloadSpeakWords, speakWord, cancelSpeakWord, media;
beforeEach(() => {
  jest.resetModules();
  media = [];
  global.Audio = jest.fn(() => {
    const audio = { readyState: 3, preload: "", load: jest.fn(), pause: jest.fn(), play: jest.fn(() => Promise.resolve()), removeAttribute: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn() };
    media.push(audio); return audio;
  });
  URL.createObjectURL = jest.fn(() => "blob:test");
  URL.revokeObjectURL = jest.fn();
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, blob: async () => new Blob(["mp3"]) }));
  window.speechSynthesis = { cancel: jest.fn(), getVoices: () => [{ lang: "en-US" }], speak: jest.fn() };
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  ({ preloadSpeakWords, speakWord, cancelSpeakWord } = require("../lib/audio/speakWord"));
});
afterEach(() => { cancelSpeakWord(); jest.useRealTimers(); });

test("background loader deduplicates normalized words without playing", async () => {
  const release = preloadSpeakWords([" Apple ", "apple", "pear"]);
  const other = preloadSpeakWords(["APPLE"]);
  await flush();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(media.every((audio) => !audio.play.mock.calls.length)).toBe(true);
  release();
  const onStart = jest.fn(), onDone = jest.fn();
  expect(speakWord("apple", { onStart, onDone })).toBe(true);
  expect(media[0].play).toHaveBeenCalledTimes(1);
  expect(media[0].playbackRate).toBe(1);
  expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  media[0].onplaying();
  expect(onStart).toHaveBeenCalledTimes(1);
  const lateEnd = media[0].onended;
  cancelSpeakWord(); lateEnd();
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(media[0].pause).toHaveBeenCalled();
  other();
});

test("pending audio uses native immediately and never plays on completion", async () => {
  let resolve;
  fetch.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const release = preloadSpeakWords(["apple"]);
  speakWord("apple");
  expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);
  resolve({ ok: true, blob: async () => new Blob(["mp3"]) });
  await flush();
  expect(media[0].play).not.toHaveBeenCalled();
  release();
});

test("three concurrent requests, release removes queued work and aborts unneeded inflight", async () => {
  const pending = [];
  fetch.mockImplementation((url, options) => new Promise((resolve) => pending.push({ resolve, options })));
  const release = preloadSpeakWords(["a", "b", "c", "d", "e"]);
  const other = preloadSpeakWords(["a"]);
  expect(fetch).toHaveBeenCalledTimes(3);
  release();
  expect(pending[0].options.signal.aborted).toBe(false);
  expect(pending[1].options.signal.aborted).toBe(true);
  pending.forEach(({ resolve }) => resolve({ ok: true, blob: async () => new Blob(["mp3"]) }));
  await flush();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(media).toHaveLength(1);
  other();
});

test("release during media loading disposes URL and late readiness cannot play", async () => {
  const listeners = {};
  Audio.mockImplementation(() => {
    const audio = { readyState: 0, load: jest.fn(), pause: jest.fn(), removeAttribute: jest.fn(), addEventListener: (event, fn) => { listeners[event] = fn; }, removeEventListener: jest.fn() };
    media.push(audio); return audio;
  });
  const release = preloadSpeakWords(["apple"]);
  await flush();
  release();
  listeners.canplay();
  await flush();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
  speakWord("apple");
  expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);
});

test("autoplay rejection reports completion without retrying native speech", async () => {
  preloadSpeakWords(["apple"]);
  await flush();
  media[0].play.mockRejectedValue({ name: "NotAllowedError" });
  const onError = jest.fn(), onDone = jest.fn();
  speakWord("apple", { onError, onDone });
  await flush();
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
});

test("late play rejection after cancellation cannot restart speech", async () => {
  preloadSpeakWords(["apple"]);
  await flush();
  let reject;
  media[0].play.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const onDone = jest.fn();
  speakWord("apple", { onDone });
  cancelSpeakWord();
  reject(new Error("decoder failed"));
  await flush();
  expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  expect(onDone).toHaveBeenCalledTimes(1);
});

test("current decoding rejection falls back to native with a single completion", async () => {
  preloadSpeakWords(["apple"]);
  await flush();
  media[0].play.mockRejectedValue(new Error("decoder failed"));
  const onDone = jest.fn();
  speakWord("apple", { onDone });
  await flush();
  expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);
  expect(onDone).not.toHaveBeenCalled();
  cancelSpeakWord();
  expect(onDone).toHaveBeenCalledTimes(1);
});

test("released large sessions trim detached media and blob URLs", async () => {
  const release = preloadSpeakWords(Array.from({ length: 130 }, (_, i) => `word${i}`));
  for (let i = 0; i < 50; i++) await flush();
  expect(media).toHaveLength(130);
  release();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(10);
  expect(media.slice(0, 10).every((audio) => audio.removeAttribute.mock.calls.length === 1)).toBe(true);
});

test("cached audio cannot unlock on an end event before confirmed playback", async () => {
  preloadSpeakWords(["apple"]);
  await flush();
  const onEnd = jest.fn(), onDone = jest.fn();
  const onError = jest.fn(() => { throw new Error("consumer callback"); });
  speakWord("apple", { onEnd, onError, onDone });
  media[0].onended();
  expect(onEnd).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onDone).toHaveBeenCalledTimes(1);
});

test("repeated playing events invoke onStart once and normal completion survives callback errors", async () => {
  preloadSpeakWords(["apple"]);
  await flush();
  const onStart = jest.fn(), onDone = jest.fn();
  const onEnd = jest.fn(() => { throw new Error("consumer callback"); });
  speakWord("apple", { onStart, onEnd, onDone });
  media[0].onplaying(); media[0].onplaying(); media[0].onended();
  expect(onStart).toHaveBeenCalledTimes(1);
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(onDone).toHaveBeenCalledTimes(1);
});
