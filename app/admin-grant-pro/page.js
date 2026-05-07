"use client";
import { useEffect, useMemo, useState } from "react";
import { C, FONT } from "../../components/shared/ui";
import AdminLayout from "../../components/admin/AdminLayout";

const TOKEN_KEY = "toefl-admin-token";

const QUICK_DAYS = [
  { label: "7 天", days: 7 },
  { label: "30 天", days: 30 },
  { label: "90 天", days: 90 },
  { label: "365 天", days: 365 },
];

const PRODUCT_LABEL = {
  pro_weekly: "Pro 体验卡",
  pro_monthly: "Pro 月卡",
  pro_quarterly: "Pro 季卡",
  pro_yearly: "Pro 年卡",
};

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function fmtRelative(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}天前`;
  return d.toLocaleDateString();
}

function tierBadge(tier, expiresAt) {
  const expired = expiresAt && new Date(expiresAt) <= new Date();
  if (tier === "pro" && !expired) {
    return { label: "PRO", bg: "#dcfce7", fg: "#166534" };
  }
  if (tier === "pro" && expired) {
    return { label: "PRO (已过期)", bg: "#fef3c7", fg: "#92400e" };
  }
  if (tier === "legacy") return { label: "LEGACY", bg: "#e0e7ff", fg: "#3730a3" };
  return { label: "FREE", bg: "#f1f5f9", fg: "#475569" };
}

export default function AdminGrantProPage() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);

  // Form state
  const [identifier, setIdentifier] = useState("");
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");
  const [lookupUser, setLookupUser] = useState(null);
  const [lookupErr, setLookupErr] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);

  const [granting, setGranting] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Recent grants list
  const [grants, setGrants] = useState([]);
  const [grantsBusy, setGrantsBusy] = useState(false);
  const [grantsErr, setGrantsErr] = useState("");

  useEffect(() => {
    try { setToken(localStorage.getItem(TOKEN_KEY) || ""); } catch {}
    setReady(true);
  }, []);

  const hasToken = token.trim().length > 0;

  async function callAdminApi(path, options = {}) {
    if (!token.trim()) throw new Error("缺少管理员口令");
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": token.trim(),
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch {}
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    return body;
  }

  async function refreshGrants() {
    if (!hasToken) return;
    setGrantsBusy(true);
    setGrantsErr("");
    try {
      const body = await callAdminApi("/api/admin/grant-pro?limit=50", { method: "GET" });
      setGrants(Array.isArray(body.grants) ? body.grants : []);
    } catch (e) {
      setGrantsErr(String(e.message || e));
    } finally {
      setGrantsBusy(false);
    }
  }

  // Auto-refresh grants on token ready
  useEffect(() => {
    if (ready && hasToken) refreshGrants();
  }, [ready, token]);

  // Debounced user lookup as user types
  useEffect(() => {
    setLookupUser(null);
    setLookupErr("");
    setResult(null);
    setErrorMsg("");
    const v = identifier.trim();
    if (!v || v.length < 3 || !hasToken) return;
    const t = setTimeout(async () => {
      setLookupBusy(true);
      try {
        const body = await callAdminApi(
          `/api/admin/grant-pro?lookup=${encodeURIComponent(v)}`,
          { method: "GET" }
        );
        setLookupUser(body.user || null);
      } catch (e) {
        setLookupErr(String(e.message || e));
      } finally {
        setLookupBusy(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [identifier, token, hasToken]);

  async function handleGrant() {
    if (!lookupUser) return;
    if (!Number.isFinite(days) || days <= 0) {
      setErrorMsg("天数必须为正整数");
      return;
    }
    if (!confirm(`确认给 ${lookupUser.code}${lookupUser.email ? ` (${lookupUser.email})` : ""} 发放 ${days} 天 Pro？`)) {
      return;
    }
    setGranting(true);
    setErrorMsg("");
    setResult(null);
    try {
      const body = await callAdminApi("/api/admin/grant-pro", {
        method: "POST",
        body: JSON.stringify({
          identifier: lookupUser.code,
          days,
          reason: reason.trim(),
        }),
      });
      setResult(body);
      // Refresh recent grants & re-lookup user to show updated state
      refreshGrants();
      // Update local lookup so the user card reflects new expiry without re-typing
      setLookupUser((prev) => prev ? { ...prev, tier: "pro", tier_expires_at: body?.granted?.expiresAt } : prev);
    } catch (e) {
      setErrorMsg(String(e.message || e));
    } finally {
      setGranting(false);
    }
  }

  const lookupBadge = lookupUser ? tierBadge(lookupUser.tier, lookupUser.tier_expires_at) : null;

  return (
    <AdminLayout title="Pro 发放">
      <div className="adm-page" style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gap: 14 }}>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.nav, marginBottom: 4 }}>手动发放 Pro</div>
          <div style={{ fontSize: 12, color: C.t2, marginBottom: 16 }}>
            通过 6 位登录码或邮箱定位用户，叠加任意天数的 Pro 期限。已是 Pro 的用户从原到期时间继续累加。
          </div>

          {/* Step 1: identifier */}
          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.t1 }}>用户（登录码或邮箱）</label>
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="例：ABC123 或 user@example.com"
              autoComplete="off"
              spellCheck={false}
              className="adm-input-full"
              style={{
                border: "1px solid " + C.bdr,
                borderRadius: 6,
                padding: "10px 12px",
                fontFamily: "monospace",
                fontSize: 13,
                outline: "none",
              }}
            />
            {lookupBusy && <div style={{ fontSize: 11, color: C.t2 }}>查询中…</div>}
            {!lookupBusy && lookupErr && (
              <div style={{ fontSize: 12, color: "#b91c1c" }}>{lookupErr}</div>
            )}
            {!lookupBusy && lookupUser && (
              <div
                style={{
                  border: "1px solid #dbeafe",
                  background: "#eff6ff",
                  borderRadius: 6,
                  padding: "10px 12px",
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.nav }}>{lookupUser.code}</span>
                    <span style={{ color: C.t2 }}>·</span>
                    <span style={{ color: C.t1 }}>{lookupUser.email || "(无邮箱)"}</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.t2 }}>
                    当前到期：{fmtDate(lookupUser.tier_expires_at)}
                  </div>
                </div>
                {lookupBadge ? (
                  <span
                    style={{
                      background: lookupBadge.bg,
                      color: lookupBadge.fg,
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "3px 10px",
                      borderRadius: 999,
                    }}
                  >
                    {lookupBadge.label}
                  </span>
                ) : null}
              </div>
            )}
          </div>

          {/* Step 2: days */}
          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.t1 }}>天数</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {QUICK_DAYS.map((q) => {
                const active = days === q.days;
                return (
                  <button
                    key={q.days}
                    type="button"
                    onClick={() => setDays(q.days)}
                    style={{
                      border: "1px solid " + (active ? C.blue : C.bdr),
                      background: active ? "#dbeafe" : "#fff",
                      color: active ? C.blue : C.t1,
                      borderRadius: 6,
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: active ? 700 : 500,
                      cursor: "pointer",
                    }}
                  >
                    {q.label}
                  </button>
                );
              })}
              <input
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(3650, Number(e.target.value) || 0)))}
                style={{
                  border: "1px solid " + C.bdr,
                  borderRadius: 6,
                  padding: "6px 10px",
                  fontSize: 12,
                  width: 100,
                  outline: "none",
                }}
              />
              <span style={{ fontSize: 11, color: C.t2 }}>天</span>
            </div>
          </div>

          {/* Step 3: reason */}
          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.t1 }}>备注（可选）</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="例：内测奖励 / 用户反馈补偿 / 推广活动"
              className="adm-input-full"
              style={{
                border: "1px solid " + C.bdr,
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 12,
                outline: "none",
              }}
            />
          </div>

          {/* Action */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={handleGrant}
              disabled={!lookupUser || granting}
              style={{
                border: "none",
                background: !lookupUser || granting ? "#94a3b8" : C.nav,
                color: "#fff",
                borderRadius: 6,
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 700,
                cursor: !lookupUser || granting ? "not-allowed" : "pointer",
              }}
            >
              {granting ? "发放中…" : `确认发放 ${days} 天 Pro`}
            </button>
            {errorMsg && <span style={{ fontSize: 12, color: "#b91c1c" }}>{errorMsg}</span>}
          </div>

          {/* Result */}
          {result?.ok ? (
            <div
              style={{
                marginTop: 14,
                background: "#f0fdf4",
                border: "1px solid #86efac",
                borderRadius: 6,
                padding: "10px 14px",
                fontSize: 12,
                color: "#166534",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>✓ 已发放</div>
              <div>
                <span style={{ fontFamily: "monospace" }}>{result.user.code}</span>
                {result.user.email ? ` (${result.user.email})` : ""} 现有 Pro 至 <b>{fmtDate(result.granted.expiresAt)}</b>
                （+{result.granted.days} 天，从 {fmtDate(result.granted.baseDate)} 累加）
              </div>
            </div>
          ) : null}
        </div>

        {/* Recent grants */}
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.nav }}>最近 50 次手动发放</div>
            <button
              onClick={refreshGrants}
              disabled={grantsBusy}
              style={{
                border: "1px solid " + C.bdr,
                background: "#fff",
                color: C.t1,
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 12,
                cursor: grantsBusy ? "not-allowed" : "pointer",
                opacity: grantsBusy ? 0.6 : 1,
              }}
            >
              {grantsBusy ? "…" : "刷新"}
            </button>
          </div>
          {grantsErr && <div style={{ fontSize: 12, color: "#b91c1c", marginBottom: 8 }}>{grantsErr}</div>}
          <div className="adm-table-wrap" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr style={{ background: "#f8fafc", color: C.t2 }}>
                  <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid " + C.bdr }}>时间</th>
                  <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid " + C.bdr }}>用户</th>
                  <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid " + C.bdr }}>商品</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid " + C.bdr }}>天数</th>
                  <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid " + C.bdr }}>当前到期</th>
                  <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid " + C.bdr }}>备注</th>
                  <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid " + C.bdr }}>来源</th>
                </tr>
              </thead>
              <tbody>
                {grants.length === 0 && !grantsBusy && (
                  <tr>
                    <td colSpan={7} style={{ padding: 12, color: C.t2 }}>暂无记录。</td>
                  </tr>
                )}
                {grants.map((g) => (
                  <tr key={g.id}>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", color: C.t2 }} title={fmtDate(g.granted_at)}>
                      {fmtRelative(g.granted_at)}
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>
                      <div style={{ fontFamily: "monospace", fontWeight: 700, color: C.nav }}>{g.user_code}</div>
                      {g.user_email ? <div style={{ fontSize: 11, color: C.t2 }}>{g.user_email}</div> : null}
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", color: C.t1 }}>
                      {PRODUCT_LABEL[g.product_id] || g.product_id}
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", textAlign: "right", fontWeight: 700, color: C.nav }}>
                      {g.days ? `${g.days} 天` : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", color: C.t2 }} title={fmtDate(g.user_tier_expires_at)}>
                      {fmtRelative(g.user_tier_expires_at)}
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", color: C.t1 }}>
                      {g.reason && g.reason !== "admin manual grant" ? g.reason : <span style={{ color: C.t2 }}>—</span>}
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", color: C.t2, fontSize: 11 }}>
                      {g.granted_by || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
