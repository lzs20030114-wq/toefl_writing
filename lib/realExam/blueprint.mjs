/**
 * 2026 改后托福（TOEFL iBT 2026）整卷结构蓝图 —— 纯数据 + 纯函数，无 IO。
 *
 * 数据来源不是官方说明书，而是从 `data/realBank/` 79 套机经卷的**题号页眉**反推
 * （每道题的 id 形如 `real_lcr_121b_1_01` = 卷 121b / Module 1 / 第 1 题；卷面页眉
 * "Reading Question 21 of 35" 的 of-T 只出现过 35/15/32/15/11/12 六种，见
 * scripts/realbank/ingest_common.py VALID_TOTALS）。凡是下面写死的题号带，
 * 都能在 docs/realbank-set-blueprint.md 的证据表里找到出处。
 *
 * 四科总题数：阅读 50（M1 35 + M2 15）· 听力 47（M1 32 + M2 15）· 口语 11 · 写作 12。
 *
 * 被 scripts/realbank/assemble_sets.mjs 用来把按题型拆散的题重新装回整卷。
 */

export const BLUEPRINT_VERSION = "2026.1";

/** 题型 → 科目。 */
export const SECTION_OF = Object.freeze({
  ctw: "reading", rdl: "reading", ap: "reading",
  lcr: "listening", lc: "listening", la: "listening", lat: "listening",
  repeat: "speaking", interview: "speaking",
  bs: "writing", email: "writing", disc: "writing",
});

export const SECTIONS = Object.freeze(["reading", "listening", "speaking", "writing"]);

/**
 * 槽位（slot）= 卷面上一段连续题号 + 该段应放的题型。
 *   key      稳定键（type_起始题号）
 *   type     题型；"mcq2" 表示 2 题的 la 或 lc 都行（听力 M2 B 型末尾两段，源卷两种都见过）
 *   band     [起, 止] 题号（含）
 *   q        这一段的题数
 *   units    这一段应由几道「题库 item」组成（lcr 每 item 1 题；rdl 一段由 2~4 篇短文拼成，写成范围）
 */
const slot = (key, type, band, q, units = 1) => Object.freeze({ key, type, band, q, units });

/* ── 阅读：M1 35 题 + M2 15 题 ────────────────────────────────────────────
 * M1 有两种版式（两种在 79 套里都反复出现，见蓝图文档）：
 *   A 型：填词 1-20（2 篇×10 空）· 日常阅读 21-30（4 篇短文 2+2+3+3）· 学术 31-35（1 篇×5）
 *   B 型：填词 1-20 · 日常阅读 21-25（2 篇 2+3）· 学术 26-30 · 学术 31-35（2 篇×5）
 * M2 只有一种：填词 1-10（1 篇）· 学术 11-15（1 篇×5）。M2 没有日常阅读。
 */
export const READING = Object.freeze({
  total: 50,
  modules: {
    1: {
      total: 35,
      forms: {
        A: [
          slot("ctw_1", "ctw", [1, 10], 10),
          slot("ctw_11", "ctw", [11, 20], 10),
          slot("rdl_21", "rdl", [21, 30], 10, [2, 5]),
          slot("ap_31", "ap", [31, 35], 5),
        ],
        B: [
          slot("ctw_1", "ctw", [1, 10], 10),
          slot("ctw_11", "ctw", [11, 20], 10),
          slot("rdl_21", "rdl", [21, 25], 5, [1, 3]),
          slot("ap_26", "ap", [26, 30], 5),
          slot("ap_31", "ap", [31, 35], 5),
        ],
      },
    },
    2: {
      total: 15,
      forms: {
        A: [
          slot("ctw_1", "ctw", [1, 10], 10),
          slot("ap_11", "ap", [11, 15], 5),
        ],
      },
    },
  },
});

/* ── 听力：M1 32 题 + M2 15 题 ────────────────────────────────────────────
 * M1 一种版式：短应答 1-12（12 题）· 对话 13-18（3 段×2）· 通知 19-24（3 段×2）· 讲座 25-32（2 段×4）
 * M2 两种版式：
 *   A 型：短应答 1-3 · 对话 4-7（2 段×2）· 讲座 8-15（2 段×4）
 *   B 型：短应答 1-7 · 讲座 8-11（1 段×4）· 2 题短材料 12-13 / 14-15（通知或对话）
 */
export const LISTENING = Object.freeze({
  total: 47,
  modules: {
    1: {
      total: 32,
      forms: {
        A: [
          slot("lcr_1", "lcr", [1, 12], 12, 12),
          slot("lc_13", "lc", [13, 14], 2),
          slot("lc_15", "lc", [15, 16], 2),
          slot("lc_17", "lc", [17, 18], 2),
          slot("la_19", "la", [19, 20], 2),
          slot("la_21", "la", [21, 22], 2),
          slot("la_23", "la", [23, 24], 2),
          slot("lat_25", "lat", [25, 28], 4),
          slot("lat_29", "lat", [29, 32], 4),
        ],
      },
    },
    2: {
      total: 15,
      forms: {
        A: [
          slot("lcr_1", "lcr", [1, 3], 3, 3),
          slot("lc_4", "lc", [4, 5], 2),
          slot("lc_6", "lc", [6, 7], 2),
          slot("lat_8", "lat", [8, 11], 4),
          slot("lat_12", "lat", [12, 15], 4),
        ],
        B: [
          slot("lcr_1", "lcr", [1, 7], 7, 7),
          slot("lat_8", "lat", [8, 11], 4),
          slot("mcq2_12", "mcq2", [12, 13], 2),
          slot("mcq2_14", "mcq2", [14, 15], 2),
        ],
      },
    },
  },
});

/* ── 口语：11 题 = 听后复述 1-7（7 句）+ 模拟面试 8-11（4 问） ── */
export const SPEAKING = Object.freeze({
  total: 11,
  modules: {
    1: {
      total: 11,
      forms: {
        A: [
          slot("repeat_1", "repeat", [1, 7], 7),
          slot("interview_8", "interview", [8, 11], 4),
        ],
      },
    },
  },
});

/* ── 写作：12 题 = 造句 1-10（10 句）+ 邮件 11 + 学术讨论 12 ── */
export const WRITING = Object.freeze({
  total: 12,
  modules: {
    1: {
      total: 12,
      forms: {
        A: [
          slot("bs_1", "bs", [1, 10], 10, 10),
          slot("email_11", "email", [11, 11], 1),
          slot("disc_12", "disc", [12, 12], 1),
        ],
      },
    },
  },
});

export const EXAM_2026 = Object.freeze({ reading: READING, listening: LISTENING, speaking: SPEAKING, writing: WRITING });

/** 每套卷各题型应有的题数（配比一览；用于报告与断言）。 */
export const PER_SET_QUOTA = Object.freeze({
  // 阅读 A 型：CTW 30 空 / RDL 10 / AP 10；B 型：CTW 30 / RDL 5 / AP 15
  ctw: { items: 3, questions: 30 },
  rdl: { items: "2-5 篇", questions: "5 或 10" },
  ap: { items: "2-3 篇", questions: "10 或 15" },
  lcr: { items: 15, questions: 15 },       // 12 + 3（M2 B 型 12 + 7 = 19）
  lc: { items: "4-5 段", questions: "8-10" },
  la: { items: "3-5 段", questions: "6-10" },
  lat: { items: "3-4 段", questions: "12-16" },
  repeat: { items: 1, questions: 7 },
  interview: { items: 1, questions: 4 },
  bs: { items: 10, questions: 10 },
  email: { items: 1, questions: 1 },
  disc: { items: 1, questions: 1 },
});

/* ── id 解析 ─────────────────────────────────────────────────────────── */

const TYPES = Object.keys(SECTION_OF);

/**
 * 把题库 id 拆成 { type, slug, module, q }。
 *   real_lcr_121b_1_01           → lcr / 121b / 1 / 1
 *   real_rdl_rf0610_1_121        → rdl / rf0610 / 1 / 121  （重排版卷阅读题号带 module 百位前缀，normalizeQ 去掉）
 *   real_ap_rp0819_1001_100101   → ap / rp0819 / 1001 / 100101（拼盘，不可锚定）
 *   real_repeat_rf0610_1         → repeat / rf0610 / 1 / null
 *   bs_225_03 · bs_rf0610_1      → bs / 225 / 1 / 3
 *   email_rf0615 · disc_rf0615   → email / rf0615 / 1 / null
 * 认不出来返回 null。
 */
export function parseRealBankId(id) {
  const s = String(id || "").trim();
  if (!s) return null;
  const parts = s.split("_");
  if (parts[0] === "real") parts.shift();
  const type = parts.shift();
  if (!TYPES.includes(type)) return null;
  const slug = parts.shift();
  if (!slug) return null;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (nums.some(Number.isNaN)) return null;
  if (type === "bs") return { type, slug, module: 1, q: nums.length ? nums[0] : null };
  if (type === "email" || type === "disc") return { type, slug, module: 1, q: null };
  if (type === "repeat" || type === "interview") return { type, slug, module: 1, q: null, seq: nums[0] ?? null };
  if (nums.length < 2) return null;
  return { type, slug, module: nums[0], q: nums[1] };
}

/** 拼盘来源（国内线下拼盘卷 rp*）：题目没有卷面题号，只能当补位素材，不能当骨架。 */
export function isPoolSlug(slug) {
  return /^rp\d+/i.test(String(slug || ""));
}

/** 重排版卷（rf*）的阅读题号写成 121 / 211（module 百位前缀），归一到 1~35。 */
export function normalizeQ(q, { module } = {}) {
  if (q == null) return null;
  if (q >= 100 && q < 1000) return q % 100 || q;
  if (q >= 1000) return null; // 拼盘伪题号，无卷面意义
  if (module != null && module > 2) return null;
  return q;
}

/**
 * 阅读 M1 按位置修正题型标签：入库时 structure_set 用「材料 ≥160 词 → ap」路由，
 * 会把长篇日常阅读（邮件/文章）错标成 ap。真卷里学术段落簇只从 26 或 31（M2 从 11）起步、
 * 且一簇 5 题；起步落在 21-25 / 27-30 之间又不足 5 题的，按位置应是日常阅读。
 * 返回修正后的 type（不改原对象）。
 */
/** 日常阅读的体裁词（rdl 的 genre / 被误标 ap 的 item 的 topic 字段里出现过的）。 */
export const DAILY_GENRES = Object.freeze(new Set([
  "email", "notice", "poster", "website", "webpage", "schedule", "advertisement", "instructions", "label", "agenda",
  "flyer", "review", "article", "blog post", "social media post", "text-message chain", "membership form",
  "course description", "club schedule", "event notice", "event schedule", "transportation notice",
  "excerpt from a syllabus",
]));

export function positionType(type, { module, q, nq, genre } = {}) {
  if (type !== "ap") return type;
  // 体裁证据优先：入库时 topic 落成 email / notice / schedule 的，不管落在哪都是日常阅读
  if (genre && DAILY_GENRES.has(String(genre).trim().toLowerCase())) return "rdl";
  if (q == null) return type;
  if (module === 2) return q >= 11 && q <= 15 ? "ap" : type;
  if (module !== 1) return type;
  const legitStart = (q >= 26 && q <= 28) || (q >= 31 && q <= 33);
  if (legitStart) return "ap";
  if (q >= 21 && q <= 30 && (nq || 0) <= 3) return "rdl";
  return type;
}

/** 判定一套卷的阅读 M1 版式：有起步 26-28 的学术段落簇 → B 型；否则 A 型。 */
export function detectReadingM1Form(items) {
  const apAt26 = items.some((it) => it.module === 1 && it.type === "ap" && it.q >= 26 && it.q <= 28);
  return apAt26 ? "B" : "A";
}

/** 判定听力 M2 版式：短应答落在 4-7、或 12 题以后出现 2 题短材料 → B 型。 */
export function detectListeningM2Form(items) {
  const b = items.some((it) => it.module === 2 && (
    (it.type === "lcr" && it.q >= 4 && it.q <= 7)
    || ((it.type === "la" || it.type === "lc") && it.q >= 12)
  ));
  return b ? "B" : "A";
}

/** 取某科某 module 某版式的槽位表。 */
export function slotsFor(section, module, form = "A") {
  const mod = EXAM_2026[section]?.modules?.[module];
  if (!mod) return [];
  return mod.forms[form] || mod.forms.A || [];
}

/** 槽位是否接受该题型。 */
export function slotAccepts(slotDef, type) {
  if (slotDef.type === "mcq2") return type === "la" || type === "lc";
  return slotDef.type === type;
}

/** 题目落在哪个槽位（按起始题号 + 题型）。找不到返回 null。 */
export function findSlot(slots, type, q) {
  if (q == null) return null;
  return slots.find((s) => slotAccepts(s, type) && q >= s.band[0] && q <= s.band[1]) || null;
}

/** 一道题库 item 含几道题（ctw 按空、repeat 按句、interview 按问、其余按 questions；lcr/email/disc/bs 为 1）。 */
export function questionCount(type, item) {
  if (!item) return 0;
  if (type === "ctw") return Array.isArray(item.blanks) ? item.blanks.length : Number(item.blank_count) || 0;
  if (type === "repeat") return Array.isArray(item.sentences) ? item.sentences.length : 0;
  if (Array.isArray(item.questions)) return item.questions.length;
  return 1;
}
