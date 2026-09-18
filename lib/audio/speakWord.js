"use client";

// 单词发音：用 Web Speech API 把一个英文词念出来。
//
// 词典弹窗（components/reading/WordLookupLayer）和单词本复习卡
// （components/vocab/VocabReview）共用这一份 —— 两边都只是「按一下念一遍」，
// 没必要各写一份挑嗓子的逻辑（单词本那份原先不挑 voice，在中文系统上会拿
// 中文嗓子念英文）。
//
// 听力题的整段朗读不走这里：那边还要进度条、多轮对话分角色、和 <audio> 抢
// 唯一播放位，逻辑留在 components/listening/AudioPlayer.js。

/** 挑一把靠谱的英语嗓子；挑不到返回 null（交给系统默认）。 */
export function pickEnglishVoice(voices) {
  const list = Array.isArray(voices) ? voices : [];
  const isEn = (v) => v && typeof v.lang === "string" && v.lang.startsWith("en-");
  // Safari / 中文系统的默认嗓子常常是中文的，念英文会跑调，所以先点名几把常见的好嗓子。
  return (
    list.find((v) => isEn(v) && /Samantha|Aria|Google US English|Alex|Karen/i.test(v.name || "")) ||
    list.find(isEn) ||
    null
  );
}

/** 当前环境能不能出声。不能的话调用方应该把发音按钮藏掉，而不是给个按不响的钮。 */
export function canSpeak() {
  return (
    typeof window !== "undefined" &&
    !!window.speechSynthesis &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

// Safari 第一次 getVoices() 返回空表，要等 voiceschanged；等不到就先念，
// 用系统默认嗓子也比不出声强。
const VOICE_WAIT_MS = 600;

/**
 * 念一个词（或短语）。返回 false 表示环境不支持 / 没词可念，没有发起朗读。
 * onDone 在念完、出错、或被下一次朗读掐掉时回调一次，用来收起按钮的「播放中」态。
 */
export function speakWord(word, { rate = 0.9, onDone } = {}) {
  const text = String(word || "").trim();
  if (!text || !canSpeak()) return false;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (onDone) {
      try {
        onDone();
      } catch {}
    }
  };

  try {
    const synth = window.speechSynthesis;
    synth.cancel(); // 上一遍还在念就掐掉：连点几个词是「改念这个」，不是排队

    const run = (voices) => {
      try {
        const u = new window.SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.rate = rate;
        try {
          const v = pickEnglishVoice(voices);
          if (v) u.voice = v;
        } catch {
          // 挑嗓子失败不该连累出声：用系统默认嗓子念，总比一声不响强
        }
        u.onend = finish;
        u.onerror = finish;
        synth.speak(u);
      } catch {
        finish();
      }
    };

    const initial = typeof synth.getVoices === "function" ? synth.getVoices() : [];
    if (initial && initial.length > 0) {
      run(initial);
    } else if (typeof synth.addEventListener === "function") {
      let fired = false;
      const go = () => {
        if (fired) return;
        fired = true;
        synth.removeEventListener("voiceschanged", go);
        run(typeof synth.getVoices === "function" ? synth.getVoices() : []);
      };
      synth.addEventListener("voiceschanged", go);
      setTimeout(go, VOICE_WAIT_MS);
    } else {
      run([]);
    }

    // 兜底：个别浏览器（尤其移动端 WebView）偶尔 onend / onerror 都不给，
    // 没有这一条，按钮的「播放中」会一直亮着。只清 UI 状态，不打断朗读。
    setTimeout(finish, Math.min(15000, 2500 + text.length * 120));
    return true;
  } catch {
    finish();
    return false;
  }
}
