"use client";

const FONT = "'Plus Jakarta Sans','Noto Sans SC',system-ui,sans-serif";

const pulseKeyframes = `
@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
`;

function Bar({ width = "100%", height = 14, mb = 10 }) {
  return (
    <div style={{
      width, height, borderRadius: 6, background: "#e2e8f0",
      animation: "skeleton-pulse 1.5s ease-in-out infinite",
      marginBottom: mb,
    }} />
  );
}

/**
 * Generic page-level loading skeleton.
 * Renders a plausible placeholder for any task page:
 * top bar + title + content area with pulse animation.
 */
export function PageSkeleton() {
  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: FONT }}>
      <style>{pulseKeyframes}</style>
      {/* Top bar placeholder */}
      <div style={{ height: 56, background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", padding: "0 20px" }}>
        <Bar width={120} height={20} mb={0} />
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px" }}>
        {/* Title */}
        <Bar width="40%" height={24} mb={16} />
        <Bar width="65%" height={14} mb={28} />

        {/* Content card */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <Bar width="80%" height={16} mb={16} />
          <Bar width="100%" height={12} />
          <Bar width="90%" height={12} />
          <Bar width="70%" height={12} mb={20} />
          <Bar width="100%" height={44} mb={12} />
          <Bar width="100%" height={44} />
        </div>
      </div>
    </div>
  );
}
