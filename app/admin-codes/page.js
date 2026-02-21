"use client";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { C, FONT } from "../../components/shared/ui";

const TOKEN_KEY = "toefl-admin-token";

function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function previewText(v, max = 180) {
  const s = String(v || "").replace(/\s+/g, " ").trim();
  if (!s) return "-";
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function scoreColor(scoreText) {
  const s = String(scoreText || "").toLowerCase();
  if (s.includes("correct")) return C.green;
  if (s.includes("incorrect")) return C.red;
  if (s.includes("pending")) return C.orange;
  return C.nav;
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

  const [expanded, setExpanded] = useState({});
  const [activityByCode, setActivityByCode] = useState({});
  const [activityLoadingByCode, setActivityLoadingByCode] = useState({});
  const [activityErrorByCode, setActivityErrorByCode] = useState({});

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
      setUsageByCode(body.usageByCode || {});
      setExpanded({});
      setActivityByCode({});
      setActivityLoadingByCode({});
      setActivityErrorByCode({});
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
      const body = await callAdminApi("/api/admin/codes", {
        method: "POST",
        body: JSON.stringify({
          action: "issue",
          code: issueCode.trim() || undefined,
          issuedTo: issueTo.trim() || undefined,
          expiresAt: expiresAt.trim() || undefined,
        }),
      });
      setMsg(`发放成功：${body?.issued?.code || "未知"}`);
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
      setMsg(`已吊销：${body?.revoked?.code || revokeCode.trim().toUpperCase()}`);
      setRevokeCode("");
      await refresh();
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function fetchCodeActivity(code) {
    setActivityLoadingByCode((prev) => ({ ...prev, [code]: true }));
    setActivityErrorByCode((prev) => ({ ...prev, [code]: "" }));
    try {
      const body = await callAdminApi(
        `/api/admin/codes/${encodeURIComponent(code)}/activity?limit=200&attemptLimit=800`,
        { method: "GET" }
      );
      setActivityByCode((prev) => ({ ...prev, [code]: body }));
    } catch (e) {
      setActivityErrorByCode((prev) => ({ ...prev, [code]: String(e.message || e) }));
    } finally {
      setActivityLoadingByCode((prev) => ({ ...prev, [code]: false }));
    }
  }

  function toggleExpand(code) {
    setExpanded((prev) => {
      const next = { ...prev, [code]: !prev[code] };
      return next;
    });
    if (!activityByCode[code] && !activityLoadingByCode[code]) {
      fetchCodeActivity(code);
    }
  }

  useEffect(() => {
    if (ready && hasToken) refresh();
  }, [ready, statusFilter, token]);

  const rowsView = useMemo(() => rows.slice(0, 200), [rows]);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, padding: 20 }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.nav }}>登录码管理后台</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Link href="/admin" style={{ color: C.t2, textDecoration: "none", fontSize: 13 }}>返回总后台</Link>
              <Link href="/admin-api-errors" style={{ color: C.blue, textDecoration: "none", fontSize: 13 }}>查看 API 失败反馈</Link>
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
            <button onClick={() => { persistToken(""); setRows([]); setUsageByCode({}); setStats({ available: 0, issued: 0, revoked: 0, total: 0 }); }} style={{ border: "1px solid #cbd5e1", background: "#fff", color: C.t2, borderRadius: 6, padding: "8px 10px", cursor: "pointer" }}>
              清空
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: C.t2 }}>本页面通过服务端 API + ADMIN_DASHBOARD_TOKEN 进行鉴权。</div>
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

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 700 }}>登录码列表（支持折叠查看作答详情）</div>
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
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>登录码</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>状态</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>发放对象</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>已答题数</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>练习记录数</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>最近活跃</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>发放时间</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>到期时间</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>创建时间</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>详情</th>
                </tr>
              </thead>
              <tbody>
                {rowsView.map((r) => {
                  const code = r.code;
                  const usage = usageByCode?.[code] || { sessions: 0, answered: { total: 0 }, lastActiveAt: null };
                  const isOpen = !!expanded[code];
                  const activity = activityByCode[code];
                  const loading = !!activityLoadingByCode[code];
                  const error = activityErrorByCode[code];
                  return (
                    <Fragment key={code}>
                      <tr>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", fontFamily: "monospace", fontWeight: 700 }}>{code}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.status || "-"}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.issued_to || "-"}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, color: C.nav }}>
                          {safeNum(usage?.answered?.total, 0)}
                        </td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{safeNum(usage?.sessions, 0)}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{fmtDate(usage?.lastActiveAt)}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{fmtDate(r.issued_at)}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{fmtDate(r.expires_at)}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{fmtDate(r.created_at)}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>
                          <button
                            onClick={() => toggleExpand(code)}
                            style={{
                              border: "1px solid " + C.blue,
                              background: isOpen ? "#dbeafe" : "#fff",
                              color: C.blue,
                              borderRadius: 6,
                              padding: "4px 8px",
                              cursor: "pointer",
                              fontSize: 12,
                            }}
                          >
                            {isOpen ? "收起" : "展开"}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={10} style={{ padding: "10px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                            {loading && <div style={{ color: C.t2 }}>正在加载详情...</div>}
                            {!loading && error && <div style={{ color: C.red }}>{error}</div>}
                            {!loading && !error && activity && (
                              <div style={{ display: "grid", gap: 10 }}>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12 }}>
                                  <span>总答题: <b>{safeNum(activity?.summary?.answered?.total, 0)}</b></span>
                                  <span>Task1: <b>{safeNum(activity?.summary?.answered?.build, 0)}</b></span>
                                  <span>Task2: <b>{safeNum(activity?.summary?.answered?.email, 0)}</b></span>
                                  <span>Task3: <b>{safeNum(activity?.summary?.answered?.discussion, 0)}</b></span>
                                  <span>记录数: <b>{safeNum(activity?.summary?.sessions, 0)}</b></span>
                                  <span>最近活跃: <b>{fmtDate(activity?.summary?.lastActiveAt)}</b></span>
                                </div>
                                <div style={{ maxHeight: 420, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff" }}>
                                  {Array.isArray(activity.attempts) && activity.attempts.length > 0 ? (
                                    activity.attempts.map((a) => (
                                      <div key={a.id} style={{ borderBottom: "1px solid #f1f5f9", padding: 10 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                                          <div style={{ fontWeight: 700, color: C.nav }}>
                                            {a.taskType === "build-sentence" ? "Task 1" : a.taskType === "email" ? "Task 2" : "Task 3"}
                                          </div>
                                          <div style={{ color: scoreColor(a.scoreText), fontWeight: 700 }}>{a.scoreText || "-"}</div>
                                        </div>
                                        <div style={{ fontSize: 11, color: C.t2, marginBottom: 6 }}>
                                          {fmtDate(a.date)} | 来源: {a.sourceType || "-"}
                                        </div>
                                        <div style={{ fontSize: 12, color: C.t1, marginBottom: 4 }}>
                                          <b>题干:</b> {previewText(a.prompt, 260)}
                                        </div>
                                        <div style={{ fontSize: 12, color: C.t1, marginBottom: 4 }}>
                                          <b>作答:</b> {previewText(a.answer, 320)}
                                        </div>
                                        {a.correctAnswer ? (
                                          <div style={{ fontSize: 12, color: C.t2 }}>
                                            <b>参考答案:</b> {previewText(a.correctAnswer, 260)}
                                          </div>
                                        ) : null}
                                      </div>
                                    ))
                                  ) : (
                                    <div style={{ padding: 12, color: C.t2 }}>暂无可展示的作答详情。</div>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
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

        {msg ? (
          <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: 10, fontSize: 12, color: "#9a3412" }}>
            {msg}
          </div>
        ) : null}
      </div>
    </div>
  );
}
