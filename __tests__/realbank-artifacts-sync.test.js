/**
 * 中间产物同步的白名单判据（scripts/realbank/artifacts_sync.mjs 的 isSynced/countStructured）。
 *
 * 这份白名单决定云端 build_bank 手里有多少套卷。漏掉一类产物 = 全量重建时那些卷凭空消失
 * （build_bank 只汇总 .codex-tmp 里现存的 *.structured.json，少一份就少一套卷的题）；
 * 多收一类 = 把 650MB 的 audio/ 与 src-converted/ 往桶里灌，每次 job 多花几分钟传大件。
 * 所以这两侧都得钉死。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  isSynced, countStructured, SyncFailure, push, pull, MANIFEST_KEY,
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
  //
  // 本地产物一律用 tmpDir 注入的夹具目录，**不读真的 `.codex-tmp/`**：那个目录不进 git，
  // 本机有几千个文件、CI 上一个都没有。这组用例最初读的就是真目录 —— 本机有文件可传，
  // 走到逐文件上传那一支，绿；CI 上 changed 为空，整段上传循环被跳过，stub 的失败 upload
  // 第一次被调用是在写清单那一步，抛出来的是普通 Error —— 同一条断言，在干净检出上必红。
  let fixtureDir; // 两个白名单内的文件（其中一个带中文名，顺带过一遍 key 编码）
  let emptyDir;   // CI 上 `.codex-tmp/` 的样子：什么都没有
  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifacts-sync-"));
    emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifacts-sync-empty-"));
    fs.mkdirSync(path.join(fixtureDir, "realbank"), { recursive: true });
    fs.mkdirSync(path.join(fixtureDir, "ocr"), { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, "realbank", "9.9测试卷.structured.json"), "{}");
    fs.writeFileSync(path.join(fixtureDir, "ocr", "9.9测试卷__阅读.txt"), "ocr text");
  });
  afterAll(() => {
    for (const d of [fixtureDir, emptyDir]) fs.rmSync(d, { recursive: true, force: true });
  });

  /** uploadResult(key) 决定每次 upload 的结局；sb.uploads 记下每次传的 key 与内容。 */
  const stubSb = (uploadResult, { download } = {}) => {
    const uploads = [];
    return {
      uploads,
      storage: {
        getBucket: async () => ({ data: { name: "real_bank_artifacts" } }),
        from: () => ({
          download: download || (async () => ({ data: null, error: { message: "not found" } })),
          upload: async (key, body) => { uploads.push({ key, body }); return uploadResult(key); },
        }),
      },
    };
  };
  const quiet = (tmpDir) => ({ log: () => {}, tmpDir });

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

  test("对照组：upload 都成功 → 两个文件按编码后的 key 传上去，清单最后写、记 structured 1 套", async () => {
    const sb = stubSb(() => ({ error: null }));
    const res = await push(sb, quiet(fixtureDir));
    expect(res.uploaded).toBe(2);
    expect(sb.uploads.map((u) => u.key).at(-1)).toBe(MANIFEST_KEY);
    // Supabase 的 isValidKey 不收中文：真正发出去的 key 必须已经过 objectKey 编码
    for (const { key } of sb.uploads) expect(key).toMatch(/^[\x20-\x7e]+$/);
    const manifest = JSON.parse(sb.uploads.at(-1).body.toString("utf8"));
    expect(manifest.structured).toBe(1);
    expect(Object.keys(manifest.files).sort()).toEqual(
      ["ocr/9.9测试卷__阅读.txt", "realbank/9.9测试卷.structured.json"]);
  });

  test("upload 返回 error → 抛 SyncFailure(exitCode 1)，清单不写", async () => {
    const sb = stubSb(() => ({ error: { message: "Invalid key: ocr/中文.txt" } }));
    const e = await expectSyncFailure(push(sb, quiet(fixtureDir)));
    expect(e.message).toMatch(/有 2 个文件上传失败，清单未更新/);
    expect(sb.uploads.map((u) => u.key)).not.toContain(MANIFEST_KEY);
  });

  test("upload 直接抛（不是返回 {error}）也照样收敛成 SyncFailure，不会让 pool 炸穿", async () => {
    const sb = stubSb(() => { throw new Error("boom"); });
    const e = await expectSyncFailure(push(sb, quiet(fixtureDir)));
    // 两个文件都进了失败清单 = pool 没有在第一个异常上炸掉
    expect(e.message).toMatch(/有 2 个文件上传失败，清单未更新/);
    expect(sb.uploads.map((u) => u.key)).not.toContain(MANIFEST_KEY);
  });

  // CI 的真实处境：本地没有任何文件可传，唯一一次 upload 就是写清单。
  test.each([
    ["返回 {error}", () => ({ error: { message: "row-level security" } }), /row-level security/],
    ["直接抛", () => { throw new Error("boom"); }, /boom/],
  ])("没有文件可传、清单写入%s → 同样是 SyncFailure，且报错点名是清单这一步", async (_label, result, detail) => {
    const sb = stubSb(result);
    const e = await expectSyncFailure(push(sb, quiet(emptyDir)));
    expect(sb.uploads.map((u) => u.key)).toEqual([MANIFEST_KEY]);
    expect(e.message).toMatch(/清单写入失败/);
    expect(e.message).toMatch(detail);
  });

  test("文件都传上去了、只有清单写不上 → 也是 SyncFailure（不能当成同步成功）", async () => {
    const sb = stubSb((key) => (key === MANIFEST_KEY ? { error: { message: "quota" } } : { error: null }));
    const e = await expectSyncFailure(push(sb, quiet(fixtureDir)));
    expect(e.message).toMatch(/清单写入失败（本次上传 2 个文件，清单未更新）/);
  });

  test("pull：清单里的文件下载失败 → SyncFailure，本地不落半截文件", async () => {
    const manifest = { structured: 1, files: { "realbank/9.9测试卷.structured.json": { size: 2, mtime: 1 } } };
    const sb = stubSb(() => ({ error: null }), {
      download: async (key) => (key === MANIFEST_KEY
        ? { data: { text: async () => JSON.stringify(manifest) }, error: null }
        : { data: null, error: { message: "Object not found" } }),
    });
    const e = await expectSyncFailure(pull(sb, quiet(emptyDir)));
    expect(e.message).toMatch(/有 1 个文件下载失败/);
    expect(fs.existsSync(path.join(emptyDir, "realbank"))).toBe(false);
  });
});
