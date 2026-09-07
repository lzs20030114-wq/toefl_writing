/**
 * 「真题专区」三档限时口径（lib/realBankModes.js）。
 *
 * 核心不变量：真题专区不是第 13 个题型，它的秒数必须**等于**常规练习同题型同档位的秒数
 * ——所以这里不写死数字期望，直接拿 lib/practiceMode 的源表对拍（写死会在改表时形成两份真相）。
 */

import {
  PRACTICE_MODE,
  READING_TIME_SECONDS,
  formatMinutesLabel,
  getReadingTimeSeconds,
  getTaskTimeSeconds,
} from "../lib/practiceMode";
import { LCR_SECONDS_PER_ITEM } from "../lib/listeningTiming";
import {
  getRealBankModeDescription,
  getRealBankModeEyebrow,
  getRealBankTimeLabels,
  getRealBankTimeSeconds,
  isRealBankAudioType,
} from "../lib/realBankModes";

const WRITING = [["discussion", "discussion"], ["email", "email"], ["bs", "build"]];
const READING = ["ctw", "rdl", "ap"];
const AUDIO = ["lcr", "lc", "la", "lat", "repeat", "interview"];

describe("lib/practiceMode：阅读限时表（从 app/reading/page.js 提取）", () => {
  test("三题型的标准 / 挑战秒数与历史内联表一致", () => {
    expect(READING_TIME_SECONDS).toEqual({
      ctw: { standard: 300, challenge: 240 },
      rdl: { standard: 240, challenge: 180 },
      ap: { standard: 480, challenge: 390 },
    });
  });

  test.each(READING)("%s：practice → 0，standard / challenge 走表", (type) => {
    expect(getReadingTimeSeconds(type, PRACTICE_MODE.PRACTICE)).toBe(0);
    expect(getReadingTimeSeconds(type, PRACTICE_MODE.STANDARD)).toBe(READING_TIME_SECONDS[type].standard);
    expect(getReadingTimeSeconds(type, PRACTICE_MODE.CHALLENGE)).toBe(READING_TIME_SECONDS[type].challenge);
  });

  test("未知 type / 未知 mode 都有兜底（不会返回 undefined 把倒计时喂坏）", () => {
    expect(getReadingTimeSeconds("bogus", PRACTICE_MODE.STANDARD)).toBe(300);
    expect(getReadingTimeSeconds("ctw", "bogus")).toBe(300);   // 非法 mode → standard
  });
});

describe("真题专区秒数：与常规练习同题型同档位完全一致", () => {
  test.each(WRITING)("写作 %s → getTaskTimeSeconds(%s)", (type, taskKey) => {
    [PRACTICE_MODE.STANDARD, PRACTICE_MODE.PRACTICE, PRACTICE_MODE.CHALLENGE].forEach((mode) => {
      expect(getRealBankTimeSeconds(type, mode)).toBe(getTaskTimeSeconds(taskKey, mode));
    });
  });

  test.each(READING)("阅读 %s → getReadingTimeSeconds", (type) => {
    [PRACTICE_MODE.STANDARD, PRACTICE_MODE.PRACTICE, PRACTICE_MODE.CHALLENGE].forEach((mode) => {
      expect(getRealBankTimeSeconds(type, mode)).toBe(getReadingTimeSeconds(type, mode));
    });
  });

  test.each(AUDIO)("听力 / 口语 %s：practice → 0，其余 null（组件内部按题计时）", (type) => {
    expect(isRealBankAudioType(type)).toBe(true);
    expect(getRealBankTimeSeconds(type, PRACTICE_MODE.PRACTICE)).toBe(0);
    expect(getRealBankTimeSeconds(type, PRACTICE_MODE.STANDARD)).toBeNull();
    expect(getRealBankTimeSeconds(type, PRACTICE_MODE.CHALLENGE)).toBeNull();
  });

  test("challenge 的限时严格短于 standard（写作 + 阅读）", () => {
    [...WRITING.map(([t]) => t), ...READING].forEach((type) => {
      expect(getRealBankTimeSeconds(type, PRACTICE_MODE.CHALLENGE))
        .toBeLessThan(getRealBankTimeSeconds(type, PRACTICE_MODE.STANDARD));
    });
  });

  test("未知 type 落回讨论（与页面 normalizeRealType 的兜底一致）", () => {
    expect(getRealBankTimeSeconds("bogus", PRACTICE_MODE.STANDARD)).toBe(getTaskTimeSeconds("discussion"));
  });
});

describe("真题专区卡片标签", () => {
  test("standard：讨论 10 min / 邮件 7 min / 造句 6m 50s / ctw 5 min / ap 8 min", () => {
    expect(getRealBankTimeLabels("discussion", PRACTICE_MODE.STANDARD).timeLabel).toBe("10 min");
    expect(getRealBankTimeLabels("email", PRACTICE_MODE.STANDARD).timeLabel).toBe("7 min");
    expect(getRealBankTimeLabels("bs", PRACTICE_MODE.STANDARD).timeLabel).toBe("6m 50s");
    expect(getRealBankTimeLabels("ctw", PRACTICE_MODE.STANDARD).timeLabel).toBe("5 min");
    expect(getRealBankTimeLabels("rdl", PRACTICE_MODE.STANDARD).timeLabel).toBe("4 min");
    expect(getRealBankTimeLabels("ap", PRACTICE_MODE.STANDARD).timeLabel).toBe("8 min");
  });

  test("challenge：timeLabel 变紧，standardLabel 仍是标准档（卡片划线对比用）", () => {
    expect(getRealBankTimeLabels("discussion", PRACTICE_MODE.CHALLENGE)).toEqual({
      timeLabel: "8m 30s", standardLabel: "10 min",
    });
    expect(getRealBankTimeLabels("bs", PRACTICE_MODE.CHALLENGE)).toEqual({
      timeLabel: "5m 30s", standardLabel: "6m 50s",
    });
    expect(getRealBankTimeLabels("ctw", PRACTICE_MODE.CHALLENGE)).toEqual({
      timeLabel: "4 min", standardLabel: "5 min",
    });
    expect(getRealBankTimeLabels("ap", PRACTICE_MODE.CHALLENGE)).toEqual({
      timeLabel: "6m 30s", standardLabel: "8 min",
    });
  });

  test.each([...WRITING.map(([t]) => t), ...READING, ...AUDIO])("%s：practice 一律「不限时」", (type) => {
    expect(getRealBankTimeLabels(type, PRACTICE_MODE.PRACTICE).timeLabel).toBe("不限时");
  });

  test("听力 / 口语：与首页常规练习面板同一套字符串，challenge 下不变", () => {
    const expected = {
      lcr: `${LCR_SECONDS_PER_ITEM}s/题`,
      lc: "5 min",
      la: "3 min",
      lat: "8 min",
      repeat: "3 min",
      interview: "4 min",
    };
    Object.entries(expected).forEach(([type, label]) => {
      expect(getRealBankTimeLabels(type, PRACTICE_MODE.STANDARD)).toEqual({ timeLabel: label, standardLabel: label });
      expect(getRealBankTimeLabels(type, PRACTICE_MODE.CHALLENGE)).toEqual({ timeLabel: label, standardLabel: label });
    });
  });

  test("写作 / 阅读的 standardLabel = formatMinutesLabel(标准档秒数)", () => {
    [...WRITING.map(([t]) => t), ...READING].forEach((type) => {
      const std = getRealBankTimeSeconds(type, PRACTICE_MODE.STANDARD);
      [PRACTICE_MODE.STANDARD, PRACTICE_MODE.PRACTICE, PRACTICE_MODE.CHALLENGE].forEach((mode) => {
        expect(getRealBankTimeLabels(type, mode).standardLabel).toBe(formatMinutesLabel(std));
      });
    });
  });
});

describe("真题专区 picker 文案", () => {
  test("practice 档说不限时；standard / challenge 都不许再说「不限时间」", () => {
    expect(getRealBankModeDescription("ctw", PRACTICE_MODE.PRACTICE)).toContain("不限时间");
    [...WRITING.map(([t]) => t), ...READING, ...AUDIO].forEach((type) => {
      [PRACTICE_MODE.STANDARD, PRACTICE_MODE.CHALLENGE].forEach((mode) => {
        expect(getRealBankModeDescription(type, mode)).not.toContain("不限时");
      });
    });
  });

  test("standard 说明「与常规练习同一计时」并带上具体时长", () => {
    const desc = getRealBankModeDescription("discussion", PRACTICE_MODE.STANDARD);
    expect(desc).toContain("10 min");
    expect(desc).toContain("常规练习");
  });

  test("challenge 同时给出挑战时长与标准时长", () => {
    const desc = getRealBankModeDescription("ap", PRACTICE_MODE.CHALLENGE);
    expect(desc).toContain("挑战模式");
    expect(desc).toContain("6m 30s");
    expect(desc).toContain("8 min");
  });

  test("听力 / 口语的 timed 档说「每题限时」，不编造整段秒数", () => {
    AUDIO.forEach((type) => {
      const desc = getRealBankModeDescription(type, PRACTICE_MODE.STANDARD);
      expect(desc).toContain("每题限时");
      expect(desc).toContain("音频只播一遍");
    });
  });

  test("eyebrow 随档位变（picker 头部小标签）", () => {
    expect(getRealBankModeEyebrow(PRACTICE_MODE.STANDARD)).toBe("Standard Mode");
    expect(getRealBankModeEyebrow(PRACTICE_MODE.PRACTICE)).toBe("Practice Mode");
    expect(getRealBankModeEyebrow(PRACTICE_MODE.CHALLENGE)).toBe("Challenge Mode");
    expect(getRealBankModeEyebrow(undefined)).toBe("Standard Mode");
  });
});
