import { TASK_IDS } from "./contracts";

export function getDefaultMockExamBlueprint() {
  return [
    {
      taskId: TASK_IDS.BUILD_SENTENCE,
      title: "Task 1 - Build a Sentence",
      seconds: 410,
      weight: 0.34,
    },
    {
      taskId: TASK_IDS.EMAIL_WRITING,
      title: "Task 2 - Write an Email",
      seconds: 420,
      weight: 0.33,
    },
    {
      taskId: TASK_IDS.ACADEMIC_WRITING,
      title: "Task 3 - Academic Discussion",
      seconds: 600,
      weight: 0.33,
    },
  ];
}
