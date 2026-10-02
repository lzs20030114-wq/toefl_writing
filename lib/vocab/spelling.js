/**
 * 拼写格子的纯函数：一个字母一个格，空格 / 连字符 / 撇号这类分隔符原样摆出来，用户只敲字母。
 * 不碰 React，直接跑测试。
 */

const isLetter = (ch) => /\p{L}/u.test(ch);

/** 词拆成格子：{ ch, letter }。letter=false 的是分隔符，照原样显示、不用敲。 */
export function spellingSlots(word) {
  return [...String(word || "").trim()].map((ch) => ({ ch, letter: isLetter(ch) }));
}

/** 只留字母、统一小写 —— 核对和显示都按这个口径。 */
export function lettersOf(text) {
  return [...String(text || "")].filter(isLetter).join("").toLocaleLowerCase("en-US");
}

/** 输入框里敲进来的东西收拾成「最多 N 个字母」：空格、标点、多敲的都丢掉。 */
export function sanitizeSpelling(raw, word) {
  return [...lettersOf(raw)].slice(0, [...lettersOf(word)].length).join("");
}

/** 拼对没有：只比字母（分隔符是给定的，不算用户写的）。 */
export function spellingCorrect(typed, word) {
  const answer = lettersOf(word);
  return answer.length > 0 && lettersOf(typed) === answer;
}

/** 把敲过的字母按词的样子摆回去（短语带上空格 / 连字符），用于「你写的是 …」。 */
export function formatTyped(typed, word) {
  const letters = [...lettersOf(typed)];
  let i = 0;
  let out = "";
  for (const slot of spellingSlots(word)) {
    if (i >= letters.length) break;
    out += slot.letter ? letters[i++] : slot.ch;
  }
  return out + letters.slice(i).join("");
}

/**
 * 正确拼写里哪几个字母是用户漏了或写错的：按最长公共子序列对齐，
 * 答案一侧没对上的字母标 true。按位置逐个比会被一个漏字母带歪整串
 * （aproximately 对 approximately，第三位往后全错位），对齐之后只标出真正漏的那个 p。
 * 返回值和 lettersOf(word) 一一对应。
 */
export function missedLetters(typed, word) {
  const a = [...lettersOf(word)];
  const b = [...lettersOf(typed)];
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const missed = new Array(a.length).fill(true);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      missed[i] = false;
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  return missed;
}
