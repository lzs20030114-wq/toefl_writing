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

function clip(v, n = 120) {
  const s = String(v || "");
  if (s.length <= n) return s;
  return `${s.slice(0, n)}...`;
}

export default function AdminApiErrorsPage() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({ total: 0, windowMinutes: 1440, byStatus: {}, byType: {} });
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [windowMinutes, setWindowMinutes] = useState(1440);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setToken(localStorage.getItem(TOKEN_KEY) || "");
    } catch {
      // no-op
    } finally {
      setReady(true);
    }
  }, []);

  function persistToken(v) {
    setToken(v);
    try {
      localStorage.setItem(TOKEN_KEY, v);
    } catch {
      // no-op
    }
  }

  async function callApi(path) {
    if (!token.trim()) throw new Error("缺少管理员口令，请先输入 ADMIN_DASHBOARD_TOKEN。 ");
    const res = await fetch(path, {
      method: "GET",
      headers: {
        "x-admin-token": token.trim(),
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
    if (!token.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      const p = new URLSearchParams();
      p.set("limit", "200");
      p.set("minutes", String(windowMinutes || 1440));
      if (statusFilter.trim()) p.set("status", statusFilter.trim());
      if (typeFilter.trim()) p.set("errorType", typeFilter.trim());
      const body = await callApi(`/api/admin/api-errors?${p.toString()}`);
      setRows(Array.isArray(body.rows) ? body.rows : []);
      setStats(body.stats || { total: 0, windowMinutes, byStatus: {}, byType: {} });
      if ((body.rows || []).length === 0) {
        setMsg("暂无错误记录。若你刚修复了配置，这是正常现象。");
      }
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (ready && token.trim()) refresh();
  }, [ready, token, statusFilter, typeFilter, windowMinutes]);

  const typePairs = useMemo(
    () => Object.entries(stats.byType || {}).sort((a, b) => Number(b[1]) - Number(a[1])),
    [stats.byType]
  );
  const statusPairs = useMemo(
    () => Object.entries(stats.byStatus || {}).sort((a, b) => Number(b[1]) - Number(a[1])),
    [stats.byStatus]
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, padding: 20 }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 12 }}>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.nav }}>API 失效反馈后台</div>
            <Link href="/admin-codes" style={{ color: C.blue, textDecoration: "none", fontSize: 13 }}>去登录码后台</Link>
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
            <button onClick={() => { persistToken(""); setRows([]); setMsg(""); }} style={{ border: "1px solid #cbd5e1", background: "#fff", color: C.t2, borderRadius: 6, padding: "8px 10px", cursor: "pointer" }}>
              清空
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: C.t2 }}>用于查看 `/api/ai` 失败原因与趋势，便于快速定位失效问题。</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.t2 }}>窗口期总失败数</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: C.nav }}>{stats.total}</div>
            <div style={{ fontSize: 12, color: C.t2 }}>最近 {stats.windowMinutes} 分钟</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>按状态码</div>
            {statusPairs.length ? statusPairs.map(([k, v]) => <div key={k} style={{ fontSize: 12 }}>{k}: {v}</div>) : <div style={{ fontSize: 12, color: C.t2 }}>暂无</div>}
          </div>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>按错误类型</div>
            {typePairs.length ? typePairs.map(([k, v]) => <div key={k} style={{ fontSize: 12 }}>{k}: {v}</div>) : <div style={{ fontSize: 12, color: C.t2 }}>暂无</div>}
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <select value={windowMinutes} onChange={(e) => setWindowMinutes(Number(e.target.value || 1440))} style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 8px" }}>
              <option value={60}>最近 60 分钟</option>
              <option value={360}>最近 6 小时</option>
              <option value={1440}>最近 24 小时</option>
              <option value={10080}>最近 7 天</option>
            </select>
            <input value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} placeholder="状态码过滤（如 401）" style={{ width: 170, border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 8px" }} />
            <input value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} placeholder="错误类型过滤（如 upstream）" style={{ width: 220, border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 8px" }} />
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", color: C.t2 }}>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>时间</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>阶段</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>状态码</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>类型</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>错误信息</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>详情</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{fmtDate(r.created_at)}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.stage || "-"}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.http_status || "-"}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.error_type || "-"}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{clip(r.error_message, 120) || "-"}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{clip(r.error_detail, 180) || "-"}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 12, color: C.t2 }}>暂无记录。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {msg ? <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: 10, fontSize: 12, color: "#9a3412" }}>{msg}</div> : null}
      </div>
    </div>
  );
}
