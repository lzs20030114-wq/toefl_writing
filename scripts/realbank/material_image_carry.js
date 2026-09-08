/**
 * 真题阅读「材料原图」的沿用判据（纯函数，无 IO —— 供 build_bank.mjs 与单测共用）。
 *
 * 背景：build_bank 每次都是**全量重建**，data/realBank/reading/{ap,rdl}.json 的条目对象
 * 是新造的，不带 material_image —— 直接落盘会把 upload_material_images.mjs 已经传过图、
 * 写回过的 118 条全部清零，只能靠重跑 upload 脚本补回（图还在 Supabase 桶里，白白重传一次）。
 *
 * 做法与 lib 侧的 audio_url 沿用（build_bank.mjs 的 carryAudioUrls）同一套思路：
 * 落盘前拍上一版快照，**同 id 且材料正文文本逐字相同**就把 material_image 接回；
 * 材料文本变了（重新 OCR / 归并策略变了导致代表材料换了一份）就不接，留给
 * upload_material_images.mjs 重新裁图。
 *
 * 判定「材料正文」用的字段与 build_bank.mjs 的 buildMcqGroup 一致：
 * AP 是 `passage`，RDL 是 `text`（两者互斥，一个 item 只会有其中一个）。
 */

/** 取一个 ap/rdl 条目的材料正文（两种题型字段名不同，见 buildMcqGroup）。 */
function materialText(it) {
  if (!it || typeof it !== "object") return "";
  if (typeof it.passage === "string") return it.passage;
  if (typeof it.text === "string") return it.text;
  return "";
}

/**
 * 把上一版 {kind: items[]}（kind 取 "ap"/"rdl"）里的 material_image 接回新一版同名单元。
 * 就地修改 bundle 里带 material_image 命中的条目，返回接回的条数。
 *
 * @param {Record<string, Array<object>>} prevBundle 上一版 {kind: items[]}
 * @param {Record<string, Array<object>>} bundle 新一版 {kind: items[]}（会被就地修改）
 */
function carryMaterialImages(prevBundle, bundle) {
  let n = 0;
  for (const [kind, list] of Object.entries(bundle || {})) {
    const prevItems = (prevBundle || {})[kind];
    if (!Array.isArray(prevItems) || !Array.isArray(list)) continue;
    const old = new Map();
    for (const it of prevItems) {
      if (it && it.id && it.material_image) {
        old.set(it.id, { material_image: it.material_image, text: materialText(it) });
      }
    }
    for (const it of list) {
      if (!it || !it.id) continue;
      const hit = old.get(it.id);
      if (hit && hit.text === materialText(it)) {
        it.material_image = hit.material_image;
        n += 1;
      }
    }
  }
  return n;
}

module.exports = { materialText, carryMaterialImages };
