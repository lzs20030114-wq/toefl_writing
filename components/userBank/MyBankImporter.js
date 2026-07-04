"use client";
// 个人题库导入器（可复用）——选题型 → 粘贴文本 / 上传图片 → AI 抽取 → 预览勾选 → 存 → 已存列表。
// 被 /my-bank 独立页（variant="page"）和首页「我的题库」section（variant="panel"，桌面+移动）共用。
// 不读 localStorage、不挂 UpgradeModal：code/tier 由父层给，升级/登录用 onRequireUpgrade/onRequireLogin 回调。
//
// 题型选择器展示全部 4 技能 12 题型（按技能分组、沿用 SECTION_ACCENTS 配色）。截至 phase 3-3，
// 12 题型已全部 live。TypeChip 仍保留 live=false 的「开发中」占位渲染分支，供未来新增题型时复用
// （新题型上线只需把 live 翻 true + 补 stored/practice/placeholder）。
import { useCallback, useEffect, useRef, useState } from "react";
import { C, FONT, Btn, SurfaceCard } from "../shared/ui";
import { SECTION_ACCENTS } from "../home/sections";

// 抽取器 key（academic/email）→ 存储/练习 type（discussion/email）。边界处映射，库里只存后者。
const TYPE_GROUPS = [
  {
    id: "writing", label: "写作", icon: "✍️", accent: SECTION_ACCENTS.writing,
    types: [
      {
        key: "academic", stored: "discussion", label: "学术讨论", en: "Academic Discussion", live: true,
        practice: "/academic-writing?mode=practice",
        placeholder: "粘贴学术讨论题文本（教授提问 + 两位同学的回复）。一次可粘多道。",
      },
      {
        key: "email", stored: "email", label: "邮件写作", en: "Write an Email", live: true,
        practice: "/email-writing?mode=practice",
        placeholder: "粘贴邮件题文本（含情景、写作要求、要点）。一次可粘多道。",
      },
      {
        key: "build", stored: "build", label: "连词成句", en: "Build a Sentence", live: true,
        practice: "/build-sentence?mode=practice",
        // 产品口径：只收「真题三件套」，**不做**「给一句话 AI 自动造题」——单题导入无 batch
        // 级多样性约束，distractor 塌陷 + 多解歧义会重演，研究已裁决砍掉（见附录 A §3）。
        placeholder: "粘贴 TOEFL 连词成句真题三件套：① A 的问句 ② B 的完整回应句 ③「/」分隔的词块条。一次可粘多道。",
      },
    ],
  },
  {
    id: "reading", label: "阅读", icon: "📖", accent: SECTION_ACCENTS.reading,
    types: [
      {
        key: "ctw", stored: "ctw", label: "单词补全", en: "Complete the Words", live: true,
        practice: "/reading?type=ctw&mode=practice",
        // 产品口径：只做「贴原文自动挖空」，**不做**「真题截图还原」——OCR 出来无 ground truth，
        // 答案键和缺口长度都不可信（研究已裁决砍掉，见附录 B CTW §a）。
        placeholder: "粘贴一段 45-120 词的英文原文（academic 段落最佳），系统会按 C-test 规则自动挖 10 个空，答案即原文。一次可粘多段。",
      },
      {
        key: "rdl", stored: "rdl", label: "日常阅读", en: "Read in Daily Life", live: true,
        // rdl 双池按题数分（2 题→short）；已存列表按每条 data.variant 覆盖此默认链接。
        practice: "/reading?type=rdl&variant=long&mode=practice",
        // 产品口径：只收「文+题」，**不做**「只给文章让 AI 出题」——价值最低、机器味风险
        // 最高，研究已裁决砍掉（见附录 B RDL §3 档 3）。答案可缺：AI 代解 + 第二考官复核。
        placeholder: "粘贴日常阅读材料（通知/邮件/传单等）和它的选择题（每题 A-D 四个选项）。没有答案也行——AI 会代解并复核。一次可粘多篇。",
      },
      {
        key: "ap", stored: "ap", label: "学术短文", en: "Academic Passage", live: true,
        practice: "/reading?type=ap&mode=practice",
        // 同上：只收「文+题」，不做 AI 出题（AP insert_text 曾出过 140 条不可作答事故）。
        placeholder: "粘贴学术短文全文（段落之间保留空行）和它的题目（每题 A-D 四个选项）。答案可缺——AI 会代解并复核。一次可粘多篇。",
      },
    ],
  },
  {
    id: "listening", label: "听力", icon: "🎧", accent: SECTION_ACCENTS.listening,
    types: [
      {
        key: "lcr", stored: "lcr", label: "选择回应", en: "Choose a Response", live: true,
        practice: "/listening?type=lcr&mode=practice",
        // 产品口径：收「口播句 + 4 选项 + 答案」机经文字（答案可缺，AI 代解+复核）。真题界面截图
        // 常只有选项没有口播句 → 会被标 invalid，引导手补口播句（见附录 C LCR §3）。保存后自动
        // 用 edge-tts 给口播句配音（免费，best-effort；失败则练习时浏览器朗读）。
        placeholder: "粘贴听力选择回应题：① 口播的那句英文 ② 四个回应选项（A-D）③ 答案（可缺，AI 会代解）。一次可粘多道。保存后自动配音。",
      },
      {
        key: "la", stored: "la", label: "听公告", en: "Announcement", live: true,
        practice: "/listening?type=la&mode=practice",
        // 产品口径：收「公告稿 + 题目」机经文字（答案可缺，AI 代解+复核）；只给公告稿不给题也行
        //（AI 抽取阶段补 main_idea/detail 各一题，answer 标 null 交 verify 复核，见附录 C LA §3）。
        // 保存后自动用 edge-tts 给公告整段配音（免费，best-effort；失败则练习时浏览器朗读）。
        placeholder: "粘贴听公告题：① 公告全文 ②（可选）题目和 A-D 选项 ③ 答案（可缺，AI 会代解）。只给公告稿也行——AI 会补出题目。一次可粘多道。保存后自动配音。",
      },
      {
        key: "lc", stored: "lc", label: "听对话", en: "Conversation", live: true,
        practice: "/listening?type=lc&mode=practice",
        // 产品口径：收「对话稿（W:/M: 或 Woman:/Man: 标记）+ 题目」机经文字（答案可缺，AI 代解+复核）；
        // 只给对话稿不给题也行（AI 补 main_idea/detail 各一题）。对话是双说话人——保存前预览逐轮显示
        // 说话人，可点击徽章在 Woman/Man 间切换以修正切分错位（见附录 C LC §5）。保存后 edge-tts 多音色
        // 配音（两位不同音色，约 1 分钟；best-effort，失败则练习时浏览器朗读带说话人前缀的兜底文本）。
        placeholder: "粘贴听对话题：① 双人对话稿（用 W:/M: 或 Woman:/Man: 标出每轮说话人）②（可选）题目和 A-D 选项 ③ 答案（可缺，AI 会代解）。只给对话稿也行——AI 会补出题目。一次可粘多道。保存后自动配音。",
      },
      {
        key: "lat", stored: "lat", label: "学术讲座", en: "Academic Talk", live: true,
        practice: "/listening?type=lat&mode=practice",
        // 产品口径：收「讲座稿 + 题目」机经文字（真题 500-800 词/6 题也能收，见附录 C LAT §3）；
        // 只给讲座稿不给题也行（AI 补 4 题，answer 标 null 交 verify 复核）。保存后 edge-tts 分段配音
        //（讲座较长，配音约 1-2 分钟；best-effort，失败则练习时浏览器朗读）。
        placeholder: "粘贴学术讲座题：① 讲座文字稿（真题 500-800 词也行）②（可选）题目和 A-D 选项 ③ 答案（可缺，AI 会代解）。只给讲座稿也行——AI 会补出题目。一次可粘多道。保存后自动配音。",
      },
    ],
  },
  {
    id: "speaking", label: "口语", icon: "🗣️", accent: SECTION_ACCENTS.speaking,
    types: [
      {
        key: "repeat", stored: "repeat", label: "听后复述", en: "Listen & Repeat", live: true,
        practice: "/speaking?type=repeat&mode=practice",
        placeholder: "粘贴 3-7 句英文句子（一行一句或一段混排都行），会打包成一套复述题。一次一批。",
      },
      {
        key: "interview", stored: "interview", label: "模拟面试", en: "Take an Interview", live: true,
        practice: "/speaking?type=interview&mode=practice",
        placeholder: "粘贴 1-4 个英文面试问题（一行一个），会打包成一套面试题。一次一批。",
      },
    ],
  },
];

const ALL_TYPES = TYPE_GROUPS.flatMap((g) => g.types);
const LIVE_TYPES = ALL_TYPES.filter((t) => t.live);
const groupOfType = (t) => TYPE_GROUPS.find((g) => g.types.includes(t));
const groupOfStored = (stored) => TYPE_GROUPS.find((g) => g.types.some((t) => t.stored === stored));

// Per-type hint for greyed-out (invalid) preview rows.
const INVALID_HINT = {
  academic: "教授提问 + 至少 2 位同学",
  email: "情景/要求/至少 3 个要点",
  repeat: "英文句子 3-25 词",
  interview: "英文问题 10-60 词",
  build: "问句 + 回应句 + 词块（且服务端校验通过）",
  rdl: "材料原文 + 至少 1 道 A-D 选项齐全的题",
  ap: "文章全文 + A-D 选项齐全的题目",
  ctw: "45-120 词英文原文（能挖出 10 个空）",
  lcr: "口播句 + A-D 四个回应选项",
  la: "公告全文 + 至少 1 道 A-D 选项齐全的题",
  lat: "讲座全文 + 至少 1 道 A-D 选项齐全的题",
  lc: "双人对话稿（≥4 轮、两位说话人）+ 至少 1 道 A-D 选项齐全的题",
};

const BD = C.bd2 || "#e2e8f0";
const ACCEPT = "image/png,image/jpeg,image/webp";
const CLIENT_MAX_BYTES = 25 * 1024 * 1024; // 下采样前的粗筛上限，防 canvas OOM
const MAX_IMAGES = 3; // 与 /api/user-bank/extract-image 一致（AP 常跨 2-3 张截图）
const CLIENT_TOTAL_UPLOAD_BYTES = Math.floor(3.8 * 1024 * 1024); // 服务端合计 4MB，客户端留余量预检

// 阅读 MCQ 题型（rdl/ap）：预览带逐题答案选择器 + verify 复核徽章。
const READING_KEYS = new Set(["rdl", "ap"]);
// 听力选择回应（lcr）：一条即一题（speaker + options + answer），复用「答案选择器 + verify 徽章」
// 预览与 packaging，但形状是单题。
const LCR_KEYS = new Set(["lcr"]);
// 听力多题 MCQ（la 听公告 / lat 学术讲座）：announcement/transcript + questions[]（每题答案在
// q.answer，不是 reading 的 q.correct_answer）。复用 reading 的多题答案选择器/verify 徽章/packaging。
const LISTENING_MCQ_KEYS = new Set(["la", "lat"]);
// 听对话（lc）：双说话人 conversation[] + 多题 MCQ（答案同样在 q.answer）。题目部分与 la/lat 同构
// （itemQuestions/答案选择器/verify/packaging 全复用），但有 LC 特供的逐轮说话人预览 UI。
const LC_KEYS = new Set(["lc"]);
// 需保存后自动配音的听力题型（lcr 口播句 / la 公告 / lat 讲座 / lc 对话多音色）。
const AUDIO_KEYS = new Set([...LCR_KEYS, ...LISTENING_MCQ_KEYS, ...LC_KEYS]);
// VERIFY_KEYS = 需要跑 /api/user-bank/verify 的全部题型。
const VERIFY_KEYS = new Set([...READING_KEYS, ...LCR_KEYS, ...LISTENING_MCQ_KEYS, ...LC_KEYS]);

// 归一化取「小题列表」：rdl/ap 是 q.questions[]（答案 correct_answer）；lcr 单题→包成 1 元素数组
// （stem=口播句）；la/lat 多题→把 q.answer 归一化成 correct_answer，让答案选择器 / effectiveAnswer /
// verify 徽章走同一套下标逻辑（i=item, j=小题）。packaging 时再写回 answer。
function itemQuestions(typeKey, q) {
  if (LCR_KEYS.has(typeKey)) {
    if (!q) return [];
    return [{ stem: q.speaker, options: q.options, correct_answer: q.answer }];
  }
  if (LISTENING_MCQ_KEYS.has(typeKey) || LC_KEYS.has(typeKey)) {
    // la/lat announcement/lecture 多题 + lc 对话多题：答案字段都是 q.answer（归一成 correct_answer
    // 让答案选择器/effectiveAnswer/verify 徽章走同一套下标逻辑；packaging 时再写回 answer）。
    return (Array.isArray(q?.questions) ? q.questions : []).map((qq) => ({
      ...qq, correct_answer: qq?.answer,
    }));
  }
  return Array.isArray(q?.questions) ? q.questions : [];
}

// CTW 预览：所见即所练——直接用服务端机械挖空产出的 blanked_text；缺时按 blanks 现算一份
//（position=全局词索引；缺口=original_word.length-fragment.length，与 CTWTask.js:111 同口径）。
function ctwBlankedText(q) {
  if (q?.blanked_text && String(q.blanked_text).trim()) return String(q.blanked_text);
  const passage = String(q?.passage || "");
  const blanks = Array.isArray(q?.blanks) ? q.blanks : [];
  if (!passage || blanks.length === 0) return passage;
  const byPos = new Map(blanks.map((b) => [b.position, b]));
  return passage.split(/\s+/).map((word, wi) => {
    const b = byPos.get(wi);
    if (!b) return word;
    const frag = String(b.displayed_fragment || "");
    const missing = Math.max(0, String(b.original_word || "").length - frag.length);
    const trailing = word.match(/[.,;:!?]+$/)?.[0] || "";
    return frag + "_".repeat(missing) + trailing;
  }).join(" ");
}
const ANSWER_KEYS = ["A", "B", "C", "D"];
function normAnswer(v) {
  const s = String(v == null ? "" : v).trim().toUpperCase();
  return ANSWER_KEYS.includes(s) ? s : null;
}

// 与 WritingTask 的 normalize 最小要求一致——不满足的条目入库后会开成「已下线」，故导入时就拦掉。
function isValidAcademic(q) {
  const students = Array.isArray(q?.students) ? q.students.filter((s) => s?.name && s?.text) : [];
  return !!(q?.professor?.name && q?.professor?.text && students.length >= 2);
}
function isValidEmail(q) {
  const goals = Array.isArray(q?.goals) ? q.goals.filter(Boolean) : [];
  return !!(q?.scenario && q?.direction && goals.length >= 3);
}
function countWords(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}
// Speaking: per-item validity mirrors the server post-processors' word bands.
function isValidRepeat(q) {
  const n = countWords(q?.sentence);
  return !!(q?.sentence && String(q.sentence).trim()) && n >= 3 && n <= 25;
}
function isValidInterview(q) {
  const n = countWords(q?.question);
  return !!(q?.question && String(q.question).trim()) && n >= 10 && n <= 60;
}
// Build: the server (validateBuildForImport) is the authority — it runs the word-bag /
// schema-fatal gate and stamps q.invalid on failure. The client just trusts that flag +
// checks the basic fields are present (so a partial AI response can't slip through).
function isValidBuild(q) {
  return q?.invalid !== true &&
    !!(q?.answer && String(q.answer).trim()) &&
    Array.isArray(q?.chunks) && q.chunks.length >= 2 &&
    !!(q?.prompt && String(q.prompt).trim());
}
// Reading (rdl/ap): the server post-processors are the authority (schema gate stamps
// q.invalid + Chinese reason). Client re-checks the basics so a partial AI response can't
// slip through. NOTE: answers may still be null here — resolving every question's answer
// (用户点选 / 抽取自带 / verify 代解) is enforced at SAVE time, not here.
function isValidReading(q) {
  const body = String(q?.text || q?.passage || "").trim();
  const questions = Array.isArray(q?.questions) ? q.questions : [];
  return q?.invalid !== true && !!body && questions.length > 0 &&
    questions.every((qq) =>
      qq && String(qq.stem || "").trim() && qq.options &&
      ANSWER_KEYS.every((k) => String(qq.options[k] || "").trim()));
}
// CTW: the server (postProcessCtw) is the authority — it runs cTestBlanker + word-count gate and
// stamps q.invalid on failure. The client trusts that flag + checks the mechanically-produced
// passage/blanks are present (so a partial response can't slip through). NOTE: 挖空是纯机械代码，
// 答案=原文，所以没有 rdl/ap 那种「答案待解」环节——预览即所练。
function isValidCtw(q) {
  return q?.invalid !== true &&
    !!(q?.passage && String(q.passage).trim()) &&
    Array.isArray(q?.blanks) && q.blanks.length >= 1;
}
// LCR: server (postProcessLcr) stamps q.invalid on schema failure. Client re-checks the
// essentials — speaker + complete A-D options present (so a partial AI response can't slip
// through). NOTE: like reading, the ANSWER may still be null here; it's enforced at SAVE time
// (用户点选 / 抽取自带 / verify AI 代解).
function isValidLcr(q) {
  const opts = q?.options && typeof q.options === "object" ? q.options : null;
  return q?.invalid !== true &&
    !!(q?.speaker && String(q.speaker).trim()) && !!opts &&
    ANSWER_KEYS.every((k) => String(opts[k] || "").trim());
}
// LA/LAT: server (postProcessLa/Lat) stamps q.invalid on schema failure. Client re-checks the
// essentials — announcement/transcript present + ≥1 question with complete A-D options. NOTE: the
// ANSWER may still be null here; it's enforced at SAVE time (点选 / 抽取自带 / verify AI 代解).
function isValidListeningMcq(q) {
  const body = String(q?.announcement || q?.transcript || "").trim();
  const questions = Array.isArray(q?.questions) ? q.questions : [];
  return q?.invalid !== true && !!body && questions.length > 0 &&
    questions.every((qq) =>
      qq && String(qq.stem || "").trim() && qq.options &&
      ANSWER_KEYS.every((k) => String(qq.options[k] || "").trim()));
}
// LC: server (postProcessLc) stamps q.invalid on schema failure. Client re-checks the essentials —
// exactly 2 speakers each with a gender, ≥4 conversation turns (each with a valid speaker + text),
// and ≥1 question with complete A-D options. NOTE: the ANSWER may still be null here; it's enforced
// at SAVE time (点选 / 抽取自带 / verify AI 代解).
function isValidLc(q) {
  if (q?.invalid === true) return false;
  const speakers = Array.isArray(q?.speakers) ? q.speakers : [];
  if (speakers.length !== 2) return false;
  if (!speakers.every((s) => s && String(s.name || "").trim() &&
    ["female", "male"].includes(String(s.gender).toLowerCase()))) return false;
  const names = new Set(speakers.map((s) => String(s.name).trim()));
  const turns = Array.isArray(q?.conversation) ? q.conversation : [];
  if (turns.length < 4) return false;
  if (!turns.every((t) => t && String(t.text || "").trim() && names.has(String(t.speaker || "").trim()))) return false;
  const questions = Array.isArray(q?.questions) ? q.questions : [];
  return questions.length > 0 && questions.every((qq) =>
    qq && String(qq.stem || "").trim() && qq.options &&
    ANSWER_KEYS.every((k) => String(qq.options[k] || "").trim()));
}
function isValid(typeKey, q) {
  if (typeKey === "email") return isValidEmail(q);
  if (typeKey === "repeat") return isValidRepeat(q);
  if (typeKey === "interview") return isValidInterview(q);
  if (typeKey === "build") return isValidBuild(q);
  if (typeKey === "ctw") return isValidCtw(q);
  if (LCR_KEYS.has(typeKey)) return isValidLcr(q);
  if (LC_KEYS.has(typeKey)) return isValidLc(q);
  if (LISTENING_MCQ_KEYS.has(typeKey)) return isValidListeningMcq(q);
  if (READING_KEYS.has(typeKey)) return isValidReading(q);
  return isValidAcademic(q);
}

// 客户端下采样：手机截图常 8-12MB，直接传必超 Vercel body(~4.5MB)。压到长边 ≤1600、jpeg 0.85。
async function downscaleImage(file, maxDim = 1600, quality = 0.85) {
  if (typeof document === "undefined") return file;
  try {
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = dataUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    return blob || file;
  } catch {
    return file; // 压缩失败退回原图，让服务端 magic-byte/size 兜底
  }
}

/* ── 题型卡片 ── */
function TypeChip({ type, accent, selected, onSelect }) {
  const [hover, setHover] = useState(false);
  const live = type.live;
  return (
    <button
      disabled={!live}
      onClick={() => live && onSelect(type.key)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-pressed={live ? selected : undefined}
      style={{
        display: "flex", flexDirection: "column", gap: 3,
        padding: "10px 12px", borderRadius: 10, textAlign: "left",
        fontFamily: FONT, transition: "all .15s", position: "relative",
        border: `1.5px solid ${selected ? accent.color : hover && live ? accent.color + "66" : live ? BD : C.bdrSubtle}`,
        background: selected ? accent.soft : live ? "#fff" : "#f8fafb",
        opacity: live ? 1 : 0.58,
        cursor: live ? "pointer" : "not-allowed",
        boxShadow: selected ? `0 1px 6px ${accent.color}22` : "none",
      }}
    >
      {/* 首行只放中文名（+选中✓），保证 3-4 字名字不被截断；徽章放次行英文名旁 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{
          flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700,
          color: selected ? accent.color : live ? C.t1 : C.t2,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {type.label}
        </span>
        {live && selected && <span style={{ fontSize: 12, fontWeight: 800, color: accent.color, flexShrink: 0 }}>✓</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {type.en}
        </span>
        {!live && (
          <span style={{
            fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 999,
            background: "#eef1f4", color: "#8b95a1", flexShrink: 0, letterSpacing: 0.3,
          }}>
            开发中
          </span>
        )}
      </div>
    </button>
  );
}

/* ── 阅读题逐题复核徽章（fail-open 的可视化）──
   ✓复核一致（AI 独立作答=用户答案）/ ⚠不一致（预览里点选裁决，不静默改）/
   AI 代解（用户没贴答案，答案由 verify 填补）/ 未复核（verify 失败或超时，仍可手动点选保存）。 */
function VerifyBadge({ state, result }) {
  let bg = "#eef1f4", color = "#8b95a1", label = "未复核";
  if (state === "pending") {
    label = "复核中…";
  } else if (state === "done" && result) {
    if (result.verdict === "ok") { bg = "#F0FDF4"; color = "#059669"; label = "✓ 复核一致"; }
    else if (result.verdict === "mismatch") { bg = "#FFFBEB"; color = "#B45309"; label = "⚠ 不一致"; }
    else if (result.verdict === "ai_answered") { bg = "#EFF6FF"; color = "#2563EB"; label = "AI 代解"; }
  }
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
      background: bg, color, marginLeft: 6, whiteSpace: "nowrap", verticalAlign: "middle",
    }}>
      {label}
    </span>
  );
}

export default function MyBankImporter({ code, tier, onRequireUpgrade, onRequireLogin, variant = "panel" }) {
  const [typeKey, setTypeKey] = useState("academic");
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [parsed, setParsed] = useState(null); // null | array
  const [parsedSource, setParsedSource] = useState("paste");
  const [selected, setSelected] = useState(() => new Set());
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  // 阅读题（rdl/ap）复核态：verifyMap[itemIdx] = {status:'pending'|'done'|'failed', results?}；
  // answerPick[`${itemIdx}:${qIdx}`] = 用户在预览里点选的答案（裁决/手动补答案）。
  // verifyGenRef 防串台：换题型/重新抽取后，旧一代 verify worker 的迟到结果直接丢弃。
  const [verifyMap, setVerifyMap] = useState({});
  const [answerPick, setAnswerPick] = useState({});
  const verifyGenRef = useRef(0);

  // 听力配音态（保存后自动为每条 LCR 调 /api/user-bank/render-audio，串行）。
  // audioMsg = 顶部一行进度文案（配音中… / ✓ 已配音 N 条 / ⚠ M 条将用浏览器朗读）。best-effort。
  const [audioMsg, setAudioMsg] = useState("");

  const [list, setList] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  const tab = LIVE_TYPES.find((t) => t.key === typeKey) || LIVE_TYPES[0];
  const tabAccent = groupOfType(tab)?.accent || SECTION_ACCENTS.writing;
  const looksPro = tier === "pro" || tier === "legacy";
  const busy = parsing || imgBusy;
  const pad = variant === "panel" ? 18 : 22;

  const loadList = useCallback(async (c) => {
    if (!c) return;
    setListLoading(true);
    try {
      const res = await fetch(`/api/user-bank?code=${encodeURIComponent(c)}`);
      const json = await res.json();
      setList(json?.ok && Array.isArray(json.items) ? json.items : []);
    } catch {
      setList([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (code) loadList(code);
    else setList([]);
  }, [code, loadList]);

  function selectType(key) {
    if (key === typeKey) return;
    setTypeKey(key);
    setParsed(null);
    setSelected(new Set());
    setErr("");
    setSavedMsg("");
    verifyGenRef.current += 1; // 淘汰在途 verify worker
    setVerifyMap({});
    setAnswerPick({});
  }

  // 每题的「生效答案」：用户点选 > 抽取自带（用户材料里的答案键）> verify 的 AI 代解。
  // 三者皆无 → null（保存前必须解决：等复核或手动点选）。
  // 归一化取答案：rdl/ap 从 questions[j].correct_answer；lcr 单题从 item.answer（itemQuestions 已归一）。
  function effectiveAnswer(i, j) {
    const picked = answerPick[`${i}:${j}`];
    if (picked) return picked;
    const own = normAnswer(itemQuestions(typeKey, parsed?.[i])[j]?.correct_answer);
    if (own) return own;
    const vr = verifyMap[i];
    const r = vr?.status === "done" ? (vr.results || [])[j] : null;
    return normAnswer(r?.ai_answer);
  }

  // 抽取成功后对每个有效阅读 item 自动调 /api/user-bank/verify（并发 ≤2，逐题更新徽章）。
  // fail-open：单个 item 复核失败只标「未复核」，不打断其他 item、不阻塞保存。
  async function runVerifyAll(items, tKey) {
    const gen = ++verifyGenRef.current;
    const indices = items.map((_, i) => i).filter((i) => isValid(tKey, items[i]));
    setVerifyMap(Object.fromEntries(indices.map((i) => [i, { status: "pending" }])));
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const at = cursor;
        cursor += 1;
        if (at >= indices.length) return;
        const i = indices[at];
        let next = { status: "failed" };
        try {
          const res = await fetch("/api/user-bank/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userCode: code, type: tKey, item: items[i] }),
          });
          const json = await res.json().catch(() => ({}));
          if (res.ok && json?.ok && Array.isArray(json.results)) {
            next = { status: "done", results: json.results };
          }
        } catch {
          /* keep failed → 未复核 */
        }
        if (verifyGenRef.current !== gen) return; // 已被新一轮抽取/换题型取代
        setVerifyMap((prev) => ({ ...prev, [i]: next }));
      }
    };
    await Promise.all([worker(), worker()]);
  }

  // 抽取结果落到同一预览态（粘贴 / 图片共用）。
  function applyExtracted(questions) {
    setParsed(questions);
    const next = new Set();
    questions.forEach((q, i) => { if (isValid(typeKey, q)) next.add(i); });
    setSelected(next);
    setVerifyMap({});
    setAnswerPick({});
    if (VERIFY_KEYS.has(typeKey)) {
      runVerifyAll(questions, typeKey); // fire-and-forget（内部逐 item 兜错；lcr 也走）
    }
  }

  // 统一消费 /extract 与 /extract-image 的返回；null = 已处理错误/需升级，调用方停手。
  function consumeExtract(res, json) {
    if (!res.ok || !json?.ok) {
      if (json?.code === "PRO_REQUIRED") { onRequireUpgrade?.(); return null; }
      if (json?.code === "DAILY_LIMIT" || json?.code === "PRO_DAILY_CAP") { setErr(json.error || "今日额度已用完"); return null; }
      setErr(json?.error || "抽取失败，请稍后重试");
      return null;
    }
    const questions = Array.isArray(json.questions) ? json.questions : [];
    if (questions.length === 0) { setErr("没能识别出题目，换一段文字 / 换张更清晰的图试试？"); return null; }
    return questions;
  }

  async function handleParse() {
    setErr("");
    setSavedMsg("");
    setParsed(null);
    if (!text.trim()) { setErr("请先粘贴题目文本"); return; }
    if (!code) { setErr("请先登录"); return; }
    setParsing(true);
    try {
      const res = await fetch("/api/user-bank/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: typeKey, text: text.trim(), userCode: code }),
      });
      const json = await res.json();
      const questions = consumeExtract(res, json);
      if (!questions) return;
      setParsedSource("paste");
      applyExtracted(questions);
    } catch {
      setErr("网络错误，请稍后重试");
    } finally {
      setParsing(false);
    }
  }

  // 多图上传（1-3 张）：AP 学术短文一屏装不下，文章+题目常 2-3 张截图。
  // 单图路径不变（长度 1 的数组）；逐张下采样后合计超限则提示。
  async function handleImageFiles(fileList) {
    setErr("");
    setSavedMsg("");
    setParsed(null);
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length === 0) return;
    if (!code) { setErr("请先登录"); return; }
    if (files.length > MAX_IMAGES) { setErr(`一次最多 ${MAX_IMAGES} 张图片（长材料可按顺序分屏截图）`); return; }
    for (const f of files) {
      if (!/^image\//.test(f.type)) { setErr("请选择图片文件（PNG / JPEG / WebP）"); return; }
      if (f.size > CLIENT_MAX_BYTES) { setErr("图片过大，请选小一点的截图"); return; }
    }
    setImgBusy(true);
    try {
      const blobs = [];
      let total = 0;
      for (const f of files) {
        const b = await downscaleImage(f);
        total += b?.size || 0;
        blobs.push(b);
      }
      if (total > CLIENT_TOTAL_UPLOAD_BYTES) {
        setErr("图片合计过大（压缩后仍超限），请减少张数或截小一点");
        return;
      }
      const fd = new FormData();
      fd.append("type", typeKey);
      fd.append("userCode", code);
      blobs.forEach((b, i) => fd.append("image", b, `upload-${i + 1}.jpg`));
      const res = await fetch("/api/user-bank/extract-image", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503) { setErr(json?.error || "图片识别暂未开通，请改用粘贴文本"); return; }
      const questions = consumeExtract(res, json);
      if (!questions) return;
      setParsedSource("image");
      applyExtracted(questions);
    } catch {
      setErr("图片处理失败，请重试或改用粘贴文本");
    } finally {
      setImgBusy(false);
    }
  }

  function toggle(i) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  // LC 特供：点击某轮的说话人徽章，在两位说话人之间循环切换该轮归属。这是修正「说话人切分错位」
  // （切错一轮会导致配音音色错乱）的唯一交互——点徽章循环，不做拖拽/重排（保持轻量）。改动直接落到
  // parsed[i].conversation[turnIdx].speaker，保存/配音都读它。isValidLc 会随之重算（每轮 speaker 必须
  // ∈ speakers 名单），所以切换不会切出名单外的名字。
  function cycleTurnSpeaker(i, turnIdx) {
    setParsed((prev) => {
      if (!Array.isArray(prev)) return prev;
      const item = prev[i];
      const speakers = Array.isArray(item?.speakers) ? item.speakers : [];
      const turns = Array.isArray(item?.conversation) ? item.conversation : [];
      if (speakers.length !== 2 || !turns[turnIdx]) return prev;
      const names = speakers.map((s) => String(s.name || "").trim()).filter(Boolean);
      if (names.length !== 2) return prev;
      const cur = String(turns[turnIdx].speaker || "").trim();
      const idx = names.indexOf(cur);
      const nextName = names[(idx + 1) % names.length] || names[0]; // 名单外/未知 → 归到第一位
      const nextTurns = turns.map((t, ti) => (ti === turnIdx ? { ...t, speaker: nextName } : t));
      const nextItem = { ...item, conversation: nextTurns };
      const next = prev.slice();
      next[i] = nextItem;
      return next;
    });
  }

  // Per-type save packaging.
  //  writing (academic/email) & build & reading (rdl/ap): one DB item per question/passage.
  //  repeat/interview: bundle ALL chosen items into ONE "set" DB item, because the
  //  speaking bank's unit is a set (RepeatTask/InterviewTask consume an array).
  function packItems(typeKey, chosen, chosenIdx) {
    if (READING_KEYS.has(typeKey)) {
      // One DB item per passage. Strip preview-only advisory fields; resolve every question's
      // correct_answer（用户点选 > 抽取自带 > verify AI 代解——handleSave 已保证全部可解）；
      // 原材料没有解析时，用 verify 的 reasoning 回填 explanation（RDLTask 提交后会展示）。
      return chosenIdx.map((i) => {
        const { warnings: _w, invalid: _i, invalid_reason: _ir, ...bank } = parsed[i];
        const vr = verifyMap[i];
        const questions = (parsed[i].questions || []).map((qq, j) => {
          const r = vr?.status === "done" ? (vr.results || [])[j] : null;
          const { explanation: _e, ...qBase } = qq || {};
          const explanation = String(qq?.explanation || "").trim() || String(r?.explanation || "").trim();
          return {
            ...qBase,
            correct_answer: effectiveAnswer(i, j),
            ...(explanation ? { explanation } : {}),
          };
        });
        // rdl 的 variant 服务端 postProcess 已按题数派生；这里兜底补齐（保存前补的口径）。
        const extra = typeKey === "rdl" && !bank.variant
          ? { variant: questions.length === 2 ? "short" : "long" }
          : {};
        return { data: { ...bank, ...extra, questions } };
      });
    }
    if (typeKey === "build") {
      // One item per question (like writing). Strip the preview-only advisory fields
      // (warnings/ambiguous/invalid/invalid_reason) so the stored bank item stays canonical.
      return chosen.map(({ warnings: _w, ambiguous: _a, invalid: _i, invalid_reason: _ir, ...bankFields }) => ({
        data: bankFields,
      }));
    }
    if (typeKey === "ctw") {
      // One item per passage. The bank item was produced by the server (cTestBlanker) already —
      // just strip the preview-only advisory fields so the stored item is the canonical bank shape.
      return chosen.map(({ warnings: _w, invalid: _i, invalid_reason: _ir, ...bankFields }) => ({
        data: bankFields,
      }));
    }
    if (LISTENING_MCQ_KEYS.has(typeKey) || LC_KEYS.has(typeKey)) {
      // One DB item per announcement/lecture/conversation. Resolve every question's answer（点选 >
      // 抽取自带 > verify AI 代解——handleSave 已保证全部可解）写回 q.answer（听力题答案字段是 answer，
      // 不是 reading 的 correct_answer）；缺解析时用 verify reasoning 回填 explanation。strip 预览专用
      // 字段 + audio_url（audio 由 render-audio 服务端 mint，security patch A）。LC 的 speakers/conversation
      // 由 ...bank 原样保留（含用户在预览里改过的每轮 speaker）。
      return chosenIdx.map((i) => {
        const { warnings: _w, invalid: _iv, invalid_reason: _ir, audio_url: _au, ...bank } = parsed[i];
        const vr = verifyMap[i];
        const questions = (parsed[i].questions || []).map((qq, j) => {
          const r = vr?.status === "done" ? (vr.results || [])[j] : null;
          const { explanation: _e, correct_answer: _ca, ...qBase } = qq || {};
          const explanation = String(qq?.explanation || "").trim() || String(r?.explanation || "").trim();
          return {
            ...qBase,
            answer: effectiveAnswer(i, j),
            ...(explanation ? { explanation } : {}),
          };
        });
        return { data: { ...bank, questions } };
      });
    }
    if (LCR_KEYS.has(typeKey)) {
      // One DB item per LCR question. Resolve the answer (点选 > 抽取自带 > AI 代解——handleSave
      // 已保证可解), backfill explanation from verify reasoning when the source had none, and
      // strip preview-only advisory fields. audio_url is NEVER sent from the client (server strips
      // it anyway, security patch A) — it's minted by /api/user-bank/render-audio after save.
      return chosenIdx.map((i) => {
        const { warnings: _w, invalid: _i, invalid_reason: _ir, audio_url: _au, ...bank } = parsed[i];
        const vr = verifyMap[i];
        const r = vr?.status === "done" ? (vr.results || [])[0] : null;
        const explanation = String(parsed[i]?.explanation || "").trim() || String(r?.explanation || "").trim();
        return {
          data: {
            ...bank,
            answer: effectiveAnswer(i, 0),
            ...(explanation ? { explanation } : {}),
          },
        };
      });
    }
    if (typeKey === "repeat") {
      return [{
        data: {
          scenario: "我的导入",
          sentences: chosen.map((q) => ({
            sentence: String(q.sentence || "").trim(),
            word_count: q.word_count,
            difficulty: q.difficulty || "medium",
            ...(q.timing_seconds != null ? { timing_seconds: q.timing_seconds } : {}),
          })),
        },
      }];
    }
    if (typeKey === "interview") {
      return [{
        data: {
          topic: parsed?.[0]?.topic || "我的面试题",
          questions: chosen.map((q, i) => ({
            position: `Q${i + 1}`,
            question: String(q.question || "").trim(),
            word_count: q.word_count,
            ...(q.difficulty ? { difficulty: q.difficulty } : {}),
          })),
        },
      }];
    }
    return chosen.map((q) => ({ data: q }));
  }

  // 保存成功后串行为每条听力题配音（edge-tts）。best-effort：整体 try/catch，单条失败继续；
  // 顶部一行状态徽章：配音中… → ✓ 已配音 N 条（失败的 M 条练习时会用浏览器朗读）。
  async function renderAudioForSaved(savedItems) {
    const ids = savedItems.map((it) => it.item_id).filter(Boolean);
    if (ids.length === 0) { setAudioMsg(""); return; }
    setAudioMsg(`配音中…（0/${ids.length}）`);
    let done = 0;
    let ok = 0;
    for (const itemId of ids) {
      try {
        const res = await fetch("/api/user-bank/render-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userCode: code, itemId }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json?.ok && json.audio_url) ok += 1;
      } catch {
        /* best-effort：失败=练习时浏览器朗读 */
      }
      done += 1;
      setAudioMsg(`配音中…（${done}/${ids.length}）`);
    }
    const failed = ids.length - ok;
    setAudioMsg(
      failed === 0
        ? `✓ 已为 ${ok} 道配音`
        : `✓ 已配音 ${ok} 道 · ⚠ ${failed} 道将用浏览器朗读（配音失败不影响练习）`
    );
  }

  async function handleSave() {
    setErr("");
    setSavedMsg("");
    setAudioMsg("");
    if (!parsed) return;
    const chosenIdx = [...selected].sort((a, b) => a - b).filter((i) => isValid(typeKey, parsed[i]));
    const chosen = chosenIdx.map((i) => parsed[i]);
    if (chosen.length === 0) { setErr("没有可保存的题（被选中的题缺少必要字段）"); return; }
    // MCQ 题（阅读 rdl/ap + 听力 lcr）：每小题必须有生效答案（判分依赖 correct_answer/answer，
    // 缺失会把用户永远判错）。verify fail-open 不阻塞保存的前提是用户可手动点选补齐——这里就是那道闸。
    if (VERIFY_KEYS.has(typeKey)) {
      const unresolved = chosenIdx.some((i) =>
        itemQuestions(typeKey, parsed[i]).some((_, j) => !effectiveAnswer(i, j))
      );
      if (unresolved) {
        setErr("还有题未确定答案：等 AI 复核完成，或在预览里点选正确答案（A-D）后再保存。");
        return;
      }
    }
    const isSpeaking = typeKey === "repeat" || typeKey === "interview";
    setSaving(true);
    try {
      const res = await fetch("/api/user-bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          type: tab.stored,
          source: parsedSource,
          items: packItems(typeKey, chosen, chosenIdx),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        if (json?.code === "PRO_REQUIRED") { onRequireUpgrade?.(); return; }
        setErr(json?.error || "保存失败");
        return;
      }
      const n = Array.isArray(json.items) ? json.items.length : 0;
      setSavedMsg(isSpeaking
        ? `已存入「我的题库」1 套（${chosen.length} ${typeKey === "repeat" ? "句" : "问"}），去练习页即可练。`
        : `已存入「我的题库」${n} 道，去练习页即可练。`);
      setParsed(null);
      setSelected(new Set());
      setText("");
      verifyGenRef.current += 1;
      setVerifyMap({});
      setAnswerPick({});
      loadList(code);
      // 听力题（lcr/la/lat/lc）：保存成功后自动为每条配音（edge-tts，best-effort；lc 走多音色对话渲染）。
      // 不阻塞——失败则练习时浏览器朗读（兜底文本含说话人前缀）。
      if (AUDIO_KEYS.has(typeKey) && Array.isArray(json.items) && json.items.length > 0) {
        renderAudioForSaved(json.items);
      } else {
        setAudioMsg("");
      }
    } catch {
      setErr("网络错误，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item) {
    try {
      const q = item.item_id ? `itemId=${encodeURIComponent(item.item_id)}` : `id=${encodeURIComponent(item.id)}`;
      await fetch(`/api/user-bank?code=${encodeURIComponent(code)}&${q}`, { method: "DELETE" });
      loadList(code);
    } catch {
      /* ignore */
    }
  }

  // ── 未登录 ──
  if (!code) {
    return (
      <SurfaceCard style={{ padding: 28 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.red, marginBottom: 8 }}>请先登录</div>
        <div style={{ fontSize: 14, color: C.t2, marginBottom: onRequireLogin ? 14 : 0 }}>
          个人题库需要登录后使用，以便和你的账号绑定。
        </div>
        {onRequireLogin && <Btn onClick={onRequireLogin}>登录 / 注册</Btn>}
      </SurfaceCard>
    );
  }

  return (
    <div style={{ fontFamily: FONT }}>
      {/* 非 Pro 提示 */}
      {!looksPro && (
        <SurfaceCard style={{ padding: 18, marginBottom: 16 }}>
          <div style={{ fontSize: 14, color: C.t1, marginBottom: 10 }}>
            「我的题库」是 <b>Pro</b> 功能。升级后即可导入并练习自己的题目。
          </div>
          {onRequireUpgrade && <Btn onClick={onRequireUpgrade}>升级 Pro</Btn>}
        </SurfaceCard>
      )}

      {/* ① 选择题型 —— 全部题型按技能分组展示，未上线的标「开发中」占位 */}
      <SurfaceCard style={{ padding: pad, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.t1 }}>
            <span style={{ color: C.t3, fontWeight: 700, marginRight: 6 }}>①</span>选择题型
          </div>
          <div style={{ fontSize: 11.5, color: C.t3 }}>
            已支持 {LIVE_TYPES.length} 种 · 其余题型陆续开放
          </div>
        </div>

        {TYPE_GROUPS.map((g) => (
          <div key={g.id} style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: g.accent.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: C.t2, letterSpacing: 0.3 }}>
                {g.label} <span style={{ color: C.t3, fontWeight: 600 }}>{g.id.charAt(0).toUpperCase() + g.id.slice(1)}</span>
              </span>
              <span style={{ flex: 1, height: 1, background: C.bdrSubtle }} />
            </div>
            <div style={{
              display: "grid", gap: 8, marginTop: 8,
              gridTemplateColumns: "repeat(auto-fill, minmax(122px, 1fr))",
            }}>
              {g.types.map((t) => (
                <TypeChip
                  key={t.key}
                  type={t}
                  accent={g.accent}
                  selected={t.live && typeKey === t.key}
                  onSelect={selectType}
                />
              ))}
            </div>
          </div>
        ))}
      </SurfaceCard>

      {/* ② 导入 —— 粘贴文本 | 上传截图 双栏（窄屏自动堆叠） */}
      <SurfaceCard style={{ padding: pad, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.t1 }}>
            <span style={{ color: C.t3, fontWeight: 700, marginRight: 6 }}>②</span>导入题目
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 999,
            background: tabAccent.soft, color: tabAccent.color,
          }}>
            {tab.label}
          </span>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "stretch" }}>
          {/* 粘贴文本 */}
          <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.t2, marginBottom: 6 }}>📋 粘贴文本</div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={tab.placeholder}
              style={{
                flex: 1, width: "100%", minHeight: 150, resize: "vertical", boxSizing: "border-box",
                border: `1px solid ${BD}`, borderRadius: 10, padding: "12px 14px",
                fontSize: 14, lineHeight: 1.6, color: C.t1, fontFamily: FONT, outline: "none",
              }}
            />
            <div style={{ marginTop: 10 }}>
              <Btn onClick={handleParse} disabled={busy || !text.trim()}>
                {parsing ? "识别中…" : "AI 抽取题目"}
              </Btn>
            </div>
          </div>

          {/* 上传截图 */}
          <div style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.t2, marginBottom: 6 }}>🖼️ 上传截图</div>
            <label
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (busy) return;
                const fs = e.dataTransfer?.files;
                if (fs && fs.length > 0) handleImageFiles(fs);
              }}
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
                padding: "20px 16px", borderRadius: 10, textAlign: "center", minHeight: 150, boxSizing: "border-box",
                border: `1.5px dashed ${dragOver ? tabAccent.color : BD}`,
                background: dragOver ? tabAccent.soft : "#fafbfc",
                cursor: busy ? "default" : "pointer", transition: "all .15s",
              }}
            >
              <input
                type="file"
                accept={ACCEPT}
                multiple
                disabled={busy}
                onChange={(e) => { const fs = e.target.files; if (fs && fs.length > 0) handleImageFiles(fs); e.target.value = ""; }}
                style={{ display: "none" }}
              />
              <span style={{ fontSize: 22 }}>{imgBusy ? "⏳" : "🖼️"}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>
                {imgBusy ? "识别中，请稍候…" : "点击选择或拖入图片"}
              </span>
              <span style={{ fontSize: 11, color: C.t3 }}>PNG / JPEG / WebP · 最多 {MAX_IMAGES} 张 · 长材料可分屏截图</span>
            </label>
          </div>
        </div>

        {err && <div style={{ marginTop: 12, fontSize: 13, color: C.red }}>{err}</div>}
        {savedMsg && <div style={{ marginTop: 12, fontSize: 13, color: C.green }}>{savedMsg}</div>}
        {audioMsg && <div style={{ marginTop: 6, fontSize: 12.5, color: C.t2 }}>{audioMsg}</div>}
      </SurfaceCard>

      {/* 预览 + 勾选 */}
      {parsed && (
        <SurfaceCard style={{ padding: pad, marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 4 }}>
            识别到 {parsed.length} 道题，勾选要存入的：
          </div>
          <div style={{ fontSize: 12, color: C.t2, marginBottom: 14 }}>
            灰色条目缺少必要字段（{INVALID_HINT[typeKey] || INVALID_HINT.academic}），无法保存。
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {parsed.map((q, i) => {
              const ok = isValid(typeKey, q);
              const on = selected.has(i);
              return (
                <label
                  key={i}
                  style={{
                    display: "flex", gap: 10, padding: "12px 14px", borderRadius: 10,
                    border: `1px solid ${on && ok ? tabAccent.color : BD}`,
                    background: ok ? (on ? tabAccent.soft : "#fff") : "#f9fafb",
                    opacity: ok ? 1 : 0.6, cursor: ok ? "pointer" : "not-allowed",
                  }}
                >
                  <input type="checkbox" checked={on && ok} disabled={!ok} onChange={() => ok && toggle(i)} style={{ marginTop: 3 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {typeKey === "email" ? (
                      <>
                        <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.5 }}>{String(q.scenario || "(无情景)")}</div>
                        <div style={{ fontSize: 12, color: C.t2, marginTop: 4 }}>要求：{String(q.direction || "—")}</div>
                        <div style={{ fontSize: 12, color: C.t2, marginTop: 2 }}>
                          要点：{(Array.isArray(q.goals) ? q.goals : []).filter(Boolean).join("；") || "—"}
                        </div>
                      </>
                    ) : typeKey === "repeat" ? (
                      <>
                        <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.5 }}>{String(q.sentence || "(无句子)")}</div>
                        <div style={{ fontSize: 12, color: C.t2, marginTop: 4 }}>{countWords(q.sentence)} 词</div>
                      </>
                    ) : typeKey === "interview" ? (
                      <>
                        <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.5 }}>{String(q.question || "(无问题)")}</div>
                        <div style={{ fontSize: 12, color: C.t2, marginTop: 4 }}>{countWords(q.question)} 词</div>
                      </>
                    ) : typeKey === "ctw" ? (
                      <>
                        {/* 所见即所练：展示机械挖空后的段落（含下划线缺口）+ 空数/词数 + warnings 黄字 */}
                        <div style={{
                          fontSize: 13, color: C.t1, lineHeight: 1.9, fontFamily: "'Georgia', serif",
                          whiteSpace: "pre-wrap", wordBreak: "break-word",
                        }}>
                          {ctwBlankedText(q) || "(无原文)"}
                        </div>
                        <div style={{ fontSize: 12, color: C.t2, marginTop: 6 }}>
                          {(Array.isArray(q.blanks) ? q.blanks.length : (q.blank_count || 0))} 空 · {q.word_count || countWords(q.passage)} 词
                          {q.topic ? ` · ${q.topic}` : ""}
                        </div>
                        {Array.isArray(q.warnings) && q.warnings.length > 0 && (
                          <div style={{ fontSize: 11, color: "#B45309", marginTop: 6 }}>⚠️ {q.warnings.join("；")}</div>
                        )}
                        {q.invalid && q.invalid_reason && (
                          <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{String(q.invalid_reason)}</div>
                        )}
                      </>
                    ) : LC_KEYS.has(typeKey) ? (
                      <>
                        {/* LC 特供预览：逐轮显示对话，每轮一行「说话人徽章（可点击切换 Woman/Man）+ 该轮文本」，
                            让用户在保存前修正切分错位（切错一轮全篇音色错乱）。题目部分复用听力 MCQ 预览。 */}
                        {q.situation && (
                          <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>情景：{String(q.situation)}</div>
                        )}
                        <div style={{ fontSize: 11.5, color: C.t3, marginBottom: 6 }}>
                          🔊 双人对话 · 点说话人徽章可切换（修正配音说话人）
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {(Array.isArray(q.conversation) ? q.conversation : []).map((turn, ti) => {
                            const sp = String(turn?.speaker || "");
                            const speakers = Array.isArray(q.speakers) ? q.speakers : [];
                            const known = speakers.some((s) => String(s?.name || "").trim() === sp.trim());
                            const gender = String(speakers.find((s) => String(s?.name || "").trim() === sp.trim())?.gender || "").toLowerCase();
                            const chipColor = gender === "female" ? "#DB2777" : gender === "male" ? "#2563EB" : "#8b95a1";
                            return (
                              <div key={ti} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (ok || speakers.length === 2) cycleTurnSpeaker(i, ti);
                                  }}
                                  title="点击切换说话人（修正配音）"
                                  style={{
                                    flexShrink: 0, minWidth: 58, padding: "2px 8px", borderRadius: 999,
                                    fontSize: 10.5, fontWeight: 700, fontFamily: FONT, cursor: "pointer",
                                    border: `1px solid ${known ? chipColor : C.red}`,
                                    background: known ? chipColor + "18" : "#FEF2F2",
                                    color: known ? chipColor : C.red, lineHeight: 1.4,
                                  }}
                                >
                                  {sp || "(?)"} ⇄
                                </button>
                                <span style={{ fontSize: 12.5, color: C.t1, lineHeight: 1.5, wordBreak: "break-word" }}>
                                  {String(turn?.text || "")}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        {itemQuestions(typeKey, q).map((qq, j) => {
                          const vr = verifyMap[i];
                          const r = vr?.status === "done" ? (vr.results || [])[j] : null;
                          const eff = ok ? effectiveAnswer(i, j) : null;
                          return (
                            <div key={j} style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${BD}` }}>
                              <div style={{ fontSize: 12.5, color: C.t1, lineHeight: 1.5 }}>
                                <b>Q{j + 1}.</b> {String(qq?.stem || "(无题干)")}
                                {ok && <VerifyBadge state={vr?.status} result={r} />}
                              </div>
                              <div style={{ fontSize: 11.5, color: C.t2, marginTop: 3, lineHeight: 1.6 }}>
                                {ANSWER_KEYS.map((k) => `${k}. ${String(qq?.options?.[k] ?? "—")}`).join("　")}
                              </div>
                              {ok && (
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 11, color: C.t3 }}>答案</span>
                                  {ANSWER_KEYS.map((k) => (
                                    <button
                                      key={k}
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setAnswerPick((prev) => ({ ...prev, [`${i}:${j}`]: k }));
                                      }}
                                      style={{
                                        width: 26, height: 22, borderRadius: 6, fontSize: 11, fontWeight: 700,
                                        cursor: "pointer", fontFamily: FONT, lineHeight: 1,
                                        border: `1px solid ${eff === k ? tabAccent.color : BD}`,
                                        background: eff === k ? tabAccent.color : "#fff",
                                        color: eff === k ? "#fff" : C.t2,
                                      }}
                                    >
                                      {k}
                                    </button>
                                  ))}
                                  {r?.verdict === "mismatch" && (
                                    <span style={{ fontSize: 11, color: "#B45309" }}>
                                      你标 {r.marked_answer} / AI 判 {r.ai_answer}，点选裁决
                                    </span>
                                  )}
                                  {!eff && <span style={{ fontSize: 11, color: C.t3 }}>（待复核 / 可手动点选）</span>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        <div style={{ fontSize: 11, color: C.t3, marginTop: 6 }}>ℹ️ 保存后配音约需 1 分钟（两位不同音色）</div>
                        {Array.isArray(q.warnings) && q.warnings.length > 0 && (
                          <div style={{ fontSize: 11, color: "#B45309", marginTop: 6 }}>⚠️ {q.warnings.join("；")}</div>
                        )}
                        {q.invalid && q.invalid_reason && (
                          <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{String(q.invalid_reason)}</div>
                        )}
                      </>
                    ) : LCR_KEYS.has(typeKey) ? (
                      <>
                        {/* 口播句（练习时朗读的那一句）+ 单题答案选择器 + 复核徽章 */}
                        <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.5 }}>
                          <b>🔊 口播：</b>{String(q.speaker || "(缺口播句)")}
                        </div>
                        {q.situation && (
                          <div style={{ fontSize: 12, color: C.t2, marginTop: 3 }}>情景：{String(q.situation)}</div>
                        )}
                        {itemQuestions(typeKey, q).map((qq, j) => {
                          const vr = verifyMap[i];
                          const r = vr?.status === "done" ? (vr.results || [])[j] : null;
                          const eff = ok ? effectiveAnswer(i, j) : null;
                          return (
                            <div key={j} style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${BD}` }}>
                              <div style={{ fontSize: 11.5, color: C.t2, lineHeight: 1.6 }}>
                                {ANSWER_KEYS.map((k) => `${k}. ${String(qq?.options?.[k] ?? "—")}`).join("　")}
                                {ok && <VerifyBadge state={vr?.status} result={r} />}
                              </div>
                              {ok && (
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 11, color: C.t3 }}>答案</span>
                                  {ANSWER_KEYS.map((k) => (
                                    <button
                                      key={k}
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setAnswerPick((prev) => ({ ...prev, [`${i}:${j}`]: k }));
                                      }}
                                      style={{
                                        width: 26, height: 22, borderRadius: 6, fontSize: 11, fontWeight: 700,
                                        cursor: "pointer", fontFamily: FONT, lineHeight: 1,
                                        border: `1px solid ${eff === k ? tabAccent.color : BD}`,
                                        background: eff === k ? tabAccent.color : "#fff",
                                        color: eff === k ? "#fff" : C.t2,
                                      }}
                                    >
                                      {k}
                                    </button>
                                  ))}
                                  {r?.verdict === "mismatch" && (
                                    <span style={{ fontSize: 11, color: "#B45309" }}>
                                      你标 {r.marked_answer} / AI 判 {r.ai_answer}，点选裁决
                                    </span>
                                  )}
                                  {!eff && <span style={{ fontSize: 11, color: C.t3 }}>（待复核 / 可手动点选）</span>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {Array.isArray(q.warnings) && q.warnings.length > 0 && (
                          <div style={{ fontSize: 11, color: "#B45309", marginTop: 6 }}>⚠️ {q.warnings.join("；")}</div>
                        )}
                        {q.invalid && q.invalid_reason && (
                          <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{String(q.invalid_reason)}</div>
                        )}
                      </>
                    ) : LISTENING_MCQ_KEYS.has(typeKey) ? (
                      <>
                        {/* 口播全文（练习时朗读/播放）截断 + 逐题 stem/选项 + 答案选择器 + 复核徽章 */}
                        <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.5 }}>
                          <b>🔊 {typeKey === "la" ? "公告" : "讲座"}：</b>
                          {(() => {
                            const body = String(q.announcement || q.transcript || "(无原文)");
                            return body.length > 180 ? body.slice(0, 177) + "..." : body;
                          })()}
                        </div>
                        {itemQuestions(typeKey, q).map((qq, j) => {
                          const vr = verifyMap[i];
                          const r = vr?.status === "done" ? (vr.results || [])[j] : null;
                          const eff = ok ? effectiveAnswer(i, j) : null;
                          return (
                            <div key={j} style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${BD}` }}>
                              <div style={{ fontSize: 12.5, color: C.t1, lineHeight: 1.5 }}>
                                <b>Q{j + 1}.</b> {String(qq?.stem || "(无题干)")}
                                {ok && <VerifyBadge state={vr?.status} result={r} />}
                              </div>
                              <div style={{ fontSize: 11.5, color: C.t2, marginTop: 3, lineHeight: 1.6 }}>
                                {ANSWER_KEYS.map((k) => `${k}. ${String(qq?.options?.[k] ?? "—")}`).join("　")}
                              </div>
                              {ok && (
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 11, color: C.t3 }}>答案</span>
                                  {ANSWER_KEYS.map((k) => (
                                    <button
                                      key={k}
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setAnswerPick((prev) => ({ ...prev, [`${i}:${j}`]: k }));
                                      }}
                                      style={{
                                        width: 26, height: 22, borderRadius: 6, fontSize: 11, fontWeight: 700,
                                        cursor: "pointer", fontFamily: FONT, lineHeight: 1,
                                        border: `1px solid ${eff === k ? tabAccent.color : BD}`,
                                        background: eff === k ? tabAccent.color : "#fff",
                                        color: eff === k ? "#fff" : C.t2,
                                      }}
                                    >
                                      {k}
                                    </button>
                                  ))}
                                  {r?.verdict === "mismatch" && (
                                    <span style={{ fontSize: 11, color: "#B45309" }}>
                                      你标 {r.marked_answer} / AI 判 {r.ai_answer}，点选裁决
                                    </span>
                                  )}
                                  {!eff && <span style={{ fontSize: 11, color: C.t3 }}>（待复核 / 可手动点选）</span>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {typeKey === "lat" && (
                          <div style={{ fontSize: 11, color: C.t3, marginTop: 6 }}>ℹ️ 讲座较长，保存后配音约需 1-2 分钟</div>
                        )}
                        {Array.isArray(q.warnings) && q.warnings.length > 0 && (
                          <div style={{ fontSize: 11, color: "#B45309", marginTop: 6 }}>⚠️ {q.warnings.join("；")}</div>
                        )}
                        {q.invalid && q.invalid_reason && (
                          <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{String(q.invalid_reason)}</div>
                        )}
                      </>
                    ) : READING_KEYS.has(typeKey) ? (
                      <>
                        {/* 原文截断 + 逐题 stem/选项 + 答案选择器 + 复核徽章 */}
                        <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.5 }}>
                          {(() => {
                            const body = String(q.text || q.passage || "(无原文)");
                            return body.length > 180 ? body.slice(0, 177) + "..." : body;
                          })()}
                        </div>
                        {(Array.isArray(q.questions) ? q.questions : []).map((qq, j) => {
                          const vr = verifyMap[i];
                          const r = vr?.status === "done" ? (vr.results || [])[j] : null;
                          const eff = ok ? effectiveAnswer(i, j) : null;
                          return (
                            <div key={j} style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${BD}` }}>
                              <div style={{ fontSize: 12.5, color: C.t1, lineHeight: 1.5 }}>
                                <b>Q{j + 1}.</b> {String(qq?.stem || "(无题干)")}
                                {ok && <VerifyBadge state={vr?.status} result={r} />}
                              </div>
                              <div style={{ fontSize: 11.5, color: C.t2, marginTop: 3, lineHeight: 1.6 }}>
                                {ANSWER_KEYS.map((k) => `${k}. ${String(qq?.options?.[k] ?? "—")}`).join("　")}
                              </div>
                              {ok && (
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 11, color: C.t3 }}>答案</span>
                                  {ANSWER_KEYS.map((k) => (
                                    <button
                                      key={k}
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setAnswerPick((prev) => ({ ...prev, [`${i}:${j}`]: k }));
                                      }}
                                      style={{
                                        width: 26, height: 22, borderRadius: 6, fontSize: 11, fontWeight: 700,
                                        cursor: "pointer", fontFamily: FONT, lineHeight: 1,
                                        border: `1px solid ${eff === k ? tabAccent.color : BD}`,
                                        background: eff === k ? tabAccent.color : "#fff",
                                        color: eff === k ? "#fff" : C.t2,
                                      }}
                                    >
                                      {k}
                                    </button>
                                  ))}
                                  {r?.verdict === "mismatch" && (
                                    <span style={{ fontSize: 11, color: "#B45309" }}>
                                      你标 {r.marked_answer} / AI 判 {r.ai_answer}，点选裁决
                                    </span>
                                  )}
                                  {!eff && <span style={{ fontSize: 11, color: C.t3 }}>（待复核 / 可手动点选）</span>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {Array.isArray(q.warnings) && q.warnings.length > 0 && (
                          <div style={{ fontSize: 11, color: "#B45309", marginTop: 6 }}>⚠️ {q.warnings.join("；")}</div>
                        )}
                        {q.invalid && q.invalid_reason && (
                          <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{String(q.invalid_reason)}</div>
                        )}
                      </>
                    ) : typeKey === "build" ? (
                      <>
                        <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.5 }}>
                          <b>问：</b>{String(q.prompt || "(无问句)")}
                        </div>
                        <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.5, marginTop: 4 }}>
                          <b>答：</b>{String(q.answer || "(无答案)")}
                        </div>
                        <div style={{ fontSize: 12, color: C.t2, marginTop: 4 }}>
                          词块：{(Array.isArray(q.chunks) ? q.chunks : []).join(" / ") || "—"}
                        </div>
                        {q.distractor && (
                          <div style={{ fontSize: 12, color: C.t2, marginTop: 2 }}>干扰项：{String(q.distractor)}</div>
                        )}
                        {q.invalid && q.invalid_reason && (
                          <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{String(q.invalid_reason)}</div>
                        )}
                        {q.ambiguous && (
                          <div style={{ fontSize: 11, color: "#B45309", marginTop: 4 }}>
                            ⚠️ 该题词块可能有多种正确排列，练习时判分可能偏严
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.5 }}>
                          <b>{q?.professor?.name || "Professor"}：</b>{String(q?.professor?.text || "(无题干)")}
                        </div>
                        <div style={{ fontSize: 12, color: C.t2, marginTop: 4 }}>
                          {(Array.isArray(q.students) ? q.students : []).map((s) => s?.name).filter(Boolean).join(" / ") || "—"}
                        </div>
                      </>
                    )}
                    {!ok && <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>字段不全，不能保存</div>}
                  </div>
                </label>
              );
            })}
          </div>
          <div style={{ marginTop: 16 }}>
            <Btn onClick={handleSave} disabled={saving}>
              {saving ? "保存中…" : `存入我的题库（${[...selected].filter((i) => isValid(typeKey, parsed[i])).length}）`}
            </Btn>
          </div>
        </SurfaceCard>
      )}

      {/* 已存列表 */}
      <SurfaceCard style={{ padding: pad }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 12 }}>
          已存 {list.length} 道
        </div>
        {listLoading ? (
          <div style={{ fontSize: 13, color: C.t2 }}>加载中…</div>
        ) : list.length === 0 ? (
          <div style={{ fontSize: 13, color: C.t2 }}>还没有导入的题。</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {list.map((it) => {
              const storedType = ALL_TYPES.find((t) => t.stored === it.type);
              const g = groupOfStored(it.type);
              const chipAccent = g?.accent || SECTION_ACCENTS.writing;
              const label = it.type === "email"
                ? String(it?.data?.scenario || "(邮件题)").slice(0, 70)
                : it.type === "repeat"
                ? `${String(it?.data?.scenario || "复述题")} · ${(it?.data?.sentences || []).length} 句`
                : it.type === "interview"
                ? `${String(it?.data?.topic || "面试题")} · ${(it?.data?.questions || []).length} 问`
                : it.type === "build"
                ? String(it?.data?.prompt || it?.data?.answer || "(连词成句题)").slice(0, 70)
                : it.type === "rdl"
                ? `${String(it?.data?.format_metadata?.title || it?.data?.text || "(日常阅读)").slice(0, 60)} · ${(it?.data?.questions || []).length} 题`
                : it.type === "ap"
                ? `${String(it?.data?.passage || "(学术短文)").slice(0, 60)} · ${(it?.data?.questions || []).length} 题`
                : it.type === "ctw"
                ? `${String(it?.data?.first_sentence || it?.data?.passage || "(单词补全)").slice(0, 60)} · ${(it?.data?.blanks || []).length} 空`
                : it.type === "lcr"
                ? `${String(it?.data?.speaker || "(选择回应)").slice(0, 60)}${it?.data?.audio_url ? " · 🔊" : ""}`
                : it.type === "la"
                ? `${String(it?.data?.situation || it?.data?.announcement || "(听公告)").slice(0, 55)} · ${(it?.data?.questions || []).length} 题${it?.data?.audio_url ? " · 🔊" : ""}`
                : it.type === "lat"
                ? `${String(it?.data?.topic || it?.data?.transcript || "(学术讲座)").slice(0, 55)} · ${(it?.data?.questions || []).length} 题${it?.data?.audio_url ? " · 🔊" : ""}`
                : it.type === "lc"
                ? `${String(it?.data?.situation || it?.data?.conversation?.[0]?.text || "(听对话)").slice(0, 55)} · ${(it?.data?.questions || []).length} 题${it?.data?.audio_url ? " · 🔊" : ""}`
                : String(it?.data?.professor?.text || "(讨论题)").slice(0, 70);
              // rdl 双池：练习链接按该条的 variant（缺失则按题数派生）指对池子。
              const practiceHref = it.type === "rdl"
                ? `/reading?type=rdl&variant=${it?.data?.variant === "short" || (it?.data?.questions || []).length === 2 ? "short" : "long"}&mode=practice`
                : storedType?.practice;
              return (
                <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: `1px solid ${BD}`, borderRadius: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: chipAccent.soft, color: chipAccent.color, flexShrink: 0 }}>
                    {storedType?.label || it.type}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                  {practiceHref && <a href={practiceHref} style={{ fontSize: 12, color: C.blue, textDecoration: "none", flexShrink: 0 }}>去练习</a>}
                  <button onClick={() => handleDelete(it)} style={{ border: "none", background: "none", color: C.red, fontSize: 12, cursor: "pointer", flexShrink: 0, fontFamily: FONT }}>删除</button>
                </div>
              );
            })}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}
