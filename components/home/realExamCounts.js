/**
 * 首页真题专区「写作三题型」的题量 —— 桌面（RealExamSectionContent）与移动端
 * （MobileHomePage）两条渲染链共用的单一来源。两边各写各的字符串迟早会对不上：
 * 第二波真题入库时桌面改了、移动端没改，手机用户看到的就是过期数字。
 *
 * 为什么不直接从 lib/realBank 现算：那会把整个写作真题库（350 KB+ JSON）连同阅读
 * 三个题库一起打进首页 bundle（实测 `/` 的 First Load JS 255 kB → 318 kB），
 * __tests__/real-bank-section.component.test.js 有一道源码级回归门盯着这两个文件
 * 「不许 import lib/realBank」。阅读 / 听力 / 口语的题量随 build_bank 产物变，读各自
 * 几十字节的 counts.json；写作三题型是冻结语料，数字写在这里，靠同一份测试的交叉校验
 * 兜住（题库长了而这里没跟着改 → 测试直接红）。
 */
export const REAL_WRITING_COUNTS = {
  /** 学术讨论：getRealDiscussionPrompts().length */
  discussion: 132,
  /** 邮件：getRealEmailPrompts().length */
  email: 27,
  /** 造句题数：getRealBSQuestions().length */
  bs: 106,
  /** 造句卷数（一卷一张批次卡）：getRealBSBatches().length */
  bsSets: 12,
};
