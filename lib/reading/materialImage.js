/**
 * 真题阅读「材料框原图」的地址改写。
 *
 * 国内直连 supabase.co 常常不通（听力音频踩过同一个坑，见 lib/listening/audioSrc.js），
 * 所以 Supabase `real_bank_images` 桶的公开 URL 一律改写成同源 /api/img/…，由
 * app/api/img/[...path]/route.js 在服务端取字节。其它形态（已经是相对路径、data:/blob:、
 * 别的域名）原样返回。
 *
 * 单独成模块（而不是挂在 lib/realBank.js 上）是为了让 RDLTask 能引它而**不**把整个真题
 * 题库 JSON 拖进常规阅读练习的包里。
 *
 * Kill switch：NEXT_PUBLIC_IMG_PROXY_DISABLED=1 直接回原始 Supabase URL。
 */
const SUPABASE_MATERIAL_IMAGE_RE = /\/storage\/v1\/object\/public\/real_bank_images\/(.+)$/;

/** 接受 item（读 item.material_image.url）或直接给一个 url 字符串。 */
export function materialImageSrc(itemOrUrl) {
  const url = typeof itemOrUrl === "string" ? itemOrUrl : itemOrUrl?.material_image?.url;
  if (!url || typeof url !== "string") return "";
  if (process.env.NEXT_PUBLIC_IMG_PROXY_DISABLED === "1") return url;
  const m = url.match(SUPABASE_MATERIAL_IMAGE_RE);
  if (!m) return url;
  // 每段分别编码，斜杠保留（和 sameOriginAudio 同一套写法）。
  const safe = m[1].split("/").map(encodeURIComponent).join("/");
  return `/api/img/${safe}`;
}

/**
 * 题目进入做题界面前需要预热的图片列表（喂给 components/shared/AssetPreloadGate）。
 * 目前只有材料原图一种；没有图返回空数组，预加载门会原样透传。
 */
export function materialImagePreloadUrls(item) {
  const src = materialImageSrc(item);
  return src ? [src] : [];
}
