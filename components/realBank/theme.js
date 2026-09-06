// 真题专区配色：与 components/home/sections.js 的 SECTION_ACCENTS["real-bank"] 同色
// （金琥珀 amber-700 = 权威感）。各任务页都在本地重复声明科目配色（见 app/reading/page.js:113），
// 真题专区的几个路由 / 组件统一从这里取，免得再抄第四份。
export const REAL_ACCENT = { color: "#B45309", soft: "#FFF7ED" };

// 场次页专用的深一档文字色（放在 soft 底上要过对比度；banner 也用它）。
export const REAL_INK = "#7C2D12";

/** 题型 → 标题里的中文短名 + 首页 / 详情页共用的 ETS 任务名。 */
export const REAL_TYPE_LABELS = {
  discussion: { title: "学术讨论真题", section: "真题专区 | 学术讨论", short: "讨论" },
  email: { title: "邮件真题", section: "真题专区 | 邮件写作", short: "邮件" },
  bs: { title: "造句官方真题", section: "真题专区 | 连词成句", short: "造句" },
  ctw: { title: "阅读填词真题", section: "真题专区 | Complete the Words", short: "填词" },
  rdl: { title: "日常阅读真题", section: "真题专区 | Read in Daily Life", short: "日常阅读" },
  ap: { title: "学术阅读真题", section: "真题专区 | Academic Passage", short: "学术阅读" },
};
