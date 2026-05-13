"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { callAdminApi, useAdminToken } from "../../lib/adminHelpers";
import { C } from "../../components/shared/ui";

function StatCard({ value, label, color, sub }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10,
      padding: "18px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || C.nav, lineHeight: 1.1 }}>{value ?? "--"}</div>
      <div style={{ fontSize: 12, color: C.t2, marginTop: 6 }}>{label}</div>
      {sub ? <div style={{ fontSize: 11, color: C.t3, marginTop: 4 }}>{sub}</div> : null}
    </div>
  );
}

function FunnelBar({ stages }) {
  if (!stages?.length) return null;
  const max = Math.max(...stages.map((s) => s.count), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {stages.map((s, idx) => {
        const pct = (s.count / max) * 100;
        const conv = idx > 0 ? (stages[idx - 1].count > 0 ? (s.count / stages[idx - 1].count) * 100 : 0) : null;
        return (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 100, fontSize: 12, fontWeight: 600, color: C.t2, flexShrink: 0, textAlign: "right" }}>
              {s.label}
            </div>
            <div style={{ flex: 1, height: 24, background: C.bg, borderRadius: 6, overflow: "hidden", position: "relative" }}>
              <div style={{
                width: `${pct}%`, height: "100%",
                background: `linear-gradient(90deg, ${s.color || "#3b82f6"}, ${s.color2 || "#1d4ed8"})`,
                borderRadius: 6, transition: "width 0.4s ease",
              }} />
              <span style={{
                position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
                fontSize: 12, fontWeight: 700, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.2)",
              }}>
                {s.count}
              </span>
            </div>
            <div style={{ width: 60, fontSize: 11, color: C.t3, textAlign: "right", flexShrink: 0 }}>
              {conv !== null ? `${conv.toFixed(1)}%` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DailyChart({ daily, height = 160 }) {
  if (!daily?.length) return <div style={{ color: C.t3, fontSize: 13, padding: 12 }}>暂无数据</div>;
  const maxVisits = Math.max(...daily.map((d) => d.link_visits || 0), 1);
  const maxGrants = Math.max(...daily.map((d) => d.grants || 0), 1);
  const max = Math.max(maxVisits, maxGrants);
  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 8, fontSize: 11, color: C.t2 }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#3b82f6", borderRadius: 2, marginRight: 4 }} />Link 访问</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#10b981", borderRadius: 2, marginRight: 4 }} />Grant 发放</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height, padding: "0 4px" }}>
        {daily.map((d) => {
          const hv = Math.max(((d.link_visits || 0) / max) * (height - 30), 0);
          const hg = Math.max(((d.grants || 0) / max) * (height - 30), 0);
          return (
            <div key={d.day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
              <div style={{ fontSize: 9, color: C.t3, marginBottom: 2 }}>
                {(d.link_visits || 0) + (d.grants || 0) || ""}
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: height - 30, width: "100%" }}>
                <div title={`${d.day}: ${d.link_visits} 访问`} style={{ flex: 1, height: hv, background: "#3b82f6", borderRadius: "3px 3px 0 0", transition: "height 0.3s" }} />
                <div title={`${d.day}: ${d.grants} 发放`} style={{ flex: 1, height: hg, background: "#10b981", borderRadius: "3px 3px 0 0", transition: "height 0.3s" }} />
              </div>
              <div style={{ fontSize: 9, color: C.t3, marginTop: 4, transform: "rotate(-30deg)", transformOrigin: "center" }}>
                {d.day.slice(5)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Table({ title, rows, columns, emptyText = "暂无数据" }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10,
      overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid " + C.bdr }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.nav }}>{title}</span>
      </div>
      <div className="adm-table-wrap" style={{ overflowX: "auto" }}>
        {(!rows || rows.length === 0) ? (
          <div style={{ padding: 24, fontSize: 13, color: C.t3, textAlign: "center" }}>{emptyText}</div>
        ) : (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {columns.map((col) => (
                  <th key={col.key} style={{ textAlign: col.align || "left", padding: "8px 12px", fontWeight: 700, color: C.t2, borderBottom: "1px solid " + C.bdr }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: "1px solid " + C.bdrSubtle }}>
                  {columns.map((col) => (
                    <td key={col.key} style={{ padding: "8px 12px", textAlign: col.align || "left", color: col.color || C.t1, fontFamily: col.mono ? "ui-monospace, Menlo, monospace" : "inherit" }}>
                      {col.render ? col.render(row) : (row[col.key] ?? "-")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function AdminReferralsPage() {
  const { token, ready: tokenReady } = useAdminToken();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const body = await callAdminApi(`/api/admin/referrals/stats?days=${days}`);
      setData(body);
    } catch (e) {
      setError(e?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [token, days]);

  useEffect(() => {
    if (!tokenReady) return;
    fetchStats();
  }, [tokenReady, fetchStats]);

  const funnelStages = useMemo(() => {
    if (!data?.funnel) return [];
    const f = data.funnel;
    return [
      { label: "链接访问", count: f.link_visit, color: "#60a5fa", color2: "#3b82f6" },
      { label: "登录窗打开", count: f.modal_open, color: "#60a5fa", color2: "#3b82f6" },
      { label: "尝试绑定", count: f.bind_attempt, color: "#a78bfa", color2: "#8b5cf6" },
      { label: "绑定成功", count: f.bind_success, color: "#a78bfa", color2: "#8b5cf6" },
      { label: "首次练习", count: f.first_practice, color: "#34d399", color2: "#10b981" },
      { label: "奖励到账", count: f.grant_success, color: "#10b981", color2: "#059669" },
    ];
  }, [data]);

  return (
    <AdminLayout title="邀请活动">
      <div className="adm-page" style={{ maxWidth: 1120, margin: "0 auto" }}>
        {/* Controls */}
        <div className="adm-ctrl-row" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, marginBottom: 16, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {[7, 14, 30, 60, 90].map((n) => (
              <button
                key={n}
                onClick={() => setDays(n)}
                style={{
                  padding: "6px 12px", borderRadius: 8, border: "1px solid " + (n === days ? C.blue : C.bdr),
                  background: n === days ? C.ltB : "#fff",
                  color: n === days ? C.blue : C.t2, fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >
                {n} 天
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.t3 }}>
            {data?.window ? `自 ${new Date(data.window.since).toLocaleDateString()} 起` : ""}
          </div>
          <button
            onClick={fetchStats}
            disabled={loading}
            style={{
              padding: "6px 14px", borderRadius: 8, border: "1px solid " + C.bdr,
              background: "#fff", color: C.t2, fontSize: 12, fontWeight: 600,
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>

        {error ? (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
            {error}
          </div>
        ) : null}

        {/* Summary cards */}
        <div className="adm-stats" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          <StatCard
            value={data?.summary?.total_referrals ?? "--"}
            label="总绑定数"
            color="#3b82f6"
          />
          <StatCard
            value={data?.summary?.granted_total ?? "--"}
            label="已发放奖励"
            color="#10b981"
            sub={data?.summary?.granted_total ? `${(data.summary.granted_total || 0) * 3} 天 Pro` : ""}
          />
          <StatCard
            value={data?.summary?.pending_total ?? "--"}
            label="待激活"
            color="#f59e0b"
            sub="尚未完成首次练习"
          />
          <StatCard
            value={data?.summary?.rejected_total ?? "--"}
            label="被拒绝"
            color="#ef4444"
            sub="自邀 / 同 IP 限流等"
          />
        </div>

        {/* Funnel */}
        <div style={{
          background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10,
          padding: "16px 20px", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.nav, marginBottom: 12 }}>
            转化漏斗
            <span style={{ fontSize: 11, fontWeight: 500, color: C.t3, marginLeft: 8 }}>
              右侧百分比 = 较上一阶段的转化率
            </span>
          </div>
          <FunnelBar stages={funnelStages} />
        </div>

        {/* Daily chart */}
        <div style={{
          background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10,
          padding: "16px 20px", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.nav, marginBottom: 12 }}>每日趋势</div>
          <DailyChart daily={data?.daily || []} />
        </div>

        {/* Top inviters + rejection reasons */}
        <div className="adm-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <Table
            title={`Top 邀请者 (按已发放数)`}
            rows={data?.topInviters || []}
            columns={[
              { key: "inviter_code", label: "邀请码", mono: true },
              { key: "granted", label: "已发放", align: "right", color: "#10b981" },
              { key: "pending", label: "待激活", align: "right", color: "#f59e0b" },
              { key: "days_earned", label: "累计 Pro 天数", align: "right",
                render: (r) => `${r.days_earned} 天` },
            ]}
          />
          <Table
            title="拒绝原因分布"
            rows={data?.rejectionReasons || []}
            columns={[
              { key: "reason", label: "原因", mono: true },
              { key: "count", label: "次数", align: "right", color: "#ef4444" },
            ]}
            emptyText="未发现拒绝事件"
          />
        </div>

        {/* Suspicious IPs */}
        <Table
          title="可疑 IP（同 IP 多次尝试或同 IP 多被邀请者）"
          rows={data?.suspiciousIps || []}
          columns={[
            { key: "ip", label: "IP 地址", mono: true },
            { key: "attempts", label: "尝试数", align: "right" },
            { key: "bind_successes", label: "绑定成功", align: "right" },
            { key: "distinct_invitees", label: "不同被邀请者", align: "right",
              render: (r) => (r.distinct_invitees >= 3
                ? <span style={{ color: "#ef4444", fontWeight: 700 }}>{r.distinct_invitees}</span>
                : r.distinct_invitees) },
          ]}
          emptyText="未发现异常模式"
        />

        <div style={{ marginTop: 16, fontSize: 11, color: C.t3, lineHeight: 1.7 }}>
          <strong>说明：</strong>
          <br />· 漏斗中各阶段计数来源于 referral_events 表；同一用户/IP 不去重，便于看真实事件量。
          <br />· "Top 邀请者"和"总绑定数"等汇总来自 referrals 表（每个被邀请者唯一一行）。
          <br />· "可疑 IP" 触发条件：尝试 ≥3 次 或 涉及 ≥3 个不同被邀请者。≥3 个不同被邀请者以红色标出。
          <br />· 时间窗口仅影响事件计数；referrals 表按 bound_at 过滤。
        </div>
      </div>
    </AdminLayout>
  );
}
