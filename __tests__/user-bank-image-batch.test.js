const { validateImageBatch } = require("../lib/userBank/imageSniff");

// Multi-image upload validation for /api/user-bank/extract-image (1-3 张, 合计 ≤4MB).
// The route delegates all batch rules to this helper, so the unit tests here cover the
// route's rejection matrix: 2 图合法 / 4 图拒 / 混入非图拒 / 合计超限拒 / 单图向后兼容.
function jpegBuf(extra = 8) {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(extra)]);
}
function pngBuf(extra = 8) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(extra),
  ]);
}

describe("validateImageBatch", () => {
  test("2 valid images (jpeg+png) pass with sniffed mimes", () => {
    const out = validateImageBatch([jpegBuf(), pngBuf()]);
    expect(out.ok).toBe(true);
    expect(out.images).toHaveLength(2);
    expect(out.images[0].mime).toBe("image/jpeg");
    expect(out.images[1].mime).toBe("image/png");
  });

  test("single image stays valid (向后兼容单图上传)", () => {
    const out = validateImageBatch([jpegBuf()]);
    expect(out.ok).toBe(true);
    expect(out.images).toHaveLength(1);
  });

  test("4 images are rejected (maxCount 3)", () => {
    const out = validateImageBatch([jpegBuf(), jpegBuf(), jpegBuf(), jpegBuf()]);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(400);
    expect(out.error).toMatch(/最多/);
  });

  test("a non-image mixed into the batch is rejected with 415", () => {
    const out = validateImageBatch([jpegBuf(), Buffer.from("<script>alert(1)</script>", "ascii")]);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(415);
  });

  test("total size over the cap is rejected with 413 (合计门, 非单张门)", () => {
    // Each image is under the cap alone; together they exceed it.
    const out = validateImageBatch([jpegBuf(600), pngBuf(600)], { maxTotalBytes: 1000 });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(413);
  });

  test("empty list and empty buffer are rejected with 400", () => {
    expect(validateImageBatch([]).ok).toBe(false);
    expect(validateImageBatch([]).status).toBe(400);
    const out = validateImageBatch([Buffer.alloc(0)]);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(400);
  });
});
