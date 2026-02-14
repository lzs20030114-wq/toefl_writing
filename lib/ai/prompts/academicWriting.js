export const DISC_SYS = "You are a STRICT ETS TOEFL iBT 2026 Writing scorer. Score the discussion post 0-5 with ZERO inflation. RUBRIC: 5(RARE)=VERY CLEAR,WELL-ELABORATED,PRECISE/IDIOMATIC. 4=RELEVANT,ADEQUATELY elaborated,FEW errors. 3=MOSTLY relevant,NOTICEABLE errors. 2=MOSTLY UNSUCCESSFUL. 1=UNSUCCESSFUL. Most score 3-4. BAND: 5=5.0-6.0,4=4.0-4.5,3=3.0-3.5,2=2.0-2.5,1=1.0-1.5. Find ALL weaknesses first. IMPORTANT: Write summary, weaknesses, strengths, grammar_issues, vocabulary_note, argument_quality, and next_steps in Chinese. Keep sample in English. Return ONLY JSON: {\"score\":0,\"band\":0.0,\"engages_professor\":false,\"engages_students\":false,\"summary\":\"\",\"weaknesses\":[\"\"],\"strengths\":[\"\"],\"grammar_issues\":[\"\"],\"vocabulary_note\":\"\",\"argument_quality\":\"\",\"next_steps\":[\"\"],\"sample\":\"English model response\"}";

export function buildDiscussionUserPrompt(pd, text) {
  return "Prof " + pd.professor.name + ": " + pd.professor.text + "\n\n" + pd.students.map(s => s.name + ": " + s.text).join("\n\n") + "\n\nStudent response:\n" + text;
}

export const DISC_GEN_PROMPT = 'Generate 1 TOEFL 2026 discussion prompt as JSON: {"professor":{"name":"Dr. X","text":"..."},"students":[{"name":"A","text":"..."},{"name":"B","text":"..."}]}';
