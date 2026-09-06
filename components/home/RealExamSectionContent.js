"use client";
// 首页「真题专区」section 面板（桌面）。骨架照 ReadingSectionContent：标题 + 特性条 +
// Pro 门禁横幅（非 Pro 时任务网格置灰禁点）+ 任务卡网格。
//
// 升级按钮走全局 open-upgrade-modal 事件 —— 本组件在 HomePageClient 组件树下，
// HomePageClient 上挂着唯一监听者（HomePageClient.js:142-152），所以不需要自持 UpgradeModal。
import { SECTION_ACCENTS } from "./sections";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";
import { HomeTaskCard, HomeLinkCard } from "./HomeTaskCard";
import { PromoBanner } from "./HomePageClient";
// 故意**不** import lib/realBank，免得把 158 道写作真题的 JSON（238 KB）+ 阅读三个题库
// 全打进首页 bundle（实测 `/` 的 First Load JS 会从 255 kB 涨到 318 kB）。
// 但阅读真题是 scripts/realbank/build_bank.mjs 的构建产物，54 套卷陆续入库题量一直在变，
// 写死的字符串会立刻过期 —— 折中办法是读 counts.json：build_bank 落库时顺手写的
// 几十字节计数文件，只有 {ctw,rdl,ap} 三个数字，静态 import 进来几乎不占体积。
// 写作三题型是冻结语料，题量保持写死（靠 __tests__/real-bank-section.component.test.js 交叉校验）。
// counts.json 同时带 sets（场次数）/ latest（最近考期），给下面「按考试场次」入口卡用。
import REAL_READING_COUNTS from "../../data/realBank/reading/counts.json";

/** 「按考试场次」入口卡的文案（桌面 / 移动端共用口径）。 */
export function realSetsEntryCopy(counts = REAL_READING_COUNTS) {
  const sets = Number(counts?.sets) || 0;
  const latest = String(counts?.latest || "");
  const latestShort = latest.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return {
    badge: sets > 0 ? `${sets} 场` : "录入中",
    description: sets > 0
      ? `一场考试一套题，按考试日期排列${latestShort ? `，最近一场 ${Number(latestShort[1])}.${Number(latestShort[2])}` : ""}；每场看得到练到哪了。`
      : "场次真题正在录入，先按题型练。",
  };
}

const REAL_ACCENT = SECTION_ACCENTS["real-bank"];

// 任务卡的文案。题量与来源分档严格按 data/REFERENCE_BANKS.md 的口径写，
// 不许把未核验的语料吹成 ETS 官方（讨论 81 条无 tier → legacy；邮件只有 tpo1/tpo2 是官方；
// 阅读三题型全是 2026 考生回忆整理 → 回忆版）。
export const REAL_EXAM_TASKS = [
  {
    k: "real-discussion",
    href: "/real-bank?type=discussion",
    n: "Task 3",
    t: "学术讨论真题",
    d: "回忆版 44 题（2026 考生回忆）+ 参考版 81 题，AI 评分与常规练习一致。",
    it: "125 题",
    timeLabel: "不限时",
    standardLabel: "不限时",
  },
  {
    k: "real-email",
    href: "/real-bank?type=email",
    n: "Task 2",
    t: "邮件真题",
    d: "ETS 官方原题 2 题 + 参考版 11 题，附收件人与写作目标。",
    it: "13 题",
    timeLabel: "不限时",
    standardLabel: "不限时",
  },
  {
    k: "real-bs",
    href: "/real-bank?type=bs",
    n: "Task 1",
    t: "造句官方真题",
    d: "ETS iBT Full-Length Practice Test 1 & 2 原题，含官方答案。",
    it: "20 题 · 2 套",
    timeLabel: "不限时",
    standardLabel: "不限时",
  },
  {
    k: "real-ctw",
    href: "/real-bank?type=ctw",
    n: "Reading 1",
    t: "阅读填词真题",
    d: "回忆版 Complete the Words 原文，按真题原样挖空。",
    it: `${REAL_READING_COUNTS.ctw} 篇`,
    timeLabel: "不限时",
    standardLabel: "不限时",
  },
  {
    k: "real-rdl",
    href: "/real-bank?type=rdl",
    n: "Reading 2",
    t: "日常阅读真题",
    d: "回忆版通知 / 邮件 / 海报等生活材料，附原题选项。",
    it: `${REAL_READING_COUNTS.rdl} 篇`,
    timeLabel: "不限时",
    standardLabel: "不限时",
  },
  {
    k: "real-ap",
    href: "/real-bank?type=ap",
    n: "Reading 3",
    t: "学术阅读真题",
    d: "回忆版学术长文，一篇多题，与常规练习同一判分。",
    it: `${REAL_READING_COUNTS.ap} 篇`,
    timeLabel: "不限时",
    standardLabel: "不限时",
  },
];

export function RealExamSectionContent({
  isChallenge, fadeIn,
  hoverKey, setHoverKey,
  userTier, isLoggedIn, showLoginModal,
}) {
  const isPro = userTier === "pro" || userTier === "legacy";

  const gridItems = REAL_EXAM_TASKS.map((task, index) => ({
    ...task,
    acc: REAL_ACCENT,
    isMock: false,
    delay: 190 + index * 70,
  }));

  return (
    <div style={{ flex: 1, minWidth: 0, fontFamily: HOME_FONT }}>
      {/* Section header */}
      <div style={{ marginBottom: 16, ...fadeIn(50) }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: isChallenge ? CH.t1 : T.t1, letterSpacing: -0.5, lineHeight: 1.2 }}>
          真题专区 <span style={{ color: REAL_ACCENT.color }}>Real Questions</span>
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: isChallenge ? CH.t2 : T.t2, lineHeight: 1.5 }}>
          把题库里现成的公开真题集中起来练：写作三题型 158 道 + 阅读三题型{" "}
          {REAL_READING_COUNTS.ctw + REAL_READING_COUNTS.rdl + REAL_READING_COUNTS.ap} 篇，
          不限时间、自选题目，做过的题会打上「已练」标记。
        </p>
      </div>

      {/* Feature strip — 来源分档口径，摆在最显眼处 */}
      <div style={{ background: isChallenge ? "rgba(17,17,24,0.7)" : T.card, border: `1px solid ${isChallenge ? CH.cardBorder : T.bdr}`, borderRadius: 10, padding: "10px 16px", marginBottom: 16, boxShadow: isChallenge ? "none" : T.shadow, ...fadeIn(120) }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: isChallenge ? CH.t2 : T.t2 }}>
          <span>- ETS官方：官方 PDF 逐字原题</span>
          <span>- 回忆版：2026 考生回忆整理</span>
          <span>- 参考版：早期收集，来源未核验</span>
          <span>- 每道题都标注来源分档，仅供练习参考</span>
        </div>
      </div>

      {/* Pro gate */}
      {!isPro && (
        <div style={{
          background: isChallenge ? "rgba(255,255,255,0.04)" : "#FFFBEB",
          border: `1px solid ${isChallenge ? CH.cardBorder : "#FDE68A"}`,
          borderRadius: 10, padding: "16px 20px", marginBottom: 16,
          display: "flex", alignItems: "center", gap: 12,
          ...fadeIn(160),
        }}>
          <span style={{ fontSize: 22 }}>🔒</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: isChallenge ? CH.t1 : T.t1 }}>Pro 专属功能</div>
            <div style={{ fontSize: 12, color: isChallenge ? CH.t2 : T.t2, marginTop: 2 }}>
              真题专区仅对 Pro 用户开放
            </div>
          </div>
          {!isLoggedIn ? (
            <button
              onClick={showLoginModal}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: REAL_ACCENT.color, color: "#fff",
                fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: HOME_FONT,
              }}
            >
              登录
            </button>
          ) : (
            <button
              onClick={() => {
                try { window.dispatchEvent(new CustomEvent("open-upgrade-modal")); } catch {}
              }}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: REAL_ACCENT.color, color: "#fff",
                fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: HOME_FONT,
              }}
            >
              升级 Pro
            </button>
          )}
        </div>
      )}

      {/* 按考试场次入口（非 Pro 同样置灰禁点） */}
      <div style={{
        marginBottom: 12, ...fadeIn(170),
        opacity: isPro ? 1 : 0.45, pointerEvents: isPro ? "auto" : "none",
        filter: isPro ? "none" : "grayscale(0.5)",
      }}>
        <HomeLinkCard
          href="/real-bank/sets"
          cardKey="real-sets"
          hoverKey={hoverKey}
          setHoverKey={setHoverKey}
          isChallenge={isChallenge}
          icon="📅"
          eyebrow="By Exam Date"
          title="按考试场次练"
          description={realSetsEntryCopy().description}
          badge={realSetsEntryCopy().badge}
          accentColor={REAL_ACCENT.color}
        />
      </div>

      {/* Task grid（非 Pro 置灰禁点） */}
      <div className="home-grid" style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28,
        opacity: isPro ? 1 : 0.45, pointerEvents: isPro ? "auto" : "none",
        filter: isPro ? "none" : "grayscale(0.5)",
      }}>
        {gridItems.map((item) => (
          <div key={item.k} style={{ display: "flex", ...fadeIn(item.delay) }}>
            <HomeTaskCard item={item} hoverKey={hoverKey} setHoverKey={setHoverKey} isChallenge={isChallenge} />
          </div>
        ))}
      </div>

      <PromoBanner isChallenge={isChallenge} fadeIn={fadeIn} />

      {/* Footer */}
      <div style={{ fontSize: 10, color: isChallenge ? CH.t2 : T.t3, opacity: 0.65, lineHeight: 1.6, textAlign: "center", ...fadeIn(520) }}>
        TreePractice 为独立练习工具，与 ETS 无关联，也未获得其认可。TOEFL® 为 ETS 注册商标。
        真题内容来自 ETS 公开材料与考生回忆整理，仅供自学参考。
      </div>
    </div>
  );
}
