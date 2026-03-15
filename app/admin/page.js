"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AdminLayout from "../../components/admin/AdminLayout";
import { callAdminApi } from "../../lib/adminHelpers";
import { C } from "../../components/shared/ui";

function StatCard({ value, label, color, sub }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10,
      padding: "18px 16px", minWidth: 0,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || C.nav, lineHeight: 1.1 }}>{value ?? "--"}</div>
      <div style={{ fontSize: 12, color: C.t2, marginTop: 6 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.t3, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function SectionCard({ title, href, children }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10,
      overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{
        padding: "12px 16px", borderBottom: "1px solid " + C.bdr,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.nav }}>{title}</span>
        {href && (
          <Link href={href} style={{ fontSize: 12, color: C.blue, textDecoration: "none", fontWeight: 600 }}>
            Details &rarr;
          </Link>
        )}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

function MetricRow({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
      <span style={{ fontSize: 13, color: C.t2 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: color || C.t1 }}>{value ?? "--"}</span>
    </div>
  );
}

function Skeleton({ width, height }) {
  return (
    <div style={{
      width: width || "100%", height: height || 20, borderRadius: 6,
      background: "linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s infinite",
    }} />
  );
}

export default function AdminHomePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function fetchAll() {
    setLoading(true);
    setError("");
    try {
      const [users, codes, questions] = await Promise.all([
        callAdminApi("/api/admin/users").catch(() => null),
        callAdminApi("/api/admin/codes").catch(() => null),
        callAdminApi("/api/admin/questions").catch(() => null),
      ]);
      setData({ users, codes, questions });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Wait a tick for token to be available from AdminLayout
    const t = setTimeout(fetchAll, 100);
    return () => clearTimeout(t);
  }, []);

  const u = data?.users;
  const codeStats = data?.codes?.stats;
  const q = data?.questions;

  const bsSets = q?.buildSentence?.question_sets?.length ?? null;
  const bsTotal = q?.buildSentence?.question_sets?.reduce((s, set) => s + (set.questions?.length || 0), 0) ?? null;

  return (
    <AdminLayout>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.nav }}>Dashboard</div>
            <div style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>
              {loading ? "Loading..." : error ? error : `Last updated ${new Date().toLocaleTimeString()}`}
            </div>
          </div>
          <button
            onClick={fetchAll}
            disabled={loading}
            style={{
              padding: "8px 18px", borderRadius: 8, border: "1px solid " + C.bdr,
              background: "#fff", fontSize: 13, fontWeight: 600, color: C.t1,
              cursor: loading ? "wait" : "pointer",
            }}
          >
            {loading ? "..." : "Refresh"}
          </button>
        </div>

        {/* Shimmer animation */}
        <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>

        {/* Key metrics row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
          {loading ? (
            <>
              {[1,2,3,4,5].map(i => <div key={i} style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10, padding: 18 }}><Skeleton height={32} width={60} /><div style={{ marginTop: 8 }}><Skeleton height={14} width={80} /></div></div>)}
            </>
          ) : (
            <>
              <StatCard value={u?.total} label="Total Users" color={C.nav} sub={u?.growth ? `+${u.growth.lastDay} today` : undefined} />
              <StatCard value={u?.active?.lastDay} label="Active (24h)" color={C.blue} />
              <StatCard value={u?.tiers?.pro} label="Pro Users" color="#16a34a" sub={u?.tiers ? `${u.tiers.free} free` : undefined} />
              <StatCard value={codeStats?.available} label="Codes Available" color={codeStats?.available > 5 ? C.blue : C.orange} sub={codeStats ? `${codeStats.issued} issued` : undefined} />
              <StatCard value={u?.growth?.lastWeek} label="New (7d)" color={C.blue} />
            </>
          )}
        </div>

        {/* Detail sections */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          {/* User growth */}
          <SectionCard title="User Growth" href="/admin-users">
            {loading ? <Skeleton height={100} /> : u ? (
              <div>
                <MetricRow label="Last hour" value={`+${u.growth?.lastHour ?? 0}`} />
                <MetricRow label="Last 24h" value={`+${u.growth?.lastDay ?? 0}`} />
                <MetricRow label="Last 7d" value={`+${u.growth?.lastWeek ?? 0}`} />
                <MetricRow label="Last 30d" value={`+${u.growth?.lastMonth ?? 0}`} />
              </div>
            ) : <div style={{ color: C.t3, fontSize: 13 }}>No data</div>}
          </SectionCard>

          {/* Auth & Activity */}
          <SectionCard title="Active Users" href="/admin-activity">
            {loading ? <Skeleton height={100} /> : u ? (
              <div>
                <MetricRow label="Active 24h" value={u.active?.lastDay} color={C.blue} />
                <MetricRow label="Active 7d" value={u.active?.lastWeek} />
                <MetricRow label="Active 30d" value={u.active?.lastMonth} />
                <div style={{ borderTop: "1px solid " + C.bdr, marginTop: 8, paddingTop: 8 }}>
                  <MetricRow label="Auth: code" value={u.authMethods?.code} />
                  <MetricRow label="Auth: email" value={u.authMethods?.email} />
                </div>
              </div>
            ) : <div style={{ color: C.t3, fontSize: 13 }}>No data</div>}
          </SectionCard>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {/* Code management */}
          <SectionCard title="Access Codes" href="/admin-codes">
            {loading ? <Skeleton height={80} /> : codeStats ? (
              <div>
                <MetricRow label="Total generated" value={codeStats.total} />
                <MetricRow label="Available" value={codeStats.available} color={codeStats.available > 5 ? C.blue : C.orange} />
                <MetricRow label="Issued" value={codeStats.issued} />
                <MetricRow label="Revoked" value={codeStats.revoked} color={codeStats.revoked > 0 ? C.red : C.t1} />
              </div>
            ) : <div style={{ color: C.t3, fontSize: 13 }}>No data</div>}
          </SectionCard>

          {/* Question bank */}
          <SectionCard title="Question Bank" href="/admin-questions">
            {loading ? <Skeleton height={80} /> : q ? (
              <div>
                <MetricRow label="Academic Discussion" value={`${Array.isArray(q.academic) ? q.academic.length : 0} questions`} />
                <MetricRow label="Email Writing" value={`${Array.isArray(q.email) ? q.email.length : 0} questions`} />
                <MetricRow label="Build Sentence" value={bsSets != null ? `${bsSets} sets / ${bsTotal} questions` : "--"} />
              </div>
            ) : <div style={{ color: C.t3, fontSize: 13 }}>No data</div>}
          </SectionCard>
        </div>
      </div>
    </AdminLayout>
  );
}
