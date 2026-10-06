/** 正式题库只读总览的注册表：路径、数据结构与列表预览字段。 */

const CONTENT_GROUPS = [
  {
    key: "writing",
    label: "写作",
    items: [
      {
        key: "disc",
        label: "学术讨论 (Discussion)",
        bankPath: "data/academicWriting/prompts.json",
        shape: "array",
        previewField: "professor",
        idField: "id",
      },
      {
        key: "email",
        label: "邮件写作 (Email)",
        bankPath: "data/emailWriting/prompts.json",
        shape: "array",
        previewField: "email",
        idField: "id",
      },
      {
        key: "bs",
        label: "连词成句 (Build Sentence)",
        bankPath: "data/buildSentence/questions.json",
        shape: "bsSets", // { question_sets: [{ set_id, questions: [...] }] }
        previewField: "prompt",
        idField: "id",
      },
    ],
  },
  {
    key: "listening",
    label: "听力",
    items: [
      {
        key: "la",
        label: "校园广播 (Announcement)",
        bankPath: "data/listening/bank/la.json",
        shape: "itemsWrapper",
        previewField: "situation",
        idField: "id",
      },
      {
        key: "lc",
        label: "对话 (Conversation)",
        bankPath: "data/listening/bank/lc.json",
        shape: "itemsWrapper",
        previewField: "situation",
        idField: "id",
      },
      {
        key: "lat",
        label: "学术讲座 (Lecture)",
        bankPath: "data/listening/bank/lat.json",
        shape: "itemsWrapper",
        previewField: "subtopic",
        idField: "id",
      },
      {
        key: "lcr",
        label: "应答选择 (Choose Response)",
        bankPath: "data/listening/bank/lcr.json",
        shape: "itemsWrapper",
        previewField: "situation",
        idField: "id",
      },
    ],
  },
  {
    key: "reading",
    label: "阅读",
    items: [
      {
        key: "ap",
        label: "学术文章 (Academic Passage)",
        bankPath: "data/reading/bank/ap.json",
        shape: "itemsWrapper",
        previewField: "topic",
        idField: "id",
      },
      {
        key: "ctw",
        label: "完形填空 (Complete the Words)",
        bankPath: "data/reading/bank/ctw.json",
        shape: "itemsWrapper",
        previewField: "topic",
        idField: "id",
      },
      {
        key: "rdl",
        label: "日常阅读 (Read in Daily Life)",
        bankPath: "data/reading/bank/rdl.json",
        shape: "itemsWrapper",
        previewField: "genre",
        idField: "id",
      },
      {
        key: "rdl-long",
        label: "日常阅读 - 长篇",
        bankPath: "data/reading/bank/rdl-long.json",
        shape: "itemsWrapper",
        previewField: "genre",
        idField: "id",
      },
      {
        key: "rdl-short",
        label: "日常阅读 - 短篇",
        bankPath: "data/reading/bank/rdl-short.json",
        shape: "itemsWrapper",
        previewField: "genre",
        idField: "id",
      },
    ],
  },
  {
    key: "speaking",
    label: "口语",
    items: [
      {
        key: "interview",
        label: "访谈 (Interview)",
        bankPath: "data/speaking/bank/interview.json",
        shape: "itemsWrapper",
        previewField: "topic",
        idField: "id",
      },
      {
        key: "repeat",
        label: "跟读 (Repeat)",
        bankPath: "data/speaking/bank/repeat.json",
        shape: "itemsWrapper",
        previewField: "scenario",
        idField: "id",
      },
    ],
  },
];

// Flatten for easy lookup by key.
const CONTENT_BY_KEY = {};
for (const group of CONTENT_GROUPS) {
  for (const item of group.items) {
    CONTENT_BY_KEY[item.key] = { ...item, group: group.key, groupLabel: group.label };
  }
}

function listContentKeys() {
  return Object.keys(CONTENT_BY_KEY);
}

function getContentMeta(key) {
  return CONTENT_BY_KEY[key] || null;
}

module.exports = {
  CONTENT_GROUPS,
  CONTENT_BY_KEY,
  listContentKeys,
  getContentMeta,
};
