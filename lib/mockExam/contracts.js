export const MOCK_EXAM_STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  COMPLETED: "completed",
  ABORTED: "aborted",
};

export const TASK_STATUS = {
  PENDING: "pending",
  STARTED: "started",
  SUBMITTED: "submitted",
};

export const TASK_IDS = {
  BUILD_SENTENCE: "build-sentence",
  EMAIL_WRITING: "email-writing",
  ACADEMIC_WRITING: "academic-writing",
};

export const DEFAULT_TASK_MAX_SCORES = {
  [TASK_IDS.BUILD_SENTENCE]: 10,
  [TASK_IDS.EMAIL_WRITING]: 5,
  [TASK_IDS.ACADEMIC_WRITING]: 5,
};
