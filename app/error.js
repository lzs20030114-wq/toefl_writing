"use client";

/**
 * Next.js 错误边界 — 页面组件渲染崩溃时显示的兜底 UI。
 *
 * ── 工作原理 ──────────────────────────────────────────────
 *
 *   这是 Next.js App Router 的约定文件。放在 app/error.js 就自动生效，
 *   不需要手动 import 或包裹任何组件。
 *
 *   当 app/ 下任意页面组件抛出未捕获的错误时，Next.js 会：
 *   1. 捕获错误（不会白屏）
 *   2. 渲染这个组件替代崩溃的页面
 *   3. 传入 error（错误对象）和 reset（重试函数）两个 props
 *
 * ── 和 global-error.js 的区别 ────────────────────────────
 *
 *   error.js        捕获页面组件的错误（layout 正常时）
 *   global-error.js 捕获 root layout 本身的错误（极端情况，需自带 <html>/<body>）
 *
 * ── 测试方法 ──────────────────────────────────────────────
 *
 *   在任意页面组件里临时加 throw new Error("测试错误边界")
 *   刷新页面 → 应该看到中文错误提示而不是白屏
 *   测完记得删掉 throw
 *
 * ── 自定义 ───────────────────────────────────────────────
 *
 *   如果某个子路由需要不同的错误 UI，在对应目录下新建 error.js 即可覆盖。
 *   例如 app/build-sentence/error.js 会只作用于 /build-sentence 路由。
 */
export default function ErrorPage({ error, reset }) {
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
        <div style={{ fontSize: 48, marginBottom: 16 }}>!</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1e293b", margin: "0 0 8px" }}>
          页面出现了问题
        </h2>
        <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, margin: "0 0 24px" }}>
          {error?.message || "发生了意外错误，请重试。"}
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
          重试
        </button>
        <div style={{ marginTop: 16 }}>
          <a href="/" style={{ fontSize: 13, color: "#94a3b8", textDecoration: "none" }}>
            返回首页
          </a>
        </div>
      </div>
    </div>
  );
}
