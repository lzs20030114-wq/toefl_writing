/**
 * Route listening audio through our own origin (the /api/audio edge proxy) so it
 * loads where the Supabase storage domain (supabase.co) is slow or blocked —
 * e.g. mainland China without a proxy. The client only ever talks to the app
 * origin it already reached; the proxy fetches Supabase server-side.
 * See app/api/audio/[...path]/route.js.
 *
 * Supabase public listening_audio URLs are rewritten; existing relative proxy
 * URLs receive the same proxy version. Other sources are returned untouched.
 *
 * Kill switch: set NEXT_PUBLIC_AUDIO_PROXY_DISABLED=1 to serve the raw Supabase
 * URLs again, no code change needed.
 */
const SUPABASE_AUDIO_RE = /\/storage\/v1\/object\/public\/listening_audio\/(.+)$/;
const PROXY_VERSION = "range-v2";

function versionProxyUrl(url) {
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const q = beforeHash.indexOf("?");
  const pathname = q >= 0 ? beforeHash.slice(0, q) : beforeHash;
  const query = new URLSearchParams(q >= 0 ? beforeHash.slice(q + 1) : "");
  query.set("proxy_version", PROXY_VERSION);
  return `${pathname}?${query}${hash}`;
}

export function sameOriginAudio(url) {
  if (!url || typeof url !== "string") return url;
  if (process.env.NEXT_PUBLIC_AUDIO_PROXY_DISABLED === "1") return url;
  // 旧代理把 206 当整份文件缓存；换代理版本绕过已污染的 immutable 副本。
  if (url.startsWith("/api/audio/")) return versionProxyUrl(url);
  let parsed;
  try { parsed = new URL(url); } catch { return url; }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname.endsWith(".supabase.co")) return url;
  // 重配后的 URL 带 ?v=<版本>（见 lib/tts/storage.versionedAudioUrl）：代理给音频打的是一年 immutable
  // 缓存，同路径覆盖上传对浏览器是不可见的，只有换 URL 才能拿到新文件。保留已有 query。
  const withoutHash = parsed.hash ? url.slice(0, url.indexOf("#")) : url;
  const q = withoutHash.indexOf("?");
  const pathPart = q >= 0 ? withoutHash.slice(0, q) : withoutHash;
  const query = q >= 0 ? withoutHash.slice(q) : "";
  const m = pathPart.match(SUPABASE_AUDIO_RE);
  if (!m) return url;
  // Encode each path segment so spaces/unicode survive, but keep the slashes.
  const safe = m[1].split("/").map(encodeURIComponent).join("/");
  return versionProxyUrl(`/api/audio/${safe}${query}${parsed.hash}`);
}
