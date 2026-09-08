/**
 * @jest-environment node
 *
 * 微信群二维码后台换图：
 *   /api/admin/wechat-qr  鉴权、magic-byte 校验、体积门、建桶 + upsert、删除
 *   /api/wechat-qr        同源代理：未配置/上游失败 → 302 默认图；上游图片 → 200 透传
 */
const calls = { getBucket: [], createBucket: [], upload: [], remove: [], list: [] };
let bucketExists = true;
let listResult = { data: [], error: null };

jest.mock("../lib/supabaseAdmin", () => ({
  isSupabaseAdminConfigured: true,
  supabaseAdmin: {
    storage: {
      getBucket(name) {
        calls.getBucket.push(name);
        return Promise.resolve(bucketExists ? { data: { name }, error: null } : { data: null, error: { message: "not found" } });
      },
      createBucket(name, opts) {
        calls.createBucket.push([name, opts]);
        return Promise.resolve({ data: { name }, error: null });
      },
      from(bucket) {
        return {
          upload(key, buf, opts) {
            calls.upload.push({ bucket, key, size: buf.length, opts });
            return Promise.resolve({ data: { path: key }, error: null });
          },
          remove(keys) {
            calls.remove.push({ bucket, keys });
            return Promise.resolve({ data: [], error: null });
          },
          list(dir, opts) {
            calls.list.push({ bucket, dir, opts });
            return Promise.resolve(listResult);
          },
        };
      },
    },
  },
}));

const admin = require("../app/api/admin/wechat-qr/route");
const proxy = require("../app/api/wechat-qr/route");

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);

function multipart(buf, { token = "secret", type = "application/octet-stream", field = "image" } = {}) {
  const fd = new FormData();
  fd.append(field, new Blob([buf], { type }), "qr.bin");
  const headers = new Headers();
  if (token) headers.set("x-admin-token", token);
  return new Request("http://localhost/api/admin/wechat-qr", { method: "POST", headers, body: fd });
}

function plain(method = "GET", token = "secret") {
  const headers = new Headers();
  if (token) headers.set("x-admin-token", token);
  return new Request("http://localhost/api/admin/wechat-qr", { method, headers });
}

beforeEach(() => {
  process.env.ADMIN_DASHBOARD_TOKEN = "secret";
  for (const k of Object.keys(calls)) calls[k] = [];
  bucketExists = true;
  listResult = { data: [], error: null };
});

describe("/api/admin/wechat-qr", () => {
  test("无口令 → 401（GET/POST/DELETE）", async () => {
    expect((await admin.GET(plain("GET", ""))).status).toBe(401);
    expect((await admin.POST(multipart(JPEG, { token: "" }))).status).toBe(401);
    expect((await admin.DELETE(plain("DELETE", ""))).status).toBe(401);
    expect(calls.upload).toHaveLength(0);
  });

  test("非图片字节 → 415，即使客户端声明 image/jpeg", async () => {
    const res = await admin.POST(multipart(Buffer.from("hello world, not an image"), { type: "image/jpeg" }));
    expect(res.status).toBe(415);
    expect(calls.upload).toHaveLength(0);
  });

  test("超过 3MB → 413", async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(3 * 1024 * 1024, 0)]);
    const res = await admin.POST(multipart(big));
    expect(res.status).toBe(413);
    expect(calls.upload).toHaveLength(0);
  });

  test("缺 image 字段 → 400", async () => {
    const res = await admin.POST(multipart(JPEG, { field: "file" }));
    expect(res.status).toBe(400);
  });

  test("JPEG 上传：固定键 upsert，content-type 以嗅探为准，60s cacheControl", async () => {
    const res = await admin.POST(multipart(JPEG, { type: "application/octet-stream" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mime).toBe("image/jpeg");
    expect(calls.upload).toEqual([{
      bucket: "app_assets",
      key: "wechat/group-qr",
      size: JPEG.length,
      opts: { contentType: "image/jpeg", upsert: true, cacheControl: "60" },
    }]);
    expect(calls.createBucket).toHaveLength(0);
  });

  test("桶不存在时自动建 public 桶再上传（PNG）", async () => {
    bucketExists = false;
    const res = await admin.POST(multipart(PNG));
    expect(res.status).toBe(200);
    expect(calls.createBucket).toHaveLength(1);
    expect(calls.createBucket[0][0]).toBe("app_assets");
    expect(calls.createBucket[0][1].public).toBe(true);
    expect(calls.upload[0].opts.contentType).toBe("image/png");
  });

  test("GET 状态：list 命中对象 → exists + 元数据；未命中 → exists=false", async () => {
    listResult = {
      data: [{ name: "group-qr", updated_at: "2026-09-08T00:00:00Z", metadata: { size: 1234, mimetype: "image/png" } }],
      error: null,
    };
    let body = await (await admin.GET(plain())).json();
    expect(body).toMatchObject({ ok: true, exists: true, size: 1234, mime: "image/png", updatedAt: "2026-09-08T00:00:00Z" });
    expect(calls.list[0]).toEqual({ bucket: "app_assets", dir: "wechat", opts: { search: "group-qr" } });

    listResult = { data: null, error: { message: "Bucket not found" } };
    body = await (await admin.GET(plain())).json();
    expect(body).toMatchObject({ ok: true, exists: false });
  });

  test("DELETE → remove 固定键", async () => {
    const res = await admin.DELETE(plain("DELETE"));
    expect(res.status).toBe(200);
    expect(calls.remove).toEqual([{ bucket: "app_assets", keys: ["wechat/group-qr"] }]);
  });
});

describe("/api/wechat-qr 代理", () => {
  const origFetch = global.fetch;
  afterEach(() => { global.fetch = origFetch; });

  function req(search = "") {
    return new Request(`http://localhost/api/wechat-qr${search}`);
  }

  test("未配置 Supabase → 302 到内置默认图", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await proxy.GET(req());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/wechat-group-qr.jpg");
  });

  test("上游 404 / 抛错 / 非图片 → 302 默认图", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    global.fetch = jest.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    expect((await proxy.GET(req())).status).toBe(302);
    global.fetch = jest.fn().mockRejectedValue(new Error("boom"));
    expect((await proxy.GET(req())).status).toBe(302);
    global.fetch = jest.fn().mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    expect((await proxy.GET(req())).status).toBe(302);
  });

  test("上游图片 → 200 透传 content-type + 60s 缓存；?v= 透传上游并 no-store", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg", etag: '"abc"' } }),
    );
    const res = await proxy.GET(req("?v=123"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("etag")).toBe('"abc"');
    expect(res.headers.get("cache-control")).toContain("max-age=60");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://x.supabase.co/storage/v1/object/public/app_assets/wechat/group-qr?v=123",
      { cache: "no-store" },
    );
  });
});
