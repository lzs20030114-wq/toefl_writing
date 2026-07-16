"use client";
import { useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { callAdminApi } from "../../lib/adminHelpers";
import { C } from "../../components/shared/ui";

// Brand teal-green (#0d9668) as rgb, for heatmap cell tinting.
const BRAND_RGB = "13, 150, 104";

// Per-feature color, shared across the ranking bars, stickiness cards, the
// first-touch bars and the weekly stacked chart so a feature reads the same
// everywhere. bs keeps the brand green.
const FEATURE_COLOR = {
  bs: "#0d9668",
  discussion: "#2563eb",
  email: "#7c3aed",
  reading: "#d97706",
  listening: "#dc2626",
  speaking: "#db2777",
  mock: "#0891b2",
};
const featureColor = (f) => FEATURE_COLOR[f] || C.t2;

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

function Card({ title, hint, right, children }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10,
      overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", marginBottom: 14,
    }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid " + C.bdr, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.nav }}>{title}</div>
          {hint ? <div style={{ fontSize: 10.5, color: C.t3, marginTop: 2 }}>{hint}</div> : null}
        </div>
        {right || null}
      </div>
      {children}
    </div>
  );
}

// Amber notice shown in the feature sections when the backing views haven't
// been created yet (migration unrun). `sql` names which migration to run —
// 整科视图缺失指向 feature-engagement.sql，小题型视图缺失指向 -subtype.sql。
function MigrationNotice({ sql = "scripts/sql/feature-engagement.sql" }) {
  return (
    <div style={{ padding: 16, fontSize: 12.5, color: "#9a3412", background: "#fff7ed", lineHeight: 1.6 }}>
      功能分析视图尚未创建。请在 Supabase SQL Editor 运行{" "}
      <code style={{ background: "#fef3c7", padding: "1px 5px", borderRadius: 4 }}>{sql}</code>
      {" "}后刷新本页。
    </div>
  );
}

const th = {
  textAlign: "right", padding: "9px 10px", fontSize: 11, fontWeight: 700,
  color: C.t2, borderBottom: "2px solid " + C.bdr, whiteSpace: "nowrap",
};
const td = {
  textAlign: "right", padding: "9px 10px", fontSize: 12.5,
  borderBottom: "1px solid " + C.bdrSubtle, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
};

// Below this many reached users a feature's rates are too noisy to trust.
const MIN_CONFIDENCE_USERS = 5;

const pctOf = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

function AiTag({ gated }) {
  return gated ? (
    <span title="AI 评分，免费用户 3 次/天 —— 做题量受额度限制" style={{ background: "#fef3c7", color: "#92400e", borderRadius: 4, padding: "1px 5px", fontSize: 9.5, fontWeight: 700 }}>
      AI·限额
    </span>
  ) : (
    <span title="本地判分，免费无限" style={{ background: "#ecfdf5", color: "#065f46", borderRadius: 4, padding: "1px 5px", fontSize: 9.5, fontWeight: 700 }}>
      免费无限
    </span>
  );
}

// ---- Feature ranking: 功能吸引力（按触达用户排序）------------------------
function FeatureRanking({ features, segment }) {
  if (!features?.length) {
    return <div style={{ padding: 20, color: C.t3, fontSize: 13 }}>暂无做题记录。</div>;
  }
  const seg = (f) => f.segments?.[segment] || f.segments?.all || { users: 0, sessions: 0, items: 0, repeat2: 0 };
  const rows = features
    .map((f) => ({ f, s: seg(f) }))
    .sort((a, b) => b.s.users - a.s.users);
  const maxUsers = Math.max(...rows.map((r) => r.s.users), 1);
  const totalItems = rows.reduce((sum, r) => sum + r.s.items, 0);

  return (
    <div className="adm-table-wrap" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left", paddingLeft: 16 }}>功能</th>
            <th style={{ ...th, minWidth: 190 }}>触达用户（主）</th>
            <th style={th}>复练率 ≥2次</th>
            <th style={th} title="首次使用 ≥7 天前的用户里之后又回来的比例（全部用户口径）">功能留存</th>
            <th style={th} title="各功能单位不同（造句一场几十题 / 写作一篇算1），不可跨功能直接比大小">题目数·投入量</th>
            <th style={th}>场次</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ f, s }) => {
            const lowConf = s.users > 0 && s.users < MIN_CONFIDENCE_USERS;
            const dim = s.users === 0;
            const repeatRate = pctOf(s.repeat2, s.users);
            const itemShare = pctOf(s.items, totalItems);
            return (
              <tr key={f.feature + "/" + (f.subtype || "")} style={{ opacity: dim ? 0.45 : 1 }}>
                <td style={{ ...td, textAlign: "left", paddingLeft: 16 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: featureColor(f.feature), flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, color: C.t1 }}>{f.label}</span>
                    <AiTag gated={f.aiGated} />
                    {lowConf ? (
                      <span title={`触达用户仅 ${s.users} 人，比率噪声大`} style={{ background: "#f1f5f9", color: "#64748b", borderRadius: 4, padding: "1px 5px", fontSize: 9.5, fontWeight: 700 }}>样本少</span>
                    ) : null}
                  </span>
                </td>
                <td style={td}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                    <div style={{ flex: 1, maxWidth: 110, height: 8, background: C.bdrSubtle, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${Math.max((s.users / maxUsers) * 100, 2)}%`, height: "100%", background: featureColor(f.feature), borderRadius: 4 }} />
                    </div>
                    <span style={{ fontWeight: 800, color: C.nav, minWidth: 42, textAlign: "right" }}>{s.users.toLocaleString()}</span>
                  </div>
                </td>
                <td style={{ ...td, color: repeatRate != null && !lowConf ? C.t1 : C.t3, fontWeight: repeatRate != null ? 600 : 400 }}>
                  {repeatRate != null ? `${repeatRate}%` : "—"}
                </td>
                <td style={{ ...td, color: f.stickinessPct != null ? C.t1 : C.t3 }} title={f.stickinessMature ? `${f.stickinessReturned}/${f.stickinessMature} 人` : "无满7天用户"}>
                  {f.stickinessPct != null ? `${f.stickinessPct}%` : "—"}
                </td>
                <td style={{ ...td, color: C.t3 }} title="投入量参考，不可跨功能比">
                  {s.items.toLocaleString()}
                  <span style={{ fontSize: 10, marginLeft: 5 }}>{itemShare != null ? `${itemShare}%` : ""}</span>
                </td>
                <td style={{ ...td, color: C.t2 }}>{s.sessions.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Feature-level stickiness: 用了还回来率 ------------------------------
function FeatureStickiness({ features }) {
  const rows = (features || []).filter((f) => f.stickinessMature > 0)
    .slice()
    .sort((a, b) => (b.stickinessPct ?? -1) - (a.stickinessPct ?? -1));
  if (!rows.length) {
    return <div style={{ padding: 16, color: C.t3, fontSize: 12.5 }}>暂无满 7 天的成熟用户可统计（每个功能需有首次使用 ≥7 天前的用户）。</div>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, padding: 16 }}>
      {rows.map((f) => (
        <div key={f.feature + "/" + (f.subtype || "")} style={{ border: "1px solid " + C.bdr, borderRadius: 8, padding: "12px 12px", background: C.bg }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: featureColor(f.feature) }} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: C.t1 }}>{f.label}</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: f.stickinessPct != null ? featureColor(f.feature) : C.t3, lineHeight: 1 }}>
            {f.stickinessPct != null ? `${f.stickinessPct}%` : "—"}
          </div>
          <div style={{ fontSize: 10.5, color: C.t3, marginTop: 5 }}>
            {f.stickinessReturned}/{f.stickinessMature} 人用后又回来
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- First touch: 首触功能 ----------------------------------------------
function FirstTouch({ firstTouch }) {
  if (!firstTouch?.length) {
    return <div style={{ padding: 16, color: C.t3, fontSize: 12.5 }}>暂无数据。</div>;
  }
  const max = Math.max(...firstTouch.map((f) => f.users), 1);
  return (
    <div style={{ padding: "14px 16px", display: "grid", gap: 10 }}>
      {firstTouch.map((f) => (
        <div key={f.feature} style={{ display: "grid", gridTemplateColumns: "88px 1fr 92px", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.t1, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: featureColor(f.feature), flexShrink: 0 }} />
            {f.label}
          </span>
          <div style={{ height: 14, background: C.bdrSubtle, borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${Math.max((f.users / max) * 100, 2)}%`, height: "100%", background: featureColor(f.feature), borderRadius: 4 }} />
          </div>
          <span style={{ fontSize: 11.5, color: C.t2, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {f.users.toLocaleString()} 人 · {f.share != null ? `${f.share}%` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---- Weekly stacked column chart: 周趋势 --------------------------------
function WeeklyTrend({ weekly, features }) {
  const weeks = (weekly || []).slice(-16);
  if (!weeks.length) {
    return <div style={{ padding: 16, color: C.t3, fontSize: 12.5 }}>暂无趋势数据。</div>;
  }
  // Stack in a stable feature order (ranking order = features prop order).
  const order = (features || []).map((f) => f.feature);
  const maxTotal = Math.max(...weeks.map((w) => w.total), 1);
  const chartH = 150;
  return (
    <div style={{ padding: 16 }}>
      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        {(features || []).map((f) => (
          <span key={f.feature} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: C.t2 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: featureColor(f.feature) }} />
            {f.label}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: chartH, overflowX: "auto", paddingBottom: 4 }}>
        {weeks.map((w) => {
          const colH = (w.total / maxTotal) * chartH;
          return (
            <div key={w.week} style={{ flex: "1 0 34px", minWidth: 34, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div
                title={`${w.week} · 共 ${w.total.toLocaleString()} 题`}
                style={{ width: "100%", height: colH, minHeight: w.total > 0 ? 3 : 0, display: "flex", flexDirection: "column-reverse", borderRadius: "3px 3px 0 0", overflow: "hidden" }}
              >
                {order.map((feat) => {
                  const v = w.byFeature?.[feat] || 0;
                  if (!v) return null;
                  return <div key={feat} style={{ height: `${(v / w.total) * 100}%`, background: featureColor(feat) }} />;
                })}
              </div>
              <div style={{ fontSize: 9, color: C.t3, whiteSpace: "nowrap", transform: "rotate(-45deg)", transformOrigin: "center", marginTop: 6, height: 12 }}>
                {String(w.week).slice(5)}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10.5, color: C.t3, marginTop: 10 }}>柱高 = 当周总题目数，分段 = 各功能占比 · 最近 {weeks.length} 周</div>
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
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [segment, setSegment] = useState("all"); // all | pro | free
  const [grain, setGrain] = useState("feature"); // feature（按科目）| subtype（按小题型）

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
  const features = data?.features || [];
  const featuresAvailable = data?.featuresAvailable;
  // 排行 + 功能级留存两卡跟随 grain：subtype 用 subFeatures，各有独立可用性与迁移指引。
  const grainRows = grain === "subtype" ? (data?.subFeatures || []) : features;
  const grainAvailable = grain === "subtype" ? data?.subFeaturesAvailable : featuresAvailable;
  const grainSql = grain === "subtype" ? "scripts/sql/feature-engagement-subtype.sql" : "scripts/sql/feature-engagement.sql";
  const pending = loading && !data;
  const skeleton = <div style={{ height: 140, background: "#f8f8f8" }} />;

  return (
    <AdminLayout title="留存分析">
      <div className="adm-page" style={{ maxWidth: 980, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 12, color: C.t3 }}>
            {loading ? "加载中..." : error ? <span style={{ color: C.red || "#dc2626" }}>{error}</span> : "做题量 / 功能吸引力 · 活跃信号取自练习记录"}
          </div>
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

        {/* Stickiness cards (always) */}
        <div className="adm-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
          <StatCard
            value={st?.ratio != null ? `${Math.round(st.ratio * 100)}%` : "--"}
            label="粘性 (DAU/MAU)"
            sub="越高越像高频习惯"
            color={C.blue}
          />
          <StatCard value={st?.dau} label="日活 DAU" sub="近 1 天练习人数" color={C.nav} />
          <StatCard value={st?.wau} label="周活 WAU" sub="近 7 天" color={C.nav} />
          <StatCard value={st?.mau} label="月活 MAU" sub="近 30 天" color={C.nav} />
        </div>

        {/* ① 功能吸引力排行 — 页面重心 */}
        <Card
          title="功能吸引力排行"
          hint="按「触达用户」排序——它和复练率才是可跨功能比的吸引力信号。题目数各功能单位不同（不可比），已降为灰色投入量参考。支持按科目/按小题型两档粒度。全部历史。"
          right={
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {/* 粒度：按科目 / 按小题型 */}
              <div style={{ display: "flex", gap: 4 }}>
                {[
                  { k: "feature", label: "按科目" },
                  { k: "subtype", label: "按小题型" },
                ].map(({ k, label }) => (
                  <button
                    key={k}
                    onClick={() => setGrain(k)}
                    style={{
                      padding: "4px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: grain === k ? 700 : 500,
                      border: "1px solid " + (grain === k ? C.blue : C.bdr),
                      background: grain === k ? C.blue : "#fff",
                      color: grain === k ? "#fff" : C.t2, cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* 分段：全部 / Pro / 免费 */}
              <div style={{ display: "flex", gap: 4 }}>
                {[
                  { k: "all", label: "全部" },
                  { k: "pro", label: "Pro·无限额" },
                  { k: "free", label: "免费" },
                ].map(({ k, label }) => (
                  <button
                    key={k}
                    onClick={() => setSegment(k)}
                    style={{
                      padding: "4px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: segment === k ? 700 : 500,
                      border: "1px solid " + (segment === k ? C.blue : C.bdr),
                      background: segment === k ? C.blue : "#fff",
                      color: segment === k ? "#fff" : C.t2, cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          {segment === "all" ? (
            <div style={{ padding: "10px 16px 0", fontSize: 11, color: "#9a3412", background: "#fff7ed", borderBottom: "1px solid #fde68a", lineHeight: 1.5, paddingBottom: 10 }}>
              ⚠️ 「全部」口径下，<b>AI·限额</b>功能（写作/模考/口语）的做题量被免费 3 次/天卡住，和免费无限功能不可比。想公平比吸引力，切到 <b>Pro·无限额</b> 段看——那里没有额度墙。
            </div>
          ) : null}
          {grainAvailable === false ? <MigrationNotice sql={grainSql} /> : pending ? skeleton : <FeatureRanking features={grainRows} segment={segment} />}
        </Card>

        {/* ② 功能级留存 — 替代按天激活（跟随 grain） */}
        <Card
          title="功能级留存（用了还回来）"
          hint="首次使用某功能 ≥7 天前的成熟用户里，之后又回来用同一功能的比例 · 替代「注册后第N天有没有登录」· 全部用户口径"
        >
          {grainAvailable === false ? <MigrationNotice sql={grainSql} /> : pending ? skeleton : <FeatureStickiness features={grainRows} />}
        </Card>

        {/* ③ 首触功能 + ④ 周趋势 */}
        <Card title="首触功能（什么把新用户拉进门）" hint="每个用户人生第一场练习落在哪个功能">
          {featuresAvailable === false ? <MigrationNotice /> : pending ? skeleton : <FirstTouch firstTouch={data?.firstTouch} />}
        </Card>

        <Card title="各功能每周做题量趋势" hint="看哪个功能在涨、哪个在衰">
          {featuresAvailable === false ? <MigrationNotice /> : pending ? skeleton : <WeeklyTrend weekly={data?.weekly} features={features} />}
        </Card>

        {/* 旧口径：按注册日回访（折叠保留） */}
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <button
            onClick={() => setLegacyOpen((v) => !v)}
            style={{ width: "100%", textAlign: "left", padding: "12px 16px", border: "none", background: "#fff", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.nav }}>按注册日回访（旧口径）</span>
              <span style={{ fontSize: 10.5, color: C.t3, marginLeft: 8 }}>激活率 + D1/D7/D30 同期群热力图</span>
            </span>
            <span style={{ fontSize: 12, color: C.blue, fontWeight: 600 }}>{legacyOpen ? "收起 ▲" : "展开 ▼"}</span>
          </button>

          {legacyOpen && (
            <div style={{ padding: 16, borderTop: "1px solid " + C.bdr }}>
              {/* Day-range selector — only affects this legacy cohort section */}
              <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 11.5, color: C.t3, marginRight: 4 }}>{s?.cohortCount ?? 0} 个注册同期群 · 时间窗</span>
                {[30, 60, 90, 180].map((d) => (
                  <button
                    key={d}
                    onClick={() => handleDaysChange(d)}
                    style={{
                      padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: days === d ? 700 : 500,
                      border: "1px solid " + (days === d ? C.blue : C.bdr),
                      background: days === d ? C.blue : "#fff",
                      color: days === d ? "#fff" : C.t2, cursor: "pointer",
                    }}
                  >
                    {d}天
                  </button>
                ))}
              </div>

              {/* Activation + mature-cohort retention summary */}
              <div className="adm-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 14 }}>
                <StatCard
                  value={s?.activationPct != null ? `${s.activationPct}%` : "--"}
                  label="激活率"
                  sub={s ? `${s.totalActivated}/${s.totalUsers} 注册后练过` : null}
                  color="#16a34a"
                />
                {[
                  { k: "d1", label: "次日 D1 回访" },
                  { k: "d7", label: "7 天内回访" },
                  { k: "d30", label: "30 天内回访" },
                ].map(({ k, label }) => {
                  const v = s?.[k];
                  return (
                    <StatCard
                      key={k}
                      value={v?.pct != null ? `${v.pct}%` : "—"}
                      label={label}
                      sub={v && v.users > 0 ? `${v.retained}/${v.users} 人` : "暂无到期数据"}
                      color={C.blue}
                    />
                  );
                })}
              </div>

              {/* Per-cohort heatmap */}
              <div style={{ border: "1px solid " + C.bdr, borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "10px 16px", borderBottom: "1px solid " + C.bdr, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: C.nav }}>注册同期群留存热力图</span>
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
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
