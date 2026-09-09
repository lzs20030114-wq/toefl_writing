"use client";
import { useMemo, useRef, useState } from "react";
import { SectionCard, Button, InlineAlert, Badge } from "../primitives";
import { callAdminApi } from "../../../lib/adminHelpers";
import { C } from "../../shared/ui";
import { supabase } from "../../../lib/supabase";
import { validateSetName, validateFiles, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES } from "../../../lib/realBankIngest/validate";
import { collectFromDataTransfer, collectFromInput, stripCommonRoot, formatBytes } from "./fileDrop";

const BUCKET = "real_bank_sources";
const CONCURRENCY = 3; // 再多就容易撞 Supabase 的并发上传限制，且浏览器内存吃紧
const SOURCE_OPTIONS = [
  { value: "auto", label: "自动探测（推荐）" },
  { value: "first_pdf", label: "第一来源 PDF" },
  { value: "vendor_docx", label: "商家 docx" },
  { value: "screenshot_docx", label: "截图 docx" },
];

/** 并发跑 tasks，每个是 () => Promise。失败不中断其余任务（逐文件可重试）。 */
async function runPool(tasks, size) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, tasks.length) }, async () => {
    while (i < tasks.length) {
      const idx = i;
      i += 1;
      await tasks[idx]();
    }
  });
  await Promise.all(workers);
}

export default function NewJobPanel({ onJobStarted }) {
  const [setName, setSetName] = useState("");
  const [sourceKind, setSourceKind] = useState("auto");
  const [items, setItems] = useState([]); // {file, path, status, error}
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [uploads, setUploads] = useState(null); // path → {objectPath, token}
  const [jobId, setJobId] = useState(null);
  const fileRef = useRef(null);
  const dirRef = useRef(null);

  const totalBytes = useMemo(() => items.reduce((s, it) => s + it.file.size, 0), [items]);
  const doneCount = items.filter((it) => it.status === "done").length;
  const failedCount = items.filter((it) => it.status === "error").length;

  // 前端先跑一遍和服务端同一份校验：超限的直接标红，不浪费一次建 job。
  const limitError = useMemo(() => {
    if (!items.length) return null;
    const r = validateFiles(items.map((it) => ({ path: it.path, size: it.file.size })));
    return r.ok ? null : r.error;
  }, [items]);

  function addItems(next) {
    const merged = stripCommonRoot(next).map((n) => ({ ...n, status: "pending", error: null }));
    setItems((prev) => {
      const byPath = new Map(prev.map((p) => [p.path, p]));
      for (const m of merged) byPath.set(m.path, m);
      return [...byPath.values()];
    });
    setUploads(null);
    setJobId(null);
    setMsg(null);
  }

  async function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    addItems(await collectFromDataTransfer(e.dataTransfer));
  }

  function reset() {
    setItems([]);
    setUploads(null);
    setJobId(null);
    setMsg(null);
  }

  async function uploadOne(it, table) {
    const u = table[it.path];
    if (!u) throw new Error("缺少上传地址");
    if (!supabase) throw new Error("Supabase 未配置（缺 NEXT_PUBLIC_SUPABASE_* 环境变量）");
    const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(u.objectPath, u.token, it.file);
    if (error) throw new Error(error.message || "上传失败");
  }

  function mark(path, patch) {
    setItems((prev) => prev.map((p) => (p.path === path ? { ...p, ...patch } : p)));
  }

  async function startUpload() {
    const nameCheck = validateSetName(setName);
    if (!nameCheck.ok) return setMsg({ tone: "error", text: nameCheck.error });
    if (!items.length) return setMsg({ tone: "error", text: "先拖入源文件" });
    if (limitError) return setMsg({ tone: "error", text: limitError });

    setBusy(true);
    setMsg({ tone: "info", text: "建任务并签发上传地址…" });
    try {
      const body = await callAdminApi("/api/admin/real-bank-ingest/jobs", {
        method: "POST",
        body: JSON.stringify({
          set_name: nameCheck.value,
          source_kind: sourceKind,
          files: items.map((it) => ({ path: it.path, size: it.file.size })),
        }),
      });
      const table = {};
      for (const u of body.uploads || []) table[u.path] = u;
      setUploads(table);
      setJobId(body.job.id);
      await doUpload(items, table, body.job.id);
    } catch (e) {
      setMsg({ tone: "error", text: String(e.message || e) });
    } finally {
      setBusy(false);
    }
  }

  async function doUpload(list, table, id) {
    setMsg({ tone: "info", text: `上传中（${list.length} 个文件，${formatBytes(totalBytes)}）…` });
    const failed = [];
    await runPool(
      list.map((it) => async () => {
        mark(it.path, { status: "uploading", error: null });
        try {
          await uploadOne(it, table);
          mark(it.path, { status: "done" });
        } catch (e) {
          failed.push(it.path);
          mark(it.path, { status: "error", error: String(e.message || e) });
        }
      }),
      CONCURRENCY
    );
    if (failed.length) {
      setMsg({ tone: "error", text: `${failed.length} 个文件上传失败，可以逐个重试后再启动。` });
      return;
    }
    setMsg({ tone: "info", text: "上传完成，正在启动录入…" });
    const started = await callAdminApi(`/api/admin/real-bank-ingest/jobs/${id}/start`, { method: "POST" });
    setMsg({ tone: "success", text: `已派工到 GitHub Actions（任务 ${String(id).slice(0, 8)}），下面的任务列表会实时更新。` });
    reset();
    setSetName("");
    if (onJobStarted) onJobStarted(started.job);
  }

  async function retryOne(path) {
    if (!uploads || !jobId) return;
    const it = items.find((p) => p.path === path);
    if (!it) return;
    setBusy(true);
    mark(path, { status: "uploading", error: null });
    try {
      await uploadOne(it, uploads);
      mark(path, { status: "done" });
      const rest = items.filter((p) => p.path !== path && p.status !== "done");
      if (!rest.length) {
        const started = await callAdminApi(`/api/admin/real-bank-ingest/jobs/${jobId}/start`, { method: "POST" });
        setMsg({ tone: "success", text: `已派工到 GitHub Actions（任务 ${String(jobId).slice(0, 8)}）。` });
        reset();
        if (onJobStarted) onJobStarted(started.job);
      }
    } catch (e) {
      mark(path, { status: "error", error: String(e.message || e) });
      setMsg({ tone: "error", text: String(e.message || e) });
    } finally {
      setBusy(false);
    }
  }

  const statusBadge = (s) =>
    s === "done" ? <Badge color="#16a34a">已传</Badge>
      : s === "uploading" ? <Badge color="#2563eb">上传中</Badge>
        : s === "error" ? <Badge color="#dc2626">失败</Badge>
          : <Badge color="#64748b">待传</Badge>;

  return (
    <SectionCard
      title="新建录入"
      right={items.length ? <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>清空</Button> : null}
    >
      {msg && <div style={{ marginBottom: 12 }}><InlineAlert tone={msg.tone}>{msg.text}</InlineAlert></div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ flex: "2 1 240px", fontSize: 12, color: C.t2 }}>
          套名（也是源目录名）
          <input
            value={setName}
            onChange={(e) => setSetName(e.target.value)}
            placeholder="如 9.12新托福真题"
            disabled={busy}
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", border: `1px solid ${C.bdr}`, borderRadius: 8, fontSize: 13 }}
          />
        </label>
        <label style={{ flex: "1 1 180px", fontSize: 12, color: C.t2 }}>
          源格式
          <select
            value={sourceKind}
            onChange={(e) => setSourceKind(e.target.value)}
            disabled={busy}
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", border: `1px solid ${C.bdr}`, borderRadius: 8, fontSize: 13, background: "#fff" }}
          >
            {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragOver ? C.nav : C.bdr}`,
          background: dragOver ? "#eff6ff" : "#f8fafc",
          borderRadius: 12,
          padding: "28px 18px",
          textAlign: "center",
          opacity: busy ? 0.7 : 1,
        }}
      >
        <div style={{ fontSize: 30, lineHeight: 1, marginBottom: 8 }}>📂</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.t1 }}>把一整套真题源（文件夹）拖到这里</div>
        <div style={{ fontSize: 12, color: C.t3, marginTop: 6, lineHeight: 1.7 }}>
          支持整个文件夹（保留子目录结构）· 单文件 ≤ {Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB ·
          总量 ≤ {Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB · 最多 {MAX_FILES} 个文件
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
          <Button variant="secondary" size="sm" onClick={() => dirRef.current?.click()} disabled={busy}>选择文件夹</Button>
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>选择文件</Button>
        </div>
        <input
          ref={dirRef} type="file" multiple webkitdirectory="" directory="" style={{ display: "none" }}
          onChange={(e) => { addItems(collectFromInput(e.target.files)); e.target.value = ""; }}
        />
        <input
          ref={fileRef} type="file" multiple style={{ display: "none" }}
          onChange={(e) => { addItems(collectFromInput(e.target.files)); e.target.value = ""; }}
        />
      </div>

      {limitError && <div style={{ marginTop: 12 }}><InlineAlert tone="error">{limitError}</InlineAlert></div>}

      {items.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: C.t2 }}>
              {items.length} 个文件 · {formatBytes(totalBytes)}
              {doneCount ? ` · 已传 ${doneCount}` : ""}{failedCount ? ` · 失败 ${failedCount}` : ""}
            </span>
            <Button onClick={startUpload} disabled={busy || !!limitError || !setName.trim()}>
              {busy ? "处理中…" : "上传并开始录入"}
            </Button>
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto", border: `1px solid ${C.bdr}`, borderRadius: 8 }}>
            {items.map((it) => (
              <div key={it.path} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                borderBottom: `1px solid ${C.bdr}`, fontSize: 12,
                background: it.file.size > MAX_FILE_BYTES ? "#fef2f2" : "#fff",
              }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.t1 }} title={it.path}>
                  {it.path}
                </span>
                <span style={{ color: C.t3 }}>{formatBytes(it.file.size)}</span>
                {statusBadge(it.status)}
                {it.status === "error" && (
                  <Button variant="ghost" size="sm" onClick={() => retryOne(it.path)} disabled={busy}>重试</Button>
                )}
              </div>
            ))}
          </div>
          {failedCount > 0 && (
            <div style={{ fontSize: 11, color: C.t3, marginTop: 6 }}>
              失败文件逐个重试即可；全部传完会自动启动录入。
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
