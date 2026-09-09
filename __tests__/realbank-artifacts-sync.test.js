/**
 * 中间产物同步的白名单判据（scripts/realbank/artifacts_sync.mjs 的 isSynced/countStructured）。
 *
 * 这份白名单决定云端 build_bank 手里有多少套卷。漏掉一类产物 = 全量重建时那些卷凭空消失
 * （build_bank 只汇总 .codex-tmp 里现存的 *.structured.json，少一份就少一套卷的题）；
 * 多收一类 = 把 650MB 的 audio/ 与 src-converted/ 往桶里灌，每次 job 多花几分钟传大件。
 * 所以这两侧都得钉死。
 */
const {
  isSynced, countStructured, SyncFailure, push,
} = require("../scripts/realbank/artifacts_sync.mjs");

describe("isSynced —— 收哪些", () => {
  test("realbank 顶层的 .json 都收", () => {
    expect(isSynced("realbank/3.24新托福真题.json")).toBe(true);
    expect(isSynced("realbank/3.24新托福真题.structured.json")).toBe(true);
    expect(isSynced("realbank/3.24新托福真题.audit.json")).toBe(true);
    expect(isSynced("realbank/3.24新托福真题.bs.json")).toBe(true);
  });

  test("四个中间目录整目录收", () => {
    expect(isSynced("realbank/asr/3.24新托福真题/listening_m1.json")).toBe(true);
    expect(isSynced("realbank/asr-vendor/rf0610/q1.json")).toBe(true);
    expect(isSynced("realbank/bs-ocr/3.24新托福真题/p12.abc12345.json")).toBe(true);
    expect(isSynced("realbank/_review/whatever.json")).toBe(true);
  });

  test("材料图只收 manifest（图本体已在公开桶 real_bank_images）", () => {
    expect(isSynced("realbank/material-images/manifest.json")).toBe(true);
    expect(isSynced("realbank/material-images/real_ap_324_1_3.webp")).toBe(false);
  });

  test("ocr 缓存整目录收", () => {
    expect(isSynced("ocr/3.24新托福真题__3.24 阅读.txt")).toBe(true);
    expect(isSynced("ocr/nested/deep/file.txt")).toBe(true);
  });
});

describe("isSynced —— 排除哪些", () => {
  test("能重算的大件一律不传", () => {
    for (const rel of [
      "realbank/src-converted/5.20新托福真题/5.20 阅读.pdf",
      "realbank/bs-pages/3.24新托福真题/p3.png",
      "realbank/audio/3.24新托福真题/lcr_1.mp3",
      "realbank/_bank_before/ap.json",
      "realbank/logs/asr-cost.jsonl",
    ]) expect(isSynced(rel)).toBe(false);
  });

  test("*.prev.json 是上一版备份，不传", () => {
    expect(isSynced("realbank/3.24新托福真题.structured.prev.json")).toBe(false);
    expect(isSynced("realbank/3.24新托福真题.audit.prev.json")).toBe(false);
  });

  test("顶层非 .json 不传", () => {
    expect(isSynced("realbank/notes.txt")).toBe(false);
    expect(isSynced("realbank/scratch.mp3")).toBe(false);
  });

  test("越界路径一律拒（清单被人改过也不能写到 .codex-tmp 外面）", () => {
    expect(isSynced("realbank/../../etc/passwd")).toBe(false);
    expect(isSynced("../secret.json")).toBe(false);
    expect(isSynced("")).toBe(false);
    expect(isSynced(null)).toBe(false);
  });

  test(".codex-tmp 下的其它顶层目录不传", () => {
    expect(isSynced("something-else/x.json")).toBe(false);
  });

  test("反斜杠路径按正斜杠一样判（Windows 侧扫出来的就是反斜杠）", () => {
    expect(isSynced("realbank\\asr\\3.24\\listening_m1.json")).toBe(true);
    expect(isSynced("realbank\\audio\\x.mp3")).toBe(false);
  });
});

describe("countStructured", () => {
  test("只数 *.structured.json —— 它就是「有几套卷」的口径", () => {
    expect(countStructured({
      "realbank/a.structured.json": {},
      "realbank/b.structured.json": {},
      "realbank/a.audit.json": {},
      "realbank/a.json": {},
      "realbank/a.structured.fs_parsed.json": {},
      "ocr/x.txt": {},
    })).toBe(2);
  });

  test("空清单 / 缺参数 → 0（fail-closed 校验会把 0 当成「拉空了」）", () => {
    expect(countStructured({})).toBe(0);
    expect(countStructured(undefined)).toBe(0);
  });
});

describe("上传失败必须是硬失败", () => {
  // 线上原样：2474 个文件全被 Supabase 以 `Invalid key: …` 拒收，脚本却还退 0，
  // 于是「同步成功」的假象一路传到 Worker 的 fail-closed 校验前。
  const stubSb = (uploadResult) => ({
    storage: {
      getBucket: async () => ({ data: { name: "real_bank_artifacts" } }),
      from: () => ({
        download: async () => ({ data: null, error: { message: "not found" } }),
        upload: async () => uploadResult(),
      }),
    },
  });

  test("SyncFailure 带 exitCode 1（CLI 据此退非 0）", () => {
    expect(SyncFailure("x").exitCode).toBe(1);
    expect(SyncFailure("x").name).toBe("SyncFailure");
  });

  // 断言看 name/exitCode 而不是 instanceof —— CLI 也只看 e.exitCode。
  const expectSyncFailure = async (p) => {
    const e = await p.then(() => null, (err) => err);
    expect(e && e.name).toBe("SyncFailure");
    expect(e.exitCode).toBe(1);
    return e;
  };

  test("upload 返回 error → 抛 SyncFailure(exitCode 1)，清单不写", async () => {
    const e = await expectSyncFailure(
      push(stubSb(() => ({ error: { message: "Invalid key: ocr/中文.txt" } })), { log: () => {} }));
    expect(e.message).toMatch(/上传失败，清单未更新/);
  });

  test("upload 直接抛（不是返回 {error}）也照样收敛成 SyncFailure，不会让 pool 炸穿", async () => {
    await expectSyncFailure(push(stubSb(() => { throw new Error("boom"); }), { log: () => {} }));
  });
});
