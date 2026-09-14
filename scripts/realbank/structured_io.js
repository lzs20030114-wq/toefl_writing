/**
 * structured 产物落盘（一代备份）+ 阅读基线同步。
 *
 * 第一来源 14 套（merge_first_source_asr.py 的 FIRST_SOURCE_SETS）的听力/口语是合流进来的，
 * 而合流**每次都从 `<卷>.structured.rw.json`（阅读/写作基线）重建阅读与写作**
 * （merge_first_source_asr.py 的 process_set），不读当前的 structured.json。
 * 所以任何「就地修阅读」的工具（CTW 重判、插入题转正……）只写 structured.json 的话，
 * 下一次重跑合流（比如对话人工标完性别）就会被悄悄冲掉。
 *
 * 这里统一：写 structured.json 的同时，若该卷有 rw 基线，就把**阅读**记录同步进去
 * （写作与其它科目原样保留）。没有 rw 基线的卷（rf / rp / 普通第一来源）只写 structured.json。
 *
 * ── 听力/口语有同一个坑，而且更隐蔽（2026-09-14 补）──
 * 两个来源的合流都「从原始产物出发」保证幂等，各自把 structure_set 的原始产物快照成一份：
 *   第一来源 merge_first_source_asr.py → `<卷>.structured.fs_parsed.json`
 *   第二来源 merge_vendor_asr.py       → `<卷>.structured.parsed.json`
 * 两份都是**只在第一次合流时存一次，之后永不刷新**。于是：重跑 structure_set 把某个听力块
 * 从 flagged 救成 ok，只写进 structured.json —— 下一次跑合流，它从那份**陈旧快照**重建听力，
 * 刚救回来的块原样消失，而且一声不响。听力是全库丢题最多的一科，抢救却正好卡在这一步。
 * 所以这里一并同步：本次**新产出**的听力/口语记录写进这两份快照（存在哪份写哪份）。
 * 只同步本次新产出的（freshKeys），不拿合流过的结果回灌快照 —— 那会毁掉幂等，越滚越偏。
 *
 * 备份：structured.json → `<卷>.structured.prev.json`（与 structure_set.mjs 同一口径）；
 *       rw 基线 → `<卷>.rwbase.prev.json`；两份合流快照 → `<卷>.fsparsed.prev.json` /
 *       `<卷>.parsedbase.prev.json`。备份文件名里**故意都不带 ".structured"**，
 *       免得被扫卷的 glob 当成一套卷。
 */
const fs = require("fs");
const path = require("path");

function tallyOf(results) {
  return (results || []).reduce((m, r) => {
    const k = r && r.status;
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

/** 把 results 里的阅读记录同步进 rw 基线；没有基线返回 false。 */
function syncReadingToBase(outDir, setname, results) {
  const rwPath = path.join(outDir, `${setname}.structured.rw.json`);
  if (!fs.existsSync(rwPath)) return false;
  const rw = JSON.parse(fs.readFileSync(rwPath, "utf8"));
  const reading = (results || []).filter((r) => r && r.section === "reading");
  const rest = (rw.results || []).filter((r) => r && r.section !== "reading");
  const next = rest.concat(reading);
  fs.copyFileSync(rwPath, path.join(outDir, `${setname}.rwbase.prev.json`));
  writeJson(rwPath, { ...rw, tally: tallyOf(next), results: next });
  return true;
}

/** 合流快照文件名 → 它的一代备份名（备份名里不带 ".structured"，见头注）。 */
const MERGE_BASES = Object.freeze([
  { snapshot: "structured.fs_parsed", backup: "fsparsed.prev" },     // 第一来源
  { snapshot: "structured.parsed", backup: "parsedbase.prev" },      // 第二来源
]);

/**
 * 把本次**新产出**的听力/口语记录同步进合流的原始快照。
 *
 * @param {Set<string>} [freshKeys] 本次真正跑出来的块 key。不传 = results 全是新的。
 *   传了就只同步这些 —— merge 模式下 results 里混着上一次（可能已合流过）的记录，
 *   把那些回灌进快照就等于「在合流结果上再合一次」，幂等就没了。
 * @returns {Array<{file, replaced, added}>} 实际写了哪些快照
 */
function syncListeningToMergeBases(outDir, setname, results, freshKeys) {
  const fresh = (results || []).filter((r) => r
    && (r.section === "listening" || r.section === "speaking")
    && (!freshKeys || freshKeys.has(r.key)));
  if (!fresh.length) return [];

  const written = [];
  for (const { snapshot, backup } of MERGE_BASES) {
    const p = path.join(outDir, `${setname}.${snapshot}.json`);
    if (!fs.existsSync(p)) continue;
    let base;
    try { base = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
    const byKey = new Map(fresh.map((r) => [r.key, r]));
    let replaced = 0;
    const next = (base.results || []).map((r) => {
      const n = r && byKey.get(r.key);
      if (!n) return r;
      byKey.delete(r.key);
      replaced += 1;
      return n;
    });
    let added = 0;
    for (const n of byKey.values()) { next.push(n); added += 1; }
    fs.copyFileSync(p, path.join(outDir, `${setname}.${backup}.json`));
    writeJson(p, { ...base, tally: tallyOf(next), results: next });
    written.push({ file: path.basename(p), replaced, added });
  }
  return written;
}

/**
 * 就地重判（--reverify-ctw / --reverify-mcq）前后，真正变了的记录的 key —— 传给 writeStructured 当 freshKeys。
 *
 * 为什么不能图省事把全部 key 传进去：syncListeningToMergeBases 会把 freshKeys 里的听力/口语记录灌回合流快照。
 * 合流过的卷，structured.json 里的听力记录是合流**产出**（带 merged_by、key 格式都换了），灌回快照 =
 * 下一次合流拿自己的产出当输入，幂等就毁了。重判只动它判过的那几块，没变的一条都不许算「新鲜」。
 */
function changedKeys(before, after) {
  const prev = new Map((before || []).map((r) => [r && r.key, JSON.stringify(r)]));
  return new Set((after || []).filter((r) => r && prev.get(r.key) !== JSON.stringify(r)).map((r) => r.key));
}

/** 写 structured.json（先备份）并同步阅读基线 + 听力/口语合流快照。 */
function writeStructured(outDir, setname, data, { freshKeys } = {}) {
  const outPath = path.join(outDir, `${setname}.structured.json`);
  if (fs.existsSync(outPath)) {
    fs.copyFileSync(outPath, path.join(outDir, `${setname}.structured.prev.json`));
  }
  const results = (data && data.results) || [];
  writeJson(outPath, { ...data, tally: tallyOf(results), results });
  return {
    outPath,
    synced: syncReadingToBase(outDir, setname, results),
    mergeBases: syncListeningToMergeBases(outDir, setname, results, freshKeys),
  };
}

module.exports = { tallyOf, syncReadingToBase, syncListeningToMergeBases, writeStructured, changedKeys, MERGE_BASES };
