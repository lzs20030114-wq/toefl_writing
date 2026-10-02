// In-progress adaptive exam checkpoint. Ordinary exams keep their old section
// key; real-bank exams are scoped to source, account, and template.
const KEY_PREFIX = "toefl-adaptive-checkpoint:";
const TTL_MS = 2 * 60 * 60 * 1000;

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function scope(section, options = {}) {
  if (options.source !== "real-bank") return { key: `${KEY_PREFIX}${section}`, real: false };
  const userCode = String(options.userCode || "").trim();
  const templateVersion = String(options.templateVersion || "").trim();
  if (!userCode || !templateVersion) return null;
  return {
    key: `${KEY_PREFIX}real-bank:${encodeURIComponent(userCode)}:${encodeURIComponent(templateVersion)}:${section}`,
    real: true, userCode, templateVersion,
  };
}

export function saveAdaptiveCheckpoint(section, state, options = {}) {
  const target = scope(section, options);
  if (!isBrowser() || !section || !state || !target) return;
  if (state.phase !== "module1" && state.phase !== "module2") return;
  if (target.real && (!state.paper || state.paper.userCode !== target.userCode || state.paper.templateVersion !== target.templateVersion)) return;
  try {
    localStorage.setItem(target.key, JSON.stringify({
      ...state,
      source: target.real ? "real-bank" : "standard",
      userCode: target.real ? target.userCode : undefined,
      templateVersion: target.real ? target.templateVersion : undefined,
      savedAt: Date.now(),
    }));
  } catch {}
}

export function loadAdaptiveCheckpoint(section, options = {}) {
  const target = scope(section, options);
  if (!isBrowser() || !section || !target) return null;
  try {
    const raw = localStorage.getItem(target.key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || Date.now() - (data.savedAt || 0) > TTL_MS ||
        (data.phase !== "module1" && data.phase !== "module2") ||
        !Array.isArray(data.m1Items) || !data.m1Items.length) {
      clearAdaptiveCheckpoint(section, options);
      return null;
    }
    if (target.real) {
      if (data.source !== "real-bank" || data.userCode !== target.userCode ||
          data.templateVersion !== target.templateVersion ||
          data.paper?.userCode !== target.userCode ||
          data.paper?.templateVersion !== target.templateVersion ||
          data.paper?.section !== section || !data.paper?.attemptId) return null;
    } else if (data.source === "real-bank") return null;
    return data;
  } catch { return null; }
}

export function clearAdaptiveCheckpoint(section, options = {}) {
  const target = scope(section, options);
  if (!isBrowser() || !section || !target) return;
  try { localStorage.removeItem(target.key); } catch {}
}
