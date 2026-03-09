const fs = require('fs');
const content = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8');
const lines = content.split('\n');

const newHints = `// Type x difficulty specific instructions for targeted generation
const TYPE_DIFFICULTY_HINTS = {
  "negation": {
    easy: \`ALL answers in this group: simple negative statement, 7-10 words.
Structure: "I did not [verb]." / "I could not [verb]." / "I am not [adj]." / "I cannot [verb]."
Examples:
- "I did not have time to finish the report."
- "I could not find the reservation confirmation."
- "I am not going to sign for the package."
Prompt: YES/NO question ("Did you attend?", "Have you?", "Are you going?")
Distractor: "did" or "do" or morphological variant.
SCORER FENCE (easy): Only "did not" / "do not" / "cannot" / "could not" / "am not" / "is not". NO "have not been" (passive). NO "had not" (past perfect). NO comparative. NO relative clause. NO embedded wh-clause.\`,

    medium: \`ALL answers in this group: negative statement, 9-12 words, may include a short embedded element.
Examples:
- "I did not understand what the manager explained at the meeting."
- "I could not find out when the new schedule would be posted."
- "I have not received any confirmation about the workshop details."
Prompt: direct question or narrative context. Distractor: "did"/"do" or morphological variant.
SCORER FENCE (medium): Prefer simple past ("did not") or present perfect ("have not"). AVOID past perfect negation ("had not done" -> HARD). AVOID passive negation ("was not approved", "has not been sent" -> HARD). At most ONE advanced grammar feature.\`,

    hard: \`ALL answers in this group: negation + advanced grammar complexity, 10-13 words.
Examples:
- "I had not realized how quickly the project deadline was approaching."
- "I did not understand why the meeting had been postponed again."
Hard MUST come from structure: past perfect negation, passive/passive-progressive inside clause, or negation + embedded grammar trap.
Distractor: morphological variant (e.g. "realized/realize", "approaching/approach").\`,
  },

  "3rd-reporting": {
    easy: \`ALL answers in this group: short third-person reporting, 8-10 words.
Structure: "[Name] wanted to know if [short clause]." / "[Name] asked what time..."
Examples:
- "He wants to know if you need a ride."
- "She asked me what time the meeting starts."
- "They wanted to know if the library was open."
Prompt: "What did [Name] ask/want?" Distractor: "did" or "do".
SCORER FENCE (easy): Embedded clause uses simple present or simple past only. NO passive ("was approved"). NO past perfect ("had gone"). NO "whom". NO comparative.\`,

    medium: \`ALL answers in this group: third-person reporting, 10-13 words.
Structure: "[Name/They] [wanted to know / asked / was curious / needed to know] [wh/if clause]"
Vary subjects: he / she / they / the manager / the professor / some colleagues
Vary wh-words across the batch: if(3), what(2), where(2), why(2), when(1)
Declarative word order in clause (NO inversion). Distractor: "did"/"do" for most.
SCORER FENCE (medium): Embedded clause uses simple past or simple present ONLY. STRICTLY AVOID past perfect in embedded clause ("had been done", "had gone" -> HARD). STRICTLY AVOID passive voice in embedded clause ("whether it had been approved", "when it would be submitted" -> HARD). AVOID "whom". Maximum ONE advanced grammar feature.\`,

    hard: \`ALL answers in this group: third-person reporting with structurally complex embedded clause, 10-13 words.
Complexity options (MUST include at least one):
- Past perfect in clause: "He wanted to know where all the files had gone."
- Passive in clause: "She wanted to know when the report would be submitted."
- whom: "She wanted to know whom I would give the presentation to."
- Two-layer: "The manager wanted to know how we had been able to finish on time."
Hard MUST come from grammar complexity, not from padding the sentence.
Distractor: morphological variant or "whom/who", "where/when" function-word swap.\`,
  },

  "1st-embedded": {
    easy: \`ALL answers in this group: first-person embedded, 8-10 words, simple structure.
Structure: "I have no idea [wh-clause]." / "I am not sure [wh-clause]."
Examples:
- "I have no idea where they are going."
- "I am not sure what time the event starts."
- "I do not know if the store is open."
Prompt: direct question the speaker cannot answer.
Distractor: "do" or "did".
SCORER FENCE (easy): Embedded clause uses simple present only. NO passive. NO past perfect. NO comparative. NO "whom".\`,

    medium: \`ALL answers in this group: first-person embedded, 10-13 words.
Examples:
- "I do not understand why he decided to quit the team."
- "I found out where the new office supplies are kept."
- "I have no idea who will be leading the morning session."
- "I am not sure when the package is going to arrive."
Distractor: "did"/"does" or function-word variant.
SCORER FENCE (medium): Embedded clause uses simple past or simple present only. AVOID past perfect ("had done" -> HARD). AVOID passive voice in embedded clause ("has been approved", "is being processed" -> HARD). AVOID "whom". AVOID combining two advanced grammar features.\`,

    hard: \`ALL answers in this group: complex first-person embedded, 10-13 words.
Examples:
- "I would love to know which restaurant you enjoyed the most." (superlative)
- "I have not been told who will be responsible for the final report." (passive + embedded)
- "We just found out where the new library equipment is being stored." (passive progressive)
Include passive voice OR superlative/comparative OR perfect aspect in the embedded clause. Hard MUST be signaled by grammar structure rather than answer length.
Distractor: morphological variant (e.g. "enjoyed/enjoy", "stored/store").\`,
  },

  "interrogative": {
    easy: \`ALL answers in this group use a natural polite question frame, 8-11 words.
Allowed frames (vary across batch):
- "Can you tell me ..."
- "Could you tell me ..."
- "Do you know ..."
Core rule: embedded clause stays in declarative word order.
Examples:
- "Can you tell me what your plans are for tomorrow?"
- "Do you know if the professor covered any new material?"
Prompt: conversational comment that leads to a question.
Distractor: "did"/"do" or nearby auxiliary/modal variant.
SCORER FENCE (easy): Embedded clause uses simple present or simple past only. NO passive. NO past perfect. NO comparative.\`,

    medium: \`ALL answers in this group use a natural interrogative frame, 10-13 words, moderate embedded complexity.
Use 2-4 different polite frames across the batch. Core rule: embedded clause stays declarative.
Examples:
- "Could you tell me how you are feeling about the new policy?"
- "Can you remind me when the department meeting was rescheduled?"
- "Do you know what you did not enjoy about the presentation?"
Distractor: morphological variant or nearby auxiliary/modal variant.
SCORER FENCE (medium): AVOID past perfect in embedded clause ("had been done" -> HARD). AVOID passive in embedded clause ("has been approved" -> HARD). Simple past or present tense in embedded clause only.\`,

    hard: \`ALL answers in this group use a natural interrogative frame with complex embedded question, 10-13 words.
The question frame stays simple. Hardness comes from the embedded clause.
Examples:
- "Could you tell me how the project team managed to finish ahead of schedule?"
- "Do you know why the final report had not been submitted yet?"
Hard MUST come from embedded grammar: tense/aspect mismatch, passive/perfect inside clause, layered embedding.
Distractor: morphological variant (e.g. "decided/decide", "managed/manage").\`,
  },

  "direct": {
    medium: \`ALL answers in this group: direct declarative statement (no reporting verb, no negation), 9-12 words.
Describe a situation, location, preference, or fact.
Examples:
- "I found the work environment at this company to be much more relaxed."
- "The store next to the post office sells all types of winter apparel."
Prompt: direct question about what happened or what the speaker did.
Distractor: morphological variant (e.g. "relaxed/relax", "sells/sold").\`,

    hard: \`ALL answers in this group: complex direct statement, 10-13 words, with comparative or structurally dense modification.
Examples:
- "This coffee tastes better than all of the other brands I have tried."
- "I found it in the back of the furniture section at the local superstore."
Prefer comparative/superlative structures, dense modifiers, or other learner-unfamiliar grammar. Do not inflate difficulty by length alone.
Distractor: morphological variant or comparative swap ("better/good", "only/once").\`,
  },

  "relative": {
    medium: \`ALL answers in this group: contact/relative clause structure, 9-12 words.
"The [noun] [I/you] [verb]..." (contact clause - omitted relative pronoun)
Examples:
- "The bookstore I stopped by had the novel in stock."
- "The diner that opened last week serves many delicious entrees."
Prompt: question about where/what the speaker found.
Distractor: morphological variant (e.g. "stopped/stop", "opened/open").\`,

    hard: \`ALL answers in this group: relative/contact clause with additional complexity, 10-13 words.
Combine relative clause with passive or perfect:
- "The desk you ordered is scheduled to arrive on Friday."
- "The book she recommended had already been checked out."
Distractor: morphological variant (e.g. "ordered/order", "recommended/recommend").\`,
  },
};`;

// Find and replace TYPE_DIFFICULTY_HINTS (lines 433-564, 0-indexed)
lines.splice(433, 132, ...newHints.split('\n'));
fs.writeFileSync('scripts/generateBSQuestions.mjs', lines.join('\n'), 'utf8');

// Verify
const newContent = fs.readFileSync('scripts/generateBSQuestions.mjs', 'utf8').split('\n');
const newStart = newContent.findIndex(l => l.includes('const TYPE_DIFFICULTY_HINTS = {'));
const newEnd = newContent.findIndex((l,i) => i > newStart && l.match(/^};/));
console.log('Done. TYPE_DIFFICULTY_HINTS: lines', newStart+1, 'to', newEnd+1);
console.log('Spot check negation/medium fence:', newContent.slice(newStart+14, newStart+17).join('\n'));
