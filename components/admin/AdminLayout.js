"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { C, FONT } from "../shared/ui";
import { useAdminToken } from "../../lib/adminHelpers";

const NAV = [
  { label: "总览", href: "/admin", icon: "grid" },
  { label: "用户管理", href: "/admin-users", icon: "users" },
  { label: "登录码", href: "/admin-codes", icon: "key" },
  { label: "答题情况", href: "/admin-activity", icon: "activity" },
  { label: "API 日志", href: "/admin-api-errors", icon: "alert" },
  { label: "用户反馈", href: "/admin-feedback", icon: "msg" },
  { label: "题库管理", href: "/admin-questions", icon: "book" },
  { label: "自动生题", href: "/admin-generate", icon: "zap" },
];

const ICONS = {
  grid: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm11 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  key: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  alert: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01",
  msg: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z",
  zap: "M13 2L3 14h9l-1 10 10-12h-9l1-10z",
};

function NavIcon({ name }) {
  const d = ICONS[name];
  if (!d) return null;
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function Sidebar() {
  const pathname = usePathname();
  return (
    <aside style={{
      width: 210, minHeight: "100vh", background: "#0f172a", display: "flex", flexDirection: "column",
      flexShrink: 0, position: "sticky", top: 0, height: "100vh", overflowY: "auto",
    }}>
      {/* Branding */}
      <div style={{ padding: "20px 18px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: -0.3 }}>TreePractice</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>管理后台</div>
      </div>

      {/* Nav items */}
      <nav style={{ padding: "8px 8px", flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV.map((item) => {
          const active = item.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 12px", borderRadius: 7, textDecoration: "none",
                fontSize: 13, fontWeight: active ? 700 : 500,
                color: active ? "#fff" : "rgba(255,255,255,0.55)",
                background: active ? "rgba(255,255,255,0.1)" : "transparent",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ display: "inline-flex", opacity: active ? 1 : 0.6 }}><NavIcon name={item.icon} /></span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
        v1.0
      </div>
    </aside>
  );
}

function TokenGate({ token, setToken }) {
  const [input, setInput] = React.useState("");
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, minHeight: "60vh" }}>
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>
          <svg viewBox="0 0 24 24" width={40} height={40} fill="none" stroke={C.t3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 6 }}>管理员认证</div>
        <div style={{ fontSize: 13, color: C.t2, marginBottom: 20 }}>请输入管理员口令以继续</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) setToken(input.trim()); }}
            placeholder="ADMIN_DASHBOARD_TOKEN"
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 8,
              border: "1px solid " + C.bdr, fontSize: 13, fontFamily: "monospace",
              outline: "none",
            }}
          />
          <button
            onClick={() => { if (input.trim()) setToken(input.trim()); }}
            style={{
              padding: "10px 20px", borderRadius: 8, border: "none",
              background: C.nav, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminLayout({ children, title }) {
  const { token, setToken, ready } = useAdminToken();

  if (!ready) return null;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Top bar */}
        {title && (
          <div style={{
            padding: "16px 28px", borderBottom: "1px solid " + C.bdr,
            background: "#fff", display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.nav }}>{title}</div>
          </div>
        )}
        {/* Content */}
        <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>
          {!token ? <TokenGate token={token} setToken={setToken} /> : children}
        </div>
      </main>
    </div>
  );
}
