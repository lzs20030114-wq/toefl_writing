"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { C, FONT } from "../../components/shared/ui";
import AdminLayout from "../../components/admin/AdminLayout";

const TOKEN_KEY = "toefl-admin-token";

function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function clip(v, n = 140) {
  const s = String(v || "");
  if (s.length <= n) return s;
  return `${s.slice(0, n)}...`;
}

export default function AdminFeedbackPage() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState([]);
  const [noteByCode, setNoteByCode] = useState({});
  const [userCode, setUserCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [replyInputs, setReplyInputs] = useState({});
  const [patchBusy, setPatchBusy] = useState({});

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
    if (!token.trim()) throw new Error("缺少管理员口令，请先输入 ADMIN_DASHBOARD_TOKEN。");
    const res = await fetch(path, {
      method: "GET",
      headers: { "x-admin-token": token.trim() },
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

  async function patchFeedback(id, updates) {
    setPatchBusy((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch("/api/admin/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-token": token.trim() },
        body: JSON.stringify({ id, ...updates }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...updates } : r));
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setPatchBusy((p) => ({ ...p, [id]: false }));
    }
  }

  async function refresh() {
    if (!token.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      const p = new URLSearchParams();
      p.set("limit", "300");
      if (userCode.trim()) p.set("userCode", userCode.trim().toUpperCase());
      const [feedbackBody, codesBody] = await Promise.all([
        callApi(`/api/admin/feedback?${p.toString()}`),
        callApi("/api/admin/codes?limit=500"),
      ]);
      setRows(Array.isArray(feedbackBody?.rows) ? feedbackBody.rows : []);
      // 建立 code -> note 映射
      const map = {};
      (codesBody?.codes || []).forEach((c) => { if (c.code) map[c.code] = c.note || ""; });
      setNoteByCode(map);
      if (!Array.isArray(feedbackBody?.rows) || feedbackBody.rows.length === 0) {
        setMsg("暂无反馈记录。");
      }
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (ready && token.trim()) refresh();
  }, [ready, token]);

  return (
    <AdminLayout title="用户反馈">
      <div className="adm-page" style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 12 }}>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.nav }}>用户反馈后台</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Link href="/admin-activity" style={{ color: C.blue, textDecoration: "none", fontSize: 13 }}>去答题情况</Link>
            </div>
          </div>
          <div className="adm-ctrl-row" style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center" }}>
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
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={userCode}
              onChange={(e) => setUserCode(e.target.value)}
              placeholder="按用户码过滤（如 ABC123）"
              className="adm-input-full"
              style={{ width: 240, border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 8px" }}
            />
            <button onClick={refresh} style={{ border: "1px solid #cbd5e1", background: "#fff", color: C.t2, borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}>
              应用筛选
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: C.t2 }}>查看内测用户提交的改进建议，包含内容、来源用户码、提交时间。</div>
        </div>

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14 }}>
          <div className="adm-table-wrap" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", color: C.t2 }}>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>提交时间</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>用户码</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0", minWidth: 90 }}>备注</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>反馈内容</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0", minWidth: 80 }}>状态</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0", minWidth: 200 }}>管理员回复</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isResolved = r.status === "resolved";
                  const replyVal = replyInputs[r.id] ?? (r.admin_reply || "");
                  const patching = !!patchBusy[r.id];
                  return (
                    <tr key={r.id} style={{ background: isResolved ? "#f0fdf4" : "transparent" }}>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap", verticalAlign: "top" }}>{fmtDate(r.created_at)}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", fontFamily: "monospace", verticalAlign: "top" }}>{r.user_code || "-"}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", color: noteByCode[r.user_code] ? C.nav : C.t2, verticalAlign: "top" }}>{noteByCode[r.user_code] || "-"}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" }} title={String(r.content || "")}>{clip(r.content, 200)}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" }}>
                        <button
                          onClick={() => patchFeedback(r.id, { status: isResolved ? "new" : "resolved" })}
                          disabled={patching}
                          style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${isResolved ? "#86efac" : "#cbd5e1"}`, background: isResolved ? "#dcfce7" : "#fff", color: isResolved ? "#15803d" : C.t2, fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                          {isResolved ? "✓ 已修改" : "标为已修改"}
                        </button>
                      </td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" }}>
                        <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
                          <textarea
                            value={replyVal}
                            onChange={(e) => setReplyInputs((p) => ({ ...p, [r.id]: e.target.value }))}
                            placeholder="写回复..."
                            rows={2}
                            style={{ flex: 1, fontSize: 11, padding: "4px 6px", border: "1px solid #cbd5e1", borderRadius: 6, resize: "vertical", fontFamily: "inherit", minWidth: 0 }}
                          />
                          <button
                            onClick={() => patchFeedback(r.id, { admin_reply: replyVal || null }).then(() => setReplyInputs((p) => { const n = { ...p }; delete n[r.id]; return n; }))}
                            disabled={patching || replyVal === (r.admin_reply || "")}
                            style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid " + C.blue, background: C.blue, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", opacity: (patching || replyVal === (r.admin_reply || "")) ? 0.5 : 1 }}
                          >
                            发送
                          </button>
                        </div>
                        {r.admin_reply && replyInputs[r.id] === undefined && (
                          <div style={{ marginTop: 4, fontSize: 10, color: C.t2 }}>当前：{clip(r.admin_reply, 60)}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
    </AdminLayout>
  );
}
