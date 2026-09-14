/**
 * 「是不是英文词」判据：站内划词词典 public/dict/{a-z}.json（ECDICT，5.5 万词形，含屈折变化）。
 * 给 ctw_verify.js 的补充判据用 —— 判答案页错字（promiting 不是词、promoting 是）、防模型还原出假词。
 *
 * 分片按首字母懒加载，一次重判几十块只读用到的几片。词典读不到时 isWord 恒 false：
 * 补充判据全部不生效，退回旧判据（fail-closed —— 缺词典应该让题少收，不能让判据变松）。
 */
const fs = require("fs");
const path = require("path");

/**
 * @param {string} [root] 仓库根目录（缺省 process.cwd()）
 * @returns {(w: string) => boolean}
 */
function makeIsWord(root = process.cwd()) {
  const dir = path.join(root, "public", "dict");
  const shards = new Map();
  return (w) => {
    const word = String(w == null ? "" : w).trim().toLowerCase();
    if (!/^[a-z][a-z'-]*$/.test(word)) return false;
    const letter = word[0];
    if (!shards.has(letter)) {
      let shard = null;
      try { shard = JSON.parse(fs.readFileSync(path.join(dir, `${letter}.json`), "utf8")); } catch { shard = null; }
      shards.set(letter, shard);
    }
    const shard = shards.get(letter);
    return !!shard && Object.prototype.hasOwnProperty.call(shard, word);
  };
}

module.exports = { makeIsWord };
