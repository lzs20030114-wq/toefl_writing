"use client";
import { useEffect, useState, Fragment } from "react";
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

// Renders one matrix question: each dimension is a labeled group of scale bars.
function MatrixBlock({ title, matrix, color }) {
  const answered = Array.isArray(matrix) && matrix.some((d) => d.total > 0);
  if (!answered) {
    return (
      <SectionCard title={title}>
        <EmptyState title="暂无作答" hint="提交后会在这里聚合分布" />
      </SectionCard>
    );
  }
  return (
    <SectionCard title={title}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {matrix.map((dim) => {
          const max = Math.max(...dim.options.map((o) => o.count), 1);
          return (
            <div key={dim.key}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.t1, marginBottom: 6 }}>
                {dim.label} <span style={{ color: C.t3, fontWeight: 400 }}>· {dim.total} 人</span>
              </div>
              {dim.options.map((o) => (
                <DistributionBar key={o.value} label={o.label} count={o.count} pct={o.pct} total={max} color={color} />
              ))}
            </div>
          );
        })}
      </div>
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
const VARIANT_BADGE_COLOR = {
  v1: "#0891b2",
  new: "#16a34a",
  legacy: "#94a3b8",
};
const RECALL_BADGE_COLOR = {
  clear: "#0891b2",
  fuzzy: "#94a3b8",
};
// Tier badge shown next to the user code in the detail table (free → none).
const TIER_BADGE = {
  pro: { label: "Pro", color: "#16a34a" },
  legacy: { label: "Legacy", color: "#7c3aed" },
};
// Matrix cell colors — abs (good/ok/bad) and cmp (better/same/worse) scales.
const MATRIX_VALUE_COLOR = {
  good: "#16a34a", ok: "#d97706", bad: "#dc2626",
  better: "#16a34a", same: "#64748b", worse: "#dc2626",
};

// Compact "MM-DD HH:mm" for the detail table (full timestamp on hover).
function shortDateTime(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Per-response detail table: one row per submitted questionnaire, showing time
// + 来源 (variant cohort) + that person's answers. Rows with a matrix / 其他原因
// / 留言 expand to reveal the full detail. Respects the round picker (entries
// come from the same round-filtered set as the aggregates above).
function ResponsesTable({ entries, truncated, labels }) {
  const [expanded, setExpanded] = useState(() => new Set());
  if (!entries || entries.length === 0) {
    return <EmptyState title="暂无作答" hint="用户提交问卷后,每一份会在这里逐条列出" />;
  }
  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const th = {
    textAlign: "left", fontSize: 11, fontWeight: 700, color: C.t3,
    padding: "8px 10px", whiteSpace: "nowrap", borderBottom: "1px solid " + C.bdr,
  };
  const td = {
    fontSize: 12.5, color: C.t1, padding: "9px 10px",
    borderBottom: "1px solid " + C.bdrSubtle, verticalAlign: "middle",
  };
  const dash = <span style={{ color: C.t3 }}>—</span>;
  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 28 }} aria-label="展开" />
              <th style={th}>时间</th>
              <th style={th}>用户</th>
              <th style={th}>分群</th>
              <th style={th}>感觉 / 印象</th>
              <th style={th}>Pro 打算</th>
              <th style={th}>影响最大</th>
              <th style={th}>留言</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const isOpen = expanded.has(e.id);
              const dims = e.matrix?.dims?.filter((d) => d.value) || [];
              const hasDetail = dims.length > 0 || e.q3Other || e.q4;
              return (
                <Fragment key={e.id}>
                  <tr
                    onClick={() => hasDetail && toggle(e.id)}
                    style={{ cursor: hasDetail ? "pointer" : "default", background: isOpen ? "#f8fafc" : "transparent" }}
                  >
                    <td style={{ ...td, textAlign: "center", color: C.t3 }}>{hasDetail ? (isOpen ? "▾" : "▸") : ""}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: C.t2, fontVariantNumeric: "tabular-nums" }} title={fmtDate(e.created_at)}>
                      {shortDateTime(e.created_at)}
                    </td>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.nav }}>{e.user_code || "—"}</span>
                        {e.tier && TIER_BADGE[e.tier] && <Badge color={TIER_BADGE[e.tier].color}>{TIER_BADGE[e.tier].label}</Badge>}
                      </div>
                      <div
                        style={{ fontSize: 11, color: C.t3, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={e.email || ""}
                      >
                        {e.email || <span style={{ color: C.t3 }}>无邮箱(登录码用户)</span>}
                      </div>
                    </td>
                    <td style={td}>{e.variant ? <Badge color={VARIANT_BADGE_COLOR[e.variant] || "#64748b"}>{labels.variant?.[e.variant] || e.variant}</Badge> : dash}</td>
                    <td style={td}>
                      {e.q1 && <Badge color={Q1_BADGE_COLOR[e.q1] || "#64748b"}>{labels.q1?.[e.q1] || e.q1}</Badge>}
                      {e.recall && <Badge color={RECALL_BADGE_COLOR[e.recall] || "#64748b"}>{labels.recall?.[e.recall] || e.recall}</Badge>}
                      {!e.q1 && !e.recall && dash}
                    </td>
                    <td style={td}>{e.q2 ? <Badge color={Q2_BADGE_COLOR[e.q2] || "#64748b"}>{labels.q2?.[e.q2] || e.q2}</Badge> : dash}</td>
                    <td style={td}>{e.q3 ? <Badge color="#7c3aed">{e.q3Label || e.q3}</Badge> : dash}</td>
                    <td style={{ ...td, textAlign: "center" }}>{e.q4 ? "💬" : dash}</td>
                  </tr>
                  {isOpen && hasDetail && (
                    <tr>
                      <td style={{ background: "#f8fafc", borderBottom: "1px solid " + C.bdrSubtle }} />
                      <td colSpan={7} style={{ padding: "2px 10px 14px", borderBottom: "1px solid " + C.bdrSubtle, background: "#f8fafc" }}>
                        {dims.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: e.q3Other || e.q4 ? 10 : 0 }}>
                            {dims.map((d) => (
                              <span key={d.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 9px", borderRadius: 7, background: "#fff", border: "1px solid " + C.bdr }}>
                                <span style={{ color: C.t2 }}>{d.label}</span>
                                <span style={{ fontWeight: 700, color: MATRIX_VALUE_COLOR[d.value] || C.t1 }}>{d.valueLabel}</span>
                              </span>
                            ))}
                          </div>
                        )}
                        {e.q3Other && (
                          <div style={{ fontSize: 12, color: C.t2, marginBottom: e.q4 ? 6 : 0 }}>
                            <span style={{ color: C.t3 }}>其他原因:</span> {e.q3Other}
                          </div>
                        )}
                        {e.q4 && (
                          <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                            <span style={{ color: C.t3, fontSize: 12 }}>留言:</span> {e.q4}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {truncated && (
        <div style={{ fontSize: 11, color: C.t3, marginTop: 10 }}>
          仅显示最新 1000 份,更早的作答未列出。
        </div>
      )}
    </div>
  );
}

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
  const matrices = data?.matrices;
  const trend = data?.trend;
  const comments = data?.comments || [];
  const entries = data?.entries || [];
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
              <DistributionBlock title="人群分布(老用户 / 新用户)" dist={distributions?.variant} color={C.nav} />
              <DistributionBlock title="这套题感觉怎么样?(新用户)" dist={distributions?.q1} color="#16a34a" />
              <DistributionBlock title="对 V1 还有印象吗?(老用户)" dist={distributions?.recall} color="#0891b2" />
              <DistributionBlock title="Pro 期间打算?" dist={distributions?.q2} color={C.blue} />
              <DistributionBlock title="影响最大的一点?" dist={distributions?.q3} color="#7c3aed" />
            </>
          )}
        </div>

        {/* Matrix questions (各维度评价) */}
        {!loading && (
          <div
            className="adm-grid-3"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: 14,
              marginBottom: 14,
            }}
          >
            <MatrixBlock title="新用户 · 各维度评价" matrix={matrices?.newAbs} color="#16a34a" />
            <MatrixBlock title="老用户(印象清楚)· 相比 V1" matrix={matrices?.v1Cmp} color="#0891b2" />
            <MatrixBlock title="老用户(记不清)· V2 绝对评价" matrix={matrices?.v1Abs} color="#7c3aed" />
          </div>
        )}

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
                      {c.variant && <Badge color={VARIANT_BADGE_COLOR[c.variant] || "#64748b"}>{labels.variant?.[c.variant] || c.variant}</Badge>}
                      {c.recall && <Badge color={RECALL_BADGE_COLOR[c.recall] || "#64748b"}>{labels.recall?.[c.recall] || c.recall}</Badge>}
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

        {/* Per-response detail — one row per submitted questionnaire */}
        <div style={{ marginBottom: 14 }}>
          <SectionCard
            title={`逐份作答明细 (${entries.length})`}
            right={<span style={{ fontSize: 11, color: C.t3 }}>点击行可展开各维度评价 / 留言</span>}
          >
            {loading ? (
              <Skeleton height={160} />
            ) : (
              <ResponsesTable entries={entries} truncated={data?.entriesTruncated} labels={labels} />
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
