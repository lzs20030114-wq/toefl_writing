/**
 * 真题复述题「场景插图」：数据层透传 + 前端按句切帧（2026-09-18）。
 *
 * 真考形态：一套 N 句共用一张场景插图常驻屏幕，每念一句图上高亮该句物件。
 * 这里把三条容易踩的口径钉住：
 *   1. **没图的套（生成库 / 个人题库 / 无图真题）UI 一个像素都不变** —— 不许多一个 <img>、
 *      不许多一层预加载门；
 *   2. 逐句帧按 **sentence_id** 对齐，既不是数组下标、也不是 id 的 _s(\d+) 后缀 ——
 *      3.15 这类套的后缀与真题题号是错位的（s1 对的是真题 Q2），靠后缀推会挂错高亮；
 *   3. 帧缺失退底图、底图也没有就什么都不渲染；图加载失败隐藏，不留破图标。
 */
import { render, screen, act, fireEvent } from "@testing-library/react";

const mockExamAudioHolder = { value: null };
jest.mock("../components/shared/ExamAudioProvider", () => ({
  __esModule: true,
  useExamAudio: () => mockExamAudioHolder.value,
  ExamAudioProvider: ({ children }) => children,
}));

import { RepeatTask, pickSceneFrame, sceneImagePreloadUrls } from "../components/speaking/RepeatTask";
import { mapRealRepeatSet } from "../lib/realBank";

const BUCKET = "https://proj.supabase.co/storage/v1/object/public/real_bank_images";
const BASE = `${BUCKET}/speaking/repeat/real_repeat_315_1.webp`;
// 文件名带的是**真题题号**（_q<n>）；句子 id 的后缀与题号错位，正是本组用例要钉的事。
const F1 = `${BUCKET}/speaking/repeat/real_repeat_315_1_q2.webp`;
const F3 = `${BUCKET}/speaking/repeat/real_repeat_315_1_q4.webp`;

// 这套只收了 s1 / s3 两句（其余被复核扣下），且句子 id 后缀与真题题号错位
// （s1↔Q2、s3↔Q4，见 scene-image-overrides.json 的 _pairing）—— 正是对齐口径的试金石。
const ITEMS = [
  { id: "real_repeat_315_1_s1", sentence: "The printers are near the entrance.", difficulty: "easy" },
  { id: "real_repeat_315_1_s3", sentence: "Visitors must sign in at the desk.", difficulty: "easy" },
];

const SET_INFO_WITH_IMAGE = {
  id: "real_repeat_315_1",
  scenario: "You are working at a university library.",
  settingText: "You are working at a university library.",
  instructionText: "",
  scene_image: { url: "/api/img/speaking/repeat/real_repeat_315_1.webp", w: 800, h: 600 },
  sentence_frames: [
    { sentence_id: "real_repeat_315_1_s1", n: 2, url: "/api/img/speaking/repeat/real_repeat_315_1_q2.webp", w: 800, h: 600 },
    { sentence_id: "real_repeat_315_1_s3", n: 4, url: "/api/img/speaking/repeat/real_repeat_315_1_q4.webp", w: 800, h: 600 },
  ],
};

const SET_INFO_NO_IMAGE = {
  id: "real_repeat_315_1",
  scenario: "You are working at a university library.",
  settingText: "You are working at a university library.",
  instructionText: "",
};

beforeEach(() => {
  jest.useFakeTimers();
  mockExamAudioHolder.value = null;
  const getUserMedia = jest.fn(() => new Promise(() => {}));
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
});

/** 预加载门里的隐藏 <img> 逐个触发 load（jsdom 不会自己加载图片）。 */
function settlePreload() {
  const imgs = screen.queryAllByTestId("asset-preload-img");
  act(() => { imgs.forEach((img) => fireEvent.load(img)); });
  return imgs.map((img) => img.getAttribute("src"));
}

const sceneSrc = () => {
  const img = screen.queryByTestId("repeat-scene-image");
  return img ? img.getAttribute("src") : null;
};

describe("pickSceneFrame（纯函数）", () => {
  test("按 sentence_id 取帧 —— 后缀与题号错位（s1↔Q2）也不会取错", () => {
    expect(pickSceneFrame(SET_INFO_WITH_IMAGE, "real_repeat_315_1_s1").n).toBe(2);
    expect(pickSceneFrame(SET_INFO_WITH_IMAGE, "real_repeat_315_1_s3").n).toBe(4);
  });

  test("绝不按 _sN 后缀推题号：后缀 1 的句子不会去拿 n=1 的帧", () => {
    const setInfo = {
      scene_image: { url: "/api/img/base.webp" },
      sentence_frames: [{ sentence_id: "real_repeat_315_1_s3", n: 1, url: "/api/img/q1.webp" }],
    };
    // 句子 s1 在帧表里没有 → 退底图（旧口径会错拿 n=1 那张，那张是 s3 的高亮）
    expect(pickSceneFrame(setInfo, "real_repeat_315_1_s1").url).toBe("/api/img/base.webp");
    expect(pickSceneFrame(setInfo, "real_repeat_315_1_s3").url).toBe("/api/img/q1.webp");
  });

  test("没有对应帧 → 退底图；没有底图 → null", () => {
    expect(pickSceneFrame(SET_INFO_WITH_IMAGE, "real_repeat_315_1_s9").url)
      .toBe(SET_INFO_WITH_IMAGE.scene_image.url);
    expect(pickSceneFrame({ sentence_frames: SET_INFO_WITH_IMAGE.sentence_frames }, "x_s9")).toBeNull();
    expect(pickSceneFrame(SET_INFO_WITH_IMAGE, null).url).toBe(SET_INFO_WITH_IMAGE.scene_image.url);
    expect(pickSceneFrame(null, "x_s1")).toBeNull();
    expect(pickSceneFrame(SET_INFO_NO_IMAGE, "real_repeat_315_1_s1")).toBeNull();
  });

  test("sceneImagePreloadUrls：底图 + 全部逐句帧；没图给空数组", () => {
    expect(sceneImagePreloadUrls(SET_INFO_WITH_IMAGE)).toHaveLength(3);
    expect(sceneImagePreloadUrls(SET_INFO_NO_IMAGE)).toEqual([]);
    expect(sceneImagePreloadUrls(null)).toEqual([]);
  });
});

describe("RepeatTask：没图的套 UI 零变化", () => {
  test("不渲染任何 <img>，也不多一层预加载门", () => {
    const { container } = render(
      <RepeatTask items={ITEMS} setInfo={SET_INFO_NO_IMAGE} onComplete={jest.fn()} onExit={jest.fn()} isPractice />,
    );
    expect(screen.queryByTestId("asset-preload-gate")).toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(0);

    act(() => { fireEvent.click(screen.getByText("开始")); });
    expect(screen.getByText(/Sentence 1 of 2/)).toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  test("setInfo 整个缺席（生成库 / 模考口径）也不炸、也没有图", () => {
    const { container } = render(
      <RepeatTask items={ITEMS} onComplete={jest.fn()} onExit={jest.fn()} isPractice />,
    );
    act(() => { fireEvent.click(screen.getByText("开始")); });
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });
});

describe("RepeatTask：有图的套", () => {
  test("预加载门先拉底图 + 全部帧，引入屏显示底图 + setting 文本", () => {
    render(
      <RepeatTask items={ITEMS} setInfo={SET_INFO_WITH_IMAGE} onComplete={jest.fn()} onExit={jest.fn()} isPractice />,
    );
    // 门挡着：任务还没挂载
    expect(screen.getByTestId("asset-preload-gate")).toBeInTheDocument();
    expect(screen.queryByText("开始")).toBeNull();
    const preloaded = settlePreload();
    expect(preloaded).toHaveLength(3);
    expect(preloaded).toEqual(expect.arrayContaining([SET_INFO_WITH_IMAGE.scene_image.url]));

    // 引入屏：底图 + 原卷提示语
    expect(sceneSrc()).toBe(SET_INFO_WITH_IMAGE.scene_image.url);
    expect(screen.getByText(/university library/)).toBeInTheDocument();
    expect(screen.getByAltText("场景图")).toBeInTheDocument();
  });

  test("逐句帧随当前句切换；题号缺口时第二句拿到的是 n=3 的帧", () => {
    render(
      <RepeatTask items={ITEMS} setInfo={SET_INFO_WITH_IMAGE} onComplete={jest.fn()} onExit={jest.fn()} isPractice />,
    );
    settlePreload();
    act(() => { fireEvent.click(screen.getByText("开始")); });

    expect(sceneSrc()).toBe(SET_INFO_WITH_IMAGE.sentence_frames[0].url);

    // 下一句（真题题号是 4，不是 2；靠 sentence_id 匹配才拿得对）
    act(() => { fireEvent.click(screen.getByText("Skip this sentence")); });
    expect(screen.getByText(/Sentence 2 of 2/)).toBeInTheDocument();
    expect(sceneSrc()).toBe(SET_INFO_WITH_IMAGE.sentence_frames[1].url);
  });

  test("某句没有帧 → 退底图；图加载失败 → 隐藏，不留破图标", () => {
    const setInfo = { ...SET_INFO_WITH_IMAGE, sentence_frames: [SET_INFO_WITH_IMAGE.sentence_frames[0]] };
    render(
      <RepeatTask items={ITEMS} setInfo={setInfo} onComplete={jest.fn()} onExit={jest.fn()} isPractice />,
    );
    settlePreload();
    act(() => { fireEvent.click(screen.getByText("开始")); });
    expect(sceneSrc()).toBe(setInfo.sentence_frames[0].url);

    act(() => { fireEvent.click(screen.getByText("Skip this sentence")); });
    expect(sceneSrc()).toBe(setInfo.scene_image.url); // s3 没帧 → 底图

    act(() => { fireEvent.error(screen.getByTestId("repeat-scene-image")); });
    expect(screen.queryByTestId("repeat-scene-image")).toBeNull();
    // 答题界面照常在（图坏了不影响做题）
    expect(screen.getByText(/Sentence 2 of 2/)).toBeInTheDocument();
  });

  test("图一直加载不完：15s 超时后门放行，不把人锁在加载页", () => {
    render(
      <RepeatTask items={ITEMS} setInfo={SET_INFO_WITH_IMAGE} onComplete={jest.fn()} onExit={jest.fn()} isPractice />,
    );
    expect(screen.getByTestId("asset-preload-gate")).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(15000); });
    expect(screen.getByText("开始")).toBeInTheDocument();
  });
});

describe("mapRealRepeatSet：两个可选字段的透传 + 地址改写 + 坏形状丢弃", () => {
  const raw = () => ({
    id: "real_repeat_315_1",
    scenario: "At the library.",
    sentences: [
      { id: "real_repeat_315_1_s1", sentence: "One." },
      { id: "real_repeat_315_1_s3", sentence: "Three." },
    ],
  });

  test("透传并把桶地址改写成同源 /api/img/…", () => {
    const out = mapRealRepeatSet({
      ...raw(),
      scene_image: { url: BASE, w: 800, h: 600, source_page: 12 },
      sentence_frames: [
        { sentence_id: "real_repeat_315_1_s3", n: 4, url: F3, w: 800, h: 600 },
        { sentence_id: "real_repeat_315_1_s1", n: 2, url: F1 },
      ],
    });
    expect(out.scene_image).toEqual({
      url: "/api/img/speaking/repeat/real_repeat_315_1.webp", w: 800, h: 600, source_page: "12",
    });
    // 顺序原样保留；sentence_id 透传，n（真题题号）留档
    expect(out.sentence_frames.map((f) => f.sentence_id))
      .toEqual(["real_repeat_315_1_s3", "real_repeat_315_1_s1"]);
    expect(out.sentence_frames[1].url).toBe("/api/img/speaking/repeat/real_repeat_315_1_q2.webp");
    expect(out.sentence_frames[0]).toEqual({
      sentence_id: "real_repeat_315_1_s3", n: 4,
      url: "/api/img/speaking/repeat/real_repeat_315_1_q4.webp", w: 800, h: 600,
    });
  });

  test("没有这两个字段：键根本不出现（前端据此不渲染任何节点）", () => {
    const out = mapRealRepeatSet(raw());
    expect(out).not.toHaveProperty("scene_image");
    expect(out).not.toHaveProperty("sentence_frames");
  });

  test("坏形状一律当没有：非对象 / sentence_id 缺失或非字符串 / url 坏 / sentence_id 重复", () => {
    const out = mapRealRepeatSet({
      ...raw(),
      scene_image: "not-an-object",
      sentence_frames: [
        { n: 1, url: F1 },                                   // 没有 sentence_id
        { sentence_id: "", url: F1 },
        { sentence_id: "   ", url: F1 },
        { sentence_id: 3, url: F1 },                         // 不是字符串
        { sentence_id: "a", url: 42 },
        { sentence_id: "b", url: "   " },
        "nope",
        null,
        { sentence_id: "real_repeat_315_1_s1", n: 2, url: F1 },
        { sentence_id: "real_repeat_315_1_s1", n: 9, url: F3 }, // 重复 id：只认第一条
      ],
    });
    expect(out).not.toHaveProperty("scene_image");
    expect(out.sentence_frames).toHaveLength(1);
    expect(out.sentence_frames[0].sentence_id).toBe("real_repeat_315_1_s1");
    expect(out.sentence_frames[0].n).toBe(2);
    expect(out.sentence_frames[0].url).toBe("/api/img/speaking/repeat/real_repeat_315_1_q2.webp");
  });

  test("n 坏掉只省这个键，帧本身还在（匹配不靠 n）", () => {
    const out = mapRealRepeatSet({
      ...raw(),
      sentence_frames: [
        { sentence_id: "real_repeat_315_1_s1", n: "2", url: F1 },
        { sentence_id: "real_repeat_315_1_s3", n: 0, url: F3 },
      ],
    });
    expect(out.sentence_frames).toHaveLength(2);
    expect(out.sentence_frames[0]).not.toHaveProperty("n");
    expect(out.sentence_frames[1]).not.toHaveProperty("n");
  });

  test("scene_image 少 w/h：键省略，不写 NaN", () => {
    const out = mapRealRepeatSet({ ...raw(), scene_image: { url: BASE, w: "x" } });
    expect(out.scene_image).toEqual({ url: "/api/img/speaking/repeat/real_repeat_315_1.webp" });
  });

  test("空数组 / 全坏的 sentence_frames：键不出现", () => {
    expect(mapRealRepeatSet({ ...raw(), sentence_frames: [] })).not.toHaveProperty("sentence_frames");
    expect(mapRealRepeatSet({ ...raw(), sentence_frames: [{ n: 1, url: F1 }] })).not.toHaveProperty("sentence_frames");
  });
});
