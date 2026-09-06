/**
 * 「真题专区 · 听力 / 口语」数据层契约测试。
 *
 * 数据源 data/realBank/{listening,speaking}/*.json 是 scripts/realbank/build_bank.mjs 的
 * **构建产物**（料来自 merge_vendor_asr.py 的音频转写合流），8 套之后还会继续加，
 * 所以锁的是「形状不变量」而不是具体题量。
 *
 * 最硬的一条：**用 App 真正在用的那几个 validator 跑全部产出，必须一条不落地通过**。
 * 这不是「再写一份形状断言」，而是拿生产代码当判据 —— 库里一旦躺着 App 渲染不了的题，
 * 用户点进去就是白屏/缺选项，而这在落库那一刻就该被拦住，不该等线上反馈。
 *
 * 另外两条同样是「上线前必须为真」的：
 *   · audio_url 要么是真 URL，要么是 null 且带 audio_pending —— 半个都不能少。
 *     配音脚本 render_real_audio.mjs 靠 audio_pending 找活干；
 *     前端靠 audio_url 播音。两边都对不上 = 用户点了没声音。
 *   · tier 只能是 recalled。这批是机经回忆版，不是 ETS 官方 PDF。
 */
import fs from "fs";
import path from "path";

import { validateLCR } from "../lib/listeningGen/lcrValidator";
import { validateLC } from "../lib/listeningGen/lcValidator";
import { validateLA } from "../lib/listeningGen/laValidator";
import { validateLAT } from "../lib/listeningGen/latValidator";
import { validateRepeatSet, validateInterviewSet } from "../lib/speakingGen/speakingValidator";

const L_DIR = path.join(process.cwd(), "data", "realBank", "listening");
const S_DIR = path.join(process.cwd(), "data", "realBank", "speaking");

function readBank(dir, name) {
  const p = path.join(dir, `${name}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const BANKS = {
  lcr: readBank(L_DIR, "lcr"),
  lc: readBank(L_DIR, "lc"),
  la: readBank(L_DIR, "la"),
  lat: readBank(L_DIR, "lat"),
};
const SPEAKING = {
  repeat: readBank(S_DIR, "repeat"),
  interview: readBank(S_DIR, "interview"),
};
const L_COUNTS = readBank(L_DIR, "counts");
const S_COUNTS = readBank(S_DIR, "counts");

const VALIDATORS = { lcr: validateLCR, lc: validateLC, la: validateLA, lat: validateLAT };

const items = (b) => (b && b.items) || [];
const allListening = Object.values(BANKS).flatMap(items);
const allSpeakingSets = Object.values(SPEAKING).flatMap(items);
// 落库产物还没生成时（本地没跑过 build_bank）跳过，而不是红一片。
const present = allListening.length > 0 || allSpeakingSets.length > 0;
const maybe = present ? describe : describe.skip;

maybe("真题听力：App validator 必须原样收下", () => {
  for (const type of ["lcr", "lc", "la", "lat"]) {
    test(`${type}.json 每条都通过 ${type} validator 的 schema 校验`, () => {
      const bad = [];
      for (const it of items(BANKS[type])) {
        const res = VALIDATORS[type](it);
        if (!res.valid) bad.push({ id: it.id, errors: res.errors });
      }
      expect(bad).toEqual([]);
    });
  }
});

maybe("真题口语：App validator 必须原样收下", () => {
  test("repeat.json 每套都通过 validateRepeatSet", () => {
    const bad = items(SPEAKING.repeat)
      .map((s) => ({ id: s.id, ...validateRepeatSet(s) }))
      .filter((r) => !r.valid)
      .map((r) => ({ id: r.id, errors: r.errors }));
    expect(bad).toEqual([]);
  });

  test("interview.json 每套都通过 validateInterviewSet", () => {
    const bad = items(SPEAKING.interview)
      .map((s) => ({ id: s.id, ...validateInterviewSet(s) }))
      .filter((r) => !r.valid)
      .map((r) => ({ id: r.id, errors: r.errors }));
    expect(bad).toEqual([]);
  });
});

maybe("真题听力 / 口语：音频状态", () => {
  // 一条音频单元 = 一次 TTS 合成的对象。听力是整条题，口语是每句 / 每题。
  const audioUnits = [
    ...allListening.map((it) => ({ id: it.id, u: it })),
    ...items(SPEAKING.repeat).flatMap((s) => (s.sentences || []).map((x) => ({ id: x.id, u: x }))),
    ...items(SPEAKING.interview).flatMap((s) => (s.questions || []).map((x) => ({ id: x.id, u: x }))),
  ];

  test("每个音频单元要么有真 URL，要么 audio_url=null 且 audio_pending=true", () => {
    const bad = audioUnits.filter(({ u }) => {
      const hasUrl = typeof u.audio_url === "string" && /^https?:\/\//.test(u.audio_url);
      const pending = u.audio_url === null && u.audio_pending === true;
      return !hasUrl && !pending;
    }).map(({ id, u }) => ({ id, audio_url: u.audio_url, audio_pending: u.audio_pending }));
    expect(bad).toEqual([]);
  });

  test("配好音的条目不许还留着 audio_pending（配音脚本会重复花钱重配）", () => {
    const bad = audioUnits
      .filter(({ u }) => u.audio_url && u.audio_pending)
      .map(({ id }) => id);
    expect(bad).toEqual([]);
  });

  test("本地兜底路径（/listening-audio/…）不许进库：线上 404", () => {
    const bad = audioUnits
      .filter(({ u }) => typeof u.audio_url === "string" && u.audio_url.startsWith("/"))
      .map(({ id }) => id);
    expect(bad).toEqual([]);
  });
});

maybe("真题听力 / 口语：id 空间与来源分档", () => {
  const allIds = [
    ...allListening.map((it) => it.id),
    ...allSpeakingSets.map((s) => s.id),
  ];

  test("全部带 real_ 前缀，且没有 real_real_", () => {
    expect(allIds.length).toBeGreaterThan(0);
    expect(allIds.filter((id) => !String(id).startsWith("real_"))).toEqual([]);
    expect(allIds.filter((id) => String(id).startsWith("real_real_"))).toEqual([]);
  });

  test("id 全局唯一（含口语子条目）", () => {
    const ids = [
      ...allIds,
      ...items(SPEAKING.repeat).flatMap((s) => (s.sentences || []).map((x) => x.id)),
      ...items(SPEAKING.interview).flatMap((s) => (s.questions || []).map((x) => x.id)),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("不占用个人题库的 usr_ 保留前缀", () => {
    expect(allIds.filter((id) => String(id).includes("usr_"))).toEqual([]);
  });

  test("全部标 recalled + real，一条都不许冒充 ETS 官方", () => {
    const all = [...allListening, ...allSpeakingSets];
    expect(all.every((x) => x.tier === "recalled")).toBe(true);
    expect(all.every((x) => x.real === true)).toBe(true);
    expect(all.filter((x) => x.tier === "official")).toEqual([]);
  });

  test("每条都带 source / date / source_flags（源料缺陷可追溯）", () => {
    for (const x of [...allListening, ...allSpeakingSets]) {
      expect(typeof x.source).toBe("string");
      expect(String(x.date)).toMatch(/^2026(-\d{2}-\d{2})?$/);
      expect(Array.isArray(x.source_flags)).toBe(true);
    }
  });
});

maybe("真题听力 / 口语：counts.json 镜像", () => {
  test("listening/counts.json 与四个库的实际条数一致", () => {
    expect(L_COUNTS).toEqual({
      lcr: items(BANKS.lcr).length, lc: items(BANKS.lc).length,
      la: items(BANKS.la).length, lat: items(BANKS.lat).length,
    });
  });

  test("speaking/counts.json 与两个库的实际套数一致", () => {
    expect(S_COUNTS).toEqual({
      repeat: items(SPEAKING.repeat).length,
      interview: items(SPEAKING.interview).length,
    });
  });

  test("counts.json 只有数字键（塞时间戳会让每次落库都产生无意义 diff）", () => {
    for (const c of [L_COUNTS, S_COUNTS]) {
      Object.values(c || {}).forEach((n) => expect(Number.isInteger(n)).toBe(true));
    }
  });
});

maybe("真题听力：内容不许重复（同一套音频不许出现两遍）", () => {
  const spoken = (it) => {
    if (it.conversation) return it.conversation.map((t) => t.text).join(" ");
    return it.announcement || it.transcript || it.speaker || "";
  };
  test("同题型内没有逐字相同的口播内容", () => {
    for (const [type, bank] of Object.entries(BANKS)) {
      const keys = items(bank).map((it) => spoken(it).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
      const dup = keys.filter((k, i) => k && keys.indexOf(k) !== i);
      expect({ type, dup }).toEqual({ type, dup: [] });
    }
  });
});
