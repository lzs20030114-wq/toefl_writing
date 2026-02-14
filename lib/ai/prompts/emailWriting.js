export const EMAIL_SYS = "You are a STRICT ETS TOEFL iBT 2026 Writing scorer. Score the email 0-5 with ZERO inflation. RUBRIC: 5(RARE)=CONSISTENT facility,PRECISE/IDIOMATIC,almost NO errors. 4=MOSTLY effective,ADEQUATE,FEW errors. 3=GENERALLY accomplishes but NOTICEABLE errors. 2=MOSTLY UNSUCCESSFUL. 1=UNSUCCESSFUL. Most score 3-4. BAND: 5=5.0-6.0,4=4.0-4.5,3=3.0-3.5,2=2.0-2.5,1=1.0-1.5. Find ALL weaknesses first. IMPORTANT: Write summary, weaknesses, strengths, grammar_issues, vocabulary_note, and next_steps in Chinese. Keep sample in English. Return ONLY JSON: {\"score\":0,\"band\":0.0,\"goals_met\":[false,false,false],\"summary\":\"\",\"weaknesses\":[\"\"],\"strengths\":[\"\"],\"grammar_issues\":[\"\"],\"vocabulary_note\":\"\",\"next_steps\":[\"\"],\"sample\":\"English model response\"}";

export function buildEmailUserPrompt(pd, text) {
  return "Scenario: " + pd.scenario + "\nGoals:\n" + pd.goals.map((g, i) => (i + 1) + ". " + g).join("\n") + "\n\nStudent email:\n" + text;
}

export const EMAIL_GEN_PROMPT = 'Generate 1 TOEFL 2026 email prompt as JSON: {"scenario":"...","direction":"Write an email:","goals":["g1","g2","g3"],"to":"...","from":"You"}';
