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
];

export const SECTION_ACCENTS = {
  writing: { color: "#0D9668", soft: "#ECFDF5" },
  reading: { color: "#3B82F6", soft: "#EFF6FF" },
  listening: { color: "#8B5CF6", soft: "#F5F3FF" },
  speaking: { color: "#F59E0B", soft: "#FFFBEB" },
};

export const TOOLS = [
  { id: "mistake-notebook", label: "拼句错题本", icon: "✗", href: "/mistake-notebook" },
  { id: "post-writing-practice", label: "拼写填空", icon: "Aa", href: "/post-writing-practice" },
  { id: "progress", label: "练习记录", icon: "📈", href: "/progress" },
];
