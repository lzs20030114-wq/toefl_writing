"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { C, FONT } from "../../components/shared/ui";

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
  const [statusFilter, setStatusFilter] = useState("");
  const [count, setCount] = useState(10);
  const [issueCode, setIssueCode] = useState("");
  const [issueTo, setIssueTo] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [revokeCode, setRevokeCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedByCode, setSelectedByCode] = useState({});

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
      const q = statusFilter ? `?status=${encodeURIComponent(statusFilter)}&limit=200` : "?limit=200";
      const body = await callAdminApi(`/api/admin/codes${q}`, { method: "GET" });
      setRows(Array.isArray(body.codes) ? body.codes : []);
      setStats(body.stats || { available: 0, issued: 0, revoked: 0, total: 0 });
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

  useEffect(() => {
    if (ready && hasToken) refresh();
  }, [ready, statusFilter, token]);

  const rowsView = useMemo(() => rows.slice(0, 200), [rows]);
  const selectedCount = useMemo(() => rowsView.filter((r) => selectedByCode[r.code]).length, [rowsView, selectedByCode]);
  const allVisibleSelected = rowsView.length > 0 && rowsView.every((r) => selectedByCode[r.code]);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, padding: 20 }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.nav }}>登录码管理后台</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Link href="/admin" style={{ color: C.t2, textDecoration: "none", fontSize: 13 }}>返回总后台</Link>
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
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>发放对象</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>发放时间</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>到期时间</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>创建时间</th>
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
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.issued_to || "-"}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{fmtDate(r.issued_at)}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{fmtDate(r.expires_at)}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{fmtDate(r.created_at)}</td>
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
                    <td colSpan={8} style={{ padding: 12, color: C.t2 }}>
                      暂无数据。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {msg ? (
          <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: 10, fontSize: 12, color: "#9a3412" }}>
            {msg}
          </div>
        ) : null}
      </div>
    </div>
  );
}
