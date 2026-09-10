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
 * 备份：structured.json → `<卷>.structured.prev.json`（与 structure_set.mjs 同一口径）；
 *       rw 基线 → `<卷>.rwbase.prev.json`（文件名里故意不带 ".structured"，免得被扫卷的 glob 当成一套卷）。
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

/** 写 structured.json（先备份）并同步阅读基线。 */
function writeStructured(outDir, setname, data) {
  const outPath = path.join(outDir, `${setname}.structured.json`);
  if (fs.existsSync(outPath)) {
    fs.copyFileSync(outPath, path.join(outDir, `${setname}.structured.prev.json`));
  }
  const results = (data && data.results) || [];
  writeJson(outPath, { ...data, tally: tallyOf(results), results });
  return { outPath, synced: syncReadingToBase(outDir, setname, results) };
}

module.exports = { tallyOf, syncReadingToBase, writeStructured };
