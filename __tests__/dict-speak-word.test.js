/**
 * 划词词典里的发音按钮 + 共用的 lib/audio/speakWord。
 *
 * 钉住三件容易悄悄坏掉的事：
 *  1. 念的是弹窗标题上的原形（查 studies 念 study），不是学生点到的那个词形——
 *     旁边显示的音标是原形的，念成别的词就对不上了；
 *  2. 不挑 voice 的话，Safari / 中文系统的默认嗓子会拿中文音色念英文；
 *  3. Safari 首次 getVoices() 返回空表，直接放弃就一声不响。
 */
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { canSpeak, pickEnglishVoice, speakWord, cancelSpeakWord } from "../lib/audio/speakWord";
import { WordLookupLayer } from "../components/reading/WordLookupLayer";

const PASSAGE = "The scholar studies ancient trade routes.";
const SHARDS = {
  s: { studies: "study", study: { p: "'stʌdi", t: "vt. 研究；n. 学习", g: "cet4" } },
};

// 一个够用的 speechSynthesis 替身：jsdom 没有这套 API。
function installSpeech({ voices = [], deferVoices = false } = {}) {
  const spoken = [];
  const listeners = {};
  const synth = {
    cancel: jest.fn(),
    speak: jest.fn((u) => spoken.push(u)),
    getVoices: jest.fn(() => (deferVoices && !synth._released ? [] : voices)),
    addEventListener: jest.fn((type, fn) => {
      (listeners[type] = listeners[type] || []).push(fn);
    }),
    removeEventListener: jest.fn((type, fn) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    }),
    _released: false,
    releaseVoices() {
      synth._released = true;
      (listeners.voiceschanged || []).slice().forEach((fn) => fn());
    },
  };
  window.speechSynthesis = synth;
  window.SpeechSynthesisUtterance = function (text) {
    this.text = text;
    this.lang = "";
    this.rate = 1;
    this.voice = null;
  };
  return { synth, spoken };
}

function clearSpeech() {
  delete window.speechSynthesis;
  delete window.SpeechSynthesisUtterance;
}

const EN = { name: "Samantha", lang: "en-US" };
const EN_PLAIN = { name: "Daniel", lang: "en-GB" };
const ZH = { name: "Tingting", lang: "zh-CN" };

describe("speakWord", () => {
  afterEach(() => {
    clearSpeech();
    jest.useRealTimers();
  });

  it("环境不支持语音合成时返回 false，不抛错", () => {
    clearSpeech();
    expect(canSpeak()).toBe(false);
    expect(() => speakWord("study")).not.toThrow();
    expect(speakWord("study")).toBe(false);
  });

  it("空词不发声", () => {
    installSpeech({ voices: [EN] });
    expect(speakWord("   ")).toBe(false);
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it("挑英语嗓子：中文系统的默认音色念英文会跑调", () => {
    expect(pickEnglishVoice([ZH, EN_PLAIN, EN])).toBe(EN); // 点名的好嗓子优先
    expect(pickEnglishVoice([ZH, EN_PLAIN])).toBe(EN_PLAIN); // 退而求其次：任何 en-
    expect(pickEnglishVoice([ZH])).toBeNull(); // 没有英语嗓子就交给系统默认
    expect(pickEnglishVoice(undefined)).toBeNull();
  });

  it("念之前先掐掉上一遍，并用 en-US 的嗓子", () => {
    const { synth, spoken } = installSpeech({ voices: [ZH, EN] });
    expect(speakWord("study")).toBe(true);
    expect(synth.cancel).toHaveBeenCalled();
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe("study");
    expect(spoken[0].lang).toBe("en-US");
    expect(spoken[0].voice).toBe(EN);
  });

  it("Safari 首次 getVoices() 为空：等 voiceschanged，别一声不响", () => {
    const { synth, spoken } = installSpeech({ voices: [EN], deferVoices: true });
    expect(speakWord("study")).toBe(true);
    expect(spoken).toHaveLength(0); // 还在等嗓子列表
    act(() => synth.releaseVoices());
    expect(spoken).toHaveLength(1);
    expect(spoken[0].voice).toBe(EN);
  });

  it("voiceschanged 一直不来也要念（600ms 后用系统默认嗓子）", () => {
    jest.useFakeTimers();
    const { spoken } = installSpeech({ voices: [EN], deferVoices: true });
    speakWord("study");
    expect(spoken).toHaveLength(0);
    act(() => jest.advanceTimersByTime(600));
    expect(spoken).toHaveLength(1);
  });

  it("onDone 只回调一次：念完和兜底超时不能各关一次", () => {
    jest.useFakeTimers();
    const { spoken } = installSpeech({ voices: [EN] });
    const onDone = jest.fn();
    speakWord("study", { onDone });
    expect(onDone).not.toHaveBeenCalled();
    act(() => spoken[0].onend());
    act(() => jest.advanceTimersByTime(20000));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("浏览器既不给 onend 也不给 onerror 时，兜底超时收尾", () => {
    jest.useFakeTimers();
    installSpeech({ voices: [EN] });
    const onDone = jest.fn();
    speakWord("study", { onDone });
    act(() => jest.advanceTimersByTime(20000));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("等待 voice 时取消，不得在延迟回调里播出旧词", () => {
    jest.useFakeTimers();
    const { synth, spoken } = installSpeech({ voices: [EN], deferVoices: true });
    speakWord("old", { onEnd: jest.fn() });
    cancelSpeakWord();
    act(() => synth.releaseVoices());
    act(() => jest.advanceTimersByTime(20000));
    expect(spoken).toHaveLength(0);
  });

  it("只有正常结束触发 onEnd，中途取消和错误均不算听完", () => {
    const { spoken } = installSpeech({ voices: [EN] });
    const onEnd = jest.fn();
    speakWord("first", { onEnd });
    cancelSpeakWord();
    expect(onEnd).not.toHaveBeenCalled();
    speakWord("second", { onEnd });
    act(() => spoken[1].onstart());
    act(() => spoken[1].onerror());
    expect(onEnd).not.toHaveBeenCalled();
    speakWord("third", { onEnd });
    act(() => spoken[2].onstart());
    act(() => spoken[2].onend());
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe("划词弹窗 · 发音按钮", () => {
  const realFetch = global.fetch;
  const realCaret = document.caretRangeFromPoint;
  const realRect = Range.prototype.getBoundingClientRect;

  beforeAll(() => {
    global.fetch = jest.fn((url) => {
      const letter = String(url).match(/\/dict\/(.)\.json/)[1];
      return Promise.resolve({ ok: true, json: () => Promise.resolve(SHARDS[letter] || {}) });
    });
    // jsdom 没实现这两个 API：点哪儿都当成点在 studies 上
    document.caretRangeFromPoint = () => {
      const host = screen.getByText(PASSAGE);
      const r = document.createRange();
      r.setStart(host.firstChild, PASSAGE.indexOf("studies") + 2);
      r.collapse(true);
      return r;
    };
    Range.prototype.getBoundingClientRect = () => ({
      top: 100, bottom: 116, left: 40, right: 100, width: 60, height: 16,
    });
  });

  afterAll(() => {
    global.fetch = realFetch;
    document.caretRangeFromPoint = realCaret;
    Range.prototype.getBoundingClientRect = realRect;
  });

  afterEach(clearSpeech);

  async function openPopup() {
    render(<WordLookupLayer passage={PASSAGE}>{PASSAGE}</WordLookupLayer>);
    fireEvent.mouseUp(screen.getByText(PASSAGE), { clientX: 60, clientY: 108 });
    return screen.findByLabelText("朗读这个词");
  }

  it("点一下就念，念的是标题上的原形而不是点到的词形", async () => {
    const { spoken } = installSpeech({ voices: [EN] });
    const btn = await openPopup();
    // 词典命中的是原形：标题和音标都显示 study
    expect(await screen.findByText("study")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe("study");
  });

  it("浏览器不支持语音合成时不渲染这个按钮", async () => {
    clearSpeech();
    render(<WordLookupLayer passage={PASSAGE}>{PASSAGE}</WordLookupLayer>);
    fireEvent.mouseUp(screen.getByText(PASSAGE), { clientX: 60, clientY: 108 });
    expect(await screen.findByText("study")).toBeInTheDocument();
    expect(screen.queryByLabelText("朗读这个词")).toBeNull();
  });
});
