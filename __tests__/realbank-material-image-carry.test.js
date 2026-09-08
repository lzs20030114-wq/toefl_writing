/**
 * 真题阅读「材料原图」沿用判据（scripts/realbank/material_image_carry.js）。
 *
 * build_bank.mjs 每次全量重建 ap/rdl.json，条目对象是新造的，不带 material_image ——
 * 这条闸决定重建后哪些条目能把 upload_material_images.mjs 传过的图接回来，接错/漏接都会
 * 白白丢图或者把图错配到内容已经变了的题上，所以这里把判据锁死：同 id 且材料正文
 * （AP 用 passage / RDL 用 text）逐字相同才接，id 变了或文本变了都不接。
 */
const { carryMaterialImages, materialText } = require("../scripts/realbank/material_image_carry.js");

describe("carryMaterialImages", () => {
  test("同 id 同文本：接回 material_image", () => {
    const prev = { ap: [{ id: "real_ap_1", passage: "Hello world text.", material_image: { url: "u1", w: 1, h: 2 } }] };
    const next = { ap: [{ id: "real_ap_1", passage: "Hello world text." }] };
    const n = carryMaterialImages(prev, next);
    expect(n).toBe(1);
    expect(next.ap[0].material_image).toEqual({ url: "u1", w: 1, h: 2 });
  });

  test("同 id 但材料文本变了：不接", () => {
    const prev = { rdl: [{ id: "real_rdl_1", text: "Old passage text.", material_image: { url: "u1" } }] };
    const next = { rdl: [{ id: "real_rdl_1", text: "New passage text, rewritten." }] };
    const n = carryMaterialImages(prev, next);
    expect(n).toBe(0);
    expect(next.rdl[0].material_image).toBeUndefined();
  });

  test("新 id（上一版没有）：不接", () => {
    const prev = { ap: [{ id: "real_ap_old", passage: "Same text.", material_image: { url: "u1" } }] };
    const next = { ap: [{ id: "real_ap_new", passage: "Same text." }] };
    const n = carryMaterialImages(prev, next);
    expect(n).toBe(0);
    expect(next.ap[0].material_image).toBeUndefined();
  });

  test("上一版该条没有 material_image：不接，也不报错", () => {
    const prev = { rdl: [{ id: "real_rdl_1", text: "No image here." }] };
    const next = { rdl: [{ id: "real_rdl_1", text: "No image here." }] };
    const n = carryMaterialImages(prev, next);
    expect(n).toBe(0);
    expect(next.rdl[0].material_image).toBeUndefined();
  });

  test("materialText：AP 取 passage，RDL 取 text，都没有则空串", () => {
    expect(materialText({ passage: "p" })).toBe("p");
    expect(materialText({ text: "t" })).toBe("t");
    expect(materialText({})).toBe("");
    expect(materialText(null)).toBe("");
  });
});
