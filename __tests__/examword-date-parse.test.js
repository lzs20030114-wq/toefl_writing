/**
 * examword 考试日期解析器的行为锁定。
 *
 * 背景：recalled_supplement.json 里 44 条回忆版只有 20 条带考试日期 —— 当初日期是从
 * 列表页手抄成写死表，其余的记 null，于是真题卡片上「同为回忆版，有的标日期有的不标」。
 * 回填脚本改成从页面解析，这组测试钉住解析规则：标题优先、关键词加权、
 * 版权年份与站尾旧闻不许冒充考试日期、解析不出来必须返回 null 而不是猜一个。
 */

let mod;
beforeAll(async () => {
  mod = await import("../scripts/research/examwordDate.mjs");
});

const page = ({ title = "", body = "" }) =>
  `<html><head><title>${title}</title></head><body>${body}</body></html>`;

describe("extractExamDate", () => {
  it("认中文年月日写法", () => {
    expect(mod.extractExamDate(page({ title: "2026年5月18日托福写作真题" }))).toBe("2026-05-18");
  });

  it("认 ISO / 斜杠 / 点分写法，月日补零", () => {
    expect(mod.extractExamDate(page({ body: "考试日期 2026-4-9" }))).toBe("2026-04-09");
    expect(mod.extractExamDate(page({ body: "考试日期 2026/04/09" }))).toBe("2026-04-09");
    expect(mod.extractExamDate(page({ body: "考试日期 2026.04.09" }))).toBe("2026-04-09");
  });

  it("标题里的日期压过正文里的", () => {
    const html = page({ title: "2026年5月18日托福写作真题", body: "相关推荐 2026年3月29日场次" });
    expect(mod.extractExamDate(html)).toBe("2026-05-18");
  });

  it("关键词附近的日期压过无上下文的裸日期", () => {
    const html = page({ body: `更新 2026-01-02 ${"正文内容。".repeat(20)} 考试日期 2026-04-09` });
    expect(mod.extractExamDate(html)).toBe("2026-04-09");
  });

  it("光有年份不算日期（版权行不许冒充）", () => {
    expect(mod.extractExamDate(page({ body: "Copyright 2026 examword.com" }))).toBeNull();
  });

  it("区间外的日期丢掉（备案年份 / 无关旧闻）", () => {
    expect(mod.extractExamDate(page({ body: "备案 2011-08-15" }))).toBeNull();
    expect(mod.extractExamDate(page({ body: "预告 2031-08-15" }))).toBeNull();
  });

  it("非法月日丢掉", () => {
    expect(mod.extractExamDate(page({ body: "编号 2026-13-40" }))).toBeNull();
  });

  it("引导词只认日期前面的，不被后一个日期蹭到", () => {
    // 「2026-01-02」后面 16 字内出现「考试」，但它自己的引导语是「更新」，不该算考试日期
    const html = page({ body: "更新 2026-01-02 考试日期 2026-04-09" });
    expect(mod.extractExamDate(html)).toBe("2026-04-09");
  });

  it("解析不出来返回 null —— 不许猜", () => {
    expect(mod.extractExamDate(page({ body: "这一篇没有任何日期" }))).toBeNull();
  });

  it("忽略 script / style 里的数字串", () => {
    const html = page({ body: "<script>var t='2026-01-01';</script> 考试日期 2026-05-16" });
    expect(mod.extractExamDate(html)).toBe("2026-05-16");
  });
});

describe("dateCandidates", () => {
  it("同一个日期只留一条，按分数降序", () => {
    const html = page({ title: "2026年5月18日真题", body: "2026年5月18日 又出现一次；另有 2026-03-29" });
    const c = mod.dateCandidates(html);
    expect(c.map((x) => x.iso)).toEqual(["2026-05-18", "2026-03-29"]);
    expect(c[0].inTitle).toBe(true);
  });
});

describe("parseListing", () => {
  it("把列表页的 p 号与日期配对", () => {
    const html = `
      <a href="/writing/discussion-example?p=1543">题目甲</a><span>2026年4月12日</span>
      <a href="/writing/discussion-example?p=1542">题目乙</a><span>2026年4月11日</span>`;
    const pairs = mod.parseListing(html);
    expect(pairs.get(1543)).toBe("2026-04-12");
    expect(pairs.get(1542)).toBe("2026-04-11");
  });
});
