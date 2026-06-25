/**
 * Same-origin streaming proxy for listening audio.
 *
 * Listening audio lives in Supabase Storage (supabase.co), which is slow or
 * unreachable for mainland-China users without a proxy — so the <audio> element
 * never loads and the listening exam "做不了". This route streams the bytes from
 * Supabase *server-side* (the datacenter reaches Supabase fine) and serves them
 * back over the app's own origin, which the client can already reach (it loaded
 * the app). Range requests are forwarded so the browser can stream/seek.
 *
 * Runs on the Edge runtime: it pipes the upstream body straight through (no
 * 4.5MB serverless body cap) and never touches the filesystem (reading the
 * 224MB audio dir is what blew Vercel's 250MB function limit before).
 *
 * If the upstream fetch itself fails, we return 5xx and the client's AudioPlayer
 * surfaces a media 'error' → TTS fallback, so the exam still completes.
 */
export const runtime = "edge";
export const dynamic = "force-dynamic";

const AUDIO_EXT = /\.(mp3|wav|ogg|opus|aac|flac|m4a)$/i;
const PASS_THROUGH_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

export async function GET(request, { params }) {
  const segments = (params && params.path) || [];
  const filePath = segments.join("/");
  if (!filePath || filePath.includes("..") || filePath.includes("\\") || !AUDIO_EXT.test(filePath)) {
    return new Response("Invalid path", { status: 400 });
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return new Response("Audio storage not configured", { status: 500 });

  const upstreamUrl = `${base}/storage/v1/object/public/listening_audio/${filePath}`;
  const range = request.headers.get("range");

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, range ? { headers: { Range: range } } : {});
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
  if (!headers.has("content-type")) headers.set("content-type", "audio/mpeg");
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  // Audio is immutable (named by item id) — cache hard at the CDN/PoP so a clip
  // is pulled from Supabase at most once per edge location.
  headers.set("cache-control", "public, max-age=31536000, immutable");

  return new Response(upstream.body, { status: upstream.status, headers });
}
