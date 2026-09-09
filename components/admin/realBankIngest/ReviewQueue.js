"use client";
import { useState } from "react";
import { SectionCard, Button, Badge, InlineAlert } from "../primitives";
import { callAdminApi } from "../../../lib/adminHelpers";
import { C } from "../../shared/ui";

const HOLD_FILES = [
  "reading/ctw", "reading/rdl", "reading/ap",
  "listening/lcr", "listening/lc", "listening/la", "listening/lat",
  "speaking/repeat", "speaking/interview",
  "writing/bs", "writing/email", "writing/discussion",
];
const SCOPES = [
  { value: "unit", label: "整条下架" },
  { value: "question", label: "只扣一题（question）" },
  { value: "sentence", label: "只扣一句（sentence）" },
  { value: "iq", label: "只扣一个面试题（iq）" },
];

const input = { width: "100%", marginTop: 4, padding: "7px 9px", border: `1px solid ${C.bdr}`, borderRadius: 8, fontSize: 12 };
const label = { fontSize: 11, color: C.t2, display: "block" };

function pct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "--";
}

export default function ReviewQueue({ data, loading, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState({ file: HOLD_FILES[0], id: "", scope: "unit", reason: "", q: "", stem: "", sid: "", qid: "" });

  async function decide(payload) {
    setBusy(true);
    setMsg(null);
    try {
      const body = await callAdminApi("/api/admin/real-bank-ingest/review/decision", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMsg({ tone: body.rebuildError ? "warn" : "success", text: body.message || "已提交" });
      if (onRefresh) onRefresh();
      return true;
    } catch (e) {
      setMsg({ tone: "error", text: String(e.message || e) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function allowSection(h) {
    const reason = window.prompt(`放行「${h.set} / ${h.section}」的理由（会写进 git 历史）：`, "人工核过，可以上线");
    if (!reason) return;
    await decide({ action: "allow_section", set_key: h.set, section: h.section, code: h.code, reason });
  }

  async function submitHold(e) {
    e.preventDefault();
    const payload = { action: "hold_unit", file: form.file, id: form.id.trim(), scope: form.scope, reason: form.reason.trim() };
    if (form.scope === "question") { payload.q = Number(form.q); payload.stem = form.stem.trim(); }
    if (form.scope === "sentence") payload.sid = form.sid.trim();
    if (form.scope === "iq") payload.qid = form.qid.trim();
    const ok = await decide(payload);
    if (ok) setForm((f) => ({ ...f, id: "", reason: "", q: "", stem: "", sid: "", qid: "" }));
  }

  const holds = data?.holds || [];
  const pending = holds.filter((h) => !h.resolved);
  const resolved = holds.filter((h) => h.resolved);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {msg && <InlineAlert tone={msg.tone}>{msg.text}</InlineAlert>}
      {data?.repoError && <InlineAlert tone="warn">仓库复核文件读取失败：{data.repoError}（GH_PAT 配了吗？）</InlineAlert>}

      <SectionCard
        title={`待复核（${pending.length}）`}
        right={<Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>{loading ? "刷新中…" : "刷新"}</Button>}
        padding={0}
      >
        {!pending.length && <div style={{ padding: 18, fontSize: 13, color: C.t3, textAlign: "center" }}>没有待复核的扣留</div>}
        {pending.map((h) => (
          <div key={`${h.set}|${h.section}|${h.code}`} style={{ padding: "10px 14px", borderBottom: `1px solid ${C.bdr}`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>{h.set}</span>
            <Badge color="#2563eb">{h.section}</Badge>
            <Badge color="#d97706">{h.code}</Badge>
            <span style={{ flex: 1, minWidth: 160, fontSize: 12, color: C.t2 }}>{h.detail || ""}</span>
            <span style={{ fontSize: 11, color: C.t3 }}>
              一致率 {pct(h.agreement)} · {h.questions ?? "?"} 题
            </span>
            <Button size="sm" disabled={busy} onClick={() => allowSection(h)}>放行整科</Button>
          </div>
        ))}
        {resolved.length > 0 && (
          <div style={{ padding: "10px 14px", fontSize: 11, color: C.t3 }}>
            已放行 {resolved.length} 项：{resolved.map((h) => `${h.set}/${h.section}`).join("、")}
          </div>
        )}
      </SectionCard>

      <SectionCard title="下架单题 / 单条">
        <form onSubmit={submitHold} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label style={{ ...label, flex: "1 1 160px" }}>
              题库文件
              <select value={form.file} onChange={(e) => setForm((f) => ({ ...f, file: e.target.value }))} style={{ ...input, background: "#fff" }}>
                {HOLD_FILES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label style={{ ...label, flex: "2 1 220px" }}>
              题目 id
              <input value={form.id} onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))} placeholder="real_ap_xxx_1_101" style={input} />
            </label>
            <label style={{ ...label, flex: "1 1 180px" }}>
              粒度
              <select value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))} style={{ ...input, background: "#fff" }}>
                {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
          </div>
          {form.scope === "question" && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <label style={{ ...label, flex: "0 0 100px" }}>
                题目下标 q
                <input value={form.q} onChange={(e) => setForm((f) => ({ ...f, q: e.target.value }))} placeholder="0" style={input} />
              </label>
              <label style={{ ...label, flex: "1 1 260px" }}>
                stem 前缀（防下标漂移误扣）
                <input value={form.stem} onChange={(e) => setForm((f) => ({ ...f, stem: e.target.value }))} placeholder="题干前 30~40 字，原样复制" style={input} />
              </label>
            </div>
          )}
          {form.scope === "sentence" && (
            <label style={label}>
              句子 id（sid）
              <input value={form.sid} onChange={(e) => setForm((f) => ({ ...f, sid: e.target.value }))} style={input} />
            </label>
          )}
          {form.scope === "iq" && (
            <label style={label}>
              面试题 id（qid）
              <input value={form.qid} onChange={(e) => setForm((f) => ({ ...f, qid: e.target.value }))} style={input} />
            </label>
          )}
          <label style={label}>
            下架理由
            <input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="如：材料被截断，Q2 在原文里无依据" style={input} />
          </label>
          <div>
            <Button type="submit" disabled={busy}>提交下架并重建</Button>
            <span style={{ fontSize: 11, color: C.t3, marginLeft: 10 }}>
              写进 data/realBank/review-holds.json 并提交 main，然后自动派 rebuild 任务。
            </span>
          </div>
        </form>
      </SectionCard>

      <SectionCard title={`已有下架清单（${(data?.repoHolds || []).length}）`} padding={0}>
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {(data?.repoHolds || []).map((h, i) => (
            <div key={`${h.file}|${h.id}|${h.scope}|${i}`} style={{ padding: "8px 14px", borderBottom: `1px solid ${C.bdr}`, fontSize: 12, color: C.t2 }}>
              <span style={{ fontFamily: "monospace", color: C.t1 }}>{h.file} · {h.id}</span>
              <Badge color="#64748b">{h.scope}</Badge>
              <div style={{ color: C.t3, marginTop: 2 }}>{h.reason}</div>
            </div>
          ))}
          {!(data?.repoHolds || []).length && <div style={{ padding: 16, fontSize: 12, color: C.t3 }}>（空）</div>}
        </div>
      </SectionCard>

      <SectionCard title={`放行清单（${(data?.allow || []).length}）`} padding={0}>
        <div style={{ maxHeight: 220, overflowY: "auto" }}>
          {(data?.allow || []).map((a, i) => (
            <div key={`${a.set}|${a.section}|${a.code}|${i}`} style={{ padding: "8px 14px", borderBottom: `1px solid ${C.bdr}`, fontSize: 12, color: C.t2 }}>
              <span style={{ color: C.t1, fontWeight: 600 }}>{a.set}</span> · {a.section} · <code>{a.code}</code>
              <div style={{ color: C.t3, marginTop: 2 }}>{a.reason} — {a.by} {String(a.at || "").slice(0, 16)}</div>
            </div>
          ))}
          {!(data?.allow || []).length && <div style={{ padding: 16, fontSize: 12, color: C.t3 }}>（空）</div>}
        </div>
      </SectionCard>
    </div>
  );
}
