"use client";
import { useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { callAdminApi } from "../../lib/adminHelpers";
import { C } from "../../components/shared/ui";

// Brand teal-green (#0d9668) as rgb, for heatmap cell tinting.
const BRAND_RGB = "13, 150, 104";

function StatCard({ value, label, sub, color }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10,
      padding: "18px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || C.nav, lineHeight: 1.1 }}>{value ?? "--"}</div>
      <div style={{ fontSize: 12, color: C.t2, marginTop: 6 }}>{label}</div>
      {sub != null && <div style={{ fontSize: 11, color: C.t3, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// One retention cell. pct may be null (no cohort / 0 size). `mature=false`
// means the window hasn't fully elapsed yet — render muted, not colored,
// so a 2-day-old cohort's "30天内" doesn't read as real churn.
function HeatCell({ pct, count, size, mature }) {
  if (pct == null || !size) {
    return <td style={cellBase}><span style={{ color: C.t3 }}>—</span></td>;
  }
  if (!mature) {
    return (
      <td style={cellBase} title={`进行中：窗口未到期，当前 ${count}/${size}`}>
        <span style={{ color: C.t3, fontStyle: "italic", fontSize: 11 }}>{pct}%·</span>
      </td>
    );
  }
  const alpha = Math.min(pct / 100, 1) * 0.85 + 0.05;
  const dark = pct >= 45;
  return (
    <td
      style={{ ...cellBase, background: `rgba(${BRAND_RGB}, ${alpha})` }}
      title={`${count}/${size} 回访`}
    >
      <span style={{ color: dark ? "#fff" : C.t1, fontWeight: 600 }}>{pct}%</span>
    </td>
  );
}

const cellBase = {
  textAlign: "center", padding: "8px 6px", fontSize: 12.5,
  borderBottom: "1px solid " + C.bdrSubtle, whiteSpace: "nowrap",
};
const headCell = {
  textAlign: "center", padding: "10px 6px", fontSize: 11.5, fontWeight: 700,
  color: C.t2, borderBottom: "2px solid " + C.bdr, whiteSpace: "nowrap",
};

export default function AdminRetentionPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [days, setDays] = useState(60);

  async function fetchData(d) {
    setLoading(true);
    setError("");
    try {
      const res = await callAdminApi(`/api/admin/retention?days=${d || days}`);
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

  const s = data?.summary;
  const st = data?.stickiness;

  return (
    <AdminLayout title="留存分析">
      <div className="adm-page" style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 12, color: C.t3 }}>
            {loading ? "加载中..." : error ? <span style={{ color: C.red || "#dc2626" }}>{error}</span> : `${s?.cohortCount ?? 0} 个注册同期群 · 活跃信号取自练习记录`}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[30, 60, 90, 180].map((d) => (
              <button
                key={d}
                onClick={() => handleDaysChange(d)}
                style={{
                  padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: days === d ? 700 : 500,
                  border: "1px solid " + (days === d ? C.blue : C.bdr),
                  background: days === d ? C.blue : "#fff",
                  color: days === d ? "#fff" : C.t2, cursor: "pointer",
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

        {/* Stickiness + activation cards */}
        <div className="adm-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 14 }}>
          <StatCard
            value={st?.ratio != null ? `${Math.round(st.ratio * 100)}%` : "--"}
            label="粘性 (DAU/MAU)"
            sub="越高越像高频习惯"
            color={C.blue}
          />
          <StatCard value={st?.dau} label="日活 DAU" sub="近 1 天练习人数" color={C.nav} />
          <StatCard value={st?.wau} label="周活 WAU" sub="近 7 天" color={C.nav} />
          <StatCard value={st?.mau} label="月活 MAU" sub="近 30 天" color={C.nav} />
          <StatCard
            value={s?.activationPct != null ? `${s.activationPct}%` : "--"}
            label="激活率"
            sub={s ? `${s.totalActivated}/${s.totalUsers} 注册后练过` : null}
            color="#16a34a"
          />
        </div>

        {/* Mature-cohort retention summary */}
        <div style={{
          background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10,
          padding: 16, marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.nav, marginBottom: 4 }}>整体回访率（仅统计窗口已到期的同期群）</div>
          <div style={{ fontSize: 11, color: C.t3, marginBottom: 12 }}>
            注册后在该天数内至少回来练习一次的比例。这是判断"桶漏不漏"的核心指标。
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {[
              { k: "d1", label: "次日 (D1)" },
              { k: "d7", label: "7 天内" },
              { k: "d30", label: "30 天内" },
            ].map(({ k, label }) => {
              const v = s?.[k];
              return (
                <div key={k} style={{ textAlign: "center", padding: "12px 8px", background: C.bg, borderRadius: 8 }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: v?.pct != null ? C.blue : C.t3 }}>
                    {v?.pct != null ? `${v.pct}%` : "—"}
                  </div>
                  <div style={{ fontSize: 12, color: C.t2, marginTop: 4 }}>{label}</div>
                  <div style={{ fontSize: 10.5, color: C.t3, marginTop: 2 }}>
                    {v && v.users > 0 ? `${v.retained}/${v.users} 人` : "暂无到期数据"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Per-cohort heatmap */}
        <div style={{
          background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10,
          overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid " + C.bdr, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.nav }}>注册同期群留存热力图</span>
            <span style={{ fontSize: 10.5, color: C.t3 }}>颜色越深 = 回访率越高 · 斜体 % · 表示窗口未到期</span>
          </div>
          <div className="adm-table-wrap" style={{ overflowX: "auto" }}>
            {loading ? (
              <div style={{ height: 200, background: "#f8f8f8" }} />
            ) : !data?.cohorts?.length ? (
              <div style={{ padding: 24, color: C.t3, fontSize: 13, textAlign: "center" }}>暂无同期群数据</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...headCell, textAlign: "left", paddingLeft: 16 }}>注册日</th>
                    <th style={headCell}>新增</th>
                    <th style={headCell}>激活率</th>
                    <th style={headCell}>次日 D1</th>
                    <th style={headCell}>7 天内</th>
                    <th style={headCell}>30 天内</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cohorts.map((c) => (
                    <tr key={c.cohortDay}>
                      <td style={{ ...cellBase, textAlign: "left", paddingLeft: 16, color: C.t1, fontWeight: 600 }}>
                        {c.cohortDay}
                        <span style={{ color: C.t3, fontWeight: 400, fontSize: 10.5 }}> · {c.ageDays}天前</span>
                      </td>
                      <td style={{ ...cellBase, fontWeight: 700, color: C.nav }}>{c.size}</td>
                      <td style={cellBase}>
                        <span style={{ color: c.activationPct != null ? C.t1 : C.t3 }}>
                          {c.activationPct != null ? `${c.activationPct}%` : "—"}
                        </span>
                      </td>
                      <HeatCell pct={c.d1Pct} count={c.d1} size={c.size} mature={c.d1Mature} />
                      <HeatCell pct={c.d7Pct} count={c.d7} size={c.size} mature={c.d7Mature} />
                      <HeatCell pct={c.d30Pct} count={c.d30} size={c.size} mature={c.d30Mature} />
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
