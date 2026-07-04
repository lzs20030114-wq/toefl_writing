"use client";
// 个人题库导入器（可复用）——选题型 → 粘贴文本 / 上传图片 → AI 抽取 → 预览勾选 → 存 → 已存列表。
// 被 /my-bank 独立页（variant="page"）和首页「我的题库」section（variant="panel"，桌面+移动）共用。
// 不读 localStorage、不挂 UpgradeModal：code/tier 由父层给，升级/登录用 onRequireUpgrade/onRequireLogin 回调。
//
// 题型选择器展示全部 4 技能 12 题型（按技能分组、沿用 SECTION_ACCENTS 配色），未上线的
// 降透明度标「开发中」占位——roadmap 直接画在界面上，
// 后续题型上线只需把 live 翻 true + 补 stored/practice/placeholder。
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
      { key: "ctw", label: "单词补全", en: "Complete the Words", live: false },
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
      { key: "lcr", label: "选择回应", en: "Choose a Response", live: false },
      { key: "la", label: "听公告", en: "Announcement", live: false },
      { key: "lc", label: "听对话", en: "Conversation", live: false },
      { key: "lat", label: "学术讲座", en: "Academic Talk", live: false },
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
};

const BD = C.bd2 || "#e2e8f0";
const ACCEPT = "image/png,image/jpeg,image/webp";
const CLIENT_MAX_BYTES = 25 * 1024 * 1024; // 下采样前的粗筛上限，防 canvas OOM
const MAX_IMAGES = 3; // 与 /api/user-bank/extract-image 一致（AP 常跨 2-3 张截图）
const CLIENT_TOTAL_UPLOAD_BYTES = Math.floor(3.8 * 1024 * 1024); // 服务端合计 4MB，客户端留余量预检

// 阅读 MCQ 题型（rdl/ap）：预览带逐题答案选择器 + verify 复核徽章。
const READING_KEYS = new Set(["rdl", "ap"]);
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
function isValid(typeKey, q) {
  if (typeKey === "email") return isValidEmail(q);
  if (typeKey === "repeat") return isValidRepeat(q);
  if (typeKey === "interview") return isValidInterview(q);
  if (typeKey === "build") return isValidBuild(q);
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
  function effectiveAnswer(i, j) {
    const picked = answerPick[`${i}:${j}`];
    if (picked) return picked;
    const own = normAnswer(parsed?.[i]?.questions?.[j]?.correct_answer);
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
    if (READING_KEYS.has(typeKey)) {
      runVerifyAll(questions, typeKey); // fire-and-forget（内部逐 item 兜错）
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

  async function handleSave() {
    setErr("");
    setSavedMsg("");
    if (!parsed) return;
    const chosenIdx = [...selected].sort((a, b) => a - b).filter((i) => isValid(typeKey, parsed[i]));
    const chosen = chosenIdx.map((i) => parsed[i]);
    if (chosen.length === 0) { setErr("没有可保存的题（被选中的题缺少必要字段）"); return; }
    // 阅读题：每小题必须有生效答案（RDLTask 判分依赖 correct_answer，缺失会把用户永远判错）。
    // verify fail-open 不阻塞保存的前提是用户可手动点选补齐——这里就是那道闸。
    if (READING_KEYS.has(typeKey)) {
      const unresolved = chosenIdx.some((i) =>
        (parsed[i].questions || []).some((_, j) => !effectiveAnswer(i, j))
      );
      if (unresolved) {
        setErr("还有小题未确定答案：等 AI 复核完成，或在预览里点选每题的正确答案（A-D）后再保存。");
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
