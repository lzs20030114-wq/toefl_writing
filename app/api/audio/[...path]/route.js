import { NextResponse } from "next/server";

/**
 * Legacy redirect. Audio is now served as STATIC assets from /public/listening-audio
 * (CDN-served). Old `/api/audio/<path>` URLs 308-redirect to `/listening-audio/<path>`.
 *
 * Crucially this handler does NO filesystem read, so the 224MB audio directory is never
 * traced into this serverless function (reading it locally is what blew Vercel's 250MB
 * unzipped-function limit and broke the deploy).
 */
export async function GET(request, { params }) {
  const pathSegments = params.path || [];
  if (!pathSegments.length) {
    return NextResponse.json({ error: "No path" }, { status: 400 });
  }
  const filePath = pathSegments.join("/");
  if (!/\.(mp3|wav|ogg|opus|aac|flac)$/i.test(filePath) || filePath.includes("..") || filePath.includes("\\")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 403 });
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return NextResponse.json({ error: "Audio storage not configured" }, { status: 500 });
  return NextResponse.redirect(`${base}/storage/v1/object/public/listening_audio/${filePath}`, 308);
}
