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
 * iOS/AVFoundation 特别对待：苹果的媒体加载器用 Range 探测（首个请求常是
 * bytes=0-1），并要求拿到语义精确的 206 —— content-range 和 content-length 必须
 * 与实际字节严格一致；流式透传经过边缘层可能被转成 chunked 而丢失定长信息，
 * Chrome/安卓宽容照播，iOS 则永远停在缓冲（表现为「缓冲中→音频播放被浏览器
 * 暂停」且重试无效）。因此带 Range 的请求一律整段读进内存后以定长 body 回应，
 * 并在上游无视 Range 回 200 时在本层自行切片出 206。听力/口语 clip 都是小 mp3
 * （几十 KB ~ 几 MB），超出缓冲上限的极端情况退回原来的流式透传。
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

// 带 Range 请求的整段缓冲上限（防内存失控；超过就退回流式透传）。
const RANGE_BUFFER_CAP = 20 * 1024 * 1024;

/**
 * Parse a single-range `bytes=` header against a known total size.
 * Returns { start, end } (inclusive), { unsatisfiable: true }, or null when the
 * header isn't a simple single range we can serve.
 */
function parseRange(header, total) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start;
  let end;
  if (m[1] === "") {
    // bytes=-N → 末尾 N 字节
    const n = Number(m[2]);
    if (n === 0) return { unsatisfiable: true };
    start = Math.max(0, total - n);
    end = total - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
  }
  if (start >= total || start > end) return { unsatisfiable: true };
  return { start, end };
}

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

  if (range) {
    const declared = Number(upstream.headers.get("content-length"));
    const bufferable = Number.isFinite(declared) && declared > 0 && declared <= RANGE_BUFFER_CAP;
    if (bufferable) {
      let buf = null;
      try {
        buf = await upstream.arrayBuffer();
      } catch {
        // Body 已被消费，无法退回流式 → 5xx 让客户端走 error → TTS 兜底。
        return new Response("Upstream read failed", { status: 502 });
      }

      if (upstream.status === 206) {
        // 上游已给出正确的 partial：只把 content-length 锁成实际字节数。
        headers.set("content-length", String(buf.byteLength));
        return new Response(buf, { status: 206, headers });
      }

      // 上游无视 Range 回了整个文件 → 在本层切片出精确的 206。
      const total = buf.byteLength;
      const r = parseRange(range, total);
      if (!r) {
        // Range 头不是我们能处理的单段格式 → 回整段定长 200（比错 206 安全）。
        headers.delete("content-range");
        headers.set("content-length", String(total));
        return new Response(buf, { status: 200, headers });
      }
      if (r.unsatisfiable) {
        return new Response(null, {
          status: 416,
          headers: new Headers({ "content-range": `bytes */${total}` }),
        });
      }
      const slice = buf.slice(r.start, r.end + 1);
      headers.set("content-range", `bytes ${r.start}-${r.end}/${total}`);
      headers.set("content-length", String(slice.byteLength));
      return new Response(slice, { status: 206, headers });
    }
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}
