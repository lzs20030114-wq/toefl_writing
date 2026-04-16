/**
 * Web Speech API wrapper for real-time speech recognition.
 * Works in Chrome, Edge, Safari. Falls back gracefully.
 *
 * Usage:
 *   const recognizer = createSpeechRecognizer({ lang: "en-US", onResult, onEnd });
 *   recognizer.start();
 *   recognizer.stop();
 */

/**
 * Check if the Web Speech API is available in this browser.
 */
export function isSpeechRecognitionSupported() {
  if (typeof window === "undefined") return false;
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

/**
 * Create a speech recognizer instance.
 *
 * @param {Object} options
 * @param {string}   options.lang      — recognition language (default: "en-US")
 * @param {Function} options.onResult  — called with (transcript: string, isFinal: boolean)
 * @param {Function} options.onEnd     — called when recognition ends
 * @param {Function} options.onError   — called with (error: { error: string, message: string })
 * @returns {{ start: Function, stop: Function, isSupported: boolean }}
 */
export function createSpeechRecognizer({
  lang = "en-US",
  onResult = () => {},
  onEnd = () => {},
  onError = () => {},
} = {}) {
  const supported = isSpeechRecognitionSupported();

  if (!supported) {
    return {
      start: () => {},
      stop: () => {},
      isSupported: false,
    };
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();

  recognition.lang = lang;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let isRunning = false;
  let finalTranscript = "";

  recognition.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += t;
      } else {
        interim += t;
      }
    }
    if (final) {
      finalTranscript += (finalTranscript ? " " : "") + final;
      onResult(finalTranscript, true);
    } else if (interim) {
      onResult(finalTranscript + (finalTranscript ? " " : "") + interim, false);
    }
  };

  recognition.onend = () => {
    isRunning = false;
    onEnd(finalTranscript);
  };

  recognition.onerror = (event) => {
    // "no-speech" and "aborted" are common non-fatal errors
    const nonFatal = ["no-speech", "aborted"];
    if (!nonFatal.includes(event.error)) {
      onError({ error: event.error, message: event.message || "" });
    }
    // recognition.onend will still fire after error
  };

  return {
    start: () => {
      if (isRunning) return;
      finalTranscript = "";
      isRunning = true;
      try {
        recognition.start();
      } catch (e) {
        // Already started — ignore
        isRunning = false;
      }
    },
    stop: () => {
      if (!isRunning) return;
      try {
        recognition.stop();
      } catch (e) {
        // Already stopped — ignore
      }
    },
    isSupported: true,
  };
}
