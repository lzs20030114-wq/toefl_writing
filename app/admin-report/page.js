"use client";
import { useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { callAdminApi } from "../../lib/adminHelpers";
import { C } from "../../components/shared/ui";

function StatCard({ value, label, delta }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10,
      padding: "18px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: C.nav, lineHeight: 1.1 }}>{value ?? "--"}</div>
        {delta}
      </div>
      <div style={{ fontSize: 12, color: C.t2, marginTop: 6 }}>{label}</div>
    </div>
  );
}

// Period-over-period change badge. prev<=0 with curr>0 → "新".
function Delta({ curr, prev, suffix = "" }) {
  if (curr == null || prev == null) return null;
  if (prev === 0) {
    return curr > 0 ? <span style={{ fontSize: 12, fontWeight: 700, color: C.green }}>新</span> : null;
  }
  const diff = curr - prev;
  if (diff === 0) return <span style={{ fontSize: 12, color: C.t3 }}>±0</span>;
  const up = diff > 0;
  const ratio = Math.round((diff / prev) * 100);
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: up ? C.green : "#dc2626" }}>
      {up ? "▲" : "▼"} {Math.abs(ratio)}%{suffix}
    </span>
  );
}

const cell = { textAlign: "center", padding: "9px 8px", fontSize: 12.5, borderBottom: "1px solid " + C.bdrSubtle, whiteSpace: "nowrap" };
const head = { textAlign: "center", padding: "10px 8px", fontSize: 11.5, fontWeight: 700, color: C.t2, borderBottom: "2px solid " + C.bdr, whiteSpace: "nowrap" };

function RetCell({ p }) {
  if (p.retentionPct == null) return <td style={cell}><span style={{ color: C.t3 }}>—</span></td>;
  if (!p.retentionMature) {
    return <td style={cell} title="窗口未到期,仍在累积"><span style={{ color: C.t3, fontStyle: "italic" }}>{p.retentionPct}%·</span></td>;
  }
  return <td style={cell}><span style={{ color: C.t1, fontWeight: 600 }}>{p.retentionPct}%</span></td>;
}

export default function AdminReportPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("week");

  async function fetchData(p) {
    setLoading(true);
    setError("");
    try {
      const res = await callAdminApi(`/api/admin/report?period=${p || period}&count=12`);
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => fetchData(period), 100);
    return () => clearTimeout(t);
  }, []);

  function switchPeriod(p) {
    setPeriod(p);
    fetchData(p);
  }

  const periods = data?.periods || [];
  const cur = periods[0];
  const prev = periods[1];
  const unit = period === "month" ? "月" : "周";
  const retLabel = period === "month" ? "30天回访" : "7天回访";

  return (
    <AdminLayout title="周报 / 月报">
      <div className="adm-page" style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 12, color: C.t3 }}>
            {loading ? "加载中..." : error ? <span style={{ color: "#dc2626" }}>{error}</span> : `本${unit}进行中 · 环比上一${unit}`}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[["week", "按周"], ["month", "按月"]].map(([p, label]) => (
              <button
                key={p}
                onClick={() => switchPeriod(p)}
                style={{
                  padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: period === p ? 700 : 500,
                  border: "1px solid " + (period === p ? C.blue : C.bdr),
                  background: period === p ? C.blue : "#fff",
                  color: period === p ? "#fff" : C.t2, cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => fetchData(period)}
              disabled={loading}
              style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid " + C.bdr, background: "#fff", fontSize: 12, fontWeight: 600, color: C.t1, cursor: loading ? "wait" : "pointer" }}
            >
              刷新
            </button>
          </div>
        </div>

        {/* Current-vs-previous cards */}
        <div style={{ fontSize: 12, color: C.t2, marginBottom: 8, fontWeight: 600 }}>
          本{unit}{cur ? `（${cur.label}，进行中）` : ""}
        </div>
        <div className="adm-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
          <StatCard value={cur?.newSignups} label="新增注册" delta={cur && prev && <Delta curr={cur.newSignups} prev={prev.newSignups} />} />
          <StatCard value={cur?.activeUsers} label="活跃用户" delta={cur && prev && <Delta curr={cur.activeUsers} prev={prev.activeUsers} />} />
          <StatCard value={cur?.sessions} label="练习次数" delta={cur && prev && <Delta curr={cur.sessions} prev={prev.sessions} />} />
          <StatCard value={cur?.activationPct != null ? `${cur.activationPct}%` : "--"} label="本期注册激活率" />
        </div>

        {/* Trend table */}
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid " + C.bdr, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.nav }}>近 12 {unit}趋势</span>
            <span style={{ fontSize: 10.5, color: C.t3 }}>新增/活跃/练习含环比 · 斜体 % · = 回访窗口未到期</span>
          </div>
          <div className="adm-table-wrap" style={{ overflowX: "auto" }}>
            {loading ? (
              <div style={{ height: 200, background: "#f8f8f8" }} />
            ) : !periods.length ? (
              <div style={{ padding: 24, color: C.t3, fontSize: 13, textAlign: "center" }}>暂无数据</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...head, textAlign: "left", paddingLeft: 16 }}>{unit === "月" ? "月份" : "周"}</th>
                    <th style={head}>新增</th>
                    <th style={head}>活跃</th>
                    <th style={head}>练习</th>
                    <th style={head}>激活率</th>
                    <th style={head}>{retLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p, i) => {
                    const pr = periods[i + 1];
                    return (
                      <tr key={p.key} style={p.inProgress ? { background: "#fbfdfc" } : null}>
                        <td style={{ ...cell, textAlign: "left", paddingLeft: 16, color: C.t1, fontWeight: 600 }}>
                          {p.label}
                          {p.inProgress && <span style={{ color: C.t3, fontWeight: 400, fontSize: 10.5 }}> · 进行中</span>}
                        </td>
                        <td style={cell}>
                          <span style={{ fontWeight: 700, color: C.nav }}>{p.newSignups}</span>
                          {pr && <span style={{ marginLeft: 6 }}><Delta curr={p.newSignups} prev={pr.newSignups} /></span>}
                        </td>
                        <td style={cell}>
                          <span style={{ fontWeight: 700, color: C.nav }}>{p.activeUsers}</span>
                          {pr && <span style={{ marginLeft: 6 }}><Delta curr={p.activeUsers} prev={pr.activeUsers} /></span>}
                        </td>
                        <td style={cell}>
                          <span style={{ color: C.t1 }}>{p.sessions}</span>
                          {pr && <span style={{ marginLeft: 6 }}><Delta curr={p.sessions} prev={pr.sessions} /></span>}
                        </td>
                        <td style={cell}>
                          <span style={{ color: p.activationPct != null ? C.t1 : C.t3 }}>{p.activationPct != null ? `${p.activationPct}%` : "—"}</span>
                        </td>
                        <RetCell p={p} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div style={{ fontSize: 11, color: C.t3, marginTop: 10, lineHeight: 1.6 }}>
          · 活跃 = 该{unit}内有练习记录的去重用户数。激活率 / 回访率均按"该{unit}注册的用户"计算。<br />
          · 回访率 = 注册后在 {data?.window ?? (period === "month" ? 30 : 7)} 天内至少回来练习一次的比例；最近几{unit}窗口未满会标斜体 ·。
        </div>
      </div>
    </AdminLayout>
  );
}
