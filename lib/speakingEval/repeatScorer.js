/**
 * Score a Listen & Repeat attempt by comparing original sentence
 * with Web Speech API transcript.
 *
 * Returns:
 *   { accuracy: 0-100, matchedWords, missedWords, extraWords, score: 0-5 }
 */

/**
 * Normalize text: lowercase, strip punctuation, collapse whitespace, split.
 */
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")   // remove punctuation
    .replace(/\s+/g, " ")       // collapse whitespace
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * Longest Common Subsequence — returns the LCS array of words.
 * Uses classic DP on two word arrays.
 */
function lcs(a, b) {
  const m = a.length;
  const n = b.length;
  // Build DP table
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  // Backtrack to get the actual LCS words
  const result = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return result;
}

/**
 * Map accuracy percentage (0-100) to a 0-5 score with 0.5 steps.
 *   100 -> 5, 90 -> 4.5, 80 -> 4, 70 -> 3.5, ... 10 -> 0.5, 0 -> 0
 */
function accuracyToScore(accuracy) {
  if (accuracy >= 100) return 5;
  if (accuracy <= 0) return 0;
  return Math.round((accuracy / 20) * 2) / 2; // maps to 0.5 steps
}

/**
 * Score a repeat attempt.
 *
 * @param {string} original  — the original sentence text
 * @param {string} transcript — the Web Speech API recognized text
 * @returns {{ accuracy: number, matchedWords: string[], missedWords: string[], extraWords: string[], score: number }}
 */
export function scoreRepeat(original, transcript) {
  const origWords = normalize(original);
  const transWords = normalize(transcript);

  // Edge cases
  if (origWords.length === 0) {
    return { accuracy: 0, matchedWords: [], missedWords: [], extraWords: transWords, score: 0 };
  }
  if (transWords.length === 0) {
    return { accuracy: 0, matchedWords: [], missedWords: [...origWords], extraWords: [], score: 0 };
  }

  const matched = lcs(origWords, transWords);

  // Find missed words: words in original that are NOT in the LCS
  // We need position-aware tracking since words can repeat
  const missedWords = [];
  const matchedCopy = [...matched];
  for (const word of origWords) {
    const idx = matchedCopy.indexOf(word);
    if (idx !== -1) {
      matchedCopy.splice(idx, 1); // consume this match
    } else {
      missedWords.push(word);
    }
  }

  // Find extra words: words in transcript that are NOT in the LCS
  const extraWords = [];
  const matchedCopy2 = [...matched];
  for (const word of transWords) {
    const idx = matchedCopy2.indexOf(word);
    if (idx !== -1) {
      matchedCopy2.splice(idx, 1);
    } else {
      extraWords.push(word);
    }
  }

  // Accuracy: matched / max(original, transcript) * 100
  const denom = Math.max(origWords.length, transWords.length);
  const accuracy = Math.round((matched.length / denom) * 100);
  const score = accuracyToScore(accuracy);

  return {
    accuracy,
    matchedWords: matched,
    missedWords,
    extraWords,
    score,
  };
}
