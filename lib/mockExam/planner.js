import { TASK_IDS } from "./contracts";
import { getTaskTimeSeconds, PRACTICE_MODE } from "../practiceMode";

export function getDefaultMockExamBlueprint(mode = PRACTICE_MODE.STANDARD) {
  return [
    {
      taskId: TASK_IDS.BUILD_SENTENCE,
      title: "Task 1 - Build a Sentence",
      seconds: getTaskTimeSeconds("build", mode),
      weight: 0.34,
    },
    {
      taskId: TASK_IDS.EMAIL_WRITING,
      title: "Task 2 - Write an Email",
      seconds: getTaskTimeSeconds("email", mode),
      weight: 0.33,
    },
    {
      taskId: TASK_IDS.ACADEMIC_WRITING,
      title: "Task 3 - Academic Discussion",
      seconds: getTaskTimeSeconds("discussion", mode),
      weight: 0.33,
    },
  ];
}
