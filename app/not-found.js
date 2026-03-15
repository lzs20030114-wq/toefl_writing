/**
 * Next.js 404 页面 — 访问不存在的路由时显示。
 *
 * 放在 app/not-found.js 自动生效，不需要配置。
 */
export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Plus Jakarta Sans','Noto Sans SC',system-ui,sans-serif",
      background: "#f8fafc",
      padding: 24,
    }}>
      <div style={{
        maxWidth: 420,
        textAlign: "center",
        background: "#fff",
        borderRadius: 16,
        padding: "48px 32px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      }}>
        <div style={{ fontSize: 64, fontWeight: 800, color: "#e2e8f0", marginBottom: 8 }}>404</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1e293b", margin: "0 0 8px" }}>
          页面不存在
        </h2>
        <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, margin: "0 0 24px" }}>
          你访问的页面可能已被移除或地址有误。
        </p>
        <a
          href="/"
          style={{
            display: "inline-block",
            padding: "10px 28px",
            fontSize: 14,
            fontWeight: 600,
            color: "#fff",
            background: "#3b82f6",
            border: "none",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          返回首页
        </a>
      </div>
    </div>
  );
}
