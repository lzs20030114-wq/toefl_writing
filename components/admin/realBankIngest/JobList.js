"use client";
import { useState } from "react";
import { SectionCard, Button, Badge, InlineAlert } from "../primitives";
import { callAdminApi, fmtDate, relativeTime } from "../../../lib/adminHelpers";
import { C } from "../../shared/ui";
import { formatBytes } from "./fileDrop";

const STATUS = {
  uploading: { label: "上传中", color: "#64748b" },
  queued: { label: "排队", color: "#d97706" },
  dispatched: { label: "已派工", color: "#2563eb" },
  running: { label: "运行中", color: "#2563eb" },
  needs_format: { label: "待选格式", color: "#d97706" },
  done: { label: "完成", color: "#16a34a" },
  failed: { label: "失败", color: "#dc2626" },
  cancelled: { label: "已取消", color: "#94a3b8" },
};
const SOURCE_LABEL = {
  auto: "自动", first_pdf: "第一来源PDF", vendor_docx: "商家docx", screenshot_docx: "截图docx",
};
const FORMAT_CHOICES = ["first_pdf", "vendor_docx", "screenshot_docx"];

function ResultSummary({ result, gh }) {
  if (!result) return <span style={{ color: C.t3, fontSize: 12 }}>无结果</span>;
  const added = result.added || {};
  const addedTotal = Object.values(added).reduce((s, n) => s + (Number(n) || 0), 0);
  const audit = result.audit || {};
  const holds = Array.isArray(result.holds) ? result.holds : [];
  return (
    <div style={{ fontSize: 12, color: C.t2, lineHeight: 1.9 }}>
      <div>
        <b style={{ color: C.t1 }}>入库 {addedTotal} 题</b>
        {Object.keys(added).length > 0 && (
          <span style={{ color: C.t3 }}>
            （{Object.entries(added).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(" · ")}）
          </span>
        )}
      </div>
      {Object.keys(audit).length > 0 && (
        <div>
          盲审一致率：{Object.entries(audit).map(([sec, a]) => {
            const total = Number(a?.total) || 0;
            const rate = total ? Math.round(((Number(a?.agree) || 0) / total) * 100) : null;
            return `${sec} ${rate == null ? "--" : `${rate}%`}(${a?.agree ?? "?"}/${total})`;
          }).join(" · ")}
        </div>
      )}
      <div>
        扣下 {holds.length} 项
        {result.audio ? ` · 配音 ${result.audio.rendered ?? 0} 条` : ""}
        {result.images ? ` · 材料图 ${result.images.uploaded ?? 0} 张` : ""}
      </div>
      {result.commit && (
        <div>
          提交：
          <a
            href={`https://github.com/${gh?.owner}/${gh?.repo}/commit/${result.commit}`}
            target="_blank" rel="noreferrer"
            style={{ color: C.blue, fontFamily: "monospace" }}
          >
            {String(result.commit).slice(0, 7)}
          </a>
        </div>
      )}
    </div>
  );
}

function ProgressLog({ progress }) {
  if (!progress || !progress.length) return <div style={{ fontSize: 12, color: C.t3 }}>暂无进度日志</div>;
  return (
    <div style={{
      maxHeight: 260, overflowY: "auto", background: "#0f172a", borderRadius: 8,
      padding: 10, fontFamily: "monospace", fontSize: 11, lineHeight: 1.7,
    }}>
      {progress.map((p, i) => (
        <div key={i} style={{ color: p.level === "error" ? "#fca5a5" : p.level === "warn" ? "#fcd34d" : "#cbd5e1" }}>
          <span style={{ color: "#64748b" }}>{String(p.ts || "").slice(11, 19)} </span>
          <span style={{ color: "#38bdf8" }}>[{p.stage || "-"}] </span>
          {p.msg}
        </div>
      ))}
    </div>
  );
}

export default function JobList({ jobs, gh, loading, onRefresh, onAction }) {
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [fmt, setFmt] = useState({});
  const [err, setErr] = useState(null);

  async function toggle(job) {
    if (openId === job.id) { setOpenId(null); setDetail(null); return; }
    setOpenId(job.id);
    setDetail(null);
    try {
      const body = await callAdminApi(`/api/admin/real-bank-ingest/jobs/${job.id}`);
      setDetail(body.job);
    } catch (e) {
      setErr(String(e.message || e));
    }
  }

  async function act(job, path, payload) {
    setBusyId(job.id);
    setErr(null);
    try {
      await callAdminApi(`/api/admin/real-bank-ingest/jobs/${job.id}/${path}`, {
        method: "POST",
        body: JSON.stringify(payload || {}),
      });
      if (onAction) onAction();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SectionCard
      title="录入任务"
      right={<Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>{loading ? "刷新中…" : "刷新"}</Button>}
      padding={0}
    >
      {err && <div style={{ padding: 12 }}><InlineAlert tone="error">{err}</InlineAlert></div>}
      {!jobs.length && <div style={{ padding: 20, fontSize: 13, color: C.t3, textAlign: "center" }}>还没有任务</div>}
      {jobs.map((job) => {
        const s = STATUS[job.status] || { label: job.status, color: "#64748b" };
        const isOpen = openId === job.id;
        const busy = busyId === job.id;
        return (
          <div key={job.id} style={{ borderBottom: `1px solid ${C.bdr}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", flexWrap: "wrap" }}>
              <button
                onClick={() => toggle(job)}
                style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 700, color: C.t1, padding: 0, textAlign: "left" }}
              >
                {isOpen ? "▾ " : "▸ "}{job.set_name}
              </button>
              <Badge color={s.color}>{s.label}</Badge>
              {job.kind === "rebuild" && <Badge color="#7c3aed">rebuild</Badge>}
              <span style={{ fontSize: 11, color: C.t3 }}>
                {SOURCE_LABEL[job.detected_kind || job.source_kind] || job.source_kind}
                {job.stage ? ` · ${job.stage}` : ""}
                {job.file_count ? ` · ${job.file_count} 文件 ${formatBytes(job.total_bytes)}` : ""}
              </span>
              <span style={{ flex: 1, minWidth: 120, fontSize: 11, color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {job.error ? <span style={{ color: "#dc2626" }}>{job.error}</span> : job.last_progress?.msg || ""}
              </span>
              <span style={{ fontSize: 11, color: C.t3 }}>
                ¥{Number(job.cost_cny || 0).toFixed(2)} · {relativeTime(job.created_at)}
              </span>
              {job.gh_run_id && (
                <a
                  href={`https://github.com/${gh?.owner}/${gh?.repo}/actions/runs/${job.gh_run_id}`}
                  target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.blue }}
                >
                  Actions ↗
                </a>
              )}
              {job.status === "needs_format" && (
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select
                    value={fmt[job.id] || "first_pdf"}
                    onChange={(e) => setFmt((p) => ({ ...p, [job.id]: e.target.value }))}
                    style={{ fontSize: 12, padding: "4px 6px", borderRadius: 6, border: `1px solid ${C.bdr}` }}
                  >
                    {FORMAT_CHOICES.map((v) => <option key={v} value={v}>{SOURCE_LABEL[v]}</option>)}
                  </select>
                  <Button size="sm" disabled={busy} onClick={() => act(job, "format", { source_kind: fmt[job.id] || "first_pdf" })}>
                    确认格式
                  </Button>
                </span>
              )}
              {job.status === "failed" && (
                <Button size="sm" disabled={busy} onClick={() => act(job, "retry")}>重试</Button>
              )}
              {["uploading", "queued", "needs_format", "failed"].includes(job.status) && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(job, "cancel")}>取消</Button>
              )}
            </div>

            {isOpen && (
              <div style={{ padding: "0 14px 14px", display: "grid", gap: 12 }}>
                <div style={{ fontSize: 11, color: C.t3 }}>
                  任务 {job.id} · 创建 {fmtDate(job.created_at)} · 更新 {fmtDate(job.updated_at)}
                </div>
                <ResultSummary result={detail ? detail.result : job.result} gh={gh} />
                <ProgressLog progress={detail?.progress} />
                {detail?.result?.holds?.length > 0 && (
                  <div style={{ fontSize: 12, color: C.t2 }}>
                    扣下的科目：{detail.result.holds.map((h) => `${h.section}(${h.code})`).join("、")} —— 到「复核队列」处理
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </SectionCard>
  );
}
