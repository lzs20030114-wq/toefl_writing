/**
 * Shared config for the multi-task question generation system.
 * Used by API routes, deploy routes, and the admin page.
 */
const TASK_CONFIG = {
  bs: {
    workflowFile: "generate-bs.yml",
    stagingDir: "data/buildSentence/staging",
    bankPath: "data/buildSentence/questions.json",
    inputKey: "target_sets",
    defaultVal: 6,
    maxVal: 20,
    label: "连词成句",
  },
  disc: {
    workflowFile: "generate-disc.yml",
    stagingDir: "data/academicWriting/staging",
    bankPath: "data/academicWriting/prompts.json",
    inputKey: "target_count",
    defaultVal: 10,
    maxVal: 50,
    label: "学术讨论",
  },
  email: {
    workflowFile: "generate-email.yml",
    stagingDir: "data/emailWriting/staging",
    bankPath: "data/emailWriting/prompts.json",
    inputKey: "target_count",
    defaultVal: 10,
    maxVal: 50,
    label: "邮件写作",
  },
};

module.exports = { TASK_CONFIG };
