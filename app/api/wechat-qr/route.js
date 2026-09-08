/**
 * 微信群二维码同源代理（公开，无需登录）。
 *
 * 后台上传的图存在 Supabase Storage（supabase.co 国内不可达），这里在 Edge 把字节
 * 拉回来从 App 自己的域名吐出去，思路与 /api/audio 相同。没上传过自定义图、
 * Storage 未配置、或上游任何失败 → 302 到内置默认图 /wechat-group-qr.jpg，
 * 保证二维码永远有图可显示（默认图随代码部署，是最后的兜底）。
 *
 * 缓存 60s（与对象自带的 cacheControl 一致）；后台预览用 ?v=时间戳 穿透。
 */
export const runtime = "edge";
export const dynamic = "force-dynamic";

const BUCKET = "app_assets";
const OBJECT_KEY = "wechat/group-qr";
const FALLBACK_PATH = "/wechat-group-qr.jpg";
const CACHE_CONTROL = "public, max-age=60, s-maxage=60, stale-while-revalidate=300";
const PASS_THROUGH_HEADERS = ["content-type", "content-length", "etag", "last-modified"];

function fallback(request) {
  let search = "";
  try { search = new URL(request.url).search || ""; } catch { search = ""; }
  // 相对 Location：浏览器按当前页面 origin 解析，不依赖 request.url 里的 host。
  return new Response(null, {
    status: 302,
    headers: { location: FALLBACK_PATH + search, "cache-control": CACHE_CONTROL },
  });
}

export async function GET(request) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return fallback(request);

  let search = "";
  try { search = new URL(request.url).search || ""; } catch { search = ""; }
  const upstreamUrl = `${base}/storage/v1/object/public/${BUCKET}/${OBJECT_KEY}${search}`;

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, search ? { cache: "no-store" } : {});
  } catch {
    return fallback(request);
  }
  if (!upstream.ok) return fallback(request);

  const headers = new Headers();
  for (const h of PASS_THROUGH_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  const ct = headers.get("content-type") || "";
  // 上游只应回图片；回了别的（例如 JSON 错误体却带 200）一律兜底到默认图。
  if (!/^image\//i.test(ct)) return fallback(request);
  headers.set("cache-control", CACHE_CONTROL);
  headers.set("x-content-type-options", "nosniff");
  return new Response(upstream.body, { status: 200, headers });
}
