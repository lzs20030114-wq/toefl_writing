const fs = require("fs");
const path = require("path");
const bank = require("../data/realBank/reading/rdl.json");
const academicBank = require("../data/realBank/reading/ap.json");

describe("真题阅读原图资源", () => {
  test("睡眠阶段柱状图使用原卷截图", () => {
    const item = bank.items.find((entry) => entry.id === "real_rdl_310_1_25");
    expect(item).toBeDefined();
    expect(item.text).toContain("Percentage of Time in Each Sleep Stage");
    expect(item.material_image?.url).toMatch(/^\/real-bank-images\/reading\/.*\.webp$/);
  });

  test("OCR 正文出现连续纵轴刻度的真题都配有原图", () => {
    const chartItems = [...bank.items, ...academicBank.items].filter((item) =>
      /(?:\n\s*\d{1,3}-?\s*){4,}/.test(item.text || item.passage || "")
    );
    expect(chartItems.map((item) => item.id)).toContain("real_rdl_310_1_25");
    for (const item of chartItems) expect(item.material_image?.url).toBeTruthy();
  });

  test("题库引用的站内原图均有可部署的 WebP 文件", () => {
    const localImages = bank.items
      .map((item) => item.material_image?.url)
      .filter((url) => url?.startsWith("/real-bank-images/"));
    expect(localImages.length).toBeGreaterThan(0);
    for (const url of localImages) {
      const file = path.join(process.cwd(), "public", url.slice(1));
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file).subarray(0, 4).toString("ascii")).toBe("RIFF");
    }
  });
});
