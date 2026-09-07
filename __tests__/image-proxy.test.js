/**
 * @jest-environment node
 *
 * 真题阅读「材料框原图」的同源代理（2026-09-07）。国内直连 supabase.co 不通，图片
 * 走 /api/img 由服务端取字节 —— 和听力音频 /api/audio 同一套路数。这里锁两件事：
 *   1) URL 改写只认 real_bank_images 桶，其余原样返回（老库 / 个人题库不受影响）；
 *   2) 路由的路径校验是白名单：扩展名不对、`..`、反斜杠、绝对 URL 一律 400，
 *      放宽一点就是任意取回。
 *
 * 跑在 node 环境（不是 jsdom），让 Response/Headers/fetch 落到 Node 原生实现上。
 */
const { materialImageSrc } = require("../lib/reading/materialImage");

const SUPA = "https://abc123.supabase.co/storage/v1/object/public/real_bank_images/reading/real_ap_310_1_25.webp";

describe("materialImageSrc", () => {
  const prev = process.env.NEXT_PUBLIC_IMG_PROXY_DISABLED;
  afterEach(() => { process.env.NEXT_PUBLIC_IMG_PROXY_DISABLED = prev; });

  test("把 Supabase real_bank_images URL 改写成同源代理路径", () => {
    expect(materialImageSrc(SUPA)).toBe("/api/img/reading/real_ap_310_1_25.webp");
  });

  test("接受 item 形状（item.material_image.url）", () => {
    expect(materialImageSrc({ material_image: { url: SUPA, w: 534, h: 492 } }))
      .toBe("/api/img/reading/real_ap_310_1_25.webp");
  });

  test("没有该字段 / 非本桶 / 已是相对路径 → 原样（老库行为零变化）", () => {
    expect(materialImageSrc({})).toBe("");
    expect(materialImageSrc(null)).toBe("");
    expect(materialImageSrc("")).toBe("");
    expect(materialImageSrc("/api/img/reading/x.webp")).toBe("/api/img/reading/x.webp");
    expect(materialImageSrc("https://other.cdn/x.webp")).toBe("https://other.cdn/x.webp");
    expect(materialImageSrc("https://abc123.supabase.co/storage/v1/object/public/listening_audio/a.mp3"))
      .toBe("https://abc123.supabase.co/storage/v1/object/public/listening_audio/a.mp3");
  });

  test("kill switch 回原始 Supabase URL", () => {
    process.env.NEXT_PUBLIC_IMG_PROXY_DISABLED = "1";
    expect(materialImageSrc(SUPA)).toBe(SUPA);
  });
});

describe("/api/img edge route", () => {
  let GET;

  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc123.supabase.co";
    GET = require("../app/api/img/[...path]/route.js").GET;
  });
  afterEach(() => { delete global.fetch; });

  const call = (segments) => GET({ headers: new Headers() }, { params: { path: segments } });

  test("合法路径 → 构造出 real_bank_images 桶的上游 URL 并透传字节", async () => {
    global.fetch = jest.fn(async (url) => {
      expect(url).toBe(
        "https://abc123.supabase.co/storage/v1/object/public/real_bank_images/reading/real_ap_310_1_25.webp"
      );
      return new Response("WEBPBYTES", {
        status: 200,
        headers: { "content-type": "image/webp", "content-length": "9", etag: "\"abc\"" },
      });
    });
    const res = await call(["reading", "real_ap_310_1_25.webp"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("etag")).toBe("\"abc\"");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await res.text()).toBe("WEBPBYTES");
  });

  test.each([
    [["reading", "x.mp3"], "非白名单扩展名"],
    [["reading", "x.svg"], "SVG（可执行脚本）"],
    [["reading", "x"], "没有扩展名"],
    [["..", "secrets.webp"], "路径穿越"],
    [["reading\\x.webp"], "反斜杠"],
    [["https://evil.example/x.webp"], "绝对 URL"],
    [[], "空路径"],
  ])("%s → 400（%s）", async (segments) => {
    global.fetch = jest.fn();
    const res = await call(segments);
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("上游 404 原样回 404（不伪装成 200 空图）", async () => {
    global.fetch = jest.fn(async () => new Response("nope", { status: 404 }));
    const res = await call(["reading", "missing.webp"]);
    expect(res.status).toBe(404);
  });

  test("上游 fetch 抛错 → 502", async () => {
    global.fetch = jest.fn(async () => { throw new Error("network"); });
    const res = await call(["reading", "x.webp"]);
    expect(res.status).toBe(502);
  });
});
