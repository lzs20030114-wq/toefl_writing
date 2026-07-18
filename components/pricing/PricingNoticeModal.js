"use client";
// 全站「Pro 服务与价格调整」进站弹窗公告 —— 用户进网页即可看到。
//
// 文案母版取自内部预览页 components/pricing/PricingPreview.js 的 Announcement 组件
// （该预览页不对外，此弹窗是唯一对外触达）。全站挂载点在 app/layout.js。
//
// 设计约定（跟 components/shared/ 惯例走）：内联样式 + ui.js 的 C/FONT，不用 CSS module。
// 关键坑规避：登录态点「按现价购买 / 续费」必须打开【页内自持】的 UpgradeModal
// （照 app/my-bank/page.js 模式），严禁 dispatch 全局 open-upgrade-modal 事件——
// layout 挂载点不在 HomePageClient 树下，那是历史死按钮的根源。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { C, FONT } from "../shared/ui";
import UpgradeModal from "../shared/UpgradeModal";
import { getSavedCode, getSavedTier } from "../../lib/AuthContext";

// 旧价缓冲窗口（2026-07-18 发布，发布日 + 14 天）。改日期时同步改 EXPIRE_AT 与 dismiss 键。
const NEW_PRICE_EFFECTIVE_DATE = "8 月 1 日";

// dismiss 键：本轮公告唯一。带日期后缀，下一轮公告换键即可重新触达。
const DISMISS_KEY = "pricing_notice_20260801_dismissed";

// 公告过期自动下线：8 月 1 日窗口结束，8 月 2 日 00:00（北京时间）起静默不再弹。
const EXPIRE_AT = new Date("2026-08-02T00:00:00+08:00");

function Icon({ name, size = 20 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (name === "bell") return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M10 20h4" /></svg>;
  if (name === "spark") return <svg {...common}><path d="m12 3-1.2 4.1a5.4 5.4 0 0 1-3.7 3.7L3 12l4.1 1.2a5.4 5.4 0 0 1 3.7 3.7L12 21l1.2-4.1a5.4 5.4 0 0 1 3.7-3.7L21 12l-4.1-1.2a5.4 5.4 0 0 1-3.7-3.7L12 3Z" /></svg>;
  if (name === "shield") return <svg {...common}><path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  return null;
}

const PRICE_ROWS = [
  { term: "7 天体验卡", price: "¥19.90", points: "含 30 点" },
  { term: "30 天月卡", price: "¥59.90", points: "含 100 点" },
  { term: "90 天季卡", price: "¥149.90", points: "每 30 天 100 点" },
  { term: "365 天年卡", price: "¥499.90", points: "每 30 天 100 点" },
];

const UNCHANGED_ITEMS = ["公共听力与阅读题库", "模拟考试与日常练习", "已生成听力音频播放"];

/**
 * 全站挂载的进站公告弹窗。
 * @param {Date} [now] 「现在」时间，默认 new Date()——注入以便测试过期下线。
 */
export default function PricingNoticeModal({ now = new Date() }) {
  const [visible, setVisible] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [code, setCode] = useState("");
  const [tier, setTier] = useState("free");

  // 挂载后判断是否弹（SSR 安全：visible 初始 false → 服务端 & 首帧都 return null，
  // 避免 createPortal 在服务端触碰 document.body，也避免 hydration 错位）。
  useEffect(() => {
    // kill switch：NEXT_PUBLIC_ 构建期内联，"1" 时全站不弹。
    if (process.env.NEXT_PUBLIC_PRICING_NOTICE_DISABLED === "1") return;
    // 过期静默下线。
    if (now.getTime() >= EXPIRE_AT.getTime()) return;
    // 已 dismiss 不再弹。
    let dismissed = null;
    try { dismissed = localStorage.getItem(DISMISS_KEY); } catch { /* no-op */ }
    if (dismissed === "1") return;
    setCode(getSavedCode() || "");
    setTier(getSavedTier() || "free");
    setVisible(true);
    // 只在挂载时评估一次；now 默认值每次渲染新建，故不入依赖数组。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function writeDismiss() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* no-op */ }
  }

  function handleClose() {
    writeDismiss();
    setVisible(false);
  }

  function handleBuy() {
    // 点「按现价购买 / 续费」也算已触达 → 写 dismiss；公告先收起，再开升级弹窗。
    writeDismiss();
    setVisible(false);
    setUpgradeOpen(true);
  }

  return (
    <>
      {visible && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pricing-notice-title"
          style={{
            position: "fixed", inset: 0, zIndex: 9990,
            background: "rgba(15,23,42,0.55)",
            WebkitBackdropFilter: "blur(6px)", backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16, fontFamily: FONT,
          }}
        >
          <section
            style={{
              background: "#fff", width: "100%", maxWidth: 460,
              maxHeight: "90vh", overflowY: "auto", WebkitOverflowScrolling: "touch",
              borderRadius: 16, border: `1px solid ${C.bdr}`,
              boxShadow: "0 20px 50px rgba(15,23,42,0.25)",
            }}
          >
            {/* Hero band */}
            <div style={{
              position: "relative", display: "flex", alignItems: "center", gap: 12,
              background: C.softAmber, borderBottom: `1px solid ${C.bdr}`,
              borderRadius: "16px 16px 0 0", padding: "18px 22px",
            }}>
              <div style={{
                flexShrink: 0, width: 40, height: 40, borderRadius: 10,
                background: "#fff", border: `1px solid ${C.bdr}`, color: C.orange,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon name="bell" size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.orange, letterSpacing: 0.3 }}>服务通知</div>
                <h2 id="pricing-notice-title" style={{ margin: "2px 0 0", fontSize: 17, fontWeight: 800, color: C.t1 }}>
                  Pro 服务与价格调整说明
                </h2>
              </div>
              <span style={{
                flexShrink: 0, alignSelf: "flex-start", fontSize: 11.5, fontWeight: 700,
                color: C.orange, background: "#fff", border: `1px solid ${C.bdr}`,
                borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap",
              }}>
                {NEW_PRICE_EFFECTIVE_DATE}起生效
              </span>
            </div>

            {/* Body */}
            <div style={{ padding: 22 }}>
              <p style={{ margin: "0 0 16px", fontSize: 13.5, color: C.t2, lineHeight: 1.7 }}>
                我们计划更新 AI 评分系统和听力语音模型。更新后，Pro 订阅将采用以下价格和点数规则。
              </p>

              {/* 调整后价格表 */}
              <section aria-label="Pro 调整后价格" style={{
                border: `1px solid ${C.bdr}`, borderRadius: 12, overflow: "hidden", marginBottom: 14,
              }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "11px 14px", background: C.ltB, borderBottom: `1px solid ${C.bdr}`,
                }}>
                  <span style={{ color: C.blue, display: "inline-flex" }}><Icon name="spark" size={18} /></span>
                  <div>
                    <strong style={{ fontSize: 13.5, color: C.t1 }}>调整后的订阅价格</strong>
                    <small style={{ display: "block", fontSize: 11.5, color: C.t2 }}>各方案包含的点数如下</small>
                  </div>
                </div>
                {PRICE_ROWS.map((row, i) => (
                  <div key={row.term} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 14px", borderTop: i > 0 ? `1px solid ${C.bdrSubtle}` : "none",
                  }}>
                    <span style={{ fontSize: 13, color: C.t1, fontWeight: 600 }}>{row.term}</span>
                    <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <strong style={{ fontSize: 14, color: C.t1 }}>{row.price}</strong>
                      <small style={{ fontSize: 11.5, color: C.t2 }}>{row.points}</small>
                    </span>
                  </div>
                ))}
              </section>

              {/* 现有订阅与原价窗口（重点加粗） */}
              <article style={{
                display: "flex", gap: 10, padding: "12px 14px", marginBottom: 14,
                background: C.softBlue, border: `1px solid ${C.bdr}`, borderRadius: 12,
              }}>
                <span style={{ flexShrink: 0, color: C.blue, display: "inline-flex", marginTop: 1 }}>
                  <Icon name="shield" size={19} />
                </span>
                <div>
                  <strong style={{ fontSize: 13.5, color: C.t1 }}>现有订阅与原价窗口</strong>
                  <p style={{ margin: "4px 0 0", fontSize: 12.5, color: C.t2, lineHeight: 1.7 }}>
                    已购订阅在有效期内继续按原规则使用。
                    <strong style={{ color: C.t1 }}>
                      {NEW_PRICE_EFFECTIVE_DATE}前仍可按当前价格购买或续费任意套餐
                    </strong>
                    ；{NEW_PRICE_EFFECTIVE_DATE}起，新购与续费按调整后的价格执行。
                  </p>
                </div>
              </article>

              {/* 不计点数清单 */}
              <div style={{
                padding: "12px 14px", marginBottom: 14,
                background: C.ltB, border: `1px solid ${C.bdr}`, borderRadius: 12,
              }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
                  fontSize: 13, fontWeight: 700, color: C.green,
                }}>
                  <Icon name="check" size={17} />以下内容不计入点数
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {UNCHANGED_ITEMS.map((item) => (
                    <span key={item} style={{
                      fontSize: 12, color: C.t2, background: "#fff",
                      border: `1px solid ${C.bdr}`, borderRadius: 999, padding: "3px 10px",
                    }}>
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              {/* 细则一行 */}
              <p style={{ margin: "0 0 18px", fontSize: 12, color: C.t3, lineHeight: 1.7 }}>
                AI 评分每次 1 点；口语转写每开始 30 秒 1 点。系统失败或超时不会扣点，已扣点会自动退回。
              </p>

              {/* Actions */}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                {code ? (
                  <button
                    type="button"
                    onClick={handleBuy}
                    style={{
                      padding: "11px 18px", borderRadius: 10, border: `1px solid ${C.bdr}`,
                      background: "#fff", color: C.t1, fontSize: 14, fontWeight: 700,
                      fontFamily: FONT, cursor: "pointer",
                    }}
                  >
                    按现价购买 / 续费
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleClose}
                  style={{
                    padding: "11px 22px", borderRadius: 10, border: "none",
                    background: C.blue, color: "#fff", fontSize: 14, fontWeight: 700,
                    fontFamily: FONT, cursor: "pointer",
                  }}
                >
                  知道了
                </button>
              </div>
            </div>
          </section>
        </div>,
        document.body,
      )}

      {upgradeOpen && (
        <UpgradeModal
          userCode={code}
          currentTier={tier}
          onClose={() => setUpgradeOpen(false)}
          onUpgraded={() => window.location.reload()}
        />
      )}
    </>
  );
}
