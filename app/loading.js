/**
 * Next.js Loading UI — 页面跳转时显示的加载状态。
 *
 * 放在 app/loading.js 自动生效。当页面组件在加载时，
 * Next.js 会先渲染这个组件，加载完成后自动替换。
 */
export default function Loading() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#f8fafc",
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: 36,
          height: 36,
          border: "3px solid #e2e8f0",
          borderTopColor: "#3b82f6",
          borderRadius: "50%",
          margin: "0 auto 16px",
          animation: "tp-spin 0.8s linear infinite",
        }} />
        <style dangerouslySetInnerHTML={{ __html: "@keyframes tp-spin{to{transform:rotate(360deg)}}" }} />
      </div>
    </div>
  );
}
