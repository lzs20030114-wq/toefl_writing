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

// Lazy-load supabaseAdmin to avoid circular deps in scripts
let _admin = null;
function getAdmin() {
  if (_admin !== undefined) return _admin;
  try {
    const { supabaseAdmin } = require("../supabaseAdmin");
    _admin = supabaseAdmin;
  } catch {
    _admin = null;
  }
  return _admin;
}

const BUCKET = "listening_audio";
const LOCAL_DIR = path.resolve(__dirname, "../../data/listening/audio");

/**
 * Upload audio buffer to storage.
 *
 * @param {string} storagePath — e.g. "choose-response/lcr_001.mp3"
 * @param {Buffer} buffer — audio data
 * @returns {Promise<{ url: string, local: boolean }>}
 */
async function uploadAudio(storagePath, buffer) {
  const admin = getAdmin();

  if (admin) {
    // Upload to Supabase Storage
    const { data, error } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: "audio/mpeg",
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

  return { url: `/api/audio/${storagePath}`, local: true };
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
    return `/api/audio/${storagePath}`;
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

module.exports = { uploadAudio, getAudioUrl, audioExists, BUCKET, LOCAL_DIR };
