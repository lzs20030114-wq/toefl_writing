"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { C, FONT } from "../../components/shared/ui";
import AdminLayout from "../../components/admin/AdminLayout";

const TOKEN_KEY = "toefl-admin-token";

function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

export default function AdminCodesPage() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState({ available: 0, issued: 0, revoked: 0, total: 0 });
  const [rows, setRows] = useState([]);
  const [usageByCode, setUsageByCode] = useState({});
  const [statusFilter, setStatusFilter] = useState("");
  const [count, setCount] = useState(10);
  const [issueCode, setIssueCode] = useState("");
  const [issueTo, setIssueTo] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [revokeCode, setRevokeCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedByCode, setSelectedByCode] = useState({});
  const [editingNote, setEditingNote] = useState(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [showTrash, setShowTrash] = useState(false);

  useEffect(() => {
    try {
      setToken(localStorage.getItem(TOKEN_KEY) || "");
    } catch {
      // no-op
    } finally {
      setReady(true);
    }
  }, []);

  const hasToken = token.trim().length > 0;

  function persistToken(v) {
    setToken(v);
    try {
      localStorage.setItem(TOKEN_KEY, v);
    } catch {
      // no-op
    }
  }

  async function callAdminApi(path, options = {}) {
    if (!token.trim()) {
      throw new Error("缺少管理员口令，请先输入 ADMIN_DASHBOARD_TOKEN。");
    }
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": token.trim(),
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    return body;
  }

  async function refresh() {
    if (!hasToken) return;
    setBusy(true);
    setMsg("");
    try {
      const q = statusFilter ? `?status=${encodeURIComponent(statusFilter)}&limit=200&includeUsage=1` : "?limit=200&includeUsage=1";
      const body = await callAdminApi(`/api/admin/codes${q}`, { method: "GET" });
      setRows(Array.isArray(body.codes) ? body.codes : []);
      setStats(body.stats || { available: 0, issued: 0, revoked: 0, total: 0 });
      setUsageByCode(body.usageByCode || {});
      setSelectedByCode({});
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function issueOneCode(code) {
    return callAdminApi("/api/admin/codes", {
      method: "POST",
      body: JSON.stringify({
        action: "issue",
        code: String(code || "").trim() || undefined,
        issuedTo: issueTo.trim() || undefined,
        expiresAt: expiresAt.trim() || undefined,
      }),
    });
  }

  async function revokeOneCode(code) {
    return callAdminApi("/api/admin/codes", {
      method: "POST",
      body: JSON.stringify({
        action: "revoke",
        code: String(code || "").trim().toUpperCase(),
      }),
    });
  }

  async function onGenerate() {
    setBusy(true);
    setMsg("");
    try {
      const body = await callAdminApi("/api/admin/codes", {
        method: "POST",
        body: JSON.stringify({ action: "generate", count: Number(count) || 10 }),
      });
      setMsg(`已生成 ${body.generated} 个登录码。`);
      await refresh();
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onIssue() {
    setBusy(true);
    setMsg("");
    try {
      const body = await issueOneCode(issueCode);
      setMsg(`发放成功：${body?.issued?.code || "未知"}`);
      setIssueCode("");
      await refresh();
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke() {
    if (!revokeCode.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      const body = await revokeOneCode(revokeCode);
      setMsg(`已吊销：${body?.revoked?.code || revokeCode.trim().toUpperCase()}`);
      setRevokeCode("");
      await refresh();
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  function toggleRowSelect(code) {
    setSelectedByCode((prev) => ({ ...prev, [code]: !prev[code] }));
  }

  function toggleSelectAllVisible() {
    const allSelected = rowsView.length > 0 && rowsView.every((r) => selectedByCode[r.code]);
    setSelectedByCode((prev) => {
      const next = { ...prev };
      rowsView.forEach((r) => {
        next[r.code] = !allSelected;
      });
      return next;
    });
  }

  async function batchIssueSelected() {
    const targets = rowsView.filter((r) => selectedByCode[r.code] && r.status === "available");
    if (targets.length === 0) {
      setMsg("请先选择可发放状态的登录码。");
      return;
    }
    setBusy(true);
    setMsg("");
    let success = 0;
    const failed = [];
    for (const item of targets) {
      try {
        await issueOneCode(item.code);
        success += 1;
      } catch {
        failed.push(item.code);
      }
    }
    setMsg(failed.length === 0 ? `批量发放完成：${success}/${targets.length}` : `批量发放完成：成功 ${success}，失败 ${failed.length}（${failed.slice(0, 8).join(", ")}）`);
    await refresh();
    setBusy(false);
  }

  async function batchRevokeSelected() {
    const targets = rowsView.filter((r) => selectedByCode[r.code] && r.status !== "revoked");
    if (targets.length === 0) {
      setMsg("请先选择可吊销的登录码。");
      return;
    }
    setBusy(true);
    setMsg("");
    let success = 0;
    const failed = [];
    for (const item of targets) {
      try {
        await revokeOneCode(item.code);
        success += 1;
      } catch {
        failed.push(item.code);
      }
    }
    setMsg(failed.length === 0 ? `批量吊销完成：${success}/${targets.length}` : `批量吊销完成：成功 ${success}，失败 ${failed.length}（${failed.slice(0, 8).join(", ")}）`);
    await refresh();
    setBusy(false);
  }

  async function quickIssue(code) {
    setBusy(true);
    setMsg("");
    try {
      const body = await issueOneCode(code);
      setMsg(`发放成功：${body?.issued?.code || code}`);
      await refresh();
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function quickRevoke(code) {
    setBusy(true);
    setMsg("");
    try {
      const body = await revokeOneCode(code);
      setMsg(`已吊销：${body?.revoked?.code || code}`);
      await refresh();
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function restoreCode(code) {
    setBusy(true);
    setMsg("");
    try {
      await callAdminApi("/api/admin/codes", {
        method: "POST",
        body: JSON.stringify({ action: "restore", code }),
      });
      setMsg(`已恢复：${code}`);
      await refresh();
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteCode(code) {
    if (!confirm(`确定要彻底删除 ${code} 吗？此操作不可恢复。`)) return;
    setBusy(true);
    setMsg("");
    try {
      await callAdminApi("/api/admin/codes", {
        method: "POST",
        body: JSON.stringify({ action: "delete", code }),
      });
      setMsg(`已彻底删除：${code}`);
      await refresh();
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  function startEditNote(code, currentNote) {
    setEditingNote(code);
    setEditingNoteText(currentNote || "");
  }

  function cancelEditNote() {
    setEditingNote(null);
    setEditingNoteText("");
  }

  async function saveNote(code) {
    setBusy(true);
    setMsg("");
    try {
      await callAdminApi("/api/admin/codes", {
        method: "POST",
        body: JSON.stringify({ action: "update-note", code, note: editingNoteText.trim() }),
      });
      setRows((prev) => prev.map((r) => r.code === code ? { ...r, note: editingNoteText.trim() } : r));
      setEditingNote(null);
      setEditingNoteText("");
      setMsg(`备注已更新：${code}`);
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (ready && hasToken) refresh();
  }, [ready, statusFilter, token]);

  const [showPregen, setShowPregen] = useState(true);
  // Pre-generated codes that haven't been activated yet
  const pregenRows = useMemo(() => rows.filter((r) => r.issued_to === "pre-generated" && usageByCode[r.code]?.userStatus === "pending"), [rows, usageByCode]);
  const pregenCodes = useMemo(() => new Set(pregenRows.map((r) => r.code)), [pregenRows]);
  const rowsView = useMemo(() => rows.filter((r) => r.status !== "revoked" && !pregenCodes.has(r.code)).slice(0, 200), [rows, pregenCodes]);
  const revokedRows = useMemo(() => rows.filter((r) => r.status === "revoked"), [rows]);
  const selectedCount = useMemo(() => rowsView.filter((r) => selectedByCode[r.code]).length, [rowsView, selectedByCode]);
  const allVisibleSelected = rowsView.length > 0 && rowsView.every((r) => selectedByCode[r.code]);

  return (
    <AdminLayout title="登录码管理">
      <div style={{ maxWidth: 1160, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.nav }}>登录码管理后台</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Link href="/admin-activity" style={{ color: C.blue, textDecoration: "none", fontSize: 13 }}>去答题情况</Link>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center" }}>
            <input
              value={token}
              onChange={(e) => persistToken(e.target.value)}
              placeholder="ADMIN_DASHBOARD_TOKEN"
              style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}
            />
            <button onClick={refresh} disabled={busy} style={{ border: "1px solid " + C.blue, background: C.blue, color: "#fff", borderRadius: 6, padding: "8px 10px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
              刷新
            </button>
            <button onClick={() => { persistToken(""); setRows([]); setStats({ available: 0, issued: 0, revoked: 0, total: 0 }); }} style={{ border: "1px solid #cbd5e1", background: "#fff", color: C.t2, borderRadius: 6, padding: "8px 10px", cursor: "pointer" }}>
              清空
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {[
            ["总量", stats.total],
            ["可发放", stats.available],
            ["已发放", stats.issued],
            ["已吊销", stats.revoked],
          ].map(([k, v]) => (
            <div key={k} style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, color: C.t2 }}>{k}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.nav }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 700 }}>批量生成登录码</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="number" min={1} max={500} value={count} onChange={(e) => setCount(Number(e.target.value || 10))} style={{ width: 120, border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px" }} />
            <button onClick={onGenerate} disabled={busy} style={{ border: "1px solid " + C.blue, background: C.blue, color: "#fff", borderRadius: 6, padding: "8px 10px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
              生成
            </button>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 700 }}>发放登录码</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(160px, 1fr)) auto", gap: 8 }}>
            <input value={issueCode} onChange={(e) => setIssueCode(e.target.value.toUpperCase())} placeholder="指定登录码（可选）" style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px", fontFamily: "monospace" }} />
            <input value={issueTo} onChange={(e) => setIssueTo(e.target.value)} placeholder="发放对象（邮箱/显示名）" style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px" }} />
            <input value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} placeholder="到期时间（ISO，可选）" style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px" }} />
            <div />
            <button onClick={onIssue} disabled={busy} style={{ border: "1px solid " + C.blue, background: C.blue, color: "#fff", borderRadius: 6, padding: "8px 10px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
              发放
            </button>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 700 }}>吊销登录码</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={revokeCode} onChange={(e) => setRevokeCode(e.target.value.toUpperCase())} placeholder="输入要吊销的登录码" style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px", fontFamily: "monospace", minWidth: 220 }} />
            <button onClick={onRevoke} disabled={busy} style={{ border: "1px solid " + C.red, background: C.red, color: "#fff", borderRadius: 6, padding: "8px 10px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
              吊销
            </button>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700 }}>批量选择操作</div>
            <div style={{ fontSize: 12, color: C.t2 }}>当前已选：{selectedCount}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={toggleSelectAllVisible} disabled={busy || rowsView.length === 0} style={{ border: "1px solid #cbd5e1", background: "#fff", color: C.t2, borderRadius: 6, padding: "8px 10px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
              {allVisibleSelected ? "取消全选" : "全选当前列表"}
            </button>
            <button onClick={batchIssueSelected} disabled={busy || selectedCount === 0} style={{ border: "1px solid " + C.blue, background: C.blue, color: "#fff", borderRadius: 6, padding: "8px 10px", cursor: busy ? "not-allowed" : "pointer", opacity: busy || selectedCount === 0 ? 0.6 : 1 }}>
              批量发放所选
            </button>
            <button onClick={batchRevokeSelected} disabled={busy || selectedCount === 0} style={{ border: "1px solid " + C.red, background: C.red, color: "#fff", borderRadius: 6, padding: "8px 10px", cursor: busy ? "not-allowed" : "pointer", opacity: busy || selectedCount === 0 ? 0.6 : 1 }}>
              批量吊销所选
            </button>
          </div>
        </div>

        {/* Pre-generated codes vault */}
        {pregenRows.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, overflow: "hidden" }}>
            <button
              onClick={() => setShowPregen(!showPregen)}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 14px", background: "none", border: "none", cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>
                预生成码库（{pregenRows.length} 个待激活）
              </span>
              <span style={{ fontSize: 12, color: C.t3, transform: showPregen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
            </button>
            {showPregen && (
              <div style={{ borderTop: "1px solid " + C.bdr, padding: 14 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  {[7, 30, 90, 365].map((d) => {
                    const cnt = pregenRows.filter((r) => r.pro_days === d).length;
                    if (cnt === 0) return null;
                    return (
                      <span key={d} style={{ background: "#f3f0ff", color: "#7c3aed", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                        {d}天 × {cnt}
                      </span>
                    );
                  })}
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#f5f3ff", color: C.t2 }}>
                        <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e9e5ff" }}>登录码</th>
                        <th style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #e9e5ff" }}>时长</th>
                        <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e9e5ff" }}>生成时间</th>
                        <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e9e5ff" }}>备注</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pregenRows.map((r) => (
                        <tr key={r.code}>
                          <td style={{ padding: "8px 6px", borderBottom: "1px solid #f5f3ff", fontFamily: "monospace", fontWeight: 700 }}>{r.code}</td>
                          <td style={{ padding: "8px 6px", borderBottom: "1px solid #f5f3ff", textAlign: "center" }}>
                            <span style={{ background: "#ede9fe", color: "#6d28d9", borderRadius: 4, padding: "1px 6px", fontSize: 11, fontWeight: 700 }}>
                              {r.pro_days || 30}天
                            </span>
                          </td>
                          <td style={{ padding: "8px 6px", borderBottom: "1px solid #f5f3ff", color: C.t2 }}>{fmtDate(r.created_at)}</td>
                          <td style={{ padding: "8px 6px", borderBottom: "1px solid #f5f3ff", color: C.t2 }}>{r.note || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 700 }}>登录码列表</div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 8px" }}>
              <option value="">全部</option>
              <option value="available">可发放</option>
              <option value="issued">已发放</option>
              <option value="revoked">已吊销</option>
            </select>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", color: C.t2 }}>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0", width: 40 }}>选</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>登录码</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>状态</th>
                  <th style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>等级</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>发放对象</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>发放时间</th>
                  <th style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>答题量</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>最近活跃</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0", minWidth: 160 }}>备注</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0", minWidth: 220 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rowsView.map((r) => (
                  <tr key={r.code}>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>
                      <input
                        type="checkbox"
                        checked={!!selectedByCode[r.code]}
                        onChange={() => toggleRowSelect(r.code)}
                        disabled={busy}
                      />
                    </td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", fontFamily: "monospace", fontWeight: 700 }}>{r.code}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.status || "-"}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", textAlign: "center" }}>
                      {(() => {
                        const u = usageByCode[r.code];
                        if (!u?.tier) return <span style={{ color: C.t2 }}>-</span>;
                        const isLegacy = u.tier === "legacy";
                        const isPro = u.tier === "pro" && u.tierExpiresAt && new Date(u.tierExpiresAt) > new Date();
                        const label = isLegacy ? "Legacy" : isPro ? "Pro" : "Free";
                        const bg = isLegacy ? "#ede9fe" : isPro ? "#e8f5e9" : "#f5f5f5";
                        const color = isLegacy ? "#6d28d9" : isPro ? "#2e7d32" : C.t2;
                        return <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: bg, color }}>{label}</span>;
                      })()}
                    </td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.issued_to || "-"}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{fmtDate(r.issued_at)}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", textAlign: "center" }}>
                      {(() => {
                        const u = usageByCode[r.code];
                        if (!u || u.answered.total === 0) return <span style={{ color: C.t2 }}>-</span>;
                        return (
                          <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                            {u.answered.build > 0 && <span style={{ background: "#eff6ff", color: "#1d4ed8", borderRadius: 4, padding: "1px 5px", fontSize: 11, fontWeight: 600 }} title="连词成句">句{u.answered.build}</span>}
                            {u.answered.email > 0 && <span style={{ background: "#fef3c7", color: "#92400e", borderRadius: 4, padding: "1px 5px", fontSize: 11, fontWeight: 600 }} title="邮件写作">邮{u.answered.email}</span>}
                            {u.answered.discussion > 0 && <span style={{ background: "#ecfdf5", color: "#065f46", borderRadius: 4, padding: "1px 5px", fontSize: 11, fontWeight: 600 }} title="学术讨论">讨{u.answered.discussion}</span>}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>
                      {(() => {
                        const u = usageByCode[r.code];
                        if (!u?.lastActiveAt) return <span style={{ color: C.t2 }}>-</span>;
                        const d = new Date(u.lastActiveAt);
                        const diff = Date.now() - d.getTime();
                        const mins = Math.floor(diff / 60000);
                        if (mins < 60) return <span style={{ color: C.blue, fontWeight: 600 }}>{mins < 1 ? "刚刚" : `${mins}分钟前`}</span>;
                        const hours = Math.floor(mins / 60);
                        if (hours < 24) return <span style={{ color: C.blue }}>{hours}小时前</span>;
                        const days = Math.floor(hours / 24);
                        return <span style={{ color: days < 7 ? C.t1 : C.t2 }}>{days}天前</span>;
                      })()}
                    </td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>
                      {editingNote === r.code ? (
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <input
                            value={editingNoteText}
                            onChange={(e) => setEditingNoteText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveNote(r.code); if (e.key === "Escape") cancelEditNote(); }}
                            autoFocus
                            maxLength={500}
                            style={{ border: "1px solid #cbd5e1", borderRadius: 4, padding: "3px 6px", fontSize: 12, width: 120 }}
                          />
                          <button onClick={() => saveNote(r.code)} disabled={busy} style={{ border: "1px solid " + C.blue, background: C.blue, color: "#fff", borderRadius: 4, padding: "2px 6px", fontSize: 11, cursor: busy ? "not-allowed" : "pointer" }}>
                            保存
                          </button>
                          <button onClick={cancelEditNote} disabled={busy} style={{ border: "1px solid #cbd5e1", background: "#fff", color: C.t2, borderRadius: 4, padding: "2px 6px", fontSize: 11, cursor: "pointer" }}>
                            取消
                          </button>
                        </div>
                      ) : (
                        <span
                          onClick={() => startEditNote(r.code, r.note)}
                          title="点击编辑备注"
                          style={{ cursor: "pointer", color: r.note ? C.nav : C.t2, borderBottom: "1px dashed #cbd5e1", minWidth: 40, display: "inline-block" }}
                        >
                          {r.note || "添加备注"}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button onClick={() => setIssueCode(r.code)} disabled={busy} style={{ border: "1px solid #cbd5e1", background: "#fff", color: C.t2, borderRadius: 6, padding: "3px 8px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
                        填入发放框
                      </button>
                      {r.status === "available" && (
                        <button onClick={() => quickIssue(r.code)} disabled={busy} style={{ border: "1px solid " + C.blue, background: C.blue, color: "#fff", borderRadius: 6, padding: "3px 8px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
                          一键发放
                        </button>
                      )}
                      {r.status !== "revoked" && (
                        <button onClick={() => quickRevoke(r.code)} disabled={busy} style={{ border: "1px solid " + C.red, background: C.red, color: "#fff", borderRadius: 6, padding: "3px 8px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
                          一键吊销
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {rowsView.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ padding: 12, color: C.t2 }}>
                      暂无数据。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Trash / Revoked codes */}
        {revokedRows.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, overflow: "hidden" }}>
            <button
              onClick={() => setShowTrash(!showTrash)}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 14px", background: "none", border: "none", cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: C.t2 }}>
                回收站（{revokedRows.length} 个已吊销）
              </span>
              <span style={{ fontSize: 12, color: C.t3, transform: showTrash ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
            </button>
            {showTrash && (
              <div style={{ borderTop: "1px solid " + C.bdr, padding: 14 }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#fef2f2", color: C.t2 }}>
                        <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #fecaca" }}>登录码</th>
                        <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #fecaca" }}>发放对象</th>
                        <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #fecaca" }}>备注</th>
                        <th style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #fecaca" }}>答题量</th>
                        <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #fecaca", minWidth: 180 }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revokedRows.map((r) => {
                        const u = usageByCode[r.code];
                        return (
                          <tr key={r.code}>
                            <td style={{ padding: "8px 6px", borderBottom: "1px solid #fef2f2", fontFamily: "monospace", fontWeight: 700, color: C.t2 }}>{r.code}</td>
                            <td style={{ padding: "8px 6px", borderBottom: "1px solid #fef2f2", color: C.t2 }}>{r.issued_to || "-"}</td>
                            <td style={{ padding: "8px 6px", borderBottom: "1px solid #fef2f2", color: C.t2 }}>{r.note || "-"}</td>
                            <td style={{ padding: "8px 6px", borderBottom: "1px solid #fef2f2", textAlign: "center" }}>
                              {u && u.answered.total > 0 ? (
                                <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                                  {u.answered.build > 0 && <span style={{ background: "#eff6ff", color: "#1d4ed8", borderRadius: 4, padding: "1px 5px", fontSize: 11, fontWeight: 600 }}>句{u.answered.build}</span>}
                                  {u.answered.email > 0 && <span style={{ background: "#fef3c7", color: "#92400e", borderRadius: 4, padding: "1px 5px", fontSize: 11, fontWeight: 600 }}>邮{u.answered.email}</span>}
                                  {u.answered.discussion > 0 && <span style={{ background: "#ecfdf5", color: "#065f46", borderRadius: 4, padding: "1px 5px", fontSize: 11, fontWeight: 600 }}>讨{u.answered.discussion}</span>}
                                </div>
                              ) : <span style={{ color: C.t2 }}>-</span>}
                            </td>
                            <td style={{ padding: "8px 6px", borderBottom: "1px solid #fef2f2", display: "flex", gap: 6 }}>
                              <button onClick={() => restoreCode(r.code)} disabled={busy} style={{ border: "1px solid " + C.blue, background: C.blue, color: "#fff", borderRadius: 6, padding: "3px 10px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1, fontSize: 12 }}>
                                恢复
                              </button>
                              <button onClick={() => deleteCode(r.code)} disabled={busy} style={{ border: "1px solid #dc2626", background: "#fff", color: "#dc2626", borderRadius: 6, padding: "3px 10px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1, fontSize: 12 }}>
                                彻底删除
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {msg ? (
          <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: 10, fontSize: 12, color: "#9a3412" }}>
            {msg}
          </div>
        ) : null}
      </div>
    </AdminLayout>
  );
}
