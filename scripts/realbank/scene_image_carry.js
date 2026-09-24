/**
 * 真题复述题「场景插图」的沿用判据（纯函数，无 IO —— 供 build_bank.mjs 与单测共用）。
 *
 * 背景：真考的 Listen & Repeat 是一套 7 句共用一张场景插图常驻屏幕，每念一句图上高亮
 * 该句物件。抠图 / 上传脚本把结果写回 data/realBank/speaking/repeat.json 的两个可选字段：
 *   scene_image:      { url, w, h, source_page }                 无高亮底图
 *   sentence_frames:  [ { sentence_id, n, url, w, h }, … ]       逐句高亮帧
 *                     （sentence_id = 题库里该句的 id，是唯一对齐键；n = 真题题号，仅留档）
 * 而 build_bank 每次都是**全量重建**，条目对象是新造的、不带这两个字段 —— 直接落盘会把
 * 已经传过图的套全部清零，只能重跑上传脚本补回（图还在 Supabase 桶里，白白重传一次）。
 *
 * 做法与 material_image_carry.js（阅读材料原图）、build_bank.mjs 的 carryAudioUrls 同一套：
 * 落盘前拍上一版快照，**同 id 且句子文本序列逐字相同**（句数相同、每句 sentence 逐字相同）
 * 才把图接回。少一句 / 多一句 / 某句改了字都不接 —— 那时逐句帧与句子的对应关系已经不可信，
 * 宁可空着等重新抠图，也不能把高亮错配到别的句子上。
 *
 * 注意判据用的是「句子文本序列」而不是句子 id：id 里带真题题号，题号重排（听力那边做过）
 * 会改 id，但句子内容没变、图仍然对得上；反过来文本变了说明这套重新解析过，图就不该再用。
 *
 * 但帧本身是按 sentence_id 挂的，所以文本过关之后还要再筛一道：**沿用后的每个
 * frame.sentence_id 必须在新句子列表里存在**，否则那一帧再也挂不到任何句子上（id 被重排过），
 * 留着只会白占预加载、还可能被将来的匹配口径误认，直接丢掉。全丢光就不写这个字段。
 */

/**
 * 取一套 repeat 条目的句子文本序列；形状不对（没有 sentences 数组）返回 null，
 * null 一律判为「对不上」（不沿用）。
 */
function sentenceTexts(it) {
  if (!it || typeof it !== "object") return null;
  if (!Array.isArray(it.sentences)) return null;
  return it.sentences.map((s) => String((s && s.sentence) || ""));
}

/** 两个句子文本序列是否逐字相同（长度 + 每一项）。 */
function sameSentences(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((t, i) => t === b[i]);
}

/**
 * 把上一版 {kind: items[]}（口语那边 kind 取 "repeat"/"interview"）里的
 * scene_image / sentence_frames 接回新一版同名单元。就地修改 bundle 里命中的条目，
 * 返回接回的条数（一条 = 一套，两个字段算一条）。
 *
 * interview 没有 sentences，sentenceTexts 返回 null → 天然不参与，无需特判。
 *
 * @param {Record<string, Array<object>>} prevBundle 上一版 {kind: items[]}
 * @param {Record<string, Array<object>>} bundle 新一版 {kind: items[]}（会被就地修改）
 */
function carrySceneImages(prevBundle, bundle) {
  let n = 0;
  for (const [kind, list] of Object.entries(bundle || {})) {
    const prevItems = (prevBundle || {})[kind];
    if (!Array.isArray(prevItems) || !Array.isArray(list)) continue;
    const old = new Map();
    for (const it of prevItems) {
      if (!it || !it.id) continue;
      if (!it.scene_image && !it.sentence_frames) continue;
      old.set(it.id, {
        scene_image: it.scene_image,
        sentence_frames: it.sentence_frames,
        texts: sentenceTexts(it),
      });
    }
    for (const it of list) {
      if (!it || !it.id) continue;
      const hit = old.get(it.id);
      if (!hit) continue;
      if (!sameSentences(hit.texts, sentenceTexts(it))) continue;
      let touched = false;
      if (hit.scene_image) { it.scene_image = hit.scene_image; touched = true; }
      if (Array.isArray(hit.sentence_frames)) {
        const ids = new Set(
          (it.sentences || []).map((s) => (s && typeof s.id === "string" ? s.id : "")).filter(Boolean),
        );
        const kept = hit.sentence_frames.filter(
          (f) => f && typeof f.sentence_id === "string" && ids.has(f.sentence_id),
        );
        if (kept.length) { it.sentence_frames = kept; touched = true; }
      }
      if (touched) n += 1;
    }
  }
  return n;
}

module.exports = { sentenceTexts, sameSentences, carrySceneImages };
