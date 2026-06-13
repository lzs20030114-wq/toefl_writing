// Reconstruct the public audio URL for a listening bank item from its id.
//
// Records saved before the replay feature (commit de6cddf) didn't persist
// `audio_url`, so their history replay fell back to robotic browser TTS off the
// speaker/transcript text — which sounds nothing like the natural recording the
// user heard while answering. Every record still stores the bank item id
// (details.items[].id / details.itemIds / mock task.itemId), and audio files
// live at a deterministic Supabase Storage path, so we can rebuild the original
// recording's URL from the id alone — no need to bundle the multi-MB question
// banks into the history page.
//
// Path convention (see lib/tts/storage.js + scripts/generate-*.mjs):
//   {SUPABASE_URL}/storage/v1/object/public/{bucket}/{folder}/{itemId}.mp3
// The folder per task type is fixed by the generation pipeline; the item id
// always begins with its task type (e.g. "lcr_…", "la_…", "lc_…", "lat_…").

const BUCKET = "listening_audio";

// taskType → storage folder. Sourced from the generation scripts:
//   scripts/generate-lcr.mjs → "choose-response"
//   scripts/generate-la.mjs  → "announcement"
//   scripts/generate-lc.mjs  → "conversation"
//   scripts/backfill-tts.mjs → "lecture" (lat)
const TYPE_FOLDER = {
  lcr: "choose-response",
  la: "announcement",
  lc: "conversation",
  lat: "lecture",
};

function storageBase() {
  const root = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!root) return null;
  return `${root.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}`;
}

/**
 * Rebuild the public recording URL for a listening item id, or null if the id
 * is unrecognized / Supabase isn't configured. The id's leading segment (before
 * the first underscore) selects the storage folder.
 */
export function listeningAudioUrlFromId(id) {
  if (!id || typeof id !== "string") return null;
  const folder = TYPE_FOLDER[id.split("_")[0]];
  if (!folder) return null;
  const base = storageBase();
  if (!base) return null;
  return `${base}/${folder}/${id}.mp3`;
}
