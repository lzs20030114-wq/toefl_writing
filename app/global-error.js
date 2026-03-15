"use client";

/**
 * Next.js Global Error Boundary — catches errors in the root layout itself.
 * Must render its own <html> and <body> tags since the root layout may have crashed.
 */
export default function GlobalError({ error, reset }) {
  return (
    <html lang="zh">
      <body style={{
        margin: 0,
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
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
            应用加载失败
          </h2>
          <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, margin: "0 0 24px" }}>
            发生了严重错误，请刷新页面重试。
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
            刷新页面
          </button>
        </div>
      </body>
    </html>
  );
}
