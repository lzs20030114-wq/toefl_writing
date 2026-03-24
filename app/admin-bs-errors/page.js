"use client";
import { Fragment, useEffect, useState } from "react";
import { C, FONT } from "../../components/shared/ui";
import AdminLayout from "../../components/admin/AdminLayout";

const TOKEN_KEY = "toefl-admin-token";

function pct(n, d) {
  if (!d) return "0%";
  return `${Math.round((n / d) * 1000) / 10}%`;
}

function barWidth(rate) {
  return `${Math.min(100, Math.max(2, rate))}%`;
}

function rateColor(rate) {
  if (rate >= 60) return "#ef4444";
  if (rate >= 40) return "#f97316";
  if (rate >= 20) return "#eab308";
  return "#22c55e";
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8,
      padding: "16px 20px", minWidth: 140,
    }}>
      <div style={{ fontSize: 11, color: C.t2, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: C.nav }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.t2, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function AdminBsErrorsPage() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState("questions"); // questions | grammar | users
  const [questionLimit, setQuestionLimit] = useState(50);
  const [expandedQ, setExpandedQ] = useState({});

  useEffect(() => {
    try { setToken(localStorage.getItem(TOKEN_KEY) || ""); } catch {}
    setReady(true);
  }, []);

  async function refresh() {
    if (!token.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/bs-errors?limit=3000", {
        headers: { "x-admin-token": token.trim() },
      });
      const text = await res.text();
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (ready && token.trim()) refresh();
  }, [ready, token]);

  const s = data?.summary || {};
  const questions = data?.questions || [];
  const grammarPoints = data?.grammarPoints || [];
  const users = data?.users || [];

  const tabStyle = (active) => ({
    padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer",
    fontSize: 13, fontWeight: active ? 700 : 500,
    background: active ? C.nav : "transparent",
    color: active ? "#fff" : C.t2,
  });

  return (
    <AdminLayout title="错题统计">
      <div className="adm-page" style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 16 }}>
        {/* Summary cards */}
        {data && (
          <div className="adm-stats" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <StatCard label="总答题次数" value={s.totalAttempts} sub={`${s.bsSessions + s.mockSessions} 个会话`} />
            <StatCard label="总错误数" value={s.totalWrong} sub={`错误率 ${s.overallErrorRate}%`} />
            <StatCard label="活跃用户" value={s.uniqueUsers} />
            <StatCard label="易错题数" value={questions.filter((q) => q.errorRate >= 50).length} sub="错误率 >= 50%" />
            <StatCard label="易错语法点" value={grammarPoints.filter((g) => g.errorRate >= 40).length} sub="错误率 >= 40%" />
          </div>
        )}

        {/* Controls */}
        <div style={{
          background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 12,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        }}>
          <div className="adm-tabs" style={{ display: "flex", gap: 4 }}>
            <button style={tabStyle(tab === "questions")} onClick={() => setTab("questions")}>
              易错题目 ({questions.length})
            </button>
            <button style={tabStyle(tab === "grammar")} onClick={() => setTab("grammar")}>
              语法弱项 ({grammarPoints.length})
            </button>
            <button style={tabStyle(tab === "users")} onClick={() => setTab("users")}>
              用户错误率 ({users.length})
            </button>
          </div>
          <button
            onClick={refresh}
            disabled={busy}
            style={{
              border: "1px solid " + C.blue, background: C.blue, color: "#fff",
              borderRadius: 6, padding: "8px 14px", cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1, fontSize: 13,
            }}
          >
            {busy ? "加载中..." : "刷新"}
          </button>
        </div>

        {msg && (
          <div style={{
            background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8,
            padding: 10, fontSize: 12, color: "#9a3412",
          }}>
            {msg}
          </div>
        )}

        {/* Questions tab */}
        {tab === "questions" && data && (
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, overflow: "hidden" }}>
            <div style={{
              padding: "12px 16px", borderBottom: "1px solid " + C.bdr,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div style={{ fontWeight: 700, color: C.nav }}>
                按错误率排序的题目（至少被做 2 次）
              </div>
              <div style={{ fontSize: 12, color: C.t2 }}>
                共 {questions.length} 题
              </div>
            </div>
            <div className="adm-table-wrap" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", color: C.t2 }}>
                    <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", width: 40 }}>#</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>正确答案</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", minWidth: 160 }}>题干</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", minWidth: 120 }}>语法点</th>
                    <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", width: 60 }}>总次</th>
                    <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", width: 60 }}>错误</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", minWidth: 140 }}>错误率</th>
                    <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", width: 60 }}>用户</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.slice(0, questionLimit).map((q, i) => {
                    const isOpen = !!expandedQ[i];
                    const attempts = q.wrongAttempts || [];
                    return (
                      <Fragment key={i}>
                        <tr
                          style={{ background: q.errorRate >= 60 ? "#fef2f2" : q.errorRate >= 40 ? "#fffbeb" : "transparent", cursor: attempts.length > 0 ? "pointer" : "default" }}
                          onClick={() => attempts.length > 0 && setExpandedQ((p) => ({ ...p, [i]: !p[i] }))}
                        >
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", color: C.t2 }}>
                            {attempts.length > 0 && <span style={{ marginRight: 4 }}>{isOpen ? "\u25BC" : "\u25B6"}</span>}
                            {i + 1}
                          </td>
                          <td style={{
                            padding: "8px 10px", borderBottom: "1px solid #f1f5f9",
                            fontWeight: 600, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {q.correctAnswer}
                          </td>
                          <td style={{
                            padding: "8px 10px", borderBottom: "1px solid #f1f5f9",
                            color: C.t2, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {q.prompt || "-"}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>
                            {(q.grammar_points || []).length > 0 ? (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                                {q.grammar_points.slice(0, 3).map((gp, gi) => (
                                  <span key={gi} style={{
                                    background: "#f1f5f9", borderRadius: 4, padding: "2px 6px",
                                    fontSize: 10, color: C.t2,
                                  }}>{gp}</span>
                                ))}
                              </div>
                            ) : "-"}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", textAlign: "center" }}>{q.total}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", textAlign: "center", fontWeight: 700, color: rateColor(q.errorRate) }}>{q.wrong}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ flex: 1, height: 6, background: "#f1f5f9", borderRadius: 3, overflow: "hidden" }}>
                                <div style={{ width: barWidth(q.errorRate), height: "100%", background: rateColor(q.errorRate), borderRadius: 3 }} />
                              </div>
                              <span style={{ fontWeight: 700, color: rateColor(q.errorRate), minWidth: 40, textAlign: "right" }}>{q.errorRate}%</span>
                            </div>
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", textAlign: "center" }}>
                            <span style={{ color: C.t2 }}>{q.uniqueWrongUsers}/{q.uniqueUsers}</span>
                          </td>
                        </tr>
                        {isOpen && attempts.length > 0 && (
                          <tr>
                            <td colSpan={8} style={{ padding: 0, borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                              <div style={{ padding: "8px 12px" }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: C.t2, marginBottom: 6 }}>
                                  错误作答记录（最多 20 条）
                                </div>
                                <div style={{ marginBottom: 8, padding: "8px 10px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6 }}>
                                  {q.prompt && (
                                    <div style={{ fontSize: 12, color: "#6d28d9", fontWeight: 700, marginBottom: 6 }}>
                                      <span style={{ background: "#7c3aed", color: "#fff", borderRadius: 3, padding: "1px 6px", marginRight: 6, fontSize: 10 }}>Q</span>
                                      {q.prompt}
                                    </div>
                                  )}
                                  <div style={{ fontSize: 12, color: "#0369a1", fontWeight: 700 }}>
                                    <span style={{ background: "#0284c7", color: "#fff", borderRadius: 3, padding: "1px 6px", marginRight: 6, fontSize: 10 }}>A</span>
                                    {q.correctAnswer}
                                  </div>
                                </div>
                                {(q.chunks?.length > 0 || q.prefilled?.length > 0) && (
                                  <div style={{ marginBottom: 6, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                                    <span style={{ fontSize: 10, color: C.t2, marginRight: 2 }}>词库:</span>
                                    {(q.chunks || []).map((c, ci) => (
                                      <span key={"c" + ci} style={{
                                        background: "#fff", border: "1px solid #cbd5e1", borderRadius: 4,
                                        padding: "2px 7px", fontSize: 11, color: C.nav,
                                      }}>{c}</span>
                                    ))}
                                    {(q.prefilled || []).map((p, pi) => (
                                      <span key={"p" + pi} style={{
                                        background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 4,
                                        padding: "2px 7px", fontSize: 11, color: "#166534", fontStyle: "italic",
                                      }}>{p} (预填)</span>
                                    ))}
                                  </div>
                                )}
                                {attempts.map((a, ai) => (
                                  <div key={ai} style={{
                                    padding: "4px 8px", borderBottom: ai < attempts.length - 1 ? "1px solid #e2e8f0" : "none",
                                    display: "flex", gap: 8, alignItems: "baseline",
                                  }}>
                                    <span style={{ fontSize: 10, color: C.t2, fontFamily: "monospace", minWidth: 52 }}>{a.userCode}</span>
                                    <span style={{ fontSize: 11, color: "#dc2626" }}>{a.userAnswer}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {questions.length === 0 && (
                    <tr><td colSpan={8} style={{ padding: 20, textAlign: "center", color: C.t2 }}>暂无数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {questions.length > questionLimit && (
              <div style={{ padding: 12, textAlign: "center", borderTop: "1px solid " + C.bdr }}>
                <button
                  onClick={() => setQuestionLimit((l) => l + 50)}
                  style={{
                    border: "1px solid " + C.bdr, background: "#fff", color: C.blue,
                    borderRadius: 6, padding: "6px 16px", cursor: "pointer", fontSize: 12,
                  }}
                >
                  加载更多（还有 {questions.length - questionLimit} 题）
                </button>
              </div>
            )}
          </div>
        )}

        {/* Grammar tab */}
        {tab === "grammar" && data && (
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid " + C.bdr }}>
              <div style={{ fontWeight: 700, color: C.nav }}>
                语法点错误率（至少出现 3 次）
              </div>
            </div>
            <div className="adm-table-wrap" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", color: C.t2 }}>
                    <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", width: 40 }}>#</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>语法点</th>
                    <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", width: 80 }}>总次数</th>
                    <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", width: 80 }}>错误数</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", minWidth: 200 }}>错误率</th>
                  </tr>
                </thead>
                <tbody>
                  {grammarPoints.map((g, i) => (
                    <tr key={i} style={{ background: g.errorRate >= 50 ? "#fef2f2" : g.errorRate >= 30 ? "#fffbeb" : "transparent" }}>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", color: C.t2 }}>{i + 1}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", fontWeight: 600 }}>{g.name}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", textAlign: "center" }}>{g.total}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", textAlign: "center", fontWeight: 700, color: rateColor(g.errorRate) }}>{g.wrong}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ width: barWidth(g.errorRate), height: "100%", background: rateColor(g.errorRate), borderRadius: 4 }} />
                          </div>
                          <span style={{ fontWeight: 700, color: rateColor(g.errorRate), minWidth: 44, textAlign: "right" }}>{g.errorRate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {grammarPoints.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: C.t2 }}>暂无数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Users tab */}
        {tab === "users" && data && (
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid " + C.bdr }}>
              <div style={{ fontWeight: 700, color: C.nav }}>
                用户 Build Sentence 错误率
              </div>
            </div>
            <div className="adm-table-wrap" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", color: C.t2 }}>
                    <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", width: 40 }}>#</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>登录码</th>
                    <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", width: 80 }}>总答题</th>
                    <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", width: 80 }}>错误数</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", minWidth: 200 }}>错误率</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => (
                    <tr key={u.code}>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", color: C.t2 }}>{i + 1}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", fontFamily: "monospace", fontWeight: 700 }}>{u.code}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", textAlign: "center" }}>{u.total}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", textAlign: "center", fontWeight: 700, color: rateColor(u.errorRate) }}>{u.wrong}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ width: barWidth(u.errorRate), height: "100%", background: rateColor(u.errorRate), borderRadius: 4 }} />
                          </div>
                          <span style={{ fontWeight: 700, color: rateColor(u.errorRate), minWidth: 44, textAlign: "right" }}>{u.errorRate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: C.t2 }}>暂无数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!data && !busy && !msg && (
          <div style={{
            background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8,
            padding: 40, textAlign: "center", color: C.t2,
          }}>
            点击"刷新"加载错题统计数据
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
