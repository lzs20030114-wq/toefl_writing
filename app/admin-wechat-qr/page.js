"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { PageHeader, SectionCard, Button, InlineAlert, KV } from "../../components/admin/primitives";
import { useAdminToken, callAdminApi, fmtDate, relativeTime } from "../../lib/adminHelpers";
import { C } from "../../components/shared/ui";

const API = "/api/admin/wechat-qr";
const PUBLIC_SRC = "/api/wechat-qr";
const MAX_MB = 3;
const ACCEPT = "image/jpeg,image/png,image/webp";

function formatBytes(n) {
  if (n == null) return "--";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function pickImageFile(fileList) {
  const files = Array.from(fileList || []);
  return files.find((f) => f && /^image\//.test(f.type)) || files[0] || null;
}

export default function AdminWechatQrPage() {
  const { token, ready } = useAdminToken();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { tone, text }
  const [dragOver, setDragOver] = useState(false);
  const [previewVer, setPreviewVer] = useState(() => Date.now());
  const [pending, setPending] = useState(null); // { file, url } 本地待上传预览
  const inputRef = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const body = await callAdminApi(API, { method: "GET" });
      setStatus(body);
    } catch (e) {
      setMsg({ tone: "error", text: String(e.message || e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready && token) refresh();
  }, [ready, token, refresh]);

  // 释放本地预览 URL
  useEffect(() => () => { if (pending?.url) URL.revokeObjectURL(pending.url); }, [pending]);

  async function upload(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setMsg({ tone: "error", text: "仅支持 JPEG / PNG / WebP 图片" });
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setMsg({ tone: "error", text: `图片过大（>${MAX_MB}MB），请压缩后重试` });
      return;
    }
    setPending({ file, url: URL.createObjectURL(file) });
    setBusy(true);
    setMsg({ tone: "info", text: "上传中…" });
    try {
      const fd = new FormData();
      fd.append("image", file, file.name || "qr");
      // multipart 不能带 JSON Content-Type：绕开 callAdminApi 的默认头，手动发。
      const res = await fetch(API, { method: "POST", headers: { "x-admin-token": token }, body: fd });
      const text = await res.text();
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setMsg({ tone: "success", text: "二维码已更新。线上用户最多约 2 分钟内看到新图，不需要重新部署。" });
      setPending(null);
      setPreviewVer(Date.now());
      await refresh();
    } catch (e) {
      setMsg({ tone: "error", text: `上传失败：${String(e.message || e)}` });
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  async function restoreDefault() {
    if (!window.confirm("确定删除自定义二维码，恢复为代码内置的默认图？")) return;
    setBusy(true);
    setMsg(null);
    try {
      await callAdminApi(API, { method: "DELETE" });
      setMsg({ tone: "success", text: "已恢复默认二维码。" });
      setPreviewVer(Date.now());
      await refresh();
    } catch (e) {
      setMsg({ tone: "error", text: String(e.message || e) });
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    upload(pickImageFile(e.dataTransfer?.files));
  }

  // 全页监听粘贴：随便在页面哪里 Ctrl+V 一张截图都能传，不要求先点中某个元素。
  useEffect(() => {
    function onPaste(e) {
      if (busy || !token) return;
      const items = Array.from(e.clipboardData?.items || []);
      const it = items.find((i) => i.kind === "file" && /^image\//.test(i.type));
      if (it) { e.preventDefault(); upload(it.getAsFile()); }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const previewSrc = pending?.url || `${PUBLIC_SRC}?v=${previewVer}`;
  const hasToken = !!token;

  return (
    <AdminLayout title="微信群二维码">
      <div className="adm-page" style={{ maxWidth: 900, margin: "0 auto" }}>
        <PageHeader
          title="微信群二维码"
          subtitle="把新的群二维码拖进下面的框里就生效，不用改代码、不用重新部署。"
          right={<Button variant="secondary" onClick={refresh} disabled={loading || !hasToken}>{loading ? "加载中…" : "刷新"}</Button>}
        />

        {!hasToken && ready && (
          <div style={{ marginBottom: 14 }}>
            <InlineAlert tone="warn">缺少管理员口令，请先在其他后台页输入 ADMIN_DASHBOARD_TOKEN。</InlineAlert>
          </div>
        )}
        {msg && <div style={{ marginBottom: 14 }}><InlineAlert tone={msg.tone}>{msg.text}</InlineAlert></div>}

        <div className="adm-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <SectionCard title="上传新图">
            <div
              role="button"
              tabIndex={0}
              aria-label="拖拽或点击上传新的群二维码"
              onClick={() => !busy && inputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
              onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              style={{
                border: `2px dashed ${dragOver ? C.nav : C.bdr}`,
                background: dragOver ? "#eff6ff" : "#f8fafc",
                borderRadius: 12,
                padding: "40px 20px",
                textAlign: "center",
                cursor: busy ? "wait" : "pointer",
                transition: "border-color 0.12s, background 0.12s",
                opacity: busy ? 0.7 : 1,
              }}
            >
              <div style={{ fontSize: 36, lineHeight: 1, marginBottom: 10 }}>🖼️</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.t1 }}>
                {busy ? "上传中…" : "把新二维码图片拖到这里"}
              </div>
              <div style={{ fontSize: 12, color: C.t3, marginTop: 6 }}>
                或点击选择文件 / 直接 Ctrl+V 粘贴截图 · JPEG / PNG / WebP · ≤ {MAX_MB}MB
              </div>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                style={{ display: "none" }}
                onChange={(e) => { upload(pickImageFile(e.target.files)); e.target.value = ""; }}
              />
            </div>
            <div style={{ fontSize: 12, color: C.t3, marginTop: 12, lineHeight: 1.6 }}>
              图片存到 Supabase Storage，前台通过同源代理 <code>/api/wechat-qr</code> 读取（国内可达）。
              拖进来就自动上传并覆盖旧图；首页侧栏、移动端首页、反馈弹窗里的二维码全部同步。
            </div>
          </SectionCard>

          <SectionCard
            title="当前线上二维码"
            right={status?.exists && (
              <Button variant="ghost" size="sm" onClick={restoreDefault} disabled={busy}>恢复默认图</Button>
            )}
          >
            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 14px" }}>
              <img
                key={previewSrc}
                src={previewSrc}
                alt="当前微信群二维码"
                style={{
                  width: 220, height: 220, objectFit: "contain",
                  borderRadius: 8, border: "1px solid " + C.bdr, background: "#fff",
                  opacity: pending ? 0.6 : 1,
                }}
              />
            </div>
            <KV label="来源">
              {status == null ? "--"
                : !status.configured ? "Storage 未配置（显示代码内置默认图）"
                : status.exists ? "后台上传的自定义图"
                : "代码内置默认图（public/wechat-group-qr.jpg）"}
            </KV>
            {status?.exists && (
              <>
                <KV label="更新时间">{fmtDate(status.updatedAt)} <span style={{ color: C.t3 }}>({relativeTime(status.updatedAt)})</span></KV>
                <KV label="大小">{formatBytes(status.size)}</KV>
                <KV label="格式" mono>{status.mime || "--"}</KV>
              </>
            )}
          </SectionCard>
        </div>
      </div>
    </AdminLayout>
  );
}
