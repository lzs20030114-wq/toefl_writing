"use client";
import { useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import {
  StatCard,
  SectionCard,
  MetricRow,
  Skeleton,
  ShimmerCSS,
  PageHeader,
  Button,
  InlineAlert,
  EmptyState,
} from "../../components/admin/primitives";
import { callAdminApi, fmtDate } from "../../lib/adminHelpers";
import { C } from "../../components/shared/ui";

function DistributionBar({ label, count, pct, total, color }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: C.t1 }}>{label}</span>
        <span style={{ fontSize: 12, color: C.t2, fontVariantNumeric: "tabular-nums" }}>
          {count} <span style={{ color: C.t3 }}>({pct}%)</span>
        </span>
      </div>
      <div style={{ height: 10, background: C.bdrSubtle, borderRadius: 5, overflow: "hidden" }}>
        <div
          style={{
            width: total > 0 ? `${(count / total) * 100}%` : "0%",
            height: "100%",
            background: color || C.blue,
            borderRadius: 5,
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}

export default function AdminVoiceVotePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  async function fetchData() {
    setLoading(true);
    setError("");
    try {
      const res = await callAdminApi("/api/admin/voice-vote");
      setData(res);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(fetchData, 100);
    return () => clearTimeout(t);
  }, []);

  const votes = data?.votes ?? 0;
  const upgrade = data?.upgrade ?? 0;
  const keep = data?.keep ?? 0;
  const upgradePct = data?.upgradePct ?? 0;
  const keepPct = data?.keepPct ?? 0;
  const lead = upgrade === keep ? "持平" : upgrade > keep ? "支持升级领先" : "维持现状领先";

  return (
    <AdminLayout title="语音升级投票">
      <div className="adm-page" style={{ maxWidth: 900, margin: "0 auto" }}>
        <ShimmerCSS />
        <PageHeader
          title="听力语音升级 A/B 投票"
          subtitle={
            loading ? "加载中..."
              : error ? error
              : updatedAt ? `最后更新 ${updatedAt.toLocaleTimeString()}`
              : ""
          }
          right={
            <Button variant="secondary" onClick={fetchData} disabled={loading}>
              {loading ? "加载中…" : "刷新"}
            </Button>
          }
        />

        {error && <div style={{ marginBottom: 16 }}><InlineAlert tone="error">{error}</InlineAlert></div>}

        {/* Top stats */}
        <div
          className="adm-stats"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}
        >
          {loading ? (
            Array.from({ length: 4 }, (_, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10, padding: 18 }}>
                <Skeleton height={32} width={60} />
                <div style={{ marginTop: 8 }}><Skeleton height={14} width={80} /></div>
              </div>
            ))
          ) : (
            <>
              <StatCard value={votes} label="总投票数" color={C.nav} sub={lead} />
              <StatCard value={upgrade} label="支持升级" color="#16a34a" sub={`${upgradePct}%`} />
              <StatCard value={keep} label="维持现状" color="#d97706" sub={`${keepPct}%`} />
              <StatCard value={data?.dismissed ?? 0} label="看过未投" color={C.t2} sub={data ? `展示 ${data.shown ?? 0} 次` : undefined} />
            </>
          )}
        </div>

        {/* Distribution */}
        <div style={{ marginBottom: 14 }}>
          <SectionCard title={votes > 0 ? `投票分布 · 共 ${votes} 票` : "投票分布"}>
            {loading ? (
              <Skeleton height={60} />
            ) : votes === 0 ? (
              <EmptyState title="还没有投票" hint="用户在首页弹窗投票后会在这里实时聚合" />
            ) : (
              <>
                <DistributionBar label="👍 支持升级" count={upgrade} pct={upgradePct} total={votes} color="#16a34a" />
                <DistributionBar label="🤔 维持现状" count={keep} pct={keepPct} total={votes} color="#d97706" />
              </>
            )}
          </SectionCard>
        </div>

        {/* Source breakdown */}
        {!loading && votes > 0 && (
          <div style={{ marginBottom: 14 }}>
            <SectionCard title="投票来源">
              <MetricRow label="登录用户投票" value={data?.loggedInVotes ?? 0} color={C.blue} />
              <MetricRow label="匿名访客投票" value={data?.anonVotes ?? 0} />
            </SectionCard>
          </div>
        )}

        <div style={{ marginTop: 24, textAlign: "center", fontSize: 11, color: C.t3 }}>
          {updatedAt && <>数据最后刷新于 {fmtDate(updatedAt)}</>}
        </div>
      </div>
    </AdminLayout>
  );
}
