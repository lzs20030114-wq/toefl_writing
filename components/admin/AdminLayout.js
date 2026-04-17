"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { C, FONT } from "../shared/ui";
import { useAdminToken } from "../../lib/adminHelpers";

function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    setMobile(mq.matches);
    const handler = (e) => setMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return mobile;
}

const ADMIN_RESPONSIVE_CSS = `
@media (max-width: 768px) {
  .adm-content { padding: 12px !important; }
  .adm-topbar { padding: 12px 16px !important; }
  .adm-topbar > div:first-child { font-size: 15px !important; }
  .adm-page { max-width: 100% !important; padding: 0 !important; }
  .adm-grid-2 { grid-template-columns: 1fr !important; }
  .adm-ctrl-row { grid-template-columns: 1fr !important; gap: 8px !important; }
  .adm-table-wrap { margin: 0 -12px; }
  .adm-table-wrap > table { font-size: 11px !important; }
  .adm-table-wrap th, .adm-table-wrap td { padding: 6px 8px !important; }
  .adm-stats { gap: 8px !important; }
  .adm-stats > div { min-width: 0 !important; }
  .adm-input-full { width: 100% !important; }
  .adm-hide-mobile { display: none !important; }
  .adm-tabs { flex-wrap: wrap !important; }
  .adm-tabs > button { flex: 1; min-width: 0; font-size: 11px !important; padding: 7px 8px !important; }
}
`;

const NAV_GROUPS = [
  {
    label: "总览",
    items: [
      { label: "仪表盘", href: "/admin", icon: "grid" },
    ],
  },
  {
    label: "内容",
    items: [
      { label: "题库总览", href: "/admin-content", icon: "library" },
      { label: "写作题库编辑", href: "/admin-questions", icon: "book" },
      { label: "AI 自动生成", href: "/admin-generate", icon: "zap" },
      { label: "暂存审核", href: "/admin-staging", icon: "inbox" },
    ],
  },
  {
    label: "用户",
    items: [
      { label: "用户管理", href: "/admin-users", icon: "users" },
      { label: "登录码", href: "/admin-codes", icon: "key" },
      { label: "答题情况", href: "/admin-activity", icon: "activity" },
    ],
  },
  {
    label: "运营",
    items: [
      { label: "数据分析", href: "/admin-analytics", icon: "chart" },
      { label: "用户反馈", href: "/admin-feedback", icon: "msg" },
      { label: "API 日志", href: "/admin-api-errors", icon: "alert" },
      { label: "BS 错题统计", href: "/admin-bs-errors", icon: "target" },
    ],
  },
];

const ICONS = {
  grid: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm11 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  key: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  alert: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01",
  msg: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  chart: "M18 20V10M12 20V4M6 20v-6",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z",
  zap: "M13 2L3 14h9l-1 10 10-12h-9l1-10z",
  target: "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-6a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-2a2 2 0 1 1 0-4 2 2 0 0 1 0 4z",
  library: "M3 3h6v18H3zm8 0h6v18h-6zm8 3l3 1-5 15-3-1z",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
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

function SidebarContent({ onNavigate }) {
  const pathname = usePathname();
  return (
    <>
      {/* Branding */}
      <div style={{ padding: "20px 18px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: -0.3 }}>TreePractice</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>管理后台</div>
      </div>

      {/* Nav items grouped by section */}
      <nav style={{ padding: "6px 8px", flex: 1, display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} style={{ marginTop: gi === 0 ? 0 : 10 }}>
            <div style={{
              fontSize: 10,
              fontWeight: 700,
              color: "rgba(255,255,255,0.35)",
              textTransform: "uppercase",
              letterSpacing: 0.8,
              padding: "4px 12px 4px",
            }}>{group.label}</div>
            {group.items.map((item) => {
              const active = item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 12px", borderRadius: 7, textDecoration: "none",
                    fontSize: 13, fontWeight: active ? 700 : 500,
                    color: active ? "#fff" : "rgba(255,255,255,0.6)",
                    background: active ? "rgba(255,255,255,0.1)" : "transparent",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ display: "inline-flex", opacity: active ? 1 : 0.55 }}><NavIcon name={item.icon} /></span>
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
        v1.0
      </div>
    </>
  );
}

function Sidebar() {
  return (
    <aside style={{
      width: 210, minHeight: "100vh", background: "#0f172a", display: "flex", flexDirection: "column",
      flexShrink: 0, position: "sticky", top: 0, height: "100vh", overflowY: "auto",
    }}>
      <SidebarContent />
    </aside>
  );
}

function MobileDrawer({ open, onClose }) {
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 999,
          opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.2s",
        }}
      />
      {/* Drawer */}
      <aside style={{
        position: "fixed", top: 0, left: 0, bottom: 0, width: 240, background: "#0f172a",
        zIndex: 1000, display: "flex", flexDirection: "column", overflowY: "auto",
        transform: open ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 0.25s ease",
      }}>
        <SidebarContent onNavigate={onClose} />
      </aside>
    </>
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
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!ready) return null;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <style dangerouslySetInnerHTML={{ __html: ADMIN_RESPONSIVE_CSS }} />
      {isMobile ? (
        <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      ) : (
        <Sidebar />
      )}
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Top bar */}
        <div className="adm-topbar" style={{
          padding: "16px 28px", borderBottom: "1px solid " + C.bdr,
          background: "#fff", display: "flex", alignItems: "center", gap: 12,
        }}>
          {isMobile && (
            <button
              onClick={() => setDrawerOpen(true)}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: 4,
                display: "flex", alignItems: "center",
              }}
              aria-label="菜单"
            >
              <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke={C.nav} strokeWidth="2" strokeLinecap="round">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </button>
          )}
          {title && <div style={{ fontSize: 18, fontWeight: 800, color: C.nav }}>{title}</div>}
        </div>
        {/* Content */}
        <div className="adm-content" style={{ flex: 1, padding: 24, overflowY: "auto" }}>
          {!token ? <TokenGate token={token} setToken={setToken} /> : children}
        </div>
      </main>
    </div>
  );
}
