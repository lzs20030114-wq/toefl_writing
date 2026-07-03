/**
 * Route listening audio through our own origin (the /api/audio edge proxy) so it
 * loads where the Supabase storage domain (supabase.co) is slow or blocked —
 * e.g. mainland China without a proxy. The client only ever talks to the app
 * origin it already reached; the proxy fetches Supabase server-side.
 * See app/api/audio/[...path]/route.js.
 *
 * Only Supabase public listening_audio URLs are rewritten — anything else
 * (already-relative /api/audio or /listening-audio, data:/blob:, a non-Supabase
 * host) is returned untouched.
 *
 * Kill switch: set NEXT_PUBLIC_AUDIO_PROXY_DISABLED=1 to serve the raw Supabase
 * URLs again, no code change needed.
 */
const SUPABASE_AUDIO_RE = /\/storage\/v1\/object\/public\/listening_audio\/(.+)$/;

export function sameOriginAudio(url) {
  if (!url || typeof url !== "string") return url;
  if (process.env.NEXT_PUBLIC_AUDIO_PROXY_DISABLED === "1") return url;
  const m = url.match(SUPABASE_AUDIO_RE);
  if (!m) return url;
  // Encode each path segment so spaces/unicode survive, but keep the slashes.
  const safe = m[1].split("/").map(encodeURIComponent).join("/");
  return `/api/audio/${safe}`;
}
