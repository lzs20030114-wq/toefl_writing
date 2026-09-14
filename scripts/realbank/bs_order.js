/**
 * 造句落库顺序：上一版已上线的题按原顺序在前，新题追加在后（纯函数，无 IO）。
 *
 * ── 为什么顺序本身就是契约 ──
 * 前端 lib/realBank.js 的 getRealBSBatches 按 bs.json 里**各卷第一次出现的顺序**给回忆版造句分批编号
 * （real-bs-set-3、-4 …），用户的「已练」标记（useBuildSentenceSession 写 DONE_STORAGE_KEYS.BUILD_SENTENCE_GP）
 * 就挂在这个批次号上。build_bank 按卷名排序遍历，一旦补进一批**卷名更靠前**的卷（2026-09-14 补 1~2 月合订卷的造句），
 * 它们会插到老卷前面：所有老批次的编号整体后移，老用户的已练标记全部错位。
 *
 * 其次是去重：落库按答案句去重、「先出现的留下」。新卷排在前面就会抢走保留位 ——
 * 已上线的同一道题（id 如 bs_34_03）被判成重复扔掉、换成新卷的 id，已练记录同样失联。
 *
 * 所以落库前先按上一版的顺序排：上一版有的 id 按上一版的位置，没有的（新题）按原遍历顺序接在后面。
 * 这样重复题留下的永远是已上线那份，新卷只贡献真正没有的题，批次号只会往后追加。
 * 与阅读的 id 沿用（id_carry.js）同一个理由。
 *
 * @param {Array<{id:string}>} items   按卷名顺序收集的造句（去重之前）
 * @param {Array<string>} prevIds       上一版 data/realBank/writing/bs.json 的 id 顺序（没有上一版就传 []）
 * @returns {Array} 新数组，不改入参
 */
function orderByPrevious(items, prevIds) {
  const rank = new Map((prevIds || []).map((id, i) => [String(id), i]));
  return (items || [])
    .map((it, i) => ({ it, i, r: rank.has(String(it && it.id)) ? rank.get(String(it.id)) : Infinity }))
    .sort((a, b) => (a.r - b.r) || (a.i - b.i))
    .map((x) => x.it);
}

module.exports = { orderByPrevious };
