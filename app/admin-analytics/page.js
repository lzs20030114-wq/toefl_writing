"use client";
import { useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { callAdminApi } from "../../lib/adminHelpers";
import { C } from "../../components/shared/ui";

function StatCard({ value, label, color }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10,
      padding: "18px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || C.nav, lineHeight: 1.1 }}>{value ?? "--"}</div>
      <div style={{ fontSize: 12, color: C.t2, marginTop: 6 }}>{label}</div>
    </div>
  );
}

function BarChart({ data, height = 180 }) {
  if (!data || data.length === 0) return <div style={{ color: C.t3, fontSize: 13 }}>暂无数据</div>;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height, padding: "0 4px" }}>
      {data.map((d) => {
        const h = Math.max((d.count / max) * (height - 24), 2);
        return (
          <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
            <div style={{ fontSize: 10, color: C.t2, marginBottom: 2 }}>{d.count || ""}</div>
            <div
              title={`${d.date}: ${d.count} PV`}
              style={{
                width: "100%", maxWidth: 32, height: h, borderRadius: "4px 4px 0 0",
                background: `linear-gradient(180deg, ${C.blue}, #3b82f6)`,
                transition: "height 0.3s",
              }}
            />
            <div style={{
              fontSize: 9, color: C.t3, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden",
              textOverflow: "ellipsis", maxWidth: "100%",
            }}>
              {d.date.slice(5)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RankTable({ title, rows, labelKey, valueKey }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10,
      overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid " + C.bdr }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.nav }}>{title}</span>
      </div>
      <div style={{ padding: "4px 0" }}>
        {(!rows || rows.length === 0) ? (
          <div style={{ padding: 16, color: C.t3, fontSize: 13 }}>暂无数据</div>
        ) : rows.map((r, i) => (
          <div key={i} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "8px 16px", borderTop: i > 0 ? "1px solid " + C.bdrSubtle : "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span style={{
                width: 20, height: 20, borderRadius: 4, display: "flex",
                alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700,
                background: i < 3 ? C.blue : C.bdr, color: i < 3 ? "#fff" : C.t2,
              }}>{i + 1}</span>
              <span style={{
                fontSize: 13, color: C.t1, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{r[labelKey]}</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.nav, flexShrink: 0, marginLeft: 8 }}>{r[valueKey]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [days, setDays] = useState(30);

  async function fetchData(d) {
    setLoading(true);
    setError("");
    try {
      const res = await callAdminApi(`/api/admin/analytics?days=${d || days}`);
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => fetchData(days), 100);
    return () => clearTimeout(t);
  }, []);

  function handleDaysChange(d) {
    setDays(d);
    fetchData(d);
  }

  return (
    <AdminLayout title="数据分析">
      <div className="adm-page" style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, color: C.t3 }}>
              {loading ? "加载中..." : error ? error : `共 ${data?.total ?? 0} 条记录`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[7, 14, 30, 60].map((d) => (
              <button
                key={d}
                onClick={() => handleDaysChange(d)}
                style={{
                  padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: days === d ? 700 : 500,
                  border: "1px solid " + (days === d ? C.blue : C.bdr),
                  background: days === d ? C.blue : "#fff",
                  color: days === d ? "#fff" : C.t2,
                  cursor: "pointer",
                }}
              >
                {d}天
              </button>
            ))}
            <button
              onClick={() => fetchData(days)}
              disabled={loading}
              style={{
                padding: "6px 14px", borderRadius: 6, border: "1px solid " + C.bdr,
                background: "#fff", fontSize: 12, fontWeight: 600, color: C.t1,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              刷新
            </button>
          </div>
        </div>

        {/* Key metrics */}
        <div className="adm-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
          <StatCard value={data?.todayPV} label="今日 PV" color={C.blue} />
          <StatCard value={data?.total} label={`${days}天总 PV`} color={C.nav} />
          <StatCard value={data?.uniqueUsers} label="登录用户" color="#16a34a" />
          <StatCard value={data?.anonymous} label="匿名访问" color={C.t2} />
        </div>

        {/* Daily chart */}
        <div style={{
          background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10,
          padding: 16, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.nav, marginBottom: 12 }}>每日访问量</div>
          {loading ? (
            <div style={{ height: 180, background: "#f8f8f8", borderRadius: 8 }} />
          ) : (
            <BarChart data={data?.daily} />
          )}
        </div>

        {/* Tables */}
        <div className="adm-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <RankTable title="热门页面" rows={data?.topPages} labelKey="path" valueKey="count" />
          <RankTable title="来源网站" rows={data?.topReferrers} labelKey="host" valueKey="count" />
        </div>
      </div>
    </AdminLayout>
  );
}
