/**
 * 真题复述题「场景插图」沿用判据（scripts/realbank/scene_image_carry.js）。
 *
 * build_bank.mjs 每次全量重建 speaking/repeat.json，条目对象是新造的、不带 scene_image /
 * sentence_frames —— 这条闸决定重建后哪些套能把抠好传好的图接回来。接错比漏接更糟：
 * 逐句帧是按句子对齐的，句子变了还硬接，用户会看到高亮的是别的句子的物件。
 * 所以判据锁死：同 id 且**句子文本序列逐字相同**才接，句数变了 / 某句改了字都不接。
 * 帧本身按 sentence_id 挂，所以文本过关后还要再筛一道：sentence_id 在新句子列表里找不到的
 * 帧（id 被重排过）直接丢，留着也挂不上任何句子。
 */
const {
  carrySceneImages,
  sameSentences,
  sentenceTexts,
} = require("../scripts/realbank/scene_image_carry.js");

const IMG = { url: "https://x/storage/v1/object/public/real_bank_images/speaking/repeat/a.webp", w: 800, h: 600 };
const FRAMES = [
  { sentence_id: "real_repeat_a_1_s1", n: 1, url: "https://x/storage/v1/object/public/real_bank_images/speaking/repeat/a_q1.webp" },
  { sentence_id: "real_repeat_a_1_s3", n: 4, url: "https://x/storage/v1/object/public/real_bank_images/speaking/repeat/a_q4.webp" },
];

const set = (extra = {}) => ({
  id: "real_repeat_a_1",
  sentences: [{ id: "real_repeat_a_1_s1", sentence: "One." }, { id: "real_repeat_a_1_s3", sentence: "Three." }],
  ...extra,
});

describe("carrySceneImages", () => {
  test("同 id 同句子序列：scene_image 与 sentence_frames 都接回", () => {
    const prev = { repeat: [set({ scene_image: IMG, sentence_frames: FRAMES })] };
    const next = { repeat: [set()] };
    expect(carrySceneImages(prev, next)).toBe(1);
    expect(next.repeat[0].scene_image).toEqual(IMG);
    expect(next.repeat[0].sentence_frames).toEqual(FRAMES);
  });

  test("只有底图没有逐句帧：接回底图，不凭空造 sentence_frames", () => {
    const prev = { repeat: [set({ scene_image: IMG })] };
    const next = { repeat: [set()] };
    expect(carrySceneImages(prev, next)).toBe(1);
    expect(next.repeat[0].scene_image).toEqual(IMG);
    expect(next.repeat[0].sentence_frames).toBeUndefined();
  });

  test("句子文本改了一个字：不接（帧与句子的对应关系已不可信）", () => {
    const prev = { repeat: [set({ scene_image: IMG, sentence_frames: FRAMES })] };
    const next = { repeat: [set({ sentences: [
      { id: "real_repeat_a_1_s1", sentence: "One!" },
      { id: "real_repeat_a_1_s3", sentence: "Three." },
    ] })] };
    expect(carrySceneImages(prev, next)).toBe(0);
    expect(next.repeat[0].scene_image).toBeUndefined();
    expect(next.repeat[0].sentence_frames).toBeUndefined();
  });

  test("句数变了（少一句 / 多一句）：不接", () => {
    const prev = { repeat: [set({ scene_image: IMG, sentence_frames: FRAMES })] };
    const short = { repeat: [set({ sentences: [{ id: "real_repeat_a_1_s1", sentence: "One." }] })] };
    expect(carrySceneImages(prev, short)).toBe(0);
    expect(short.repeat[0].scene_image).toBeUndefined();
  });

  test("句子 id 变了但文本没变（题号重排）：底图照接 —— 判据是文本不是 id；挂不上的帧丢掉", () => {
    const prev = { repeat: [set({ scene_image: IMG, sentence_frames: FRAMES })] };
    const renumbered = { repeat: [set({ sentences: [
      { id: "real_repeat_a_1_s1", sentence: "One." },
      { id: "real_repeat_a_1_s2", sentence: "Three." },
    ] })] };
    expect(carrySceneImages(prev, renumbered)).toBe(1);
    expect(renumbered.repeat[0].scene_image).toEqual(IMG);
    // _s3 那一帧在新句子列表里没有对应 id → 丢；_s1 还在 → 留
    expect(renumbered.repeat[0].sentence_frames).toEqual([FRAMES[0]]);
  });

  test("id 全被重排、一帧都挂不上：sentence_frames 干脆不写（只剩底图）", () => {
    const prev = { repeat: [set({ scene_image: IMG, sentence_frames: FRAMES })] };
    const renumbered = { repeat: [set({ sentences: [
      { id: "real_repeat_a_1_s7", sentence: "One." },
      { id: "real_repeat_a_1_s8", sentence: "Three." },
    ] })] };
    expect(carrySceneImages(prev, renumbered)).toBe(1);
    expect(renumbered.repeat[0].sentence_frames).toBeUndefined();
  });

  test("上一版只有帧、且一帧都挂不上：什么都没接回，计数不虚报", () => {
    const prev = { repeat: [set({ sentence_frames: FRAMES })] };
    const renumbered = { repeat: [set({ sentences: [
      { id: "real_repeat_a_1_s7", sentence: "One." },
      { id: "real_repeat_a_1_s8", sentence: "Three." },
    ] })] };
    expect(carrySceneImages(prev, renumbered)).toBe(0);
    expect(renumbered.repeat[0].sentence_frames).toBeUndefined();
  });

  test("新 id（上一版没有）/ 上一版该套没有图：不接，也不报错", () => {
    const prev = { repeat: [set({ id: "real_repeat_old_1", scene_image: IMG })] };
    const next = { repeat: [set()] };
    expect(carrySceneImages(prev, next)).toBe(0);

    const prevNoImg = { repeat: [set()] };
    const next2 = { repeat: [set()] };
    expect(carrySceneImages(prevNoImg, next2)).toBe(0);
    expect(next2.repeat[0].scene_image).toBeUndefined();
  });

  test("interview（没有 sentences）不参与，也不炸", () => {
    const prev = { interview: [{ id: "real_interview_a_1", questions: [{ question: "Q" }], scene_image: IMG }] };
    const next = { interview: [{ id: "real_interview_a_1", questions: [{ question: "Q" }] }] };
    expect(carrySceneImages(prev, next)).toBe(0);
    expect(next.interview[0].scene_image).toBeUndefined();
  });

  test("空输入 / 形状不对：返回 0", () => {
    expect(carrySceneImages(null, null)).toBe(0);
    expect(carrySceneImages({}, { repeat: [] })).toBe(0);
    expect(carrySceneImages({ repeat: null }, { repeat: [set()] })).toBe(0);
  });

  test("sentenceTexts / sameSentences 的边界", () => {
    expect(sentenceTexts(null)).toBeNull();
    expect(sentenceTexts({})).toBeNull();
    expect(sentenceTexts({ sentences: [{ sentence: "a" }, {}] })).toEqual(["a", ""]);
    expect(sameSentences(["a"], ["a"])).toBe(true);
    expect(sameSentences(["a"], ["a", "b"])).toBe(false);
    expect(sameSentences(null, ["a"])).toBe(false);
  });
});
