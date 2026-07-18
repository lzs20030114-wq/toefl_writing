"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./PricingPreview.module.css";

const PLANS = [
  {
    id: "weekly",
    name: "7 天体验卡",
    price: "19.90",
    term: "7 天",
    points: "30 点",
    note: "适合考前体验",
  },
  {
    id: "monthly",
    name: "30 天月卡",
    price: "59.90",
    term: "30 天",
    points: "100 点",
    note: "灵活按月使用",
  },
  {
    id: "quarterly",
    name: "90 天季卡",
    price: "149.90",
    term: "90 天",
    points: "每 30 天 100 点",
    note: "比月卡省 ¥29.80",
  },
  {
    id: "yearly",
    name: "365 天年卡",
    price: "499.90",
    term: "365 天",
    points: "每 30 天 100 点",
    note: "长期备考更划算",
    saving: "省 ¥218.90",
  },
];

const TOP_UPS = [
  { points: 50, price: "9.90", unit: "¥0.20 / 点" },
  { points: 150, price: "24.90", unit: "¥0.17 / 点" },
  { points: 400, price: "59.90", unit: "¥0.15 / 点" },
];

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
  if (name === "spark") return <svg {...common}><path d="m12 3-1.2 4.1a5.4 5.4 0 0 1-3.7 3.7L3 12l4.1 1.2a5.4 5.4 0 0 1 3.7 3.7L12 21l1.2-4.1a5.4 5.4 0 0 1 3.7-3.7L21 12l-4.1-1.2a5.4 5.4 0 0 1-3.7-3.7L12 3Z" /></svg>;
  if (name === "headphones") return <svg {...common}><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><path d="M18 19h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5a2 2 0 0 1-2 2ZM6 19H5a2 2 0 0 1-2-2v-5h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2Z" /></svg>;
  if (name === "mic") return <svg {...common}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></svg>;
  if (name === "shield") return <svg {...common}><path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
  if (name === "bell") return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M10 20h4" /></svg>;
  if (name === "arrow") return <svg {...common}><path d="M5 12h14M14 7l5 5-5 5" /></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  if (name === "coins") return <svg {...common}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></svg>;
  return null;
}

function Brand() {
  return (
    <div className={styles.brand}>
      <span className={styles.brandMark}>T</span>
      <span>TreePractice</span>
      <span className={styles.proTag}>PRO</span>
    </div>
  );
}

function PlanCard({ plan, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`${styles.planCard} ${selected ? styles.planSelected : ""}`}
      onClick={() => onSelect(plan.id)}
      aria-pressed={selected}
    >
      <div className={styles.planTopline}>
        <span className={styles.planName}>{plan.name}</span>
        <span className={`${styles.radio} ${selected ? styles.radioSelected : ""}`} />
      </div>
      <div className={styles.priceLine}>
        <span className={styles.currency}>¥</span>
        <span className={styles.price}>{plan.price}</span>
      </div>
      <div className={styles.term}>有效期 {plan.term}</div>
      <div className={styles.pointsPill}><Icon name="coins" size={16} />{plan.points}</div>
      <div className={styles.planNote}>{plan.note}</div>
      {plan.saving && <span className={styles.saving}>{plan.saving}</span>}
    </button>
  );
}

// 旧价缓冲窗口（2026-07-18 拍板）：公告发布后 14 天内仍可按原价购买/续费，
// 之后只保留新价。具体日期在正式发公告时按「发布日 + 14 天」定稿。
const NEW_PRICE_EFFECTIVE_DATE = "8 月 1 日";

function Announcement({ onClose, onSeePlans }) {
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="announcement-title">
      <section className={styles.announcement}>
        <div className={styles.announcementHero}>
          <div className={styles.announcementIcon}><Icon name="bell" size={25} /></div>
          <div>
            <div className={styles.announcementEyebrow}>服务通知</div>
            <h2 id="announcement-title">Pro 服务与价格调整说明</h2>
          </div>
          <span className={styles.dateBadge}>{NEW_PRICE_EFFECTIVE_DATE}起生效</span>
        </div>

        <div className={styles.announcementBody}>
          <p className={styles.lead}>
            我们计划更新 AI 评分系统和听力语音模型。更新后，Pro 订阅将采用以下价格和点数规则。
          </p>

          <section className={styles.priceOverview} aria-label="Pro 新价格">
            <div className={styles.priceOverviewTitle}>
              <span className={styles.changeIcon}><Icon name="spark" /></span>
              <div><strong>调整后的订阅价格</strong><small>各方案包含的点数如下</small></div>
            </div>
            <div className={styles.priceList}>
              <div><span>7 天体验卡</span><strong>¥19.90</strong><small>含 30 点</small></div>
              <div><span>30 天月卡</span><strong>¥59.90</strong><small>含 100 点</small></div>
              <div><span>90 天季卡</span><strong>¥149.90</strong><small>每 30 天 100 点</small></div>
              <div><span>365 天年卡</span><strong>¥499.90</strong><small>每 30 天 100 点</small></div>
            </div>
          </section>

          <article className={styles.protectionCard}>
            <span className={styles.changeIcon}><Icon name="shield" /></span>
            <div>
              <strong>现有订阅与原价窗口</strong>
              <p>已购订阅在有效期内继续按原规则使用。公告发布后 14 天内（{NEW_PRICE_EFFECTIVE_DATE}前）仍可按当前价格购买或续费任意套餐；{NEW_PRICE_EFFECTIVE_DATE}起，新购与续费按调整后的价格执行。</p>
            </div>
          </article>

          <div className={styles.unchangedBox}>
            <div className={styles.unchangedTitle}><Icon name="check" size={18} />以下内容不计入点数</div>
            <div className={styles.unchangedItems}>
              <span>公共听力与阅读题库</span>
              <span>模拟考试与日常练习</span>
              <span>已生成听力音频播放</span>
            </div>
          </div>

          <p className={styles.detailNote}>
            AI 评分每次 1 点；口语转写每开始 30 秒 1 点。系统失败或超时不会扣点，已扣点会自动退回。
          </p>

          <div className={styles.announcementActions}>
            <button type="button" className={styles.secondaryButton} onClick={onClose}>关闭</button>
            <button type="button" className={styles.primaryButton} onClick={onSeePlans}>查看订阅方案 <Icon name="arrow" size={17} /></button>
          </div>
        </div>
      </section>
    </div>
  );
}

function PurchaseConfirmation({ offer, onClose }) {
  const [confirmed, setConfirmed] = useState([false, false, false, false]);
  const items = [
    `我已确认购买的是${offer.name}，价格为 ¥${offer.price}，${offer.term}`,
    `我已了解点数发放与扣除规则：${offer.points}`,
    "我已了解 AI 评分、转写和反馈仅用于学习参考，不代表官方考试结果",
    "我已了解权益正常开通后，因个人原因原则上不支持退款；法定情形和平台未履约情形除外",
  ];
  const allConfirmed = confirmed.every(Boolean);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="purchase-confirm-title">
      <section className={styles.confirmDialog}>
        <header className={styles.confirmHeader}>
          <div>
            <span>购买确认预览</span>
            <h2 id="purchase-confirm-title">请确认订单和服务规则</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭购买确认">×</button>
        </header>

        <div className={styles.confirmBody}>
          <div className={styles.orderSummary}>
            <div><span>购买项目</span><strong>{offer.name}</strong></div>
            <div><span>支付金额</span><strong>¥{offer.price}</strong></div>
            <div><span>付款方式</span><strong>爱发电</strong></div>
          </div>

          <div className={styles.channelNote}>
            <Icon name="shield" size={17} />
            <span>付款由爱发电处理，不自动续费。符合退款条件的订单通过爱发电原订单处理，本网站不提供即时自动退款。</span>
          </div>

          <fieldset className={styles.confirmChecklist}>
            <legend>请逐项确认</legend>
            {items.map((item, index) => (
              <label key={item}>
                <input
                  type="checkbox"
                  checked={confirmed[index]}
                  onChange={(event) => setConfirmed((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.checked : value))}
                />
                <span>{item}</span>
              </label>
            ))}
          </fieldset>

          <p className={styles.confirmLegalLinks}>
            查看完整的 <Link href="/pricing-preview/notices#pro">Pro 服务规则</Link>、
            <Link href="/pricing-preview/notices#refunds">退款与异常处理</Link> 和
            <Link href="/pricing-preview/notices#data">AI 与语音数据说明</Link>。
          </p>

          <div className={styles.confirmActions}>
            <button type="button" className={styles.secondaryButton} onClick={onClose}>返回</button>
            <button type="button" className={styles.primaryButton} disabled>
              {allConfirmed ? "前往爱发电（未接通）" : "请完成全部确认"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function PricingPreview({ initialAnnouncement = false, initialSection = "plans" }) {
  const [showAnnouncement, setShowAnnouncement] = useState(initialAnnouncement);
  const [showPurchaseConfirm, setShowPurchaseConfirm] = useState(false);
  const [activeSection, setActiveSection] = useState(initialSection);
  const [selectedPlan, setSelectedPlan] = useState("quarterly");
  const [selectedTopUp, setSelectedTopUp] = useState(150);
  const selectedPlanDetails = PLANS.find((plan) => plan.id === selectedPlan);
  const selectedTopUpDetails = TOP_UPS.find((item) => item.points === selectedTopUp);
  const selectedOffer = activeSection === "plans"
    ? { name: selectedPlanDetails.name, price: selectedPlanDetails.price, term: `有效期 ${selectedPlanDetails.term}`, points: selectedPlanDetails.points }
    : { name: `${selectedTopUpDetails.points} 点加量包`, price: selectedTopUpDetails.price, term: "点数长期有效", points: "购买后计入加量点数余额" };

  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Brand />
        <div className={styles.navActions}>
          <button type="button" className={styles.noticeButton} onClick={() => setShowAnnouncement(true)}>
            <Icon name="bell" size={17} />调价说明
          </button>
          <div className={styles.balanceChip}><Icon name="coins" size={17} /><strong>72</strong><span>点</span></div>
          <div className={styles.avatar}>林</div>
        </div>
      </nav>

      <div className={styles.accountContainer}>
        <header className={styles.accountHeader}>
          <div>
            <h1>Pro 与点数</h1>
            <p>查看订阅状态、可选方案、点数余额和使用规则。</p>
          </div>
          <span className={styles.previewStatus}>内部预览 · 功能未接通</span>
        </header>

        <div className={styles.accountTabs} role="tablist" aria-label="账户与方案">
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "plans"}
            className={activeSection === "plans" ? styles.accountTabActive : ""}
            onClick={() => setActiveSection("plans")}
          >
            Pro 订阅
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "credits"}
            className={activeSection === "credits" ? styles.accountTabActive : ""}
            onClick={() => setActiveSection("credits")}
          >
            点数与加量包 <span className={styles.tabBalance}>72</span>
          </button>
        </div>

        {activeSection === "plans" && <section className={styles.accountSection}>
          <div className={styles.currentPlanPanel}>
            <div>
              <span className={styles.panelLabel}>当前订阅</span>
              <div className={styles.currentPlanTitle}><h2>Pro 90 天季卡</h2><span>使用中</span></div>
              <p>有效期至 2026 年 8 月 31 日</p>
            </div>
            <div className={styles.currentPlanMeta}>
              <div><span>本周期点数</span><strong>72 / 100</strong></div>
              <div><span>下次点数刷新</span><strong>2026 年 8 月 1 日</strong></div>
            </div>
          </div>

          <div className={styles.accountSectionHeading}>
            <div><h2>订阅方案</h2><p>季卡和年卡每 30 天发放 100 点，未使用的订阅点数在周期结束时清零。</p></div>
          </div>

          <div className={styles.planGrid}>
            {PLANS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} selected={selectedPlan === plan.id} onSelect={setSelectedPlan} />
            ))}
          </div>

          <div className={styles.purchaseBar}>
            <div>
              <span>已选择</span>
              <strong>{selectedPlanDetails.name}</strong>
              <small>已购权益按原规则持续至当前有效期结束</small>
            </div>
            <div className={styles.purchaseActions}>
              <button type="button" className={styles.confirmPreviewButton} onClick={() => setShowPurchaseConfirm(true)}>查看购买确认</button>
              <button type="button" disabled>新方案尚未生效</button>
            </div>
          </div>

          <div className={styles.rulesPanel}>
            <h3>订阅说明</h3>
            <div className={styles.rulesGrid}>
              <span><Icon name="check" size={15} />公共听力、阅读题库和模拟考试不扣点</span>
              <span><Icon name="check" size={15} />AI 评分和口语转写按实际使用扣点</span>
              <span><Icon name="check" size={15} />系统失败或超时会自动退回点数</span>
              <span><Icon name="check" size={15} />现有订阅在当前有效期内按原规则使用</span>
            </div>
          </div>
        </section>}

        {activeSection === "credits" && <section className={styles.accountSection}>
          <div className={styles.creditSummary}>
            <div>
              <span className={styles.panelLabel}>可用点数</span>
              <strong className={styles.creditTotal}>72</strong>
              <p>订阅点数会优先使用。</p>
            </div>
            <div className={styles.creditBreakdown}>
              <div><span>订阅赠送</span><strong>52 点</strong><small>8 月 1 日刷新</small></div>
              <div><span>加量点数</span><strong>20 点</strong><small>长期有效</small></div>
            </div>
          </div>

          <div className={styles.accountSectionHeading}>
            <div><h2>点数加量包</h2><p>加量点数长期有效，不随订阅周期清零。</p></div>
          </div>

          <div className={styles.topUpLayout}>
            <div className={styles.topUpGrid}>
              {TOP_UPS.map((item) => (
                <button
                  type="button"
                  key={item.points}
                  className={`${styles.topUpCard} ${item.featured ? styles.topUpFeatured : ""} ${selectedTopUp === item.points ? styles.topUpSelected : ""}`}
                  onClick={() => setSelectedTopUp(item.points)}
                  aria-pressed={selectedTopUp === item.points}
                >
                  <div><Icon name="coins" size={24} /><strong>{item.points}</strong><small>点</small></div>
                  <b>¥{item.price}</b>
                  <em>{item.unit}</em>
                </button>
              ))}
            </div>

            <div className={styles.usageCard}>
              <h3>点数使用规则</h3>
              <div className={styles.usageRow}>
                <span className={styles.usageIcon}><Icon name="spark" /></span>
                <div><strong>AI 评分</strong><small>每次完整评分</small></div><b>1 点</b>
              </div>
              <div className={styles.usageRow}>
                <span className={styles.usageIcon}><Icon name="mic" /></span>
                <div><strong>口语转写</strong><small>每开始 30 秒</small></div><b>1 点</b>
              </div>
              <div className={styles.usageRow}>
                <span className={styles.usageIcon}><Icon name="headphones" /></span>
                <div><strong>公共听力</strong><small>练习与重复播放</small></div><b className={styles.free}>0 点</b>
              </div>
            </div>
          </div>

          <div className={styles.purchaseBar}>
            <div>
              <span>已选择</span>
              <strong>{selectedTopUp} 点加量包 · ¥{selectedTopUpDetails.price}</strong>
              <small>购买功能目前未接通</small>
            </div>
            <div className={styles.purchaseActions}>
              <button type="button" className={styles.confirmPreviewButton} onClick={() => setShowPurchaseConfirm(true)}>查看购买确认</button>
              <button type="button" disabled>暂不可购买</button>
            </div>
          </div>
        </section>}

        <aside className={styles.documentLinks} aria-label="服务说明">
          <span>服务说明</span>
          <nav>
            <Link href="/pricing-preview/notices#pro">Pro 服务规则</Link>
            <Link href="/pricing-preview/notices#credits">点数使用说明</Link>
            <Link href="/pricing-preview/notices#refunds">退款与异常处理</Link>
            <Link href="/pricing-preview/notices#data">AI 与语音数据说明</Link>
          </nav>
        </aside>

        <footer className={styles.footerNote}>
          <Icon name="shield" size={18} />
          <span><strong>内部预览。</strong>未连接支付、未修改线上价格，也不会产生任何扣点。</span>
        </footer>
      </div>

      {showAnnouncement && (
        <Announcement
          onClose={() => setShowAnnouncement(false)}
          onSeePlans={() => {
            setActiveSection("plans");
            setShowAnnouncement(false);
          }}
        />
      )}

      {showPurchaseConfirm && <PurchaseConfirmation offer={selectedOffer} onClose={() => setShowPurchaseConfirm(false)} />}
    </main>
  );
}
