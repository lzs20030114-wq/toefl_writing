"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HOME_FONT, HOME_TOKENS as T } from "./theme";

/* ── 新功能聚光灯引导 ──
   首次（每浏览器一次）把用户视线引到某个新功能入口：
   目标元素保持明亮并套呼吸光圈，页面其余部分被四块半透明模糊面板压暗，
   旁边浮出带箭头的说明气泡。点目标/「去看看」进入功能，点其他任意处关闭。
   已看过的记录存 localStorage，同一个 featureId 不会再弹。 */

const STORE_KEY = "toefl-feature-spotlight-seen";

function readSeen() {
  if (typeof localStorage === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}

export function shouldShowSpotlight(featureId) {
  return !readSeen()[featureId];
}

export function markSpotlightSeen(featureId) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...readSeen(), [featureId]: Date.now() }));
  } catch { /* no-op */ }
}

/* 打开时机的共用门控：已登录 + 没看过 + 不在目标页。
   等 openDelay 毫秒（让入场动画和异步数据落定）且目标元素真实存在才打开；
   期间用户自己点进了目标页则直接记为已看过。
   页面上已有其他弹窗（带 data-tp-overlay 标记：投票/题库更新/问卷等）时避让，
   每 1.5s 重试，最多等约一分钟；等不到就留到下次访问，绝不两层弹窗叠加。 */
export function useSpotlightGate({ featureId, enabled, alreadyThere, targetSelector, openDelay = 1100 }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    if (alreadyThere) {
      markSpotlightSeen(featureId);
      setOpen(false);
      return;
    }
    if (!shouldShowSpotlight(featureId)) return;
    let cancelled = false;
    let tries = 0;
    let timer;
    const attempt = () => {
      if (cancelled) return;
      const blocked = document.querySelector("[data-tp-overlay]");
      const target = document.querySelector(targetSelector);
      if (!blocked && target) { setOpen(true); return; }
      if (++tries < 40) timer = setTimeout(attempt, 1500);
    };
    timer = setTimeout(attempt, openDelay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [featureId, enabled, alreadyThere, targetSelector, openDelay]);

  const close = () => { markSpotlightSeen(featureId); setOpen(false); };
  return { open, close };
}

const CARD_W = 264;
const PAD = 6;        // 高亮缺口相对目标的外扩
const GAP = 16;       // 气泡与高亮圈的间距

export function FeatureSpotlight({
  targetSelector,
  badge = "新功能",
  title,
  description,
  ctaLabel = "去看看",
  dismissLabel = "知道了",
  onCta,
  onDismiss,
}) {
  const [rect, setRect] = useState(null);

  useEffect(() => {
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const el = document.querySelector(targetSelector);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect((prev) => {
        if (prev && Math.abs(prev.top - r.top) < 1 && Math.abs(prev.left - r.left) < 1 &&
            Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1) return prev;
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const iv = setInterval(measure, 300); // sticky 栏/异步数据造成的布局移动兜底
    return () => {
      alive = false;
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      clearInterval(iv);
    };
  }, [targetSelector]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onDismiss?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  if (!rect || typeof document === "undefined") return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const hole = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };

  // 目标右侧放得下气泡就放右边（桌面侧栏场景），否则放下方（移动端顶部 tab 场景）
  const placeRight = vw - (hole.left + hole.width) >= CARD_W + GAP + 12;
  let cardTop, cardLeft, arrowStyle;
  if (placeRight) {
    cardLeft = hole.left + hole.width + GAP;
    cardTop = Math.max(12, Math.min(hole.top + hole.height / 2 - 60, vh - 190));
    const arrowTop = Math.max(14, Math.min(hole.top + hole.height / 2 - cardTop - 6, 150));
    arrowStyle = { left: -6, top: arrowTop };
  } else {
    cardTop = hole.top + hole.height + GAP;
    cardLeft = Math.max(12, Math.min(hole.left + hole.width / 2 - CARD_W / 2, vw - CARD_W - 12));
    const arrowLeft = Math.max(18, Math.min(hole.left + hole.width / 2 - cardLeft - 6, CARD_W - 30));
    arrowStyle = { top: -6, left: arrowLeft };
  }

  const dimStyle = {
    position: "fixed",
    background: "rgba(13,22,18,0.52)",
    WebkitBackdropFilter: "blur(2.5px)",
    backdropFilter: "blur(2.5px)",
    zIndex: 10600,
  };

  return createPortal(
    <div style={{ fontFamily: HOME_FONT }} role="dialog" aria-label={`新功能引导：${title}`}>
      <style>{`
        @keyframes tp-spot-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes tp-spot-dim-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tp-spot-pulse {
          0%, 100% { box-shadow: 0 0 0 5px rgba(13,150,104,0.22); }
          50%      { box-shadow: 0 0 0 10px rgba(13,150,104,0.10); }
        }
      `}</style>

      {/* 四块压暗+模糊面板，中间留出高亮缺口；点面板任意处 = 知道了 */}
      {[
        { top: 0, left: 0, width: "100vw", height: Math.max(0, hole.top) },
        { top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height },
        { top: hole.top, left: hole.left + hole.width, width: Math.max(0, vw - hole.left - hole.width), height: hole.height },
        { top: hole.top + hole.height, left: 0, width: "100vw", height: Math.max(0, vh - hole.top - hole.height) },
      ].map((s, i) => (
        <div key={i} onClick={onDismiss} style={{ ...dimStyle, ...s, animation: "tp-spot-dim-in .3s ease both" }} />
      ))}

      {/* 高亮圈：呼吸光晕描出入口位置 */}
      <div style={{
        position: "fixed", top: hole.top, left: hole.left, width: hole.width, height: hole.height,
        borderRadius: 12, border: `2px solid ${T.primary}`,
        animation: "tp-spot-pulse 1.8s ease-in-out infinite",
        pointerEvents: "none", zIndex: 10601, boxSizing: "border-box",
      }} />
      {/* 缺口点击层：点亮着的入口本身 = 直接前往 */}
      <div onClick={onCta} title={title} style={{ position: "fixed", top: hole.top, left: hole.left, width: hole.width, height: hole.height, cursor: "pointer", zIndex: 10602 }} />

      {/* 说明气泡 + 指向箭头 */}
      <div style={{
        position: "fixed", top: cardTop, left: cardLeft, width: CARD_W,
        background: "#fff", borderRadius: 14, padding: "14px 16px 12px",
        boxShadow: "0 12px 40px rgba(10,40,25,0.22)",
        zIndex: 10603, animation: "tp-spot-in .35s cubic-bezier(0.25,1,0.5,1) .1s both",
        boxSizing: "border-box",
      }}>
        <div style={{ position: "absolute", width: 12, height: 12, background: "#fff", transform: "rotate(45deg)", ...arrowStyle }} />
        <span style={{ display: "inline-block", fontSize: 10, fontWeight: 700, color: T.primaryDeep, background: T.primarySoft, border: `1px solid ${T.primaryMist}`, borderRadius: 999, padding: "2px 8px", letterSpacing: 0.5, marginBottom: 8 }}>
          {badge}
        </span>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.t1, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: T.t2, lineHeight: 1.7 }}>{description}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <button
            onClick={onCta}
            style={{ border: "none", background: T.primary, color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "7px 16px", cursor: "pointer", fontFamily: HOME_FONT }}
          >
            {ctaLabel} →
          </button>
          <button
            onClick={onDismiss}
            style={{ border: "none", background: "transparent", color: T.t3, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: HOME_FONT, padding: "7px 4px" }}
          >
            {dismissLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
