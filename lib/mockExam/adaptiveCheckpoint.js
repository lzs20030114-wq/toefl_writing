// In-progress checkpoint for the adaptive (reading / listening) mock exam.
// Lets a user exit mid-exam and resume where they left off. Keyed by section
// so reading and listening checkpoints are independent. Mirrors the writing
// mock's checkpoint (see ./storage.js) but stores the adaptive shell's state
// shape (phase / modules / results / index / route / timer / usedIds).

const KEY_PREFIX = "toefl-adaptive-checkpoint:";
const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function keyFor(section) {
  return `${KEY_PREFIX}${section}`;
}

export function saveAdaptiveCheckpoint(section, state) {
  if (!isBrowser() || !section || !state) return;
  // Only mid-exam phases are resumable; never checkpoint intro/routing/results.
  if (state.phase !== "module1" && state.phase !== "module2") return;
  try {
    localStorage.setItem(keyFor(section), JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch {
    // quota / permission — non-fatal
  }
}

export function loadAdaptiveCheckpoint(section) {
  if (!isBrowser() || !section) return null;
  try {
    const raw = localStorage.getItem(keyFor(section));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || Date.now() - (data.savedAt || 0) > TTL_MS) {
      clearAdaptiveCheckpoint(section);
      return null;
    }
    if (data.phase !== "module1" && data.phase !== "module2") {
      clearAdaptiveCheckpoint(section);
      return null;
    }
    if (!Array.isArray(data.m1Items) || data.m1Items.length === 0) {
      // Corrupt / incomplete — discard.
      clearAdaptiveCheckpoint(section);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearAdaptiveCheckpoint(section) {
  if (!isBrowser() || !section) return;
  try { localStorage.removeItem(keyFor(section)); } catch {}
}
