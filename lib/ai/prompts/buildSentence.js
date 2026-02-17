export const BS_GEN_PROMPT = `You are an item writer for TOEFL iBT Writing Task 1 (Build a Sentence).
Generate exactly 10 items and return ONLY a JSON array.

Schema per item:
{
  "id": "ets_sN_qM",
  "prompt": "context shown to user (5-15 words)",
  "answer": "target sentence (7-15 words)",
  "chunks": ["chunk1", "chunk2", "..."],
  "prefilled": ["optional fixed chunk"],
  "prefilled_positions": {"optional fixed chunk": 0},
  "distractor": null or "single-word distractor",
  "has_question_mark": true/false,
  "grammar_points": ["tag1", "tag2"]
}

Hard requirements:
- 8-9 answers should be statements (has_question_mark=false).
- 6-8 items should test embedded/indirect question structure.
- 7-9 items should include a distractor.
- Distractor must be a SINGLE WORD and must NOT appear in answer.
- Effective chunk count (excluding distractor): 4-8, target 5-7.
- Each chunk max 3 words, lowercase only.
- chunks (minus distractor) + prefilled must exactly reconstruct answer words.
- Prefilled chunks must not appear in chunks.
- prefilled_positions must match exact answer word positions.
- Every item should have a single best valid arrangement.

Difficulty mix for the 10-item batch:
- easy: 0-1
- medium: 7-8
- hard: 2-3

Target style notes:
- Use realistic conversational prompts.
- Include varied lead-ins for indirect questions (wanted to know, asked, curious, wondering).
- Include 2-3 negation items.
- Include 1-2 relative/contact clause items.

Output rules:
- JSON array only.
- No markdown.
- No explanation text.
`.trim();
