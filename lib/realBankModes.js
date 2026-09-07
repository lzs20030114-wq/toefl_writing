// 「真题专区」的三档模式口径（Standard / Practice / Challenge）。
//
// 设计前提：真题专区不是第 13 个题型，它只是「换一批题目」的常规练习 —— 所以限时必须与
// 普通练习完全对齐（同一张表、同一套标签），不能自己另发明一套秒数。
//   写作 / 造句 → lib/practiceMode.js 的 getTaskTimeSeconds
//   阅读三题型   → lib/practiceMode.js 的 getReadingTimeSeconds
//   听力 / 口语  → 计时在任务组件内部按题走（LCRTask / ListeningMCQTask 的每题倒计时、
//                  InterviewTask 每题 45s），页面层只有「限时 / 不限时」两态，
//                  所以 timed 档返回 null = 「别传 timeLimit，交给组件自己算」。
//
// 纯函数模块：只依赖 lib/practiceMode + lib/listeningTiming，**不许** import 任何题库 JSON
// （首页面板要用它，见 __tests__/real-bank-section.component.test.js 的 bundle 体积守卫）。

import {
  PRACTICE_MODE,
  formatMinutesLabel,
  getReadingTimeSeconds,
  getTaskTimeSeconds,
  normalizePracticeMode,
} from "./practiceMode";
import { LCR_SECONDS_PER_ITEM } from "./listeningTiming";

// 真题 type → 写作侧 taskKey（practiceMode 的表用 build/email/discussion 三个键）。
const WRITING_TASK_KEYS = {
  discussion: "discussion",
  email: "email",
  bs: "build",
};

const READING_TYPES = new Set(["ctw", "rdl", "ap"]);
const LISTENING_TYPES = new Set(["lcr", "lc", "la", "lat"]);
const SPEAKING_TYPES = new Set(["repeat", "interview"]);

// 听力 / 口语的卡片标签：与首页常规练习面板同一套字符串
// （ListeningSectionContent.js / SpeakingSectionContent.js），challenge 下不变 ——
// 这几个题型的限时在组件里按题固定，档位切换不改秒数。
// lcr 在真题专区是「一条 = 一题」，写整段的 5 min 会骗人，所以标每题答题窗口。
const AUDIO_TIME_LABELS = {
  lcr: `${LCR_SECONDS_PER_ITEM}s/题`,
  lc: "5 min",
  la: "3 min",
  lat: "8 min",
  repeat: "3 min",
  interview: "4 min",
};

export function isRealBankAudioType(type) {
  return LISTENING_TYPES.has(type) || SPEAKING_TYPES.has(type);
}

/**
 * 当前档位下这道真题的限时（秒）。
 *  - 写作 / 造句 / 阅读：正整数；practice 档 0（不限时）
 *  - 听力 / 口语：practice 档 0，其余返回 null（= 由任务组件按题自己计时）
 *  - 未知 type：按讨论处理（与页面的 normalizeRealType 兜底一致）
 */
export function getRealBankTimeSeconds(type, mode = PRACTICE_MODE.STANDARD) {
  const safeMode = normalizePracticeMode(mode);
  if (isRealBankAudioType(type)) return safeMode === PRACTICE_MODE.PRACTICE ? 0 : null;
  if (READING_TYPES.has(type)) return getReadingTimeSeconds(type, safeMode);
  return getTaskTimeSeconds(WRITING_TASK_KEYS[type] || "discussion", safeMode);
}

/**
 * 首页真题卡的两个时间标签：
 *  - timeLabel：当前档位的限时（practice → 「不限时」）
 *  - standardLabel：标准档限时（HomeTaskCard 在 challenge 档把它划线显示做对比）
 */
export function getRealBankTimeLabels(type, mode = PRACTICE_MODE.STANDARD) {
  const safeMode = normalizePracticeMode(mode);
  const isPractice = safeMode === PRACTICE_MODE.PRACTICE;

  if (isRealBankAudioType(type)) {
    const label = AUDIO_TIME_LABELS[type] || "不限时";
    return { timeLabel: isPractice ? "不限时" : label, standardLabel: label };
  }

  const standardSeconds = getRealBankTimeSeconds(type, PRACTICE_MODE.STANDARD);
  const standardLabel = formatMinutesLabel(standardSeconds);
  if (isPractice) return { timeLabel: "不限时", standardLabel };
  return { timeLabel: formatMinutesLabel(getRealBankTimeSeconds(type, safeMode)), standardLabel };
}

/** TopicPicker 头部那句话：说清「这一档是什么计时」，别再写死「不限时间」。 */
export function getRealBankModeDescription(type, mode = PRACTICE_MODE.STANDARD) {
  const safeMode = normalizePracticeMode(mode);
  if (safeMode === PRACTICE_MODE.PRACTICE) return "不限时间、自选题目。";

  if (isRealBankAudioType(type)) {
    return safeMode === PRACTICE_MODE.CHALLENGE
      ? "挑战模式：每题限时作答、音频只播一遍，与常规练习一致；自选题目。"
      : "每题限时作答、音频只播一遍，与常规练习一致；自选题目。";
  }

  const { timeLabel, standardLabel } = getRealBankTimeLabels(type, safeMode);
  return safeMode === PRACTICE_MODE.CHALLENGE
    ? `挑战模式：限时 ${timeLabel}（标准 ${standardLabel}），自选题目。`
    : `限时 ${timeLabel}，与常规练习同一计时，自选题目。`;
}

/** picker 头部小标签（TopicPicker 的 eyebrow）。 */
export function getRealBankModeEyebrow(mode = PRACTICE_MODE.STANDARD) {
  const safeMode = normalizePracticeMode(mode);
  if (safeMode === PRACTICE_MODE.CHALLENGE) return "Challenge Mode";
  if (safeMode === PRACTICE_MODE.PRACTICE) return "Practice Mode";
  return "Standard Mode";
}
