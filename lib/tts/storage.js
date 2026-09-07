/**
 * Audio storage — upload TTS audio to Supabase Storage.
 *
 * Bucket: "listening_audio"
 * Path convention: {taskType}/{itemId}.mp3
 *   e.g. "choose-response/lcr_001.mp3"
 *        "conversation/lc_001.mp3"
 *        "announcement/la_001.mp3"
 *        "academic-talk/lat_001.mp3"
 *
 * Falls back to local file system if Supabase is not configured.
 */

const path = require("path");
const fs = require("fs");

// Lazy-load supabaseAdmin to avoid circular deps in scripts.
// Sentinel: `undefined` = not yet resolved, `null` = resolved but unavailable
// (no creds / require failed). This MUST start as `undefined`, not `null` — the
// `!== undefined` guard below would otherwise short-circuit on the very first call
// and never run the require, silently disabling Supabase uploads in EVERY
// environment (the bug that made fresh items fall back to dead local URLs).
let _admin;
function getAdmin() {
  if (_admin !== undefined) return _admin;
  try {
    const { supabaseAdmin } = require("../supabaseAdmin");
    _admin = supabaseAdmin || null;
  } catch {
    _admin = null;
  }
  return _admin;
}

const BUCKET = "listening_audio";
// Local fallback now lives under public/ so files are served as STATIC assets by the CDN
// (not bundled into the /api/audio serverless function — that hit Vercel's 250MB limit).
const LOCAL_DIR = path.resolve(__dirname, "../../public/listening-audio");

/**
 * Upload audio buffer to storage.
 *
 * @param {string} storagePath — e.g. "choose-response/lcr_001.mp3"
 * @param {Buffer} buffer — audio data
 * @returns {Promise<{ url: string, local: boolean }>}
 */
async function uploadAudio(storagePath, buffer, contentType = "audio/mpeg") {
  const admin = getAdmin();

  if (admin) {
    // Upload to Supabase Storage
    const { data, error } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType,
        upsert: true,
      });

    if (error) throw new Error(`Supabase upload error: ${error.message}`);

    // Get public URL (or signed URL if bucket is private)
    const { data: urlData } = admin.storage
      .from(BUCKET)
      .getPublicUrl(storagePath);

    return { url: urlData.publicUrl, local: false };
  }

  // Fallback: save to local filesystem
  const fullPath = path.join(LOCAL_DIR, storagePath);
  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, buffer);

  return { url: `/listening-audio/${storagePath}`, local: true };
}

/**
 * Get public URL for an audio file.
 *
 * @param {string} storagePath
 * @returns {string|null}
 */
function getAudioUrl(storagePath) {
  const admin = getAdmin();

  if (admin) {
    const { data } = admin.storage
      .from(BUCKET)
      .getPublicUrl(storagePath);
    return data.publicUrl;
  }

  const fullPath = path.join(LOCAL_DIR, storagePath);
  if (fs.existsSync(fullPath)) {
    return `/listening-audio/${storagePath}`;
  }
  return null;
}

/**
 * Check if audio exists in storage.
 *
 * @param {string} storagePath
 * @returns {Promise<boolean>}
 */
async function audioExists(storagePath) {
  const admin = getAdmin();

  if (admin) {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .list(path.dirname(storagePath), {
        search: path.basename(storagePath),
      });
    return !error && data && data.length > 0;
  }

  return fs.existsSync(path.join(LOCAL_DIR, storagePath));
}

/**
 * 给音频 URL 打版本：`…/x.mp3?v=<base36 时间戳>`。
 * /api/audio 代理把音频当不可变资源缓存一年，同路径 upsert 覆盖后老 URL 永远拿旧文件；
 * 所有「写回 audio_url」的地方（配音 / 补配 / 重配脚本）都要经过这里，换 URL 才等于换内容。
 * 已带 ?v= 的会被替换成新版本。
 */
function versionedAudioUrl(url, ver = Date.now().toString(36)) {
  if (!url || typeof url !== "string") return url;
  const bare = url.replace(/[?&]v=[^&#]*/, "").replace(/\?$/, "");
  return `${bare}${bare.includes("?") ? "&" : "?"}v=${ver}`;
}

module.exports = { uploadAudio, getAudioUrl, audioExists, versionedAudioUrl, BUCKET, LOCAL_DIR };
