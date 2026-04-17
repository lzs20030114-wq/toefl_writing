/**
 * Single source of truth describing every content bank the admin can view.
 *
 * Each entry tells the admin UI + API:
 *   - how to read the bank from disk
 *   - where its staging directory lives (for AI-generated review queue)
 *   - which field to use as the list preview
 *   - whether the generation workflow is hooked up
 *
 * Banks with `hasGeneration: true` have a generate workflow in GitHub Actions
 * and can be reviewed + deployed via /api/admin/staging/[runId].
 * Banks with `hasGeneration: false` are browse-only in the admin UI today;
 * staging files (if any) are still listed for inspection.
 */

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
        stagingDir: "data/academicWriting/staging",
        previewField: "professor",
        idField: "id",
        hasGeneration: true,
      },
      {
        key: "email",
        label: "邮件写作 (Email)",
        bankPath: "data/emailWriting/prompts.json",
        shape: "array",
        stagingDir: "data/emailWriting/staging",
        previewField: "email",
        idField: "id",
        hasGeneration: true,
      },
      {
        key: "bs",
        label: "连词成句 (Build Sentence)",
        bankPath: "data/buildSentence/questions.json",
        shape: "bsSets", // { question_sets: [{ set_id, questions: [...] }] }
        stagingDir: "data/buildSentence/staging",
        previewField: "prompt",
        idField: "id",
        hasGeneration: true,
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
        stagingDir: "data/listening/staging",
        stagingPrefix: "la-",
        previewField: "situation",
        idField: "id",
        hasGeneration: false,
      },
      {
        key: "lc",
        label: "对话 (Conversation)",
        bankPath: "data/listening/bank/lc.json",
        shape: "itemsWrapper",
        stagingDir: "data/listening/staging",
        stagingPrefix: "lc-",
        previewField: "situation",
        idField: "id",
        hasGeneration: false,
      },
      {
        key: "lat",
        label: "学术讲座 (Lecture)",
        bankPath: "data/listening/bank/lat.json",
        shape: "itemsWrapper",
        stagingDir: "data/listening/staging",
        stagingPrefix: "lat-",
        previewField: "subtopic",
        idField: "id",
        hasGeneration: false,
      },
      {
        key: "lcr",
        label: "应答选择 (Choose Response)",
        bankPath: "data/listening/bank/lcr.json",
        shape: "itemsWrapper",
        stagingDir: "data/listening/staging",
        stagingPrefix: "lcr-",
        previewField: "situation",
        idField: "id",
        hasGeneration: false,
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
        stagingDir: "data/reading/staging",
        stagingPrefix: "ap-",
        previewField: "topic",
        idField: "id",
        hasGeneration: false,
      },
      {
        key: "ctw",
        label: "完形填空 (Complete the Words)",
        bankPath: "data/reading/bank/ctw.json",
        shape: "itemsWrapper",
        stagingDir: "data/reading/staging",
        stagingPrefix: "ctw-",
        previewField: "topic",
        idField: "id",
        hasGeneration: false,
      },
      {
        key: "rdl",
        label: "日常阅读 (Read in Daily Life)",
        bankPath: "data/reading/bank/rdl.json",
        shape: "itemsWrapper",
        stagingDir: "data/reading/staging",
        stagingPrefix: "rdl-",
        previewField: "genre",
        idField: "id",
        hasGeneration: false,
      },
      {
        key: "rdl-long",
        label: "日常阅读 - 长篇",
        bankPath: "data/reading/bank/rdl-long.json",
        shape: "itemsWrapper",
        stagingDir: "data/reading/staging",
        stagingPrefix: "rdl-long-",
        previewField: "genre",
        idField: "id",
        hasGeneration: false,
      },
      {
        key: "rdl-short",
        label: "日常阅读 - 短篇",
        bankPath: "data/reading/bank/rdl-short.json",
        shape: "itemsWrapper",
        stagingDir: "data/reading/staging",
        stagingPrefix: "rdl-short-",
        previewField: "genre",
        idField: "id",
        hasGeneration: false,
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
        stagingDir: "data/speaking/staging",
        stagingPrefix: "intv-",
        previewField: "topic",
        idField: "id",
        hasGeneration: false,
      },
      {
        key: "repeat",
        label: "跟读 (Repeat)",
        bankPath: "data/speaking/bank/repeat.json",
        shape: "itemsWrapper",
        stagingDir: "data/speaking/staging",
        stagingPrefix: "rpt-",
        previewField: "scenario",
        idField: "id",
        hasGeneration: false,
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
