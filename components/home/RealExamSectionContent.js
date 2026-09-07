"use client";
// 首页「真题专区」section 面板（桌面）。骨架照 ReadingSectionContent：标题 + 特性条 +
// Pro 门禁横幅（非 Pro 时任务网格置灰禁点）+ 任务卡网格。
//
// 升级按钮走全局 open-upgrade-modal 事件 —— 本组件在 HomePageClient 组件树下，
// HomePageClient 上挂着唯一监听者（HomePageClient.js:142-152），所以不需要自持 UpgradeModal。
import { SECTION_ACCENTS } from "./sections";
import { CHALLENGE_TOKENS as CH, HOME_FONT, HOME_TOKENS as T } from "./theme";
import { HomeTaskCard } from "./HomeTaskCard";
import { PromoBanner } from "./HomePageClient";
// 故意**不** import lib/realBank，免得把 158 道写作真题的 JSON（238 KB）+ 阅读三个题库
// 全打进首页 bundle（实测 `/` 的 First Load JS 会从 255 kB 涨到 318 kB）。
// 但阅读真题是 scripts/realbank/build_bank.mjs 的构建产物，54 套卷陆续入库题量一直在变，
// 写死的字符串会立刻过期 —— 折中办法是读 counts.json：build_bank 落库时顺手写的
// 几十字节计数文件，只有 {ctw,rdl,ap} 三个数字，静态 import 进来几乎不占体积。
// 写作三题型是冻结语料，题量保持写死（靠 __tests__/real-bank-section.component.test.js 交叉校验）。
import REAL_READING_COUNTS from "../../data/realBank/reading/counts.json";
// 听力 / 口语（三期）同理：只读 counts.json，不许 import lib/realBank。
import REAL_LISTENING_COUNTS from "../../data/realBank/listening/counts.json";
import REAL_SPEAKING_COUNTS from "../../data/realBank/speaking/counts.json";
// 三档限时口径与常规练习共用（lib/realBankModes 只依赖 lib/practiceMode + lib/listeningTiming，
// 不碰题库 JSON，所以不会把真题库打进首页 bundle）。
import { PRACTICE_MODE } from "../../lib/practiceMode";
import { getRealBankTimeLabels } from "../../lib/realBankModes";

const REAL_ACCENT = SECTION_ACCENTS["real-bank"];

// 卡片分组（写作 / 阅读 / 听力 / 口语）。12 张卡平铺会糊成一片，按科目分段用户才找得着。
export const REAL_EXAM_GROUPS = [
  { id: "writing", label: "写作" },
  { id: "reading", label: "阅读" },
  { id: "listening", label: "听力" },
  { id: "speaking", label: "口语" },
];

// 任务卡的文案。题量与来源分档严格按 data/REFERENCE_BANKS.md 的口径写，
// 不许把未核验的语料吹成 ETS 官方（讨论 81 条无 tier → legacy；邮件只有 tpo1/tpo2 是官方；
// 阅读三题型全是 2026 考生回忆整理 → 回忆版）。
export const REAL_EXAM_TASKS = [
  {
    g: "writing",
    k: "real-discussion",
    type: "discussion",
    href: "/real-bank?type=discussion",
    n: "Task 3",
    t: "学术讨论真题",
    d: "回忆版 44 题（2026 考生回忆）+ 参考版 81 题，AI 评分与常规练习一致。",
    it: "125 题",
  },
  {
    g: "writing",
    k: "real-email",
    type: "email",
    href: "/real-bank?type=email",
    n: "Task 2",
    t: "邮件真题",
    d: "ETS 官方原题 2 题 + 参考版 11 题，附收件人与写作目标。",
    it: "13 题",
  },
  {
    g: "writing",
    k: "real-bs",
    type: "bs",
    href: "/real-bank?type=bs",
    n: "Task 1",
    t: "造句官方真题",
    d: "ETS iBT Full-Length Practice Test 1 & 2 原题，含官方答案。",
    it: "20 题 · 2 套",
  },
  {
    g: "reading",
    k: "real-ctw",
    type: "ctw",
    href: "/real-bank?type=ctw",
    n: "Reading 1",
    t: "阅读填词真题",
    d: "回忆版 Complete the Words 原文，按真题原样挖空。",
    it: `${REAL_READING_COUNTS.ctw} 篇`,
  },
  {
    g: "reading",
    k: "real-rdl",
    type: "rdl",
    href: "/real-bank?type=rdl",
    n: "Reading 2",
    t: "日常阅读真题",
    d: "回忆版通知 / 邮件 / 海报等生活材料，附原题选项。",
    it: `${REAL_READING_COUNTS.rdl} 篇`,
  },
  {
    g: "reading",
    k: "real-ap",
    type: "ap",
    href: "/real-bank?type=ap",
    n: "Reading 3",
    t: "学术阅读真题",
    d: "回忆版学术长文，一篇多题，与常规练习同一判分。",
    it: `${REAL_READING_COUNTS.ap} 篇`,
  },
  {
    g: "listening",
    k: "real-lcr",
    type: "lcr",
    href: "/real-bank?type=lcr",
    n: "Listening 1",
    t: "听力应答真题",
    d: "回忆版 Choose a Response，配真题录音，一题一段。",
    it: `${REAL_LISTENING_COUNTS.lcr} 题`,
  },
  {
    g: "listening",
    k: "real-lc",
    type: "lc",
    href: "/real-bank?type=lc",
    n: "Listening 2",
    t: "听力对话真题",
    d: "回忆版校园对话，一段音频多题。",
    it: `${REAL_LISTENING_COUNTS.lc} 段`,
  },
  {
    g: "listening",
    k: "real-la",
    type: "la",
    href: "/real-bank?type=la",
    n: "Listening 3",
    t: "听力通知真题",
    d: "回忆版校园通知播报，附原题选项。",
    it: `${REAL_LISTENING_COUNTS.la} 段`,
  },
  {
    g: "listening",
    k: "real-lat",
    type: "lat",
    href: "/real-bank?type=lat",
    n: "Listening 4",
    t: "听力讲座真题",
    d: "回忆版学术讲座，一段音频多题。",
    it: `${REAL_LISTENING_COUNTS.lat} 段`,
  },
  {
    g: "speaking",
    k: "real-repeat",
    type: "repeat",
    href: "/real-bank?type=repeat",
    n: "Speaking 1",
    t: "口语跟读真题",
    d: "回忆版 Listen & Repeat，录音 + AI 评分与常规练习一致。",
    it: `${REAL_SPEAKING_COUNTS.repeat} 套`,
  },
  {
    g: "speaking",
    k: "real-interview",
    type: "interview",
    href: "/real-bank?type=interview",
    n: "Speaking 2",
    t: "口语访谈真题",
    d: "回忆版 Take an Interview，一套多问，含参考答案。",
    it: `${REAL_SPEAKING_COUNTS.interview} 套`,
  },
];

export function RealExamSectionContent({
  isChallenge, isPractice, mode, switchMode, fadeIn,
  hoverKey, setHoverKey,
  userTier, isLoggedIn, showLoginModal,
}) {
  const isPro = userTier === "pro" || userTier === "legacy";
  const modeStr = isPractice ? "practice" : mode === PRACTICE_MODE.CHALLENGE ? "challenge" : "standard";

  const gridItems = REAL_EXAM_TASKS.map((task, index) => {
    const { timeLabel, standardLabel } = getRealBankTimeLabels(task.type, modeStr);
    return {
      ...task,
      href: `${task.href}&mode=${modeStr}`,
      timeLabel,
      standardLabel,
      acc: REAL_ACCENT,
      isMock: false,
      delay: 190 + index * 70,
    };
  });

  return (
    <div style={{ flex: 1, minWidth: 0, fontFamily: HOME_FONT }}>
      {/* Section header */}
      <div style={{ marginBottom: 16, ...fadeIn(50) }}>
        <div className="tp-home-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: isChallenge ? CH.t1 : T.t1, letterSpacing: -0.5, lineHeight: 1.2 }}>
            真题专区 <span style={{ color: REAL_ACCENT.color }}>Real Questions</span>
          </h1>
          {/* 三档切换：与阅读/听力/口语面板同款 pill（真题只换题源，不换计时口径） */}
          <div className="tp-mode-switcher" style={{ display: "inline-flex", gap: 4, flexShrink: 0, background: isChallenge ? "rgba(255,255,255,0.05)" : T.card, border: `1px solid ${isChallenge ? "rgba(255,30,30,0.3)" : T.bdr}`, borderRadius: 999, padding: 4, boxShadow: T.shadow }}>
            {[
              { value: PRACTICE_MODE.STANDARD, label: "Standard" },
              { value: PRACTICE_MODE.PRACTICE, label: "Practice" },
              { value: PRACTICE_MODE.CHALLENGE, label: "Challenge" },
            ].map((option) => {
              const selected = mode === option.value;
              const challengeOption = option.value === PRACTICE_MODE.CHALLENGE;
              const practiceOption = option.value === PRACTICE_MODE.PRACTICE;
              return (
                <button
                  key={option.value}
                  onClick={() => switchMode && switchMode(option.value)}
                  style={{
                    border: "none",
                    background: selected ? (challengeOption ? "rgba(255,30,30,0.18)" : practiceOption ? "rgba(99,102,241,0.12)" : "#fff") : "transparent",
                    color: selected ? (challengeOption ? CH.accent : practiceOption ? "#6366f1" : T.t1) : (isChallenge ? CH.t2 : T.t2),
                    borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 700,
                    cursor: "pointer", transition: "all .15s",
                    boxShadow: selected && !challengeOption && !practiceOption ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                    fontFamily: HOME_FONT,
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: isChallenge ? CH.t2 : T.t2, lineHeight: 1.5 }}>
          把题库里现成的公开真题集中起来练：写作三题型 158 道 + 阅读三题型{" "}
          {REAL_READING_COUNTS.ctw + REAL_READING_COUNTS.rdl + REAL_READING_COUNTS.ap} 篇 + 听力四题型{" "}
          {REAL_LISTENING_COUNTS.lcr + REAL_LISTENING_COUNTS.lc + REAL_LISTENING_COUNTS.la + REAL_LISTENING_COUNTS.lat} 段 + 口语两题型{" "}
          {REAL_SPEAKING_COUNTS.repeat + REAL_SPEAKING_COUNTS.interview} 套，
          {isPractice
            ? "自选题目，不限时间，做过的题会打上「已练」标记。"
            : mode === PRACTICE_MODE.CHALLENGE
              ? "挑战模式，限时更紧；自选题目，做过的题会打上「已练」标记。"
              : "自选题目，按常规练习同一限时，做过的题会打上「已练」标记。"}
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

      {/* Task grid（非 Pro 置灰禁点） */}
      {/* 按科目分组：每组一个小标题 + 一张网格。四张网格都带 .home-grid 和同一套置灰样式，
          非 Pro 时整个专区一起禁点（测试用 querySelector 取第一张网格断言，语义一致）。 */}
      {REAL_EXAM_GROUPS.map((group) => {
        const groupItems = gridItems.filter((it) => it.g === group.id);
        if (groupItems.length === 0) return null;
        return (
          <div key={group.id}>
            <div style={{
              fontSize: 12, fontWeight: 700, letterSpacing: 0.5, marginBottom: 8,
              color: isChallenge ? CH.t2 : T.t2, ...fadeIn(170),
            }}>
              {group.label}
            </div>
            <div className="home-grid" style={{
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20,
              opacity: isPro ? 1 : 0.45, pointerEvents: isPro ? "auto" : "none",
              filter: isPro ? "none" : "grayscale(0.5)",
            }}>
              {groupItems.map((item) => (
                <div key={item.k} style={{ display: "flex", ...fadeIn(item.delay) }}>
                  <HomeTaskCard item={item} hoverKey={hoverKey} setHoverKey={setHoverKey} isChallenge={isChallenge} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div style={{ marginBottom: 8 }} />

      <PromoBanner isChallenge={isChallenge} fadeIn={fadeIn} />

      {/* Footer */}
      <div style={{ fontSize: 10, color: isChallenge ? CH.t2 : T.t3, opacity: 0.65, lineHeight: 1.6, textAlign: "center", ...fadeIn(520) }}>
        TreePractice 为独立练习工具，与 ETS 无关联，也未获得其认可。TOEFL® 为 ETS 注册商标。
        真题内容来自 ETS 公开材料与考生回忆整理，仅供自学参考。
      </div>
    </div>
  );
}
