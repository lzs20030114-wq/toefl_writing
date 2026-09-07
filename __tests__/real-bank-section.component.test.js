/**
 * 首页「真题专区」section 面板接线冒烟（components/home/RealExamSectionContent.js）。
 * 范式照 __tests__/my-bank-section.component.test.js。
 *
 * 同时锁首页 5 个接触点里最容易漏的两个：
 *   - SectionContent 必须有 real-bank 分支（漏了会静默掉进文件末尾的 Writing 默认分支）；
 *   - HomePageClient 的 section 白名单必须收 "real-bank"（漏了深链 ?section=real-bank 被兜回 writing）。
 */

import { render, screen, fireEvent } from "@testing-library/react";

// PromoBanner 来自 HomePageClient —— mock 掉避免把首页整棵重依赖树拉进来。
jest.mock("../components/home/HomePageClient", () => ({
  PromoBanner: () => <div data-testid="promo" />,
}));

import { RealExamSectionContent, REAL_EXAM_TASKS } from "../components/home/RealExamSectionContent";
import {
  getRealBSQuestions,
  getRealDiscussionPrompts,
  getRealEmailPrompts,
} from "../lib/realBank";
// 首页卡片的阅读题量只许经过这份计数文件（几十字节），不许经过 lib/realBank —— 见下面
// 「首页不许 import lib/realBank」那条。counts.json 与真实题量是否一致由
// __tests__/real-bank-reading-data.test.js 守（那边本来就 import lib/realBank）。
import READING_COUNTS from "../data/realBank/reading/counts.json";
import { SectionContent } from "../components/home/SectionContent";
import { SECTIONS, SECTION_ACCENTS, SECTION_STATUS } from "../components/home/sections";

const fs = require("fs");
const path = require("path");

const baseProps = {
  isChallenge: false,
  isPractice: false,
  mode: "standard",
  switchMode: () => {},
  fadeIn: () => ({}),
  hoverKey: "",
  setHoverKey: () => {},
  showLoginModal: jest.fn(),
};

describe("真题专区 section：注册表", () => {
  test("SECTIONS 里有 real-bank，且状态 active、带短标签（移动端 6 tab 横排不溢出）", () => {
    const sec = SECTIONS.find((s) => s.id === "real-bank");
    expect(sec).toBeTruthy();
    expect(sec.status).toBe(SECTION_STATUS.ACTIVE);
    expect(sec.label).toBe("真题专区");
    expect(sec.labelZh).toBe("真题专区");
    expect(sec.shortLabel.length).toBeLessThanOrEqual(6);
  });

  test("SECTION_ACCENTS 有同 key 配色，且与其它 section 不同色", () => {
    const accent = SECTION_ACCENTS["real-bank"];
    expect(accent).toEqual({ color: "#B45309", soft: "#FFF7ED" });
    const colors = Object.values(SECTION_ACCENTS).map((a) => a.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  test("每个 active section 都有配色（新增 section 忘配色会崩 NavSidebar）", () => {
    SECTIONS.forEach((s) => expect(SECTION_ACCENTS[s.id]).toBeTruthy());
  });
});

describe("真题专区 section：Pro 门禁", () => {
  test("非 Pro：显示锁定横幅 + 升级按钮，任务网格置灰禁点", () => {
    const { container } = render(
      <RealExamSectionContent {...baseProps} userTier="free" isLoggedIn={true} />
    );
    expect(screen.getByText("Pro 专属功能")).toBeTruthy();
    expect(screen.getByRole("button", { name: /升级 Pro/ })).toBeTruthy();

    const grid = container.querySelector(".home-grid");
    expect(grid.style.pointerEvents).toBe("none");
    expect(grid.style.opacity).toBe("0.45");
  });

  test("非 Pro 且未登录：按钮是「登录」并调 showLoginModal", () => {
    const showLoginModal = jest.fn();
    render(
      <RealExamSectionContent {...baseProps} showLoginModal={showLoginModal} userTier="free" isLoggedIn={false} />
    );
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(showLoginModal).toHaveBeenCalled();
  });

  test("非 Pro 已登录：点「升级 Pro」dispatch 全局 open-upgrade-modal（HomePageClient 上有唯一监听者）", () => {
    const seen = jest.fn();
    window.addEventListener("open-upgrade-modal", seen);
    render(<RealExamSectionContent {...baseProps} userTier="free" isLoggedIn={true} />);
    fireEvent.click(screen.getByRole("button", { name: /升级 Pro/ }));
    expect(seen).toHaveBeenCalled();
    window.removeEventListener("open-upgrade-modal", seen);
  });

  test.each([["pro"], ["legacy"]])("tier=%s：解锁写作 3 + 阅读 3 共六张真题卡，无锁定横幅", (tier) => {
    const { container } = render(
      <RealExamSectionContent {...baseProps} userTier={tier} isLoggedIn={true} />
    );
    expect(screen.queryByText("Pro 专属功能")).toBeNull();

    const grid = container.querySelector(".home-grid");
    expect(grid.style.pointerEvents).toBe("auto");

    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining([
      "/real-bank?type=discussion&mode=standard",
      "/real-bank?type=email&mode=standard",
      "/real-bank?type=bs&mode=standard",
      "/real-bank?type=ctw&mode=standard",
      "/real-bank?type=rdl&mode=standard",
      "/real-bank?type=ap&mode=standard",
    ]));
  });

  test("阅读三张卡的标题文案齐全（ctw / rdl / ap 各一张）", () => {
    render(<RealExamSectionContent {...baseProps} userTier="pro" isLoggedIn={true} />);
    expect(screen.getByText("阅读填词真题")).toBeTruthy();
    expect(screen.getByText("日常阅读真题")).toBeTruthy();
    expect(screen.getByText("学术阅读真题")).toBeTruthy();
  });

  // 写作三题型是冻结语料 → 题量写死，靠这道交叉校验兜住。
  test("写作卡写死的题量与数据源实际题量一致", () => {
    const byKey = Object.fromEntries(REAL_EXAM_TASKS.map((t) => [t.k, t]));
    expect(byKey["real-discussion"].it).toBe(`${getRealDiscussionPrompts().length} 题`);
    expect(byKey["real-email"].it).toBe(`${getRealEmailPrompts().length} 题`);
    expect(byKey["real-bs"].it).toBe(`${getRealBSQuestions().length} 题 · 2 套`);
  });

  // 阅读是 build_bank 的构建产物（54 套卷会持续入库），题量不许写死 —— 但也不许为了「现算」
  // 去 import lib/realBank（见下方 bundle 体积那条），只能读 counts.json。
  test("阅读卡的题量取自 counts.json（不是写死字符串）", () => {
    const byKey = Object.fromEntries(REAL_EXAM_TASKS.map((t) => [t.k, t]));
    expect(byKey["real-ctw"].it).toBe(`${READING_COUNTS.ctw} 篇`);
    expect(byKey["real-rdl"].it).toBe(`${READING_COUNTS.rdl} 篇`);
    expect(byKey["real-ap"].it).toBe(`${READING_COUNTS.ap} 篇`);
  });

  test("阅读三张卡渲染出来的数字 = counts.json 里的数字", () => {
    const { container } = render(
      <RealExamSectionContent {...baseProps} userTier="pro" isLoggedIn={true} />
    );
    // 按 href 逐卡取，而不是 getByText —— 三个数字可能相同（例如库还没回填时全是 0），
    // getByText 会因为「找到多个」直接报错。
    [["ctw", READING_COUNTS.ctw], ["rdl", READING_COUNTS.rdl], ["ap", READING_COUNTS.ap]].forEach(([type, n]) => {
      const card = container.querySelector(`a[href="/real-bank?type=${type}&mode=standard"]`);
      expect(card).toBeTruthy();
      expect(card.textContent).toContain(`${n} 篇`);
    });
  });

  // 体积回归门：首页 `/` 的 First Load JS 曾因为这两个组件 import lib/realBank
  // （连带 238 KB 写作真题 JSON + 阅读三个题库）从 255 kB 涨到 318 kB。
  // 题量改走 data/realBank/reading/counts.json（几十字节）后必须一直保持不 import。
  test.each([
    ["components/home/RealExamSectionContent.js"],
    ["components/home/MobileHomePage.js"],
  ])("%s 不 import lib/realBank（否则整个真题库被打进首页 bundle）", (rel) => {
    const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    // 只看 import/require 语句，注释里提到 lib/realBank 是允许的（那正是解释「为什么不 import」的地方）。
    const importsRealBank = /^\s*(?:import\s[^\n]*?from\s*|const\s[^\n]*?=\s*require\s*\()\s*["'][^"']*lib\/realBank["']/m.test(src);
    expect(importsRealBank).toBe(false);
    expect(src).toContain("data/realBank/reading/counts.json");
  });

  test("题量与来源分档文案诚实（参考版不冒充官方）", () => {
    render(<RealExamSectionContent {...baseProps} userTier="pro" isLoggedIn={true} />);
    // 用 getAllByText：题库长大后不同题型的徽章会撞到同一个数字（第二波之后
    // 写作造句和听力 LCR 都是 125 题），getByText 会因为「找到多个」直接报错 ——
    // 这条断言要的是「徽章在、数字对」，不是「全页面只有一个 125」。
    expect(screen.getAllByText("125 题").length).toBeGreaterThan(0);
    expect(screen.getByText("13 题")).toBeTruthy();
    expect(screen.getByText("20 题 · 2 套")).toBeTruthy();
    expect(screen.getByText(/参考版：早期收集，来源未核验/)).toBeTruthy();
  });
});

describe("真题专区 section：三档模式（与常规练习同一限时口径）", () => {
  const pro = { ...baseProps, userTier: "pro", isLoggedIn: true };

  test("头部有三个档位 pill，点一下调 switchMode", () => {
    const switchMode = jest.fn();
    render(<RealExamSectionContent {...pro} switchMode={switchMode} />);
    ["Standard", "Practice", "Challenge"].forEach((label) => {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Challenge" }));
    expect(switchMode).toHaveBeenCalledWith("challenge");
  });

  test("standard 档：讨论卡显示 10 min（不再写死「不限时」）", () => {
    const { container } = render(<RealExamSectionContent {...pro} />);
    const card = container.querySelector('a[href="/real-bank?type=discussion&mode=standard"]');
    expect(card.textContent).toContain("10 min");
    expect(card.textContent).not.toContain("不限时");
  });

  test("challenge 档：href 带 mode=challenge，讨论卡 8m 30s（标准 10 min 划线对比）", () => {
    const { container } = render(
      <RealExamSectionContent {...pro} isChallenge mode="challenge" />
    );
    const card = container.querySelector('a[href="/real-bank?type=discussion&mode=challenge"]');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("8m 30s");
    expect(card.textContent).toContain("10 min");
  });

  test("practice 档：href 带 mode=practice，卡片全是「不限时」", () => {
    const { container } = render(
      <RealExamSectionContent {...pro} isPractice mode="practice" />
    );
    const card = container.querySelector('a[href="/real-bank?type=ctw&mode=practice"]');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("不限时");
  });

  test("听力 lcr 卡标每题答题窗口（真题是单题，标整段 5 min 会骗人）", () => {
    const { container } = render(<RealExamSectionContent {...pro} />);
    const card = container.querySelector('a[href="/real-bank?type=lcr&mode=standard"]');
    expect(card.textContent).toContain("20s/题");
  });

  test("移动端真题区也接了三档切换 + href 带 mode", () => {
    const src = fs.readFileSync(path.join(__dirname, "../components/home/MobileHomePage.js"), "utf8");
    const block = src.slice(src.indexOf("function MobileRealExamSection"));
    const body = block.slice(0, block.indexOf("/* ── Mobile Listening"));
    expect(body).toContain("withChallenge");
    expect(body).toContain("&mode=${modeStr}");
    expect(body).toContain("getRealBankTimeLabels");
  });
});

describe("真题专区 section：SectionContent 路由分支", () => {
  const sectionProps = {
    ...baseProps,
    isPractice: false,
    mode: "standard",
    switchMode: () => {},
    gridItems: [],
    postWritingCounts: { today: 0, notebook: 0, total: 0 },
    bsMistakeCount: 0,
    readingMistakeCount: 0,
    listeningMistakeCount: 0,
    sessions: [],
    userTier: "pro",
    isLoggedIn: true,
    userCode: "REAL01",
  };

  test("activeSection=real-bank 渲染真题专区，而不是掉进 Writing 默认分支", () => {
    render(<SectionContent {...sectionProps} activeSection="real-bank" />);
    expect(screen.getByText("Real Questions")).toBeTruthy();
    // Writing 默认分支的标志性文案不应出现。
    expect(screen.queryByText("拼句错题本")).toBeNull();
  });

  test("HomePageClient 的 section 白名单收了 real-bank（深链不被兜回 writing）", () => {
    // 白名单是组件内部的字面量数组，直接读源文件断言 —— 比跑整个首页更稳，且能钉死漏改。
    const src = fs.readFileSync(path.join(__dirname, "../components/home/HomePageClient.js"), "utf8");
    const whitelist = src.match(/\["writing",[^\]]*\]/);
    expect(whitelist).toBeTruthy();
    expect(whitelist[0]).toContain('"real-bank"');
  });

  test("MobileHomePage 有 real-bank 分支（移动端与桌面端是两条独立渲染链）", () => {
    const src = fs.readFileSync(path.join(__dirname, "../components/home/MobileHomePage.js"), "utf8");
    expect(src).toContain('activeSection === "real-bank"');
    expect(src).toContain("MobileRealExamSection");
    // 移动端 tab 必须用 shortLabel 兜底，否则 "Real Questions" 会把 6 等分横排挤爆。
    expect(src).toContain("sec.shortLabel || sec.label");
  });

  // 移动端的任务卡是另一份硬编码数组，桌面加了卡而移动端忘加 = 手机用户压根看不到阅读真题。
  test("MobileRealExamSection 的任务列表与桌面同步（六个 type 都在）", () => {
    const src = fs.readFileSync(path.join(__dirname, "../components/home/MobileHomePage.js"), "utf8");
    const block = src.slice(src.indexOf("function MobileRealExamSection"));
    const tasks = block.slice(0, block.indexOf("return ("));
    ["discussion", "email", "bs", "ctw", "rdl", "ap"].forEach((t) => {
      expect(tasks).toContain(`type: "${t}"`);
    });
    // 阅读题量读 counts.json，不许写死、也不许回退成 import lib/realBank。
    expect(tasks).toContain("REAL_READING_COUNTS.ctw");
    expect(tasks).toContain("REAL_READING_COUNTS.rdl");
    expect(tasks).toContain("REAL_READING_COUNTS.ap");
  });

  test("sections.js 的真题专区描述提到了阅读（不然导航里像是只有写作）", () => {
    const sec = SECTIONS.find((s) => s.id === "real-bank");
    expect(sec.descriptionZh).toContain("阅读");
    expect(sec.description).toContain("Reading");
  });
});
