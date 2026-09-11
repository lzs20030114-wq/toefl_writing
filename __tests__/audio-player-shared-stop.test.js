/**
 * 共享单一 <audio> 模式下的「停自己那条」锁（2026-09-11 用户反馈）。
 *
 * 病灶：听力题播放中点「返回」退回题目列表，音频继续放到结束。三个页面
 * （listening / speaking / real-bank）都用 ExamAudioProvider 包住整棵子树，
 * AudioPlayer 在 Provider 下走共享持久 <audio>（controllerMode），但
 * stopPlayback 只 pause 本地 audioRef（共享模式下压根没渲染）+ cancel
 * speechSynthesis，从未调 controller.stop() —— 于是卸载清理 / 换题重置 /
 * 紧凑模式手动停止在共享模式下全部空转，题目组件卸载后 Provider 还在，
 * 共享元素照放到底。
 *
 * 方案 A：共享模式下若共享元素上响的就是本播放器交出去的那条片段，调
 * controller.stop()。别的播放器刚接手时 currentSrc 已变，不能误停。
 */
import { render, act, fireEvent, screen } from "@testing-library/react";
import { ExamAudioProvider, useExamAudio } from "../components/shared/ExamAudioProvider";
import { AudioPlayer } from "../components/listening/AudioPlayer";

const CLIP_A = "https://cdn.example/clip-a.mp3";
const CLIP_B = "https://cdn.example/clip-b.mp3";
const OTHER = "https://cdn.example/other.mp3";

let playMock;
let pauseMock;
let audioEl; // Provider controller 的常驻元素（createElement 钩出来）

beforeEach(() => {
  playMock = jest.fn().mockResolvedValue(undefined);
  pauseMock = jest.fn();
  window.HTMLMediaElement.prototype.play = playMock;
  window.HTMLMediaElement.prototype.pause = pauseMock;
  window.HTMLMediaElement.prototype.load = jest.fn();
  global.SpeechSynthesisUtterance = function (t) { this.text = t; };
  global.speechSynthesis = {
    speak: jest.fn(),
    cancel: jest.fn(),
    getVoices: () => [{ lang: "en-US", name: "Samantha" }],
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
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
});

// 把 context 暴露给测试（Provider 的 controller 就是被测对象）。
function Consumer({ ctxRef }) {
  ctxRef.ctx = useExamAudio();
  return null;
}

// 真实页面形状：Provider 常驻（页面级），题目组件挂/卸（返回列表 = show:false）。
function Harness({ ctxRef, show = true, src = CLIP_A, compact = false }) {
  return (
    <ExamAudioProvider>
      <Consumer ctxRef={ctxRef} />
      {show
        ? <AudioPlayer src={src} text="hi" onEnded={() => {}} maxReplays={0} autoPlay compact={compact} />
        : <div>题目列表</div>}
    </ExamAudioProvider>
  );
}

// stop() 计数 + 每次调用当时共享元素上响的是哪条（换题场景要看这个）。
function spyStop(controller) {
  const orig = controller.stop;
  const srcsAtStop = [];
  const spy = jest.spyOn(controller, "stop").mockImplementation((...args) => {
    srcsAtStop.push(controller.getCurrentSrc());
    return orig(...args);
  });
  return { spy, srcsAtStop };
}

test("共享模式播放中卸载（点「返回」）→ 共享元素被停，不再放到结束", async () => {
  const ctxRef = {};
  const { rerender } = render(<Harness ctxRef={ctxRef} />);
  await act(async () => { await Promise.resolve(); });

  const controller = ctxRef.ctx.controller;
  // 走的确实是共享通道：片段交给了常驻元素（AudioPlayer 自己不渲染 <audio>）。
  expect(controller.getCurrentSrc()).toBe(CLIP_A);
  await act(async () => { audioEl.dispatchEvent(new Event("playing")); });
  expect(controller.getState()).toBe("playing");

  const { spy } = spyStop(controller);
  // 「返回」= 题目组件卸载，Provider 留着 —— 修复前这里什么都不会发生。
  await act(async () => { rerender(<Harness ctxRef={ctxRef} show={false} />); });

  expect(spy).toHaveBeenCalledTimes(1);
  expect(controller.getState()).toBe("idle");
  expect(pauseMock).toHaveBeenCalled();
});

test("共享元素已被别的播放器接手（currentSrc 是别的 src）→ 卸载时不误停别人", async () => {
  const ctxRef = {};
  const { rerender } = render(<Harness ctxRef={ctxRef} />);
  await act(async () => { await Promise.resolve(); });
  const controller = ctxRef.ctx.controller;
  expect(controller.getCurrentSrc()).toBe(CLIP_A);

  // 另一个播放器抢走了单一播放位。
  await act(async () => { controller.play(OTHER, { section: "listening" }); });
  expect(controller.getCurrentSrc()).toBe(OTHER);

  const { spy } = spyStop(controller);
  await act(async () => { rerender(<Harness ctxRef={ctxRef} show={false} />); });

  expect(spy).not.toHaveBeenCalled();          // 停自己那条，不是停共享元素
  expect(controller.getCurrentSrc()).toBe(OTHER);
  expect(controller.getState()).not.toBe("idle"); // 别人的正片没被掐断
});

test("换题（src 变化）→ 旧片段被停，且停的是旧的那条", async () => {
  const ctxRef = {};
  const { rerender } = render(<Harness ctxRef={ctxRef} />);
  await act(async () => { await Promise.resolve(); });
  const controller = ctxRef.ctx.controller;
  await act(async () => { audioEl.dispatchEvent(new Event("playing")); });

  const { spy, srcsAtStop } = spyStop(controller);
  await act(async () => { rerender(<Harness ctxRef={ctxRef} src={CLIP_B} />); });

  expect(spy).toHaveBeenCalledTimes(1);
  // 换题重置先跑（audioSrc 已是新值），所以判等只能靠「我交出去的那条」——
  // 拿新 src 判等会漏停仍在响的旧片段。
  expect(srcsAtStop).toEqual([CLIP_A]);
  // 停完立刻接上新题。
  expect(controller.getCurrentSrc()).toBe(CLIP_B);
});

test("换题到一条没有 audio_url 的题（src=null）→ 旧片段仍被停（不会一路放下去）", async () => {
  // 这条路径 playAudio 走浏览器朗读、根本不碰 controller，只有 stopPlayback
  // 能停住上一条 mp3。
  const ctxRef = {};
  const { rerender } = render(<Harness ctxRef={ctxRef} />);
  await act(async () => { await Promise.resolve(); });
  const controller = ctxRef.ctx.controller;
  await act(async () => { audioEl.dispatchEvent(new Event("playing")); });

  const { spy, srcsAtStop } = spyStop(controller);
  await act(async () => { rerender(<Harness ctxRef={ctxRef} src={null} />); });

  expect(spy).toHaveBeenCalledTimes(1);
  expect(srcsAtStop).toEqual([CLIP_A]);
  expect(controller.getState()).toBe("idle");
});

test("紧凑模式播放中点按钮 → 共享元素被停，按钮回到未播放态", async () => {
  const ctxRef = {};
  render(<Harness ctxRef={ctxRef} compact />);
  await act(async () => { await Promise.resolve(); });
  const controller = ctxRef.ctx.controller;
  await act(async () => { audioEl.dispatchEvent(new Event("playing")); });

  const button = screen.getByRole("button");
  expect(button).toHaveTextContent("Playing…");

  const { spy } = spyStop(controller);
  await act(async () => { fireEvent.click(button); });

  expect(spy).toHaveBeenCalledTimes(1);
  expect(controller.getState()).toBe("idle");
  expect(button).toHaveTextContent("Replay");
});

test("非共享模式（无 Provider）行为不变：走自己的 <audio>，停止仍只 pause 本地元素", async () => {
  const { container, rerender, unmount } = render(
    <AudioPlayer src={CLIP_A} text="hi" onEnded={() => {}} maxReplays={0} autoPlay compact />
  );
  await act(async () => { await Promise.resolve(); });
  // 传统路径：本地 <audio> 照样渲染，播放走它自己。
  const localEl = container.querySelector("audio");
  expect(localEl).toBeTruthy();
  expect(localEl.getAttribute("src")).toBe(CLIP_A);
  expect(playMock).toHaveBeenCalled();

  // 紧凑模式手动停止：本地元素被 pause，按钮回到未播放态（新增的共享分支在
  // 没有 controller 时必须整段跳过，不能抛）。
  const button = screen.getByRole("button");
  await act(async () => { localEl.dispatchEvent(new Event("playing")); });
  pauseMock.mockClear();
  await act(async () => { fireEvent.click(button); });
  expect(pauseMock).toHaveBeenCalled();
  expect(button).toHaveTextContent("Replay");

  // 换题与卸载同样不受影响、不抛。
  await act(async () => { rerender(<AudioPlayer src={CLIP_B} text="hi" onEnded={() => {}} maxReplays={0} autoPlay compact />); });
  expect(container.querySelector("audio").getAttribute("src")).toBe(CLIP_B);
  await act(async () => { unmount(); });
});
