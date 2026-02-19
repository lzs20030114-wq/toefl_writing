"use client";
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
      throw new Error("Missing admin token. Please input ADMIN_DASHBOARD_TOKEN first.");
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
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onGenerate() {
    setBusy(true);
    setMsg("");
    try {
      const body = await callAdminApi("/api/admin/codes", {
        method: "POST",
        body: JSON.stringify({ action: "generate", count: Number(count) || 10 }),
      });
      setMsg(`Generated ${body.generated} codes.`);
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
      const body = await callAdminApi("/api/admin/codes", {
        method: "POST",
        body: JSON.stringify({
          action: "issue",
          code: issueCode.trim() || undefined,
          issuedTo: issueTo.trim() || undefined,
          expiresAt: expiresAt.trim() || undefined,
        }),
      });
      setMsg(`Issued code: ${body?.issued?.code || "(unknown)"}`);
      setIssueCode("");
      setIssueTo("");
      setExpiresAt("");
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
      const body = await callAdminApi("/api/admin/codes", {
        method: "POST",
        body: JSON.stringify({
          action: "revoke",
          code: revokeCode.trim().toUpperCase(),
        }),
      });
      setMsg(`Revoked code: ${body?.revoked?.code || revokeCode.trim().toUpperCase()}`);
      setRevokeCode("");
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

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, padding: 20 }}>
      <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.nav, marginBottom: 8 }}>Access Code Admin</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center" }}>
            <input
              value={token}
              onChange={(e) => persistToken(e.target.value)}
              placeholder="ADMIN_DASHBOARD_TOKEN"
              style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}
            />
            <button onClick={refresh} disabled={busy} style={{ border: "1px solid " + C.blue, background: C.blue, color: "#fff", borderRadius: 6, padding: "8px 10px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
              Refresh
            </button>
            <button onClick={() => { persistToken(""); setRows([]); setStats({ available: 0, issued: 0, revoked: 0, total: 0 }); }} style={{ border: "1px solid #cbd5e1", background: "#fff", color: C.t2, borderRadius: 6, padding: "8px 10px", cursor: "pointer" }}>
              Clear
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: C.t2 }}>This page is controlled by `ADMIN_DASHBOARD_TOKEN` via server-side API.</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {[
            ["Total", stats.total],
            ["Available", stats.available],
            ["Issued", stats.issued],
            ["Revoked", stats.revoked],
          ].map(([k, v]) => (
            <div key={k} style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, color: C.t2 }}>{k}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.nav }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 700 }}>Generate Codes</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="number" min={1} max={500} value={count} onChange={(e) => setCount(Number(e.target.value || 10))} style={{ width: 120, border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px" }} />
            <button onClick={onGenerate} disabled={busy} style={{ border: "1px solid " + C.blue, background: C.blue, color: "#fff", borderRadius: 6, padding: "8px 10px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
              Generate
            </button>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 700 }}>Issue Code</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(160px, 1fr)) auto", gap: 8 }}>
            <input value={issueCode} onChange={(e) => setIssueCode(e.target.value.toUpperCase())} placeholder="Specific code (optional)" style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px", fontFamily: "monospace" }} />
            <input value={issueTo} onChange={(e) => setIssueTo(e.target.value)} placeholder="issued_to (email/nickname)" style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px" }} />
            <input value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} placeholder="expires_at (ISO, optional)" style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px" }} />
            <div />
            <button onClick={onIssue} disabled={busy} style={{ border: "1px solid " + C.blue, background: C.blue, color: "#fff", borderRadius: 6, padding: "8px 10px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
              Issue
            </button>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 700 }}>Revoke Code</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={revokeCode} onChange={(e) => setRevokeCode(e.target.value.toUpperCase())} placeholder="Code to revoke" style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px", fontFamily: "monospace", minWidth: 220 }} />
            <button onClick={onRevoke} disabled={busy} style={{ border: "1px solid " + C.red, background: C.red, color: "#fff", borderRadius: 6, padding: "8px 10px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
              Revoke
            </button>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 700 }}>Code List</div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 8px" }}>
              <option value="">All</option>
              <option value="available">available</option>
              <option value="issued">issued</option>
              <option value="revoked">revoked</option>
            </select>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", color: C.t2 }}>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>Code</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>Status</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>Issued To</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>Issued At</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>Expires</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {rowsView.map((r) => (
                  <tr key={r.code}>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", fontFamily: "monospace", fontWeight: 700 }}>{r.code}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.status || "-"}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.issued_to || "-"}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{fmtDate(r.issued_at)}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{fmtDate(r.expires_at)}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{fmtDate(r.created_at)}</td>
                  </tr>
                ))}
                {rowsView.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 12, color: C.t2 }}>
                      No rows.
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
