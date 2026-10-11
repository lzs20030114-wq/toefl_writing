"use client";

const entries = new Map();
const queue = [];
let running = 0;
const normalize = (word) => String(word || "").trim().replace(/\s+/g, " ").toLowerCase();

function dispose(entry) {
  entry.controller?.abort();
  entry.cleanup?.();
  if (entry.audio) { entry.audio.pause(); entry.audio.removeAttribute("src"); entry.audio.load(); }
  if (entry.url) URL.revokeObjectURL(entry.url);
  if (entries.get(entry.word) === entry) entries.delete(entry.word);
}

function trim() {
  const idle = [...entries.values()].filter((e) => !e.refs && !e.players && e.ready);
  while (entries.size > 120 && idle.length) dispose(idle.shift());
}

async function prepare(entry) {
  entry.controller = new AbortController();
  const timeout = setTimeout(() => entry.controller.abort(), 15000);
  try {
    const response = await fetch(`/api/vocab/pronunciation?word=${encodeURIComponent(entry.word)}&v=1`, { signal: entry.controller.signal });
    if (!response.ok) throw new Error("Pronunciation unavailable");
    const blob = await response.blob();
    if (!entry.refs || entries.get(entry.word) !== entry) return;
    entry.url = URL.createObjectURL(blob);
    entry.audio = new Audio(entry.url);
    entry.audio.preload = "auto";
    await new Promise((resolve, reject) => {
      const audio = entry.audio;
      let timer;
      const cleanup = () => { clearTimeout(timer); audio.removeEventListener("canplay", ready); audio.removeEventListener("canplaythrough", ready); audio.removeEventListener("error", failed); entry.controller.signal.removeEventListener("abort", failed); };
      const ready = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error("Audio unavailable")); };
      entry.cleanup = failed;
      audio.addEventListener("canplay", ready);
      audio.addEventListener("canplaythrough", ready);
      audio.addEventListener("error", failed);
      entry.controller.signal.addEventListener("abort", failed);
      timer = setTimeout(failed, 10000);
      audio.load();
      if (audio.readyState >= 3) ready();
    });
    entry.cleanup = null;
    if (entry.refs && entries.get(entry.word) === entry) entry.ready = true;
    else dispose(entry);
  } catch { dispose(entry); }
  finally { clearTimeout(timeout); running--; pump(); trim(); }
}

function pump() {
  while (running < 3 && queue.length) {
    const entry = queue.shift();
    if (!entry.refs || entries.get(entry.word) !== entry) continue;
    running++; entry.started = true; void prepare(entry);
  }
}

/** Starts silent background loading; release only relinquishes this session's leases. */
export function preloadSpeakWords(words) {
  if (typeof Audio === "undefined" || typeof URL.createObjectURL !== "function") return () => {};
  const leased = [...new Set((Array.isArray(words) ? words : []).map(normalize).filter(Boolean))].map((word) => {
    let entry = entries.get(word);
    if (!entry) { entry = { word, refs: 0, players: 0, ready: false }; entries.set(word, entry); queue.push(entry); }
    entry.refs++; return entry;
  });
  pump();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    leased.forEach((entry) => { entry.refs--; if (!entry.refs && !entry.players && !entry.ready) dispose(entry); });
    trim(); pump();
  };
}

export function acquirePronunciation(word) {
  const entry = entries.get(normalize(word));
  if (!entry?.ready) return null;
  entry.players++;
  let released = false;
  return { audio: entry.audio, release() { if (released) return; released = true; entry.players--; trim(); } };
}
