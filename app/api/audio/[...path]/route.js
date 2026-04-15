import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Serve audio files from data/listening/audio/.
 *
 * URL: /api/audio/choose-response/lcr_v2_xxx.mp3
 * Maps to: data/listening/audio/choose-response/lcr_v2_xxx.mp3
 *
 * Only serves .mp3/.wav/.ogg files from the listening/audio directory.
 * Returns proper Content-Type and caching headers.
 */
export async function GET(request, { params }) {
  const pathSegments = params.path;
  if (!pathSegments || pathSegments.length === 0) {
    return NextResponse.json({ error: "No path" }, { status: 400 });
  }

  const filePath = pathSegments.join("/");

  // Security: only allow audio file extensions
  if (!/\.(mp3|wav|ogg|opus|aac|flac)$/i.test(filePath)) {
    return NextResponse.json({ error: "Invalid file type" }, { status: 403 });
  }

  // Security: prevent path traversal
  if (filePath.includes("..") || filePath.includes("\\")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 403 });
  }

  const fullPath = join(process.cwd(), "data", "listening", "audio", filePath);

  if (!existsSync(fullPath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const buffer = readFileSync(fullPath);
    const ext = filePath.split(".").pop().toLowerCase();
    const contentType = {
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      opus: "audio/opus",
      aac: "audio/aac",
      flac: "audio/flac",
    }[ext] || "application/octet-stream";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Accept-Ranges": "bytes",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "Read error" }, { status: 500 });
  }
}
