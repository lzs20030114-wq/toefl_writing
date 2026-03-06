# AI Prompt Refinement Task (from Gemini Architect)

## Context
Current TOEFL "Build a Sentence" generation prompts rely too heavily on `did/do/does` distractors and lack sufficient variety in morphological/semantic traps found in real TPO sets.

## Required Changes

### 1. File: `lib/ai/prompts/buildSentence.js`
- **Expand Distractor Variety:** Update the `Hard requirements` or `Given word (prefilled) rules` section to explicitly demand a mix of distractor types:
  - 50% extra auxiliary (did/do/does).
  - 30% morphological variants (e.g., `choosing` vs `choose`, `went` vs `go`).
  - 20% semantic/functional distractors (e.g., `no` vs `not`, `which` vs `what`).
- **Clarify Chunk Boundaries:** Add a rule: "Avoid isolation of prepositions that could create ambiguous attachment points."

### 2. File: `scripts/generateBSQuestions.mjs`
- **Update `buildGeneratePrompt` Function:**
  - Locate the `Distractor strategies` section.
  - **Change:** Increase the priority of "Tense/form variant" and "Similar function word".
  - **Add:** A specific constraint for `Hard` mode: "Must include at least one morphological distractor that matches the sentence's context but violates tense/aspect rules."
- **Refine `Contact Clause` generation:**
  - Strengthen the instructions for "Relative/contact clause" to ensure the AI creates sentences where the relative pronoun is naturally omitted (e.g., "The book [that] I read").

### 3. General Prompting Hygiene
- **Register/Power Dynamics:** For `emailWriting.js`, add a requirement to specify the "Power Relationship" (Student-to-Professor vs Admin-to-Student) to ensure correct tone scoring.

## Execution Goal
Apply these surgical updates to the prompt strings to increase the "TPO Similarity" score and decrease the pattern-recognition bypass (where students just look for 'did').
