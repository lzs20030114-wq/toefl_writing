/**
 * Section registry — the single source of truth for app sections.
 * To add a new section (e.g. Reading), change its status to "active"
 * and wire up its tasks in SectionContent.js.
 */

export const SECTION_STATUS = {
  ACTIVE: "active",
  COMING_SOON: "coming_soon",
};

export const SECTIONS = [
  {
    id: "writing",
    label: "Writing",
    labelZh: "写作",
    icon: "✍",
    status: SECTION_STATUS.ACTIVE,
    description: "Build a Sentence · Email · Academic Discussion · Mock Exam",
    descriptionZh: "拖拽造句、邮件写作、学术讨论，支持 AI 评分",
  },
  {
    id: "reading",
    label: "Reading",
    labelZh: "阅读",
    icon: "📖",
    status: SECTION_STATUS.ACTIVE,
    description: "Complete the Words · Read in Daily Life",
    descriptionZh: "单词补全、日常阅读理解，TOEFL 2026 新题型（测试中）",
  },
  {
    id: "listening",
    label: "Listening",
    labelZh: "听力",
    icon: "🎧",
    status: SECTION_STATUS.ACTIVE,
    description: "Choose a Response · Announcement · Conversation · Academic Talk",
    descriptionZh: "选择回应、听公告、听对话、学术讲座，TOEFL 2026 新题型",
  },
  {
    id: "speaking",
    label: "Speaking",
    labelZh: "口语",
    icon: "🗣",
    status: SECTION_STATUS.ACTIVE,
    description: "Listen & Repeat · Take an Interview",
    descriptionZh: "听后复述、模拟面试，TOEFL 2026 新题型",
  },
  {
    id: "real-bank",
    label: "Real Questions",
    // 移动端 tab 是 6 等分横排（11.5px 字号，320px 屏也不能溢出），完整 label 会被挤爆，
    // 所以移动端读 shortLabel（见 MobileHomePage 的 tab 渲染）。
    shortLabel: "Real",
    labelZh: "真题专区",
    icon: "📜",
    status: SECTION_STATUS.ACTIVE,
    description: "Public real questions — Writing (Discussion · Email · Build a Sentence) + Reading",
    // 阅读题量随 build_bank 产物持续变化，这里只说题型不写数字（写死会过期）。
    descriptionZh: "公开真题集中练：写作（讨论 125 / 邮件 13 / 造句 20）+ 阅读填词、日常阅读、学术阅读",
  },
  {
    id: "my-bank",
    label: "My Bank",
    labelZh: "我的题库",
    icon: "📥",
    status: SECTION_STATUS.ACTIVE,
    description: "Import your own Discussion & Email prompts",
    descriptionZh: "导入你自己的学术讨论 / 邮件题，粘贴文本或上传截图识别",
  },
];

export const SECTION_ACCENTS = {
  writing: { color: "#0D9668", soft: "#ECFDF5" },
  reading: { color: "#3B82F6", soft: "#EFF6FF" },
  listening: { color: "#8B5CF6", soft: "#F5F3FF" },
  speaking: { color: "#F59E0B", soft: "#FFFBEB" },
  // 金琥珀（amber-700）= 真题的权威感。与 speaking 的 amber-500 同色系但明度差一大截，
  // 且导航里同一时刻只有 active 项显色（侧栏 3px accent bar / 移动端 tab 文字），不会并排撞色。
  "real-bank": { color: "#B45309", soft: "#FFF7ED" },
  "my-bank": { color: "#E11D48", soft: "#FFF1F2" },
};

export const TOOLS = [
  { id: "mistake-notebook", label: "拼句错题本", icon: "✗", href: "/mistake-notebook" },
  { id: "post-writing-practice", label: "拼写填空", icon: "Aa", href: "/post-writing-practice" },
  { id: "progress", label: "练习记录", icon: "📈", href: "/progress" },
];
