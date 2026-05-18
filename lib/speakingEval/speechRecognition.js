/**
 * Web Speech API wrapper for real-time speech recognition.
 * Works in Chrome, Edge, Safari 14.5+. Falls back gracefully.
 *
 * Usage:
 *   const recognizer = createSpeechRecognizer({ lang: "en-US", onResult, onEnd });
 *   recognizer.start();
 *   recognizer.stop();
 */

/**
 * Check if the Web Speech API is available in this browser.
 * Note: Safari exposes webkitSpeechRecognition but the recognizer can still
 * throw at start() time on macOS if the user has revoked microphone access
 * at the OS level. We can only detect that after attempting to start.
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
    // "no-speech" and "aborted" are common non-fatal errors.
    // Safari throws "service-not-allowed" / "not-allowed" when the user
    // hasn't granted microphone permission at the OS level (macOS Privacy
    // settings) even if the browser-level prompt was accepted. Surface a
    // human-readable hint for the caller to render.
    const nonFatal = ["no-speech", "aborted"];
    if (!nonFatal.includes(event.error)) {
      const macOS = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || "");
      let hint = event.message || "";
      if ((event.error === "service-not-allowed" || event.error === "not-allowed") && macOS) {
        hint = "macOS 用户：请打开「系统设置 → 隐私与安全性 → 麦克风」并允许当前浏览器使用麦克风，然后重新刷新页面。";
      } else if (event.error === "service-not-allowed" || event.error === "not-allowed") {
        hint = "麦克风权限被拒绝，请在浏览器中允许麦克风访问。";
      } else if (event.error === "network") {
        // Chrome/Edge 的浏览器内置语音识别（Web Speech API）会把音频上传到
        // Google 的服务器识别，国内网络环境下该服务无法访问，所以会反复报
        // network。客户端无法通过"检查网络/重试"解决——这是依赖项不可达。
        // 录音本身使用本地 MediaRecorder，已经正常保存。
        hint = "你的录音已正常保存。不过 Chrome / Edge 的语音识别功能依赖 Google 服务，国内网络下通常无法访问，因此本题暂时无法自动生成转写和发音评分。我们正在接入国内可用的识别服务。";
      } else if (event.error === "audio-capture") {
        hint = "未能从麦克风采集到音频，请确认麦克风未被静音或被其他程序占用。";
      }
      onError({ error: event.error, message: hint });
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
