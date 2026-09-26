"use client";

export function pickEnglishVoice(voices) {
  const list = Array.isArray(voices) ? voices : [];
  const isEn = (v) => v && typeof v.lang === "string" && v.lang.startsWith("en-");
  return list.find((v) => isEn(v) && /Samantha|Aria|Google US English|Alex|Karen/i.test(v.name || "")) || list.find(isEn) || null;
}

export function canSpeak() {
  return typeof window !== "undefined" && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === "function";
}

const VOICE_WAIT_MS = 600;
let active = null;

export function cancelSpeakWord() {
  const task = active;
  active = null;
  if (task) task.finish("cancelled");
  if (canSpeak()) { try { window.speechSynthesis.cancel(); } catch {} }
}

/** 旧调用方继续获得 boolean；onStart 只在确认开声时触发。 */
export function speakWord(word, { rate = 0.9, onStart, onEnd, onError, onDone } = {}) {
  const spokenText = String(word || "").trim();
  if (!spokenText || !canSpeak()) return false;
  cancelSpeakWord();
  const synth = window.speechSynthesis;
  const task = { finished: false, started: false, timer: null, voiceTimer: null, go: null, utterance: null };
  task.finish = (reason) => {
    if (task.finished) return;
    task.finished = true;
    clearTimeout(task.timer);
    clearTimeout(task.voiceTimer);
    if (task.go && typeof synth.removeEventListener === "function") synth.removeEventListener("voiceschanged", task.go);
    if (task.utterance) {
      task.utterance.onstart = null;
      task.utterance.onend = null;
      task.utterance.onerror = null;
    }
    if (active === task) active = null;
    if (reason === "ended") { try { onEnd?.(); } catch {} }
    if (reason === "error") { try { onError?.(); } catch {} }
    try { onDone?.(); } catch {}
  };
  active = task;
  const run = (voices) => {
    if (task.finished || active !== task) return;
    try {
      const u = new window.SpeechSynthesisUtterance(spokenText);
      task.utterance = u;
      u.lang = "en-US";
      u.rate = rate;
      try { const voice = pickEnglishVoice(voices); if (voice) u.voice = voice; } catch {}
      u.onstart = () => {
        if (task.finished || active !== task) return;
        task.started = true;
        try { onStart?.(); } catch {}
      };
      u.onend = () => task.finish(task.started ? "ended" : "error");
      u.onerror = () => task.finish("error");
      synth.speak(u);
    } catch { task.finish("error"); }
  };
  try {
    const voices = typeof synth.getVoices === "function" ? synth.getVoices() : [];
    if (voices?.length) run(voices);
    else if (typeof synth.addEventListener === "function") {
      task.go = () => {
        if (task.finished || active !== task) return;
        clearTimeout(task.voiceTimer);
        synth.removeEventListener("voiceschanged", task.go);
        run(typeof synth.getVoices === "function" ? synth.getVoices() : []);
      };
      synth.addEventListener("voiceschanged", task.go);
      task.voiceTimer = setTimeout(task.go, VOICE_WAIT_MS);
    } else run([]);
    task.timer = setTimeout(() => task.finish("error"), Math.min(15000, 2500 + spokenText.length * 120));
    return true;
  } catch { task.finish("error"); return false; }
}
