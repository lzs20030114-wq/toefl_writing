/**
 * 「真题专区 · 阅读」数据层契约测试（lib/realBank.js 的 CTW / RDL / AP 三支）。
 *
 * 数据源 data/realBank/reading/*.json 是 scripts/realbank/build_bank.mjs 的**构建产物**
 * （54 套卷会持续往里加），所以这里锁的是「形状不变量」而不是具体题量：
 *
 *   1. 三类都得有题 —— 空库 = 用户点进真题阅读只看到「暂无可用题目」，等于功能没上线；
 *   2. id 带 `real_` 前缀且与写作真题 / 个人题库 id 空间互不相交（已练与历史记录不互相污染）；
 *   3. 来源分档只能是 recalled —— 这批是 2026 机经回忆版，不是 ETS 官方 PDF；
 *   4. **CTW 的 original_word 不许带尾标点**（回归测试）：CTWTask 用
 *      `original_word.length - displayed_fragment.length` 算输入框宽度和 maxLength，
 *      带着句号就多算一位，屏幕上多一条永远填不满的下划线；
 *   5. 每道选择题恰好 A–D 四个非空选项 + 合法答案键 —— RDLTask:262 硬编码渲染这四个键，
 *      少一个（实测 OCR 串栏会吃掉一个选项）正确答案就渲染不出来，用户怎么点都错。
 */

import RB_CTW from "../data/realBank/reading/ctw.json";
import RB_RDL from "../data/realBank/reading/rdl.json";
import RB_AP from "../data/realBank/reading/ap.json";
import RB_COUNTS from "../data/realBank/reading/counts.json";

import {
  getRealAPItems,
  getRealBSQuestions,
  getRealCTWItems,
  getRealDiscussionPrompts,
  getRealEmailPrompts,
  getRealRDLItems,
  isRealBankId,
  mapRealAPToPicker,
  mapRealCTWToPicker,
  mapRealRDLToPicker,
  REAL_TIER_LABELS,
} from "../lib/realBank";

const ctw = getRealCTWItems();
const rdl = getRealRDLItems();
const ap = getRealAPItems();
const mcqItems = [...rdl, ...ap];
const allReading = [...ctw, ...rdl, ...ap];

describe("真题阅读：供给", () => {
  test("CTW / RDL / AP 三类都有题（空库 = 功能没上线）", () => {
    expect(ctw.length).toBeGreaterThan(0);
    expect(rdl.length).toBeGreaterThan(0);
    expect(ap.length).toBeGreaterThan(0);
  });

  test("防御性过滤没有把整库过滤光（源文件里的条目绝大多数应当适配得了）", () => {
    // 过滤器是「适配失败整条作废」，正常情况下丢弃率应该很低；
    // 一旦 build_bank 改坏形状，这里会先于线上暴露。
    expect(ctw.length).toBe((RB_CTW.items || []).length);
    expect(rdl.length).toBe((RB_RDL.items || []).length);
    expect(ap.length).toBe((RB_AP.items || []).length);
  });

  // counts.json 是 build_bank 顺手落的「题量镜像」，专门给首页卡片用 ——
  // 首页不能 import lib/realBank（会把整个真题库打进 `/` 的 first-load chunk，实测 255→318 kB）。
  // 镜像一旦和真库对不上，用户看到的题量就是假的；忘了跑 build_bank 也会在这里先暴露。
  test("counts.json 与三个真库的实际题量一致（首页显示的数字不许失真）", () => {
    expect(RB_COUNTS).toEqual({ ctw: ctw.length, rdl: rdl.length, ap: ap.length });
  });

  test("counts.json 只有三个数字键（塞时间戳/生成信息会让每次落库都产生无意义 diff）", () => {
    expect(Object.keys(RB_COUNTS).sort()).toEqual(["ap", "ctw", "rdl"]);
    Object.values(RB_COUNTS).forEach((n) => expect(Number.isInteger(n)).toBe(true));
  });
});

describe("真题阅读：id 空间", () => {
  test("全部带 real_ 前缀，且没有 real_real_ 这种重复加前缀", () => {
    expect(allReading.length).toBeGreaterThan(0);
    expect(allReading.filter((it) => !isRealBankId(it.id))).toEqual([]);
    expect(allReading.filter((it) => it.id.startsWith("real_real_"))).toEqual([]);
  });

  test("与写作真题合并后仍然全局唯一", () => {
    const ids = [
      ...allReading.map((it) => it.id),
      ...getRealDiscussionPrompts().map((p) => p.id),
      ...getRealEmailPrompts().map((p) => p.id),
      ...getRealBSQuestions().map((q) => q.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("不占用个人题库的 usr_ 保留前缀", () => {
    expect(allReading.filter((it) => it.id.includes("usr_"))).toEqual([]);
  });
});

describe("真题阅读：来源分档诚实", () => {
  test("全部标 recalled（回忆版），一条都不许冒充 ETS 官方", () => {
    expect(allReading.every((it) => it.tier === "recalled")).toBe(true);
    expect(allReading.filter((it) => it.tier === "official")).toEqual([]);
  });

  test("每条都带 real 标记（历史 / 统计里能认出是真题）", () => {
    expect(allReading.every((it) => it.real === true)).toBe(true);
  });
});

describe("真题阅读：源料缺陷标记（source_flags）", () => {
  // build_bank.mjs 从 data/realBank/source-flags.json 给每题写入所属套次的已知缺陷。
  // 缺这个字段说明构建时没读到清单（loader 会退化成不打标），题就变成「看着干净其实没查过」。
  test("每条都带 source_flags 数组（哪怕是空数组）", () => {
    allReading.forEach((it) => {
      expect(Array.isArray(it.source_flags)).toBe(true);
    });
  });

  test("每个 flag 形状齐全，severity 只有 warn / blocking 两种", () => {
    allReading.forEach((it) => {
      it.source_flags.forEach((f) => {
        expect(typeof f.code).toBe("string");
        expect(f.code.length).toBeGreaterThan(0);
        expect(["warn", "blocking"]).toContain(f.severity);
        expect(typeof f.detail).toBe("string");
      });
    });
  });

  // 入库的题不该带 blocking —— blocking 的含义就是「这一科别入库」。
  // 真出现了，是 build_bank 的过滤漏了，不是数据的正常状态。
  test("已入库的题不带 blocking 级缺陷", () => {
    const bad = allReading
      .filter((it) => it.source_flags.some((f) => f.severity === "blocking"))
      .map((it) => `${it.id}(${it.source})`);
    expect(bad).toEqual([]);
  });
});

describe("真题阅读：CTW 形状（CTWTask 硬契约）", () => {
  test("passage / first_sentence / blanks 齐全", () => {
    ctw.forEach((it) => {
      expect(typeof it.passage).toBe("string");
      expect(it.passage.length).toBeGreaterThan(0);
      expect(it.first_sentence.length).toBeGreaterThan(0);
      expect(it.blanks.length).toBeGreaterThan(0);
      expect(it.blank_count).toBe(it.blanks.length);
    });
  });

  // 回归测试：build_bank.buildCtw 曾经直接把带标点的 token 当 original_word。
  test("original_word 不带尾标点，且以 displayed_fragment 开头（忽略大小写）", () => {
    const bad = [];
    ctw.forEach((it) => {
      it.blanks.forEach((b) => {
        if (/[.,;:!?]$/.test(b.original_word)) bad.push(`${it.id}:${b.position} 尾标点 ${b.original_word}`);
        if (!b.original_word.toLowerCase().startsWith(b.displayed_fragment.toLowerCase())) {
          bad.push(`${it.id}:${b.position} 前缀对不上 ${b.displayed_fragment}/${b.original_word}`);
        }
      });
    });
    expect(bad).toEqual([]);
  });

  test("每个空至少还剩 1 个字母要填（宽度 0 的空点不动也答不了）", () => {
    ctw.forEach((it) => {
      it.blanks.forEach((b) => {
        expect(b.original_word.length - b.displayed_fragment.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  test("position 用的是 CTWTask 的分词口径（passage.split(/\\s+/)），且严格升序", () => {
    ctw.forEach((it) => {
      const tokens = it.passage.split(/\s+/);   // ← CTWTask.renderPassage 的原话
      let prev = -1;
      it.blanks.forEach((b) => {
        expect(b.position).toBeGreaterThan(prev);
        expect(b.position).toBeLessThan(tokens.length);
        // 屏幕上那个词必须以给定前缀开头，否则用户看到的灰底字母和答案对不上。
        expect(tokens[b.position].toLowerCase().startsWith(b.displayed_fragment.toLowerCase())).toBe(true);
        prev = b.position;
      });
    });
  });
});

describe("真题阅读：选择题形状（RDLTask 硬契约）", () => {
  test("每题恰好 A–D 四个非空选项", () => {
    const bad = [];
    mcqItems.forEach((it) => {
      expect(it.questions.length).toBeGreaterThan(0);
      it.questions.forEach((q, i) => {
        const keys = Object.keys(q.options).sort();
        if (keys.join("") !== "ABCD") bad.push(`${it.id}#${i} 选项键 ${keys.join("")}`);
        keys.forEach((k) => {
          if (!String(q.options[k] || "").trim()) bad.push(`${it.id}#${i} 选项 ${k} 为空`);
        });
      });
    });
    expect(bad).toEqual([]);
  });

  test("correct_answer 必须是 A/B/C/D 之一，且 stem 非空", () => {
    mcqItems.forEach((it) => {
      it.questions.forEach((q) => {
        expect(["A", "B", "C", "D"]).toContain(q.correct_answer);
        expect(String(q.stem).trim().length).toBeGreaterThan(0);
      });
    });
  });

  test("RDL 有 text、AP 有 passage（RDLTask 渲染 item.text，AP 靠页面适配层转）", () => {
    rdl.forEach((it) => expect(String(it.text).trim().length).toBeGreaterThan(0));
    ap.forEach((it) => expect(String(it.passage).trim().length).toBeGreaterThan(0));
  });

  test("RDL 不带 variant 字段（真题不分 short/long 池，留着只会被误用）", () => {
    rdl.forEach((it) => expect("variant" in it).toBe(false));
  });

  test("没有无 ■ 标记的插入题混进来（那种题在 App 里点不出插入位）", () => {
    const suspicious = [];
    mcqItems.forEach((it) => {
      const material = it.text || it.passage || "";
      it.questions.forEach((q) => {
        const probe = [q.stem, ...Object.values(q.options)].join(" ");
        // 可见的插入位标记有两套：旧源（ETS 截图）用 ■，第二来源「重排版」用 [A]-[D]
        // 字母方括号（选项也直接写 "A. [A]"）。两种都是屏幕上看得见的定位符，用户看得见
        // 就答得了 —— 判据必须和 build_bank.hasInsertMarkers 一致，否则同一道题在落库时
        // 放行、在测试里报错。四个字母缺一个仍不算（那是 OCR 掉了标记）。
        const marked = /■/.test(material)
          || ["[A]", "[B]", "[C]", "[D]"].every((x) => material.includes(x));
        if (/insert|slot\s*\d|■/i.test(probe) && !marked) suspicious.push(`${it.id}: ${q.stem}`);
      });
    });
    expect(suspicious).toEqual([]);
  });
});

describe("真题阅读：TopicPicker 映射", () => {
  const cases = [
    ["CTW", mapRealCTWToPicker(ctw), ctw],
    ["RDL", mapRealRDLToPicker(rdl), rdl],
    ["AP", mapRealAPToPicker(ap), ap],
  ];

  test.each(cases)("%s picker item 契约齐全（id/tag/title/subtitle）", (_name, items, source) => {
    expect(items.length).toBe(source.length);
    items.forEach((it) => {
      expect(typeof it.id).toBe("string");
      expect(it.id.length).toBeGreaterThan(0);
      expect(it.tag).toBeTruthy();
      expect(it.title).toBeTruthy();
      expect(it.subtitle).toBeTruthy();
    });
  });

  test.each(cases)("%s 每张卡都标着来源分档「回忆版」", (_name, items) => {
    items.forEach((it) => expect(it.subtitle).toContain(REAL_TIER_LABELS.recalled));
  });

  test.each(cases)("%s picker id 与题目 id 同源（已练标记才对得上）", (_name, items, source) => {
    expect(items.map((it) => it.id)).toEqual(source.map((s) => s.id));
  });
});

describe("真题阅读：源文件只读", () => {
  test("映射不写回源 JSON（不注入 real/tier 字段，不改 id）", () => {
    const probes = [RB_CTW, RB_RDL, RB_AP].flatMap((bank) => (bank.items || []).slice(0, 3));
    expect(probes.length).toBeGreaterThan(0);
    probes.forEach((raw) => {
      // build_bank 本来就写了 real/tier/id，这里断言的是「值没被运行时改动」。
      expect(raw.tier).toBe("recalled");
      expect(String(raw.id).startsWith("real_real_")).toBe(false);
    });
    // 重新取一次，两次结果必须是不同的对象（说明映射返回的是副本，不是源引用）。
    const a = getRealCTWItems();
    const b = getRealCTWItems();
    if (a.length) {
      expect(a[0]).not.toBe(b[0]);
      expect(a[0]).not.toBe((RB_CTW.items || [])[0]);
      expect(a[0].blanks[0]).not.toBe((RB_CTW.items || [])[0].blanks[0]);
    }
  });
});
