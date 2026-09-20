/**
 * 真题材料「丢字」回归锁（scripts/realbank/truncation_scan.js）。
 *
 * 病灶：回忆版真题的材料是从截图 / 重排版 docx 里抽出来的，抽取窗口截断时材料会停在半句上。
 * 用户在真题专区看到的就是「丢字」——
 *   real_rdl_121a_1_23（1.21 A 卷 advertisement）倒数第二段停在 "…while having fun. Whether you're a"，
 *   下一行直接跳到 "For more details and to RSVP…"。
 *
 * 为什么 2026-09-07 那轮全库复核没兜住：那轮只按**字段末尾**扫断句（13 条 trim_tail 都是结尾那类），
 * 断在中间段落、后面还跟着一行正常收尾文字的那一类整批漏网。本测试把两类一起锁死。
 *
 * 修法一律走 data/realBank/review-holds.json 的 patches（trim_tail / replace），不直接改成品 JSON：
 * 源料在 .codex-tmp 不进 git，build_bank 重跑会把截断原样再产一遍，只有 apply_review.mjs 的幂等重放能长期兜住。
 *
 * 本测试双向锁：
 *   · 正向 —— 全库材料字段断句体检必须为 0；
 *   · 反向 —— 把这 4 条缺陷的原始形态回灌检测器必须全部命中，防止有人为了让测试变绿把判据调松。
 */
const fs = require("fs");
const path = require("path");
const { scanField, scanItem } = require("../scripts/realbank/truncation_scan.js");

const BANK = path.join(__dirname, "..", "data", "realBank");
const FILES = [
  "reading/ctw", "reading/rdl", "reading/ap",
  "listening/lcr", "listening/lc", "listening/la", "listening/lat",
  "speaking/repeat", "speaking/interview",
  "writing/bs", "writing/email", "writing/discussion",
];
const load = (key) => JSON.parse(fs.readFileSync(path.join(BANK, `${key}.json`), "utf8")).items || [];
const byId = (key, id) => load(key).find((x) => x.id === id);

describe("真题材料断句体检", () => {
  it("全库材料字段没有断在半句上的文本", () => {
    const hits = [];
    for (const key of FILES) {
      for (const item of load(key)) {
        for (const h of scanItem(item)) {
          hits.push(`${key} ${item.id} .${h.path} [${h.kind}] …${h.text.slice(-80)}`);
        }
      }
    }
    // 新命中 = 又有材料被截进库了：修法写进 review-holds.json 的 patches，别在这里加白名单。
    expect(hits).toEqual([]);
  });
});

describe("四条已修缺陷（2026-09-14）", () => {
  it("real_rdl_121a_1_23：advertisement 倒数第二段不再停在 Whether you're a", () => {
    const text = byId("reading/rdl", "real_rdl_121a_1_23").text;
    expect(text).not.toMatch(/Whether you're a\s*$/m);
    expect(text).toContain("achieve your fitness goals while having fun.\nFor more details");
  });

  it("real_ap_324_1_31：passage 结尾收在完整句上", () => {
    const passage = byId("reading/ap", "real_ap_324_1_31").passage;
    expect(passage).not.toMatch(/necessary to maintain$/);
    expect(passage.trimEnd()).toMatch(/rising rents or property taxes\.$/);
  });

  it("real_repeat_314_1：指令语不再断在 for faculty to use in the", () => {
    expect(byId("speaking/repeat", "real_repeat_314_1").scenario)
      .toBe("You are learning how to give a tutorial on the video equipment for faculty to use.");
  });

  it("real_repeat_228_1：指令语尾巴不再串入天气图表的 OCR 残片", () => {
    const scenario = byId("speaking/repeat", "real_repeat_228_1").scenario;
    expect(scenario).not.toMatch(/\d+%/);
    expect(scenario.trimEnd()).toMatch(/Repeat only once\.$/);
  });

  it("四条修补都记在 review-holds.json 里（build_bank 重建后能幂等重放）", () => {
    const holds = JSON.parse(fs.readFileSync(path.join(BANK, "review-holds.json"), "utf8"));
    const ids = holds.patches
      .filter((p) => p.source === "truncation-sweep-2026-09-14")
      .map((p) => p.id);
    expect(new Set(ids)).toEqual(new Set([
      "real_rdl_121a_1_23", "real_ap_324_1_31", "real_repeat_314_1", "real_repeat_228_1",
    ]));
  });
});

describe("检测器本身不许被调松", () => {
  // 这 4 条是缺陷的原始形态（从当前已修文本反向构造），检测器必须照样抓得到。
  const rdl = byId("reading/rdl", "real_rdl_121a_1_23").text;
  const ap = byId("reading/ap", "real_ap_324_1_31").passage;
  const rp314 = byId("speaking/repeat", "real_repeat_314_1").scenario;
  const rp228 = byId("speaking/repeat", "real_repeat_228_1").scenario;

  it.each([
    ["段中断句（下一行另起）", rdl.replace("having fun.\n", "having fun. Whether you're a\n"), "dangling"],
    ["结尾断句", `${ap} Another challenge is preserving these spaces—it can be difficult to secure the funding necessary to maintain`, "unterminated_tail"],
    ["单行指令语截断", rp314.replace(/use\.$/, "use in the"), "unterminated_tail"],
    ["结尾串入 OCR 残片", `${rp228} Morning Afternoon Evening 84% 90% 0 93% 15-20 10 KM`, "unterminated_tail"],
  ])("抓得到：%s", (_label, broken, kind) => {
    expect(scanField(broken).map((h) => h.kind)).toContain(kind);
  });

  it.each([
    ["网址结尾不算断句", "Join the photography club this summer for weekly sessions.\nSign up online at www.newburgcenter.com/photographyclub"],
    ["表单行不算断句", "Please fill out the form below before submitting your request.\nDevice Type: Laptop Tablet Smartphone Other"],
    ["整段硬换行的续行不算断句", "Connectivity allows animals to move between patches, disperse\nseeds, or migrate. This concept is crucial in landscape ecology, as\nit influences population dynamics and genetic diversity."],
    ["「标签 取值」表格不算断句", "Learning activities Class discussions and written assignments\nAssignment formats Both group and individual work"],
  ])("不误报：%s", (_label, clean) => {
    expect(scanField(clean)).toEqual([]);
  });
});
