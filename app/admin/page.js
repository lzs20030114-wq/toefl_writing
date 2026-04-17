"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLayout from "../../components/admin/AdminLayout";
import {
  StatCard,
  SectionCard,
  MetricRow,
  Skeleton,
  ShimmerCSS,
  PageHeader,
  Badge,
  Button,
  InlineAlert,
} from "../../components/admin/primitives";
import { callAdminApi, fmtDate, relativeTime } from "../../lib/adminHelpers";
import { C } from "../../components/shared/ui";

// Quick-jump link groups rendered at the bottom — keeps admins one click away
// from every surface even if they don't use the sidebar.
const QUICK_LINKS = [
  {
    label: "内容",
    items: [
      { href: "/admin-content", label: "题库总览", hint: "所有题型的浏览" },
      { href: "/admin-questions", label: "写作题库编辑", hint: "学术 / 邮件 / BS CRUD" },
      { href: "/admin-generate", label: "AI 自动生成", hint: "发起生成任务" },
      { href: "/admin-staging", label: "暂存库审核", hint: "审核/部署生成结果" },
    ],
  },
  {
    label: "用户",
    items: [
      { href: "/admin-users", label: "用户管理" },
      { href: "/admin-codes", label: "登录码" },
      { href: "/admin-activity", label: "答题情况" },
    ],
  },
  {
    label: "运营",
    items: [
      { href: "/admin-analytics", label: "数据分析" },
      { href: "/admin-feedback", label: "用户反馈" },
      { href: "/admin-api-errors", label: "API 错误" },
      { href: "/admin-bs-errors", label: "BS 错题" },
    ],
  },
];

function CardLink({ href, label, hint }) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid " + C.bdr,
        textDecoration: "none",
        background: "#fff",
        transition: "border-color 0.12s, background 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = C.nav;
        e.currentTarget.style.background = "#f8fafc";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = C.bdr;
        e.currentTarget.style.background = "#fff";
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: C.nav }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>{hint}</div>}
    </Link>
  );
}

export default function AdminHomePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  async function fetchAll() {
    setLoading(true);
    setError("");
    try {
      const [users, codes, content, staging, apiErrors] = await Promise.all([
        callAdminApi("/api/admin/users").catch(() => null),
        callAdminApi("/api/admin/codes").catch(() => null),
        callAdminApi("/api/admin/content").catch(() => null),
        callAdminApi("/api/admin/content/staging").catch(() => null),
        callAdminApi("/api/admin/api-errors?limit=5").catch(() => null),
      ]);
      setData({ users, codes, content, staging, apiErrors });
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(fetchAll, 100);
    return () => clearTimeout(t);
  }, []);

  const u = data?.users;
  const codeStats = data?.codes?.stats;
  const content = data?.content;
  const staging = data?.staging;
  const apiErrors = data?.apiErrors;

  const contentTotals = useMemo(() => {
    if (!content?.groups) return null;
    let banks = 0;
    let questions = 0;
    for (const g of content.groups) {
      for (const item of g.items) {
        banks++;
        questions += item.count || 0;
      }
    }
    return { banks, questions, groups: content.groups.length };
  }, [content]);

  const stagingCount = staging?.items?.length ?? 0;
  const recentStaging = (staging?.items || []).slice(0, 4);
  const recentApiErrors = Array.isArray(apiErrors?.rows) ? apiErrors.rows.slice(0, 4) : [];

  return (
    <AdminLayout title="数据总览">
      <div className="adm-page" style={{ maxWidth: 1200, margin: "0 auto" }}>
        <ShimmerCSS />

        <PageHeader
          title="管理后台"
          subtitle={
            loading ? "加载中..."
              : error ? error
              : updatedAt ? `最后更新 ${updatedAt.toLocaleTimeString()}`
              : ""
          }
          right={
            <Button variant="secondary" onClick={fetchAll} disabled={loading}>
              {loading ? "加载中…" : "刷新"}
            </Button>
          }
        />

        {error && <div style={{ marginBottom: 16 }}><InlineAlert tone="error">{error}</InlineAlert></div>}

        {/* Top row: key business metrics */}
        <div className="adm-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
          {loading ? (
            Array.from({ length: 6 }, (_, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10, padding: 18 }}>
                <Skeleton height={32} width={60} />
                <div style={{ marginTop: 8 }}><Skeleton height={14} width={80} /></div>
              </div>
            ))
          ) : (
            <>
              <StatCard value={u?.total} label="总用户" color={C.nav} sub={u?.growth ? `24h +${u.growth.lastDay}` : undefined} />
              <StatCard value={u?.active?.lastDay} label="24h 活跃" color={C.blue} />
              <StatCard value={u?.tiers?.pro} label="Pro 用户" color="#16a34a" sub={u?.tiers ? `${u.tiers.free} 免费` : undefined} />
              <StatCard value={codeStats?.available} label="可用登录码" color={codeStats?.available > 5 ? C.blue : "#d97706"} sub={codeStats ? `已发放 ${codeStats.issued}` : undefined} />
              <StatCard value={contentTotals?.questions ?? "--"} label="题库总题数" color={C.nav} sub={contentTotals ? `${contentTotals.banks} 个题库` : undefined} />
              <StatCard value={stagingCount} label="暂存待审核" color={stagingCount > 0 ? "#d97706" : C.t2} />
            </>
          )}
        </div>

        {/* Content overview */}
        <div style={{ marginBottom: 14 }}>
          <SectionCard title="题库覆盖" href="/admin-content">
            {loading ? <Skeleton height={100} /> : content?.groups ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                {content.groups.map((g) => {
                  const gTotal = g.items.reduce((s, it) => s + (it.count || 0), 0);
                  const gStaging = g.items.reduce((s, it) => s + (it.stagingCount || 0), 0);
                  return (
                    <div key={g.key} style={{ padding: "10px 12px", border: "1px solid " + C.bdr, borderRadius: 8, background: "#fafbfc" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.nav }}>{g.label}</span>
                        <span style={{ fontSize: 12, color: C.t3 }}>{gTotal} 题</span>
                      </div>
                      {g.items.map((item) => (
                        <div key={item.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0", color: C.t2 }}>
                          <span>{item.label}</span>
                          <span>
                            {item.count}{item.stagingCount > 0 ? <span style={{ color: "#d97706" }}> + {item.stagingCount}</span> : ""}
                            {!item.hasGeneration && <span style={{ color: "#94a3b8", marginLeft: 4 }}>· 只读</span>}
                          </span>
                        </div>
                      ))}
                      {gStaging > 0 && (
                        <div style={{ marginTop: 6, fontSize: 11 }}>
                          <Link href={`/admin-staging`} style={{ color: "#d97706", textDecoration: "none", fontWeight: 600 }}>
                            {gStaging} 项暂存待审核 &rarr;
                          </Link>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : <div style={{ color: C.t3, fontSize: 13 }}>暂无数据</div>}
          </SectionCard>
        </div>

        {/* Users + codes */}
        <div className="adm-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <SectionCard title="用户增长" href="/admin-users">
            {loading ? <Skeleton height={100} /> : u ? (
              <div>
                <MetricRow label="最近1小时" value={`+${u.growth?.lastHour ?? 0}`} />
                <MetricRow label="最近24小时" value={`+${u.growth?.lastDay ?? 0}`} />
                <MetricRow label="最近7天" value={`+${u.growth?.lastWeek ?? 0}`} />
                <MetricRow label="最近30天" value={`+${u.growth?.lastMonth ?? 0}`} />
              </div>
            ) : <div style={{ color: C.t3, fontSize: 13 }}>暂无数据</div>}
          </SectionCard>

          <SectionCard title="活跃与认证" href="/admin-activity">
            {loading ? <Skeleton height={100} /> : u ? (
              <div>
                <MetricRow label="24h 活跃" value={u.active?.lastDay} color={C.blue} />
                <MetricRow label="7天活跃" value={u.active?.lastWeek} />
                <MetricRow label="30天活跃" value={u.active?.lastMonth} />
                <div style={{ borderTop: "1px solid " + C.bdr, marginTop: 8, paddingTop: 8 }}>
                  <MetricRow label="登录码注册" value={u.authMethods?.code} />
                  <MetricRow label="邮箱注册" value={u.authMethods?.email} />
                </div>
              </div>
            ) : <div style={{ color: C.t3, fontSize: 13 }}>暂无数据</div>}
          </SectionCard>
        </div>

        {/* Staging + errors */}
        <div className="adm-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <SectionCard title="最近暂存" href="/admin-staging">
            {loading ? <Skeleton height={100} /> : recentStaging.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {recentStaging.map((s) => (
                  <div key={s.file} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "4px 0" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                      <Badge color="#d97706">{s.typeKey}</Badge>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: C.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.file}</span>
                    </div>
                    <span style={{ color: C.t3, fontSize: 11 }}>{relativeTime(s.modifiedAt)}</span>
                  </div>
                ))}
              </div>
            ) : <div style={{ color: C.t3, fontSize: 13 }}>暂无待审核</div>}
          </SectionCard>

          <SectionCard title="最近 API 错误" href="/admin-api-errors">
            {loading ? <Skeleton height={100} /> : recentApiErrors.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {recentApiErrors.map((err, i) => {
                  const status = Number(err.http_status) || 0;
                  return (
                    <div key={err.id || i} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid " + C.bdr }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <Badge color={status >= 500 ? "#dc2626" : "#d97706"}>{status || err.error_type || "?"}</Badge>
                        <span style={{ color: C.t3, fontSize: 11 }}>{relativeTime(err.created_at)}</span>
                      </div>
                      <div style={{ marginTop: 2, color: C.t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {err.endpoint || err.error_message || err.error_type || "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <div style={{ color: C.t3, fontSize: 13 }}>近期无错误</div>}
          </SectionCard>
        </div>

        {/* Quick links */}
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.nav, marginBottom: 10 }}>快速入口</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {QUICK_LINKS.map((group) => (
              <div key={group.label} style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.t3, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>{group.label}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {group.items.map((it) => <CardLink key={it.href} {...it} />)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 24, textAlign: "center", fontSize: 11, color: C.t3 }}>
          {updatedAt && <>数据最后刷新于 {fmtDate(updatedAt)}</>}
        </div>
      </div>
    </AdminLayout>
  );
}
