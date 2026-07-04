// Pure helpers for personal-bank listening audio (shared by /api/user-bank routes; unit-tested).
//
// These encode two security口径 from the 2026-07-04 research (附录 C, §3 补丁 A/B):
//   * stripClientAudioUrl — audio for listening items is minted server-side only
//     (/api/user-bank/render-audio). A client-supplied data.audio_url on POST is dropped so a
//     request can't point an <audio src> at an arbitrary external URL (IP leak / spoofed content).
//   * userAudioStoragePath — on DELETE, derive the bucket-relative storage path from a stored
//     audio_url ONLY when it belongs to THIS user's own render prefix (listening_audio/user/{code}/).
//     Returns null for foreign / malformed URLs, so a stale/injected URL can never trigger a
//     storage delete of someone else's object.

// Listening types whose data carries a server-minted audio_url. Widen with LC later.
const LISTENING_TYPES = new Set(["lcr", "la", "lat"]);

function isListeningType(type) {
  return LISTENING_TYPES.has(String(type || "").toLowerCase());
}

// Return `data` with audio_url removed IFF this is a listening type carrying one. Non-listening
// types pass through untouched (they legitimately have no audio_url). Never mutates the input.
function stripClientAudioUrl(type, data) {
  if (!isListeningType(type)) return data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  if (!("audio_url" in data)) return data;
  const { audio_url: _dropped, ...rest } = data;
  return rest;
}

// Derive the listening_audio bucket-relative path for THIS user's own audio, else null.
// Accepts the same-origin proxy form (/api/audio/user/{code}/x.mp3) and the raw Supabase public
// URL (…/storage/v1/object/public/listening_audio/user/{code}/x.mp3).
function userAudioStoragePath(code, audioUrl) {
  const c = String(code || "").trim();
  const url = String(audioUrl || "").trim();
  if (!c || !url) return null;
  const prefix = `user/${c}/`;
  const proxyMatch = url.match(/^\/api\/audio\/(.+)$/);
  if (proxyMatch) {
    const p = safeDecode(proxyMatch[1]);
    return p && p.startsWith(prefix) && !p.includes("..") ? p : null;
  }
  const bucketMatch = url.match(/\/storage\/v1\/object\/public\/listening_audio\/(.+)$/);
  if (bucketMatch) {
    const p = safeDecode(bucketMatch[1]);
    return p && p.startsWith(prefix) && !p.includes("..") ? p : null;
  }
  return null;
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

module.exports = { LISTENING_TYPES, isListeningType, stripClientAudioUrl, userAudioStoragePath };
