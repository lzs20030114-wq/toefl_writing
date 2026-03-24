"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { C, FONT } from "../../components/shared/ui";
import AdminLayout from "../../components/admin/AdminLayout";

const TOKEN_KEY = "toefl-admin-token";

function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function relativeTime(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return `${Math.floor(days / 30)}个月前`;
}

const STAT_CARD = {
  background: "#fff",
  border: "1px solid " + C.bdr,
  borderRadius: 8,
  padding: "14px 16px",
  textAlign: "center",
};
const STAT_NUM = { fontSize: 28, fontWeight: 800, color: C.nav, lineHeight: 1.2 };
const STAT_LABEL = { fontSize: 12, color: C.t2, marginTop: 4 };
const SECTION = {
  background: "#fff",
  border: "1px solid " + C.bdr,
  borderRadius: 8,
  padding: 16,
  marginTop: 12,
};
const TH = {
  padding: "8px 10px",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 700,
  color: C.t2,
  borderBottom: "2px solid " + C.bdr,
  whiteSpace: "nowrap",
};
const TD = {
  padding: "8px 10px",
  fontSize: 13,
  color: C.t1,
  borderBottom: "1px solid " + C.bdr,
  whiteSpace: "nowrap",
};

function proRemaining(expiresAt) {
  if (!expiresAt) return null;
  const exp = new Date(expiresAt);
  if (Number.isNaN(exp.getTime())) return null;
  const diff = exp.getTime() - Date.now();
  if (diff <= 0) return { text: "已过期", urgent: true, expired: true };
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days >= 1) return { text: `${days}天${hours}小时`, urgent: days <= 3, expired: false };
  const mins = Math.floor((diff % 3600000) / 60000);
  return { text: `${hours}小时${mins}分钟`, urgent: true, expired: false };
}

function TierBadge({ tier, expiresAt }) {
  const now = new Date();
  const isLegacy = tier === "legacy";
  const isPro = tier === "pro" && expiresAt && new Date(expiresAt) > now;
  const label = isLegacy ? "Legacy" : isPro ? "Pro" : "Free";
  const bg = isLegacy ? "#ede9fe" : isPro ? "#e8f5e9" : "#f5f5f5";
  const color = isLegacy ? "#6d28d9" : isPro ? "#2e7d32" : C.t2;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        background: bg,
        color,
      }}
    >
      {label}
    </span>
  );
}

function ProRemainingBadge({ tier, expiresAt }) {
  if (tier === "legacy") return <span style={{ fontSize: 12, color: "#6d28d9" }}>永久</span>;
  if (tier !== "pro") return <span style={{ fontSize: 12, color: C.t2 }}>-</span>;
  const r = proRemaining(expiresAt);
  if (!r) return <span style={{ fontSize: 12, color: C.t2 }}>-</span>;
  const color = r.expired ? "#d32f2f" : r.urgent ? "#e65100" : "#2e7d32";
  const bg = r.expired ? "#ffebee" : r.urgent ? "#fff3e0" : "#e8f5e9";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        background: bg,
        color,
      }}
      title={expiresAt ? new Date(expiresAt).toLocaleString() : ""}
    >
      {r.text}
    </span>
  );
}

function AuthBadge({ method }) {
  const isEmail = String(method || "").toLowerCase() === "email";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        background: isEmail ? "#e3f2fd" : "#fff3e0",
        color: isEmail ? "#1565c0" : "#e65100",
      }}
    >
      {isEmail ? "邮箱" : "登录码"}
    </span>
  );
}

export default function AdminUsersPage() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [authFilter, setAuthFilter] = useState("all");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY) || "";
    setToken(t);
    setReady(true);
  }, []);

  const fetchData = async () => {
    if (!token) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/users", {
        headers: { "x-admin-token": token },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMsg(j.error || `HTTP ${res.status}`);
        return;
      }
      setData(await res.json());
    } catch (e) {
      setMsg(e.message || "Network error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (ready && token) fetchData();
  }, [ready, token]);

  const filteredUsers = useMemo(() => {
    if (!data?.users) return [];
    let list = data.users;

    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (u) =>
          String(u.code || "").toLowerCase().includes(q) ||
          String(u.email || "").toLowerCase().includes(q)
      );
    }

    // Tier filter
    if (tierFilter !== "all") {
      const now = new Date();
      list = list.filter((u) => {
        if (tierFilter === "legacy") return u.tier === "legacy";
        const isPro = u.tier === "pro" && u.tier_expires_at && new Date(u.tier_expires_at) > now;
        if (tierFilter === "pro") return isPro;
        return !isPro && u.tier !== "legacy"; // free
      });
    }

    // Auth filter
    if (authFilter !== "all") {
      list = list.filter((u) => {
        const am = String(u.auth_method || "").toLowerCase();
        return authFilter === "email" ? am === "email" : am !== "email";
      });
    }

    // Sort
    list = [...list].sort((a, b) => {
      let va = a[sortBy] || "";
      let vb = b[sortBy] || "";
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });

    return list;
  }, [data, search, tierFilter, authFilter, sortBy, sortAsc]);

  const handleSort = (col) => {
    if (sortBy === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(col);
      setSortAsc(false);
    }
  };

  const sortIcon = (col) => (sortBy === col ? (sortAsc ? " ↑" : " ↓") : "");

  if (!ready) return null;

  return (
    <AdminLayout title="用户管理">
      <div className="adm-page" style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <button
            onClick={fetchData}
            disabled={busy}
            style={{
              marginLeft: "auto",
              padding: "6px 16px",
              borderRadius: 6,
              border: "1px solid " + C.bdr,
              background: "#fff",
              cursor: busy ? "wait" : "pointer",
              fontSize: 13,
              color: C.t1,
            }}
          >
            {busy ? "加载中..." : "刷新"}
          </button>
        </div>

        {msg && <div style={{ color: C.red, fontSize: 13, marginBottom: 12 }}>{msg}</div>}

        {data && (
          <>
            {/* Stats overview */}
            <div className="adm-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
              <div style={STAT_CARD}>
                <div style={STAT_NUM}>{data.total}</div>
                <div style={STAT_LABEL}>总用户</div>
              </div>
              <div style={STAT_CARD}>
                <div style={{ ...STAT_NUM, color: C.blue }}>{data.growth.lastHour}</div>
                <div style={STAT_LABEL}>最近1小时新增</div>
              </div>
              <div style={STAT_CARD}>
                <div style={{ ...STAT_NUM, color: C.blue }}>{data.growth.lastDay}</div>
                <div style={STAT_LABEL}>最近24小时新增</div>
              </div>
              <div style={STAT_CARD}>
                <div style={{ ...STAT_NUM, color: C.blue }}>{data.growth.lastWeek}</div>
                <div style={STAT_LABEL}>最近7天新增</div>
              </div>
              <div style={STAT_CARD}>
                <div style={{ ...STAT_NUM, color: C.blue }}>{data.growth.lastMonth}</div>
                <div style={STAT_LABEL}>最近30天新增</div>
              </div>
            </div>

            {/* Secondary stats */}
            <div className="adm-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginTop: 10 }}>
              {/* Tier breakdown */}
              <div style={SECTION}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.nav, marginBottom: 10 }}>用户等级</div>
                <div style={{ display: "flex", gap: 20 }}>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: C.t1 }}>{data.tiers.free}</div>
                    <div style={{ fontSize: 12, color: C.t2 }}>Free</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#2e7d32" }}>{data.tiers.pro}</div>
                    <div style={{ fontSize: 12, color: C.t2 }}>Pro</div>
                  </div>
                  {data.tiers.legacy > 0 && (
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: "#6d28d9" }}>{data.tiers.legacy}</div>
                      <div style={{ fontSize: 12, color: C.t2 }}>Legacy</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Auth method breakdown */}
              <div style={SECTION}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.nav, marginBottom: 10 }}>登录方式</div>
                <div style={{ display: "flex", gap: 20 }}>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#e65100" }}>{data.authMethods.code}</div>
                    <div style={{ fontSize: 12, color: C.t2 }}>登录码</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#1565c0" }}>{data.authMethods.email}</div>
                    <div style={{ fontSize: 12, color: C.t2 }}>邮箱</div>
                  </div>
                </div>
              </div>

              {/* Active users */}
              <div style={SECTION}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.nav, marginBottom: 10 }}>活跃用户</div>
                <div style={{ display: "flex", gap: 20 }}>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: C.nav }}>{data.active.lastDay}</div>
                    <div style={{ fontSize: 12, color: C.t2 }}>24h</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: C.nav }}>{data.active.lastWeek}</div>
                    <div style={{ fontSize: 12, color: C.t2 }}>7天</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: C.nav }}>{data.active.lastMonth}</div>
                    <div style={{ fontSize: 12, color: C.t2 }}>30天</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Filters and user table */}
            <div style={SECTION}>
              <div className="adm-ctrl-row" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                <input
                  type="text"
                  placeholder="搜索用户码或邮箱..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "1px solid " + C.bdr,
                    fontSize: 13,
                    width: 220,
                  }}
                  className="adm-input-full"
                />
                <select
                  value={tierFilter}
                  onChange={(e) => setTierFilter(e.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid " + C.bdr, fontSize: 13 }}
                >
                  <option value="all">全部等级</option>
                  <option value="free">Free</option>
                  <option value="pro">Pro</option>
                  <option value="legacy">Legacy</option>
                </select>
                <select
                  value={authFilter}
                  onChange={(e) => setAuthFilter(e.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid " + C.bdr, fontSize: 13 }}
                >
                  <option value="all">全部登录方式</option>
                  <option value="code">登录码</option>
                  <option value="email">邮箱</option>
                </select>
                <div style={{ marginLeft: "auto", fontSize: 13, color: C.t2 }}>
                  共 {filteredUsers.length} 条
                </div>
              </div>

              <div className="adm-table-wrap" style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...TH, cursor: "pointer" }} onClick={() => handleSort("code")}>
                        用户码{sortIcon("code")}
                      </th>
                      <th style={{ ...TH, cursor: "pointer" }} onClick={() => handleSort("email")}>
                        邮箱{sortIcon("email")}
                      </th>
                      <th style={TH}>等级</th>
                      <th style={{ ...TH, cursor: "pointer" }} onClick={() => handleSort("tier_expires_at")}>
                        Pro剩余{sortIcon("tier_expires_at")}
                      </th>
                      <th style={TH}>登录方式</th>
                      <th style={{ ...TH, cursor: "pointer" }} onClick={() => handleSort("created_at")}>
                        注册时间{sortIcon("created_at")}
                      </th>
                      <th style={{ ...TH, cursor: "pointer" }} onClick={() => handleSort("last_login")}>
                        最近登录{sortIcon("last_login")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => (
                      <tr key={u.code} style={{ transition: "background 0.15s" }} onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                        <td style={{ ...TD, fontWeight: 700, fontFamily: "monospace" }}>{u.code}</td>
                        <td style={{ ...TD, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {u.email || <span style={{ color: C.t2 }}>-</span>}
                        </td>
                        <td style={TD}><TierBadge tier={u.tier} expiresAt={u.tier_expires_at} /></td>
                        <td style={TD}><ProRemainingBadge tier={u.tier} expiresAt={u.tier_expires_at} /></td>
                        <td style={TD}><AuthBadge method={u.auth_method} /></td>
                        <td style={TD} title={fmtDate(u.created_at)}>{relativeTime(u.created_at)}</td>
                        <td style={TD} title={fmtDate(u.last_login)}>{relativeTime(u.last_login)}</td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ ...TD, textAlign: "center", color: C.t2, padding: 30 }}>
                          暂无数据
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
