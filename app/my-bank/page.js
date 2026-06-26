"use client";
// 我的题库 —— 用户自助把自己的题导入个人库（P0：粘贴文本 → AI 抽取 → 预览勾选 → 存）。
// P1 会在此基础上加图片/PDF 上传（Qwen-VL 识别）。Pro 专属；服务端门禁是权威，前端只做提示。
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { C, FONT, Btn, PageShell, SurfaceCard } from "../../components/shared/ui";
import UpgradeModal from "../../components/shared/UpgradeModal";
import { getSavedCode, getSavedTier } from "../../lib/AuthContext";

// 抽取器 key（academic/email）→ 存储/练习 type（discussion/email）。边界处映射，库里只存后者。
const TYPE_TABS = [
  { key: "academic", stored: "discussion", label: "学术讨论", practice: "/academic-writing?mode=practice" },
  { key: "email", stored: "email", label: "邮件写作", practice: "/email-writing?mode=practice" },
];

// 与 WritingTask 的 normalize 最小要求一致——不满足的条目入库后会开成「已下线」，故导入时就拦掉。
function isValidAcademic(q) {
  const students = Array.isArray(q?.students) ? q.students.filter((s) => s?.name && s?.text) : [];
  return !!(q?.professor?.name && q?.professor?.text && students.length >= 2);
}
function isValidEmail(q) {
  const goals = Array.isArray(q?.goals) ? q.goals.filter(Boolean) : [];
  return !!(q?.scenario && q?.direction && goals.length >= 3);
}
function isValid(typeKey, q) {
  return typeKey === "email" ? isValidEmail(q) : isValidAcademic(q);
}

export default function MyBankPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [code, setCode] = useState("");
  const [tier, setTier] = useState("free");
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const [typeKey, setTypeKey] = useState("academic");
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null); // null | array
  const [selected, setSelected] = useState(() => new Set());
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  const [list, setList] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  const tab = TYPE_TABS.find((t) => t.key === typeKey) || TYPE_TABS[0];
  const looksPro = tier === "pro" || tier === "legacy";

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
    setMounted(true);
    const c = getSavedCode() || "";
    setCode(c);
    setTier(getSavedTier() || "free");
    if (c) loadList(c);
  }, [loadList]);

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
      if (!res.ok || !json?.ok) {
        if (json?.code === "PRO_REQUIRED") { setUpgradeOpen(true); return; }
        if (json?.code === "DAILY_LIMIT" || json?.code === "PRO_DAILY_CAP") { setErr(json.error || "今日额度已用完"); return; }
        setErr(json?.error || "抽取失败，请稍后重试");
        return;
      }
      const questions = Array.isArray(json.questions) ? json.questions : [];
      if (questions.length === 0) { setErr("没能从文本里识别出题目，换一段试试？"); return; }
      setParsed(questions);
      // Default-select every item that meets the practice minima.
      const next = new Set();
      questions.forEach((q, i) => { if (isValid(typeKey, q)) next.add(i); });
      setSelected(next);
    } catch {
      setErr("网络错误，请稍后重试");
    } finally {
      setParsing(false);
    }
  }

  function toggle(i) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function handleSave() {
    setErr("");
    setSavedMsg("");
    if (!parsed) return;
    const chosen = parsed.filter((_, i) => selected.has(i)).filter((q) => isValid(typeKey, q));
    if (chosen.length === 0) { setErr("没有可保存的题（被选中的题缺少必要字段）"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/user-bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          type: tab.stored,
          source: "paste",
          items: chosen.map((q) => ({ data: q })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        if (json?.code === "PRO_REQUIRED") { setUpgradeOpen(true); return; }
        setErr(json?.error || "保存失败");
        return;
      }
      const n = Array.isArray(json.items) ? json.items.length : 0;
      setSavedMsg(`已存入「我的题库」${n} 道，去练习页即可练。`);
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

  if (!mounted) return null;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: FONT }}>
      {upgradeOpen && (
        <UpgradeModal
          userCode={code}
          currentTier={tier}
          onClose={() => setUpgradeOpen(false)}
          onUpgraded={() => window.location.reload()}
        />
      )}
      <PageShell narrow>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.nav }}>我的题库</div>
            <div style={{ fontSize: 13, color: C.t2, marginTop: 4 }}>
              把你自己的题导入个人库，导入后在练习页会以「我的」标签出现。
            </div>
          </div>
          <Btn variant="secondary" onClick={() => router.push("/")}>返回首页</Btn>
        </div>

        {!code ? (
          <SurfaceCard style={{ padding: 28 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.red, marginBottom: 8 }}>请先登录</div>
            <div style={{ fontSize: 14, color: C.t2 }}>个人题库需要登录后使用，以便和你的账号绑定。</div>
          </SurfaceCard>
        ) : (
          <>
            {!looksPro && (
              <SurfaceCard style={{ padding: 18, marginBottom: 16 }}>
                <div style={{ fontSize: 14, color: C.t1, marginBottom: 10 }}>
                  「我的题库」是 <b>Pro</b> 功能。升级后即可导入并练习自己的题目。
                </div>
                <Btn onClick={() => setUpgradeOpen(true)}>升级 Pro</Btn>
              </SurfaceCard>
            )}

            {/* 导入卡片 */}
            <SurfaceCard style={{ padding: 22, marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {TYPE_TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => { setTypeKey(t.key); setParsed(null); setErr(""); setSavedMsg(""); }}
                    style={{
                      padding: "7px 16px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer",
                      fontFamily: FONT, transition: "all .15s",
                      border: `1px solid ${typeKey === t.key ? C.nav : C.bd2 || "#e2e8f0"}`,
                      background: typeKey === t.key ? C.nav : "#fff",
                      color: typeKey === t.key ? "#fff" : C.t2,
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={typeKey === "email"
                  ? "粘贴邮件题文本（含情景、写作要求、要点）。一次可粘多道。"
                  : "粘贴学术讨论题文本（教授提问 + 两位同学的回复）。一次可粘多道。"}
                style={{
                  width: "100%", minHeight: 180, resize: "vertical", boxSizing: "border-box",
                  border: `1px solid ${C.bd2 || "#e2e8f0"}`, borderRadius: 10, padding: "12px 14px",
                  fontSize: 14, lineHeight: 1.6, color: C.t1, fontFamily: FONT, outline: "none",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
                <Btn onClick={handleParse} disabled={parsing || !text.trim()}>
                  {parsing ? "识别中…" : "AI 抽取题目"}
                </Btn>
                <span style={{ fontSize: 12, color: C.t3 || C.t2 }}>P1 将支持上传图片 / PDF</span>
              </div>
              {err && <div style={{ marginTop: 10, fontSize: 13, color: C.red }}>{err}</div>}
              {savedMsg && <div style={{ marginTop: 10, fontSize: 13, color: "#15803d" }}>{savedMsg}</div>}
            </SurfaceCard>

            {/* 预览 + 勾选 */}
            {parsed && (
              <SurfaceCard style={{ padding: 22, marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 4 }}>
                  识别到 {parsed.length} 道题，勾选要存入的：
                </div>
                <div style={{ fontSize: 12, color: C.t2, marginBottom: 14 }}>
                  灰色条目缺少必要字段（{typeKey === "email" ? "情景/要求/至少 3 个要点" : "教授提问 + 至少 2 位同学"}），无法保存。
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
                          border: `1px solid ${on && ok ? C.nav : (C.bd2 || "#e2e8f0")}`,
                          background: ok ? (on ? "#f8fafc" : "#fff") : "#f9fafb",
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
            <SurfaceCard style={{ padding: 22 }}>
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
                    const stored = TYPE_TABS.find((t) => t.stored === it.type);
                    const label = it.type === "email"
                      ? String(it?.data?.scenario || "(邮件题)").slice(0, 70)
                      : String(it?.data?.professor?.text || "(讨论题)").slice(0, 70);
                    return (
                      <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: `1px solid ${C.bd2 || "#e2e8f0"}`, borderRadius: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#eef2ff", color: "#4f46e5", flexShrink: 0 }}>
                          {stored?.label || it.type}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                        {stored && <a href={stored.practice} style={{ fontSize: 12, color: C.nav, textDecoration: "none", flexShrink: 0 }}>去练习</a>}
                        <button onClick={() => handleDelete(it)} style={{ border: "none", background: "none", color: C.red, fontSize: 12, cursor: "pointer", flexShrink: 0 }}>删除</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </SurfaceCard>
          </>
        )}
      </PageShell>
    </div>
  );
}
