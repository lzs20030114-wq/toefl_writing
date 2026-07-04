"use client";
// 个人题库导入器（可复用）——选题型 → 粘贴文本 / 上传图片 → AI 抽取 → 预览勾选 → 存 → 已存列表。
// 被 /my-bank 独立页（variant="page"）和首页「我的题库」section（variant="panel"，桌面+移动）共用。
// 不读 localStorage、不挂 UpgradeModal：code/tier 由父层给，升级/登录用 onRequireUpgrade/onRequireLogin 回调。
//
// 题型选择器展示全部 4 技能 12 题型（按技能分组、沿用 SECTION_ACCENTS 配色），当前仅
// 学术讨论 + 邮件可导入，其余降透明度标「开发中」占位——roadmap 直接画在界面上，
// 后续题型上线只需把 live 翻 true + 补 stored/practice/placeholder。
import { useCallback, useEffect, useState } from "react";
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
      { key: "build", label: "连词成句", en: "Build a Sentence", live: false },
    ],
  },
  {
    id: "reading", label: "阅读", icon: "📖", accent: SECTION_ACCENTS.reading,
    types: [
      { key: "ctw", label: "单词补全", en: "Complete the Words", live: false },
      { key: "rdl", label: "日常阅读", en: "Read in Daily Life", live: false },
      { key: "ap", label: "学术短文", en: "Academic Passage", live: false },
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
};

const BD = C.bd2 || "#e2e8f0";
const ACCEPT = "image/png,image/jpeg,image/webp";
const CLIENT_MAX_BYTES = 25 * 1024 * 1024; // 下采样前的粗筛上限，防 canvas OOM

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
function isValid(typeKey, q) {
  if (typeKey === "email") return isValidEmail(q);
  if (typeKey === "repeat") return isValidRepeat(q);
  if (typeKey === "interview") return isValidInterview(q);
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
  }

  // 抽取结果落到同一预览态（粘贴 / 图片共用）。
  function applyExtracted(questions) {
    setParsed(questions);
    const next = new Set();
    questions.forEach((q, i) => { if (isValid(typeKey, q)) next.add(i); });
    setSelected(next);
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

  async function handleImageFile(file) {
    setErr("");
    setSavedMsg("");
    setParsed(null);
    if (!file) return;
    if (!code) { setErr("请先登录"); return; }
    if (!/^image\//.test(file.type)) { setErr("请选择图片文件（PNG / JPEG / WebP）"); return; }
    if (file.size > CLIENT_MAX_BYTES) { setErr("图片过大，请选小一点的截图"); return; }
    setImgBusy(true);
    try {
      const blob = await downscaleImage(file);
      const fd = new FormData();
      fd.append("type", typeKey);
      fd.append("userCode", code);
      fd.append("image", blob, "upload.jpg");
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
  //  writing (academic/email): one DB item per question (current behavior).
  //  repeat/interview: bundle ALL chosen items into ONE "set" DB item, because the
  //  speaking bank's unit is a set (RepeatTask/InterviewTask consume an array).
  function packItems(typeKey, chosen) {
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
    const chosen = parsed.filter((_, i) => selected.has(i)).filter((q) => isValid(typeKey, q));
    if (chosen.length === 0) { setErr("没有可保存的题（被选中的题缺少必要字段）"); return; }
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
          items: packItems(typeKey, chosen),
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
                const f = e.dataTransfer?.files?.[0];
                if (f) handleImageFile(f);
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
                disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ""; }}
                style={{ display: "none" }}
              />
              <span style={{ fontSize: 22 }}>{imgBusy ? "⏳" : "🖼️"}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>
                {imgBusy ? "识别中，请稍候…" : "点击选择或拖入图片"}
              </span>
              <span style={{ fontSize: 11, color: C.t3 }}>PNG / JPEG / WebP · 一张图可含多道题</span>
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
                : String(it?.data?.professor?.text || "(讨论题)").slice(0, 70);
              return (
                <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: `1px solid ${BD}`, borderRadius: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: chipAccent.soft, color: chipAccent.color, flexShrink: 0 }}>
                    {storedType?.label || it.type}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                  {storedType?.practice && <a href={storedType.practice} style={{ fontSize: 12, color: C.blue, textDecoration: "none", flexShrink: 0 }}>去练习</a>}
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
