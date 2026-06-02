"use client";
import { useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import {
  StatCard,
  SectionCard,
  Skeleton,
  ShimmerCSS,
  PageHeader,
  Badge,
  Button,
  InlineAlert,
  EmptyState,
} from "../../components/admin/primitives";
import { callAdminApi, relativeTime, fmtDate } from "../../lib/adminHelpers";
import { C } from "../../components/shared/ui";
import {
  FIRST_SET_SURVEY_ROUNDS,
  FIRST_SET_SURVEY_TYPE,
} from "../../lib/survey/firstSetSurveyType";

// Round picker options: every past round + an "all rounds" aggregate. Older
// rounds' responses stay in the DB across a round bump (separate survey_type),
// so the operator can always revisit them here.
const ROUND_OPTIONS = [...FIRST_SET_SURVEY_ROUNDS, { key: "all", label: "全部轮次" }];

function DistributionBar({ label, count, pct, total, color }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: C.t1 }}>{label}</span>
        <span style={{ fontSize: 12, color: C.t2, fontVariantNumeric: "tabular-nums" }}>
          {count} <span style={{ color: C.t3 }}>({pct}%)</span>
        </span>
      </div>
      <div style={{ height: 8, background: C.bdrSubtle, borderRadius: 4, overflow: "hidden" }}>
        <div
          style={{
            width: total > 0 ? `${(count / total) * 100}%` : "0%",
            height: "100%",
            background: color || C.blue,
            borderRadius: 4,
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}

function DistributionBlock({ title, dist, color }) {
  if (!dist || dist.total === 0) {
    return (
      <SectionCard title={title}>
        <EmptyState title="暂无作答" hint="提交后会在这里聚合分布" />
      </SectionCard>
    );
  }
  const max = Math.max(...dist.options.map((o) => o.count), 1);
  return (
    <SectionCard title={`${title} · ${dist.total} 人作答`}>
      {dist.options.map((o) => (
        <DistributionBar
          key={o.value}
          label={o.label}
          count={o.count}
          pct={o.pct}
          total={max}
          color={color}
        />
      ))}
    </SectionCard>
  );
}

function TrendChart({ trend }) {
  if (!trend || trend.length === 0) return <EmptyState title="暂无数据" />;
  const max = Math.max(...trend.map((d) => d.submitted + d.dismissed), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 140, paddingTop: 8 }}>
      {trend.map((d) => {
        const total = d.submitted + d.dismissed;
        const h = total > 0 ? Math.max((total / max) * 110, 4) : 2;
        const subH = total > 0 ? (d.submitted / total) * h : 0;
        return (
          <div
            key={d.date}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}
            title={`${d.date} · 提交 ${d.submitted} / 跳过 ${d.dismissed}`}
          >
            <div style={{ fontSize: 10, color: C.t3, marginBottom: 2 }}>{total || ""}</div>
            <div
              style={{
                width: "100%", maxWidth: 28, height: h,
                borderRadius: "4px 4px 0 0",
                background: C.bdr,
                position: "relative", overflow: "hidden",
              }}
            >
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: subH, background: C.blue }} />
            </div>
            <div
              style={{
                fontSize: 9, color: C.t3, marginTop: 3,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%",
              }}
            >
              {d.date.slice(5)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const Q1_BADGE_COLOR = {
  better: "#16a34a",
  same: "#64748b",
  worse: "#dc2626",
};
const Q2_BADGE_COLOR = {
  use_it_up: "#16a34a",
  maybe: "#d97706",
  probably_not: "#dc2626",
};

export default function AdminSurveysPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [round, setRound] = useState(FIRST_SET_SURVEY_TYPE);

  async function fetchData(r = round) {
    setLoading(true);
    setError("");
    try {
      const res = await callAdminApi(
        `/api/admin/surveys?commentLimit=100&round=${encodeURIComponent(r)}`,
      );
      setData(res);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => fetchData(round), 100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  const stats = data?.stats;
  const distributions = data?.distributions;
  const trend = data?.trend;
  const comments = data?.comments || [];
  const labels = data?.labels || {};

  return (
    <AdminLayout title="新手问卷">
      <div className="adm-page" style={{ maxWidth: 1200, margin: "0 auto" }}>
        <ShimmerCSS />
        <PageHeader
          title="新手首套题问卷"
          subtitle={
            loading ? "加载中..."
              : error ? error
              : updatedAt ? `最后更新 ${updatedAt.toLocaleTimeString()}`
              : ""
          }
          right={
            <Button variant="secondary" onClick={() => fetchData(round)} disabled={loading}>
              {loading ? "加载中…" : "刷新"}
            </Button>
          }
        />

        {/* Round picker — past rounds stay queryable after a bump */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: C.t3, fontWeight: 600 }}>轮次</span>
          {ROUND_OPTIONS.map((opt) => (
            <Button
              key={opt.key}
              size="sm"
              variant={round === opt.key ? "primary" : "secondary"}
              onClick={() => setRound(opt.key)}
              disabled={loading && round === opt.key}
            >
              {opt.label}
            </Button>
          ))}
        </div>

        {error && <div style={{ marginBottom: 16 }}><InlineAlert tone="error">{error}</InlineAlert></div>}

        {/* Top stats */}
        <div
          className="adm-stats"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
            marginBottom: 16,
          }}
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
              <StatCard
                value={stats?.totalShown ?? 0}
                label="问卷展示次数"
                color={C.nav}
                sub="提交 + 跳过"
              />
              <StatCard
                value={stats?.submitted ?? 0}
                label="成功提交"
                color="#16a34a"
              />
              <StatCard
                value={stats?.dismissed ?? 0}
                label="跳过/关闭"
                color="#d97706"
              />
              <StatCard
                value={stats ? `${stats.completionRate}%` : "--"}
                label="完成率"
                color={(stats?.completionRate ?? 0) >= 40 ? C.blue : "#d97706"}
                sub={(stats?.completionRate ?? 0) < 40 ? "<40% 偏低,可调奖励" : "健康区间"}
              />
            </>
          )}
        </div>

        {/* Trend */}
        <div style={{ marginBottom: 14 }}>
          <SectionCard title="近 14 天展示与提交">
            {loading ? <Skeleton height={140} /> : <TrendChart trend={trend} />}
            {!loading && (
              <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: C.t3 }}>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: C.blue, borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />提交</span>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: C.bdr, borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />跳过</span>
              </div>
            )}
          </SectionCard>
        </div>

        {/* Distributions */}
        <div
          className="adm-grid-3"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 14,
            marginBottom: 14,
          }}
        >
          {loading ? (
            Array.from({ length: 3 }, (_, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10, padding: 16 }}>
                <Skeleton height={80} />
              </div>
            ))
          ) : (
            <>
              <DistributionBlock title="Q1 · 这套题感觉怎么样?" dist={distributions?.q1} color="#16a34a" />
              <DistributionBlock title="Q2 · Pro 期间打算?" dist={distributions?.q2} color={C.blue} />
              <DistributionBlock title="Q3 · 影响最大的一点?" dist={distributions?.q3} color="#7c3aed" />
            </>
          )}
        </div>

        {/* Comments */}
        <div style={{ marginBottom: 14 }}>
          <SectionCard title={`用户留言 (${comments.length})`}>
            {loading ? (
              <Skeleton height={120} />
            ) : comments.length === 0 ? (
              <EmptyState title="暂无留言" hint="提交问卷的用户大多没写文字补充" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {comments.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      padding: "10px 12px",
                      border: "1px solid " + C.bdr,
                      borderRadius: 8,
                      background: "#fafbfc",
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: C.nav }}>
                        {c.user_code || "—"}
                      </span>
                      {c.q1 && <Badge color={Q1_BADGE_COLOR[c.q1] || "#64748b"}>{labels.q1?.[c.q1] || c.q1}</Badge>}
                      {c.q2 && <Badge color={Q2_BADGE_COLOR[c.q2] || "#64748b"}>{labels.q2?.[c.q2] || c.q2}</Badge>}
                      {c.q3 && <Badge color="#7c3aed">{c.q3Label || c.q3}</Badge>}
                      <span style={{ marginLeft: "auto", fontSize: 11, color: C.t3 }}>{relativeTime(c.created_at)}</span>
                    </div>
                    {c.q3Other && (
                      <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>
                        <span style={{ color: C.t3 }}>其他原因:</span> {c.q3Other}
                      </div>
                    )}
                    {c.q4 && (
                      <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                        {c.q4}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <div style={{ marginTop: 24, textAlign: "center", fontSize: 11, color: C.t3 }}>
          {updatedAt && <>数据最后刷新于 {fmtDate(updatedAt)}</>}
        </div>
      </div>
    </AdminLayout>
  );
}
