/**
 * Storage 对象 key 编解码（lib/realBankIngest/objectKey.mjs）。
 *
 * 为什么要钉死：Supabase storage-api 的 isValidKey 只收
 * `\w / ! - . * ' ( ) 空格 & $ @ = ; : + , ?`，中文和 `%` 都不在里面 ——
 * 真题源文件名（`3.24新托福真题/阅读.pdf`）和 ocr 缓存名（`ocr/1.21新托福真题B卷__….txt`）
 * 直接上传会被服务端 400 `Invalid key`。这层一破，整条录入链路（源直传 + 中间产物同步）全断。
 */
const {
  encodeSegment, decodeSegment, encodeObjectPath, decodeObjectPath, isEncodedSegment,
} = require("../lib/realBankIngest/objectKey.mjs");

/** 服务端 isValidKey 的同款正则（supabase/storage src/storage/limits.ts）。 */
const VALID_KEY = /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/;

describe("encodeSegment / decodeSegment 往返", () => {
  const cases = [
    "3.24新托福真题",
    "阅读.pdf",
    "1.21新托福真题B卷__新托福2026年真题02.txt",
    "5.20 新托福 真题",           // 空格
    "真题(第一套).pdf",           // 半角括号
    "真题（第一套）.pdf",         // 全角括号
    "题目、答案；解析",           // 全角标点
    "emoji 🎧 音频.mp3",
    "a%b+c=d",                    // 含 % —— percent-encoding 方案在这里就死了
    "!literal-bang",              // 真的以 ! 开头的文件名，不能被误判成编码段
    "!",
  ];
  test.each(cases)("往返不变：%s", (s) => {
    expect(decodeSegment(encodeSegment(s))).toBe(s);
  });

  test.each(cases)("编码结果落在 Supabase 合法字符集内：%s", (s) => {
    expect(VALID_KEY.test(encodeSegment(s))).toBe(true);
  });
});

describe("纯 ASCII 安全段原样保留（桶里仍然人眼可读）", () => {
  test.each(["reading", "audio", "q1.mp3", "listening_m1.json", "a-b_c.3.json", "jobs", "_manifest.json"])(
    "%s 不变",
    (s) => { expect(encodeSegment(s)).toBe(s); expect(decodeSegment(s)).toBe(s); },
  );

  test("空段返回空（保留 // 之外的边界行为）", () => {
    expect(encodeSegment("")).toBe("");
    expect(decodeSegment("")).toBe("");
  });
});

describe("编码形态", () => {
  test("非安全段编成 !<base64url>，不含 padding、不含 /", () => {
    const k = encodeSegment("阅读.pdf");
    expect(k.startsWith("!")).toBe(true);
    expect(k.slice(1)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(k).not.toContain("=");
    expect(k).not.toContain("/");
  });

  test("isEncodedSegment 只认我们自己编出来的规范形态", () => {
    expect(isEncodedSegment(encodeSegment("阅读"))).toBe(true);
    expect(isEncodedSegment("reading")).toBe(false);
    expect(isEncodedSegment("!literal-bang")).toBe(false); // 不是规范 base64url 回环
    expect(isEncodedSegment("!")).toBe(false);
  });
});

describe("幂等 —— 编两次不等于编两层", () => {
  test.each(["3.24新托福真题", "阅读.pdf", "reading", "真题（第一套）.pdf"])("%s", (s) => {
    const once = encodeSegment(s);
    expect(encodeSegment(once)).toBe(once);
    expect(decodeSegment(encodeSegment(once))).toBe(s);
  });

  test("整条路径也幂等", () => {
    const p = "jobs/1a2b/3.24新托福真题/听力 音频/q1.mp3";
    const once = encodeObjectPath(p);
    expect(encodeObjectPath(once)).toBe(once);
    expect(decodeObjectPath(once)).toBe(p);
  });
});

describe("encodeObjectPath / decodeObjectPath 保目录结构", () => {
  test("逐段处理，斜杠数量不变，安全段不动", () => {
    const p = "jobs/0f8f-4b/3.24新托福真题/audio/q1.mp3";
    const k = encodeObjectPath(p);
    expect(k.split("/").length).toBe(p.split("/").length);
    expect(k.split("/")[0]).toBe("jobs");
    expect(k.split("/")[1]).toBe("0f8f-4b");
    expect(k.endsWith("/audio/q1.mp3")).toBe(true);
    expect(decodeObjectPath(k)).toBe(p);
  });

  test("嵌套目录里每一层中文都编，且整条 key 合法", () => {
    const p = "realbank/asr/3.24新托福真题/听力 第一节/lcr_1.json";
    const k = encodeObjectPath(p);
    expect(VALID_KEY.test(k)).toBe(true);
    expect(decodeObjectPath(k)).toBe(p);
  });

  test("ocr 缓存的长中文名（就是线上报 Invalid key 的那条）", () => {
    const p = "ocr/1.21新托福真题B卷__新托福2026年真题02.txt";
    const k = encodeObjectPath(p);
    expect(VALID_KEY.test(k)).toBe(true);
    expect(decodeObjectPath(k)).toBe(p);
  });

  test("纯 ASCII 路径完全不变（存量对象 key 不会因为这次改动漂移）", () => {
    for (const p of ["realbank/_manifest.json", "realbank/asr-vendor/rf0610/q1.json", "ocr/nested/deep/file.txt"]) {
      expect(encodeObjectPath(p)).toBe(p);
      expect(decodeObjectPath(p)).toBe(p);
    }
  });

  test("反斜杠归一成正斜杠（Windows 侧扫出来的是反斜杠）", () => {
    expect(encodeObjectPath("realbank\\asr\\x.json")).toBe("realbank/asr/x.json");
  });

  test("空 / 空值", () => {
    expect(encodeObjectPath("")).toBe("");
    expect(encodeObjectPath(null)).toBe("");
    expect(decodeObjectPath(undefined)).toBe("");
  });

  test("解码不会凭空多出目录层级（构造出的 key 也不行）", () => {
    // "../x" 的 base64url —— 若被当成编码段解开就越界了，所以带 / 的解码结果一律不认。
    const evil = `!${Buffer.from("../x", "utf8").toString("base64url")}`;
    expect(decodeSegment(evil)).toBe(evil);
    expect(decodeObjectPath(`realbank/${evil}`).split("/").length).toBe(2);
  });
});

describe("与 validate.jobObjectKey 的接线", () => {
  const { jobObjectPath, jobObjectKey } = require("../lib/realBankIngest/validate");
  const JOB = "3f2b1c4d-0000-4000-8000-000000000001";

  test("逻辑路径保持原样，对象 key 是编码形态且合法", () => {
    expect(jobObjectPath(JOB, "3.24新托福真题/阅读.pdf")).toBe(`jobs/${JOB}/3.24新托福真题/阅读.pdf`);
    const key = jobObjectKey(JOB, "3.24新托福真题/阅读.pdf");
    expect(VALID_KEY.test(key)).toBe(true);
    expect(decodeObjectPath(key)).toBe(`jobs/${JOB}/3.24新托福真题/阅读.pdf`);
  });

  test("非法相对路径照旧抛（编码不能顺手把越界路径洗白）", () => {
    expect(() => jobObjectKey(JOB, "../etc/passwd")).toThrow();
    expect(() => jobObjectKey(JOB, "a\\b.pdf")).toThrow();
    expect(() => jobObjectKey("not a uuid!", "a.pdf")).toThrow();
  });
});
