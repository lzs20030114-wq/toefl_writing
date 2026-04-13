/**
 * TOEFL 2026 Reading — Sample-calibrated profile constants.
 *
 * Derived from 27 collected samples:
 *   - 6 Complete the Words passages (60 blanks)
 *   - 8 Read in Daily Life texts (20 questions)
 *   - 13 Academic Passages (65 questions)
 *
 * These targets guide the AI generation pipeline for reading questions.
 * Re-run `node scripts/analyze-reading-samples.mjs` to refresh stats.
 * Re-run `node scripts/analyze-ets-flavor.mjs` to refresh flavor profile.
 */

/* ────────────────────────────────────────────────────────
   Complete the Words (C-test)
   ──────────────────────────────────────────────────────── */

const CTW_PROFILE = Object.freeze({
  blankCount: 10,

  // Passage length (words)
  passageWordCount: { min: 45, max: 100, target: 70 },

  // Sentence metrics
  avgSentenceLength: { min: 14, max: 17, target: 15 },
  sentenceCount: { min: 3, max: 5, target: 4 },

  // Readability
  fleschKincaidGrade: { min: 8, max: 13, target: 10 },
  typeTokenRatio: { min: 0.75, max: 0.9, target: 0.8 },

  // Blank word characteristics
  blankWordLength: { min: 2, max: 13, mean: 5.5 },
  // Fragment shows roughly 40% of the word
  fragmentRatio: { min: 0.33, max: 0.57, mean: 0.4 },

  // POS distribution of blanked words (observed)
  // Function words (det/prep/pronoun/conj/aux) ~30%, content words ~70%
  blankPosProfile: {
    content_words_pct: 0.70,
    function_words_pct: 0.30,
  },

  // Difficulty distribution
  difficultyRatio: { easy: 0.33, medium: 0.50, hard: 0.17 },

  // Topic diversity target: at least 4 distinct topics per 10 passages
  topicDiversityMin: 4,
});

/* ────────────────────────────────────────────────────────
   Read in Daily Life
   ──────────────────────────────────────────────────────── */

const RDL_PROFILE = Object.freeze({
  // Text length by variant
  shortTextWordCount: { min: 40, max: 60 },
  longTextWordCount: { min: 80, max: 150 },

  // Questions per text
  shortTextQuestions: 2,
  longTextQuestions: 3,

  // Genre distribution (observed from 52 samples)
  genreTargets: {
    email: 0.40,      // emails, invitations, shift swaps, welcome messages
    notice: 0.40,     // campus announcements, policies, procedures
    social_media: 0.08,
    schedule: 0.04,
    syllabus: 0.02,
    menu: 0.02,
    text_message: 0.02,
    flyer: 0.02,
  },

  // Question type distribution (corrected with 152 questions)
  questionTypeTargets: {
    detail: 0.55,                 // "According to...", "What must X do?"
    inference: 0.28,              // "What can be inferred?", much higher than initially thought
    main_idea: 0.12,              // "What is the main purpose?"
    vocabulary_in_context: 0.05,  // RDL ALSO has vocab questions!
  },

  // Option length (words per option) — updated with 52-sample data
  optionWordCount: { min: 1, max: 15, mean: 7.4 },

  // Correct answer position: observed B=46%, D=5% — generation MUST balance
  answerPositionTarget: { A: 0.25, B: 0.25, C: 0.25, D: 0.25 },

  difficultyRatio: { easy: 0.52, medium: 0.48 },
});

/* ────────────────────────────────────────────────────────
   Academic Passage
   ──────────────────────────────────────────────────────── */

const AP_PROFILE = Object.freeze({
  questionsPerPassage: 5,

  // Passage metrics
  passageWordCount: { min: 150, max: 400, target: 250 },
  paragraphCount: { min: 2, max: 5, target: 3 },
  sentenceCount: { min: 9, max: 20, target: 15 },

  // Readability
  fleschKincaidGrade: { min: 11, max: 18, target: 15 },
  typeTokenRatio: { min: 0.57, max: 0.73, target: 0.63 },

  // Question type distribution (observed, rounded to generation targets)
  questionTypeTargets: {
    vocabulary_in_context: 0.20,
    factual_detail: 0.20,
    inference: 0.17,
    paragraph_relationship: 0.17,
    rhetorical_purpose: 0.14,
    negative_factual: 0.09,
    main_idea: 0.03,
  },

  // Distractor strategy distribution
  distractorPatternTargets: {
    wrong_detail: 0.31,
    not_mentioned: 0.29,
    opposite: 0.19,
    misquoted: 0.09,
    plausible_but_unsupported: 0.07,
    too_narrow: 0.03,
    too_broad: 0.03,
  },

  // Option word count
  optionWordCount: { min: 1, max: 23, mean: 7.9 },
  // Correct options tend to be slightly longer than distractors
  correctOptionWordCount: { mean: 9.0 },
  distractorOptionWordCount: { mean: 7.6 },

  // Correct answer should be roughly balanced (observed: A=43%, D=5% — need to balance)
  answerPositionTarget: { A: 0.25, B: 0.25, C: 0.25, D: 0.25 },

  // Topic diversity: at least 5 distinct topics per 10 passages
  topicDiversityMin: 5,

  difficultyRatio: { easy: 0.15, medium: 0.46, hard: 0.38 },
});

/* ────────────────────────────────────────────────────────
   Quality gates for AI-generated items
   ──────────────────────────────────────────────────────── */

const GENERATION_QUALITY_GATES = Object.freeze({
  // Max ratio of correct option being the longest (should be < 40%)
  longestOptionIsCorrectMaxRatio: 0.40,

  // Guessability test: if AI can answer >50% without the passage, reject
  maxGuessabilityRate: 0.50,

  // Min distractor analysis coverage: all 3 wrong options must have a pattern
  minDistractorAnalysisCoverage: 1.0,

  // Answer position entropy: should be close to uniform
  minAnswerPositionEntropy: 1.8, // max entropy for 4 options is 2.0

  // Per-set: at least 3 distinct question types in a 5-question set
  minQuestionTypeDiversity: 3,
});

/* ────────────────────────────────────────────────────────
   ETS "Flavor" — What makes passages feel authentic
   Derived from analyze-ets-flavor.mjs
   ──────────────────────────────────────────────────────── */

const ETS_FLAVOR = Object.freeze({
  // --- Lexical ---
  // AWL (Academic Word List) coverage: ~2.7% of all words
  awlCoverageTarget: 0.027,
  // Lexical density (content words / total): ~63.7%
  lexicalDensityTarget: 0.637,
  // Average word length: 5.7 characters
  avgWordLength: 5.7,
  // Long words (≥7 chars): ~37.7%
  longWordRatio: 0.377,

  // --- Syntactic ---
  // Passive voice: ~0.23 per sentence (about 1 in 4 sentences has passive)
  passivePerSentence: 0.23,
  // Relative clauses: ~5.2 per passage
  relativeClausesPerPassage: 5.2,
  // Sentence length variation (CV): 0.344 — moderate variation is key
  sentLengthVariation: 0.344,
  // Punctuation complexity: 1.48 commas/semicolons per sentence
  punctComplexityPerSent: 1.48,
  // Comparisons: ~2.5 per passage
  comparisonsPerPassage: 2.5,

  // --- Discourse ---
  // Hedging: ~0.93% of words (may, might, suggest, appear, tend...)
  hedgeRatio: 0.0093,
  // Transitions: ~8.5 per passage, heavy on contrast
  transitionsPerPassage: 8.5,
  transitionProfile: {
    contrast: 0.43,       // "however", "but", "although" — DOMINANT
    cause_effect: 0.19,   // "because", "therefore", "as a result"
    example: 0.15,        // "for example", "such as"
    sequence: 0.10,       // "first", "then", "finally"
    addition: 0.08,       // "also", "furthermore"
    emphasis: 0.05,       // "in fact", "indeed"
  },
  // Evidence markers: ~0.2 per passage (sparse in 200-word passages)
  evidenceMarkersPerPassage: 0.2,
  // Definition patterns: ~1.4 per passage (introduces terminology)
  definitionPatternsPerPassage: 1.4,

  // --- Question stem conventions ---
  stemPatterns: {
    // AP: starts with "According to" (29%), "The" (20%), "What" (18%), "Why" (14%)
    // AP: avg stem length 16 words (much longer than RDL's 8 words)
    apAvgStemLength: 16,
    rdlAvgStemLength: 8,
  },

  // --- Option construction rules ---
  optionRules: {
    // Grammatical parallelism: 97% of AP, 100% of RDL — near-mandatory
    grammaticalParallelismMin: 0.95,
    // Correct is longest: 34% AP (too high — target ≤25%)
    correctIsLongestMax: 0.25,
    // All options should have similar avg length per position
    // Observed: A=8.1, B=7.9, C=8.2, D=7.5 — within 1 word of each other
    optionLengthVarianceMax: 1.5,
  },

  // --- Distractor strategies by question type ---
  distractorByQuestionType: {
    factual_detail: { primary: "not_mentioned", secondary: "wrong_detail" },
    inference: { primary: "opposite", secondary: "not_mentioned" },
    main_idea: { primary: "too_narrow" },
    negative_factual: { primary: "misquoted" },
    paragraph_relationship: { primary: "wrong_detail" },
    rhetorical_purpose: { primary: "not_mentioned", secondary: "opposite" },
    vocabulary_in_context: { primary: "wrong_detail", secondary: "opposite" },
  },

  // --- CTW blank composition ---
  ctwBlankProfile: {
    // 35% function words, 65% content words
    functionWordRatio: 0.35,
    // Most blanks are simple root forms (85% "other" ending, not -ing/-ed/-ly)
    simpleFormRatio: 0.85,
    // Easy blanks (>45% shown) dominate: 50%
    easyBlankRatio: 0.50,
  },

  // --- RDL register & structure (from 52-sample deep analysis) ---
  rdlRegisterProfile: {
    // Informal markers per text
    contractionsPerText: 0.9,
    exclamationsPerText: 1.0,
    abbreviationsPerText: 1.8,   // AM/PM/ID/Wi-Fi/QR etc
    bulletPointsPerText: 1.7,    // structured info is common

    // Formal markers per text
    passiveVoicePerText: 1.5,
    nominalizationsPerText: 5.3, // high even in "daily life" texts

    // Formality varies hugely by genre:
    //   text_message: informal=9.0/text, formal=1.0 (most informal)
    //   social_media: informal=5.0, formal=2.3
    //   email: informal=1.9, formal=6.5
    //   notice: informal=1.1, formal=7.8 (most formal)
    //   syllabus: informal=1.0, formal=11.0 (most formal)
  },

  rdlTextStructure: {
    // 38% have greeting (Dear/Hi), 27% have sign-off — mostly emails
    greetingRate: 0.38,
    signoffRate: 0.27,
    // 37% have bullet/list formatting
    bulletListRate: 0.37,
    // 60% mention specific dates, 69% mention specific times
    hasDateRate: 0.60,
    hasTimeRate: 0.69,
    // 33% mention money amounts ($)
    hasMoneyRate: 0.33,
    // Avg 16.6 words/sentence — NOT short choppy sentences
    avgSentenceLength: 16.6,
    // 28% short (≤10), 42% medium (11-20), 23% long (21-30), 7% very long (31+)
    sentLengthProfile: { short: 0.28, medium: 0.42, long: 0.23, veryLong: 0.07 },
  },

  rdlSettingProfile: {
    // 75% are campus/university contexts — DOMINANT
    campus: 0.75,
    commercial: 0.40,
    community: 0.35,
    workplace: 0.21,
  },

  rdlStemProfile: {
    // Top stem patterns (152 questions), in generation frequency:
    // "What can be inferred" 13.2%, "According to the X" 11.8%
    // "What is the main purpose" 7.9%, "Which is NOT" 7.2%
    // "What must X do" 6.6%, "Why does X mention" 5.9%
    // "word closest in meaning" 4.6%, "What will happen" 4.6%
    avgStemLength: 11.8,
  },

  rdlOptionProfile: {
    // 78.9% of questions have well-balanced options (max-min ≤ 3 words)
    balancedRate: 0.789,
    // Correct is longest only 22.4% — better than AP's 33.8%
    correctIsLongestRate: 0.224,
    avgCorrectLen: 7.6,
    avgDistractorLen: 7.3,
    // main_idea: B=83%(!), detail: B=43%, inference: B=38%
    // SEVERE B-bias especially for main_idea — MUST fix in generation
  },

  // --- Deep flavor analysis (from 52-sample rdlDeepFlavor.json) ---

  rdlAnswerMapping: {
    // Correct answer ↔ passage word overlap by question type:
    //   detail: 59.6% — about 3 in 5 content words shared
    //   inference: 35.6% — much lower, answer says what text implies
    //   main_idea: 41.4% — uses meta-language ("to inform", "to provide")
    //   vocab: 0% — answer is a synonym, no overlap expected
    correctOverlap: { detail: 0.596, inference: 0.356, main_idea: 0.414, vocabulary_in_context: 0.0 },

    // Paraphrase strategy distribution:
    //   44% synthesis (combines info from multiple sentences)
    //   28% synonym paraphrase (single sentence, key words swapped)
    //   17% near-verbatim (close to passage wording)
    //   12% meta-language (main_idea — "to inform students about...")
    paraphraseTypes: { synthesis: 0.44, synonym_paraphrase: 0.28, direct_quote: 0.17, meta_language: 0.12 },
  },

  rdlDistractorProfile: {
    // Distractor-passage word overlap by question type:
    //   detail distractors: 50.3% overlap (CLOSE to correct's 59.6% — gap only 9pp!)
    //   inference distractors: 36.4% (virtually same as correct — hardest to distinguish)
    //   main_idea distractors: 37.7%
    distractorOverlap: { detail: 0.503, inference: 0.364, main_idea: 0.377 },

    // Distractor vocabulary strategy:
    //   48.7% "plausible_generic" — sounds reasonable, moderate overlap
    //   31.1% "uses_passage_words" — borrows real terms, changes relationships
    //   19.5% "introduces_new_terms" — completely fabricated content
    strategy: { plausible_generic: 0.487, uses_passage_words: 0.311, introduces_new_terms: 0.195 },

    // KEY INSIGHT: For detail questions, the gap between correct (59.6%) and
    // distractor (50.3%) overlap is only 9.3pp. Distractors DELIBERATELY borrow
    // passage vocabulary to create confusion. AI must replicate this.
    detailOverlapGap: 0.093,
    // For inference, there is NO gap (-0.8pp) — distractors have same overlap as correct.
    // The difference is purely logical, not lexical.
    inferenceOverlapGap: -0.008,
  },

  rdlInformationDensity: {
    // Avg extractable facts per passage: 14.4
    avgFactsPerPassage: 14.4,
    // Fact density: 8.83 facts per 100 words
    factDensityPer100Words: 8.83,
    // By genre (facts per passage):
    //   menu: 34.0 (densest), schedule: 29.0, syllabus: 29.0
    //   notice: 17.3, email: 11.1, social_media: 1.0 (least dense)
    // KEY: notices/schedules are data-rich, social_media is experience-rich
    genreFactDensity: { menu: 34.0, schedule: 29.0, notice: 17.3, email: 11.1, social_media: 1.0 },
  },

  rdlTextStructure: {
    // 75% start with direct statement (not greeting or title)
    // 12% start with "Subject:" line
    // 8% start with title/header
    // 6% start with "Dear..."
    openings: { direct_statement: 0.75, subject_line: 0.12, title_header: 0.08, dear_greeting: 0.06 },
    // Closings: 33% contact info, 27% sign-off, 19% call-to-action, 13% deadline
    closings: { contact_info: 0.33, sign_off: 0.27, call_to_action: 0.19, deadline: 0.13, url: 0.10 },
    // Campus vocabulary density: 6.9% of content words
    campusVocabDensity: 0.069,
    // Top 5 content words: please(56), campus(49), student(43), must(38), pm(37)
  },

  // --- AP paragraph structure (from passageStructure.json deep analysis) ---
  apParagraphProfile: {
    // Avg topic sentence length: 22 words (longer than average sentence)
    topicSentenceLength: 22,
    // 72% of paragraphs open with a direct statement
    statementOpeningRatio: 0.72,
    // 15% open with an example
    exampleOpeningRatio: 0.15,
    // Avg paragraph length: 88 words
    avgParagraphLength: 88,
  },

  // --- Rhetorical structure (from deep analysis of 13 passages) ---
  passageStructure: {
    // 100% of paragraphs have a functioning topic sentence — MANDATORY
    topicSentenceRequired: true,
    // 91% of non-opening paragraphs reference the previous paragraph
    interParagraphCohesionRate: 0.91,
    // ETS passages NEVER have a dedicated conclusion paragraph
    hasConclusion: false,

    // Rhetorical patterns to use when generating
    rhetoricalPatterns: {
      general_to_specific: 0.31,
      definition_elaboration: 0.23,
      chronological: 0.23,
      problem_solution: 0.15,
    },

    // Opening strategy: 46% start with "received wisdom then revision"
    openingStrategies: {
      received_wisdom_then_revision: 0.46,  // "Historically...", "While early theories..."
      direct_definition: 0.31,
      contextual_framing: 0.23,
    },

    // Closing strategy: never a summary, always pushes forward
    closingStrategies: {
      consequence_implication: 0.54,
      limitation_concession: 0.31,  // Opens with "Despite..."
      chronological_endpoint: 0.15,
    },

    // Reusable passage templates
    templates: [
      "Define technology → Explain mechanism → List benefits → Acknowledge limitations + research",
      "Primitive era → Intermediate/flawed → Breakthrough with lasting impact",
      "Discovery → Physical mechanism → Biological mechanism → Complex ecology",
    ],
  },

  // --- Question-passage mapping (from questionMapping.json deep analysis) ---
  questionPassageMapping: {
    // Correct answer NEVER uses >3 consecutive passage words
    maxConsecutivePassageWords: 3,
    // Factual detail correct answers share ~58% content words with passage
    factualDetailLexicalOverlap: 0.58,
    // Inference answers share only ~32%
    inferenceLexicalOverlap: 0.32,
    // Rhetorical purpose answers use meta-language, ~15% overlap
    rhetoricalPurposeLexicalOverlap: 0.15,

    // Distractor vocabulary borrowing
    distractorsWithPassageWords: 0.40,   // 40% borrow ≥1 passage content word
    distractorsWith2PlusWords: 0.27,     // 27% borrow ≥2 (most dangerous)

    // Distractors tend to be SHORTER than correct (50% shorter vs 17% longer)
    distractorShorterThanCorrectRate: 0.50,

    // Vocab questions: 85% test primary definition, context always has disambiguation clues
    vocabPrimaryDefinitionRate: 0.85,
    vocabContextClueRequired: true,
  },
});

module.exports = {
  CTW_PROFILE,
  RDL_PROFILE,
  AP_PROFILE,
  GENERATION_QUALITY_GATES,
  ETS_FLAVOR,
};
