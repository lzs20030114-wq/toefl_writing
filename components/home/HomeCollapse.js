"use client";

// 与真题专区分组面板保持相同的展开节奏。
export const HOME_COLLAPSE_MS = 320;
export const HOME_COLLAPSE_EASE = "cubic-bezier(0.25, 1, 0.5, 1)";

export function HomeCollapse({ open, children, id, label }) {
  return (
    <div
      id={id}
      role={label ? "region" : undefined}
      aria-label={label}
      aria-hidden={!open}
      className="home-collapse-panel"
      style={{
        display: "grid",
        gridTemplateRows: open ? "1fr" : "0fr",
        transition: `grid-template-rows ${HOME_COLLAPSE_MS}ms ${HOME_COLLAPSE_EASE}`,
      }}
    >
      <div style={{
        minHeight: 0,
        overflow: "hidden",
        opacity: open ? 1 : 0,
        transform: open ? "translateY(0)" : "translateY(-6px)",
        visibility: open ? "visible" : "hidden",
        pointerEvents: open ? "auto" : "none",
        transition: `opacity ${HOME_COLLAPSE_MS}ms ease, transform ${HOME_COLLAPSE_MS}ms ${HOME_COLLAPSE_EASE}, visibility 0s linear ${open ? 0 : HOME_COLLAPSE_MS}ms`,
      }}>
        {children}
      </div>
    </div>
  );
}
