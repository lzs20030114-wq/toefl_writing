/**
 * Same-origin proxy for real-exam material images.
 *
 * 真题阅读的「材料框原图」存在 Supabase Storage（supabase.co），国内用户直连常常不通
 * —— <img> 加载不出来，用户看到的就是一块空白。这里在服务端（数据中心到 Supabase 是通的）
 * 取字节、用 App 自己的域名发回去，和听力音频的 /api/audio 是同一套路数，只是更简单：
 * 图片不需要 Range（几十 KB 的 WebP，浏览器一次拉完）。
 *
 * 只映射 `real_bank_images` 这一个公开桶；扩展名白名单之外、含 `..` / 反斜杠 / 绝对 URL
 * 的路径一律 400 —— 路径是拼进上游 URL 的，放宽一点就是任意取回。
 */
export const runtime = "edge";

const IMG_EXT = /\.(webp|png|jpg|jpeg)$/i;
const BUCKET = "real_bank_images";
const PASS_THROUGH_HEADERS = ["content-type", "content-length", "etag", "last-modified"];

const CONTENT_TYPES = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export async function GET(request, { params }) {
  const segments = (params && params.path) || [];
  const filePath = segments.join("/");

  if (
    !filePath ||
    filePath.includes("..") ||
    filePath.includes("\\") ||
    filePath.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(filePath) ||
    !IMG_EXT.test(filePath)
  ) {
    return new Response("Invalid path", { status: 400 });
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return new Response("Image storage not configured", { status: 500 });

  const upstreamUrl = `${base}/storage/v1/object/public/${BUCKET}/${filePath}`;

  let upstream;
  try {
    upstream = await fetch(upstreamUrl);
  } catch {
    return new Response("Upstream fetch failed", { status: 502 });
  }
  if (upstream.status >= 400) {
    return new Response("Upstream error", { status: upstream.status });
  }

  const headers = new Headers();
  for (const h of PASS_THROUGH_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("content-type")) {
    const ext = (IMG_EXT.exec(filePath)[1] || "webp").toLowerCase();
    headers.set("content-type", CONTENT_TYPES[ext] || "image/webp");
  }
  // 图片按 item id 命名，内容不会变 —— 边缘缓存到底，一个 PoP 最多回 Supabase 拿一次。
  headers.set("cache-control", "public, max-age=31536000, immutable");

  return new Response(upstream.body, { status: upstream.status, headers });
}
