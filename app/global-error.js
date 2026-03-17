"use client";

/**
 * Next.js 全局错误边界 — 当 root layout 本身崩溃时的兜底 UI。
 *
 * 与 error.js 的区别：
 *   error.js        捕获页面组件的错误（layout 正常渲染时）
 *   global-error.js 捕获 root layout 自身的错误（极端情况）
 *
 * 必须自带 <html> 和 <body>，因为 root layout 已经崩溃无法渲染。
 */
export default function GlobalError({ error, reset }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, padding: 0 }}>
        <div style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
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
            <div style={{ fontSize: 48, marginBottom: 16 }}>!</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1e293b", margin: "0 0 8px" }}>
              应用出现了严重错误
            </h2>
            <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, margin: "0 0 24px" }}>
              {error?.message || "发生了意外错误，请刷新页面重试。"}
            </p>
            <button
              onClick={reset}
              style={{
                padding: "10px 28px",
                fontSize: 14,
                fontWeight: 600,
                color: "#fff",
                background: "#3b82f6",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              重新加载
            </button>
            <div style={{ marginTop: 16 }}>
              <a href="/" style={{ fontSize: 13, color: "#94a3b8", textDecoration: "none" }}>
                返回首页
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
