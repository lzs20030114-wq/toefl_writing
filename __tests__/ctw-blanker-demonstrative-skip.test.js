/**
 * CTW 挖空器指示代词跳过 — 冻结测试（2026-08-02 L1 审计根治）
 *
 * this/that（fragment "th", len 4）与 these/those（"th", len 5）挖空后同前缀同长度、
 * 且都能回指前句实体，语境无法消歧——L1 审计确认这是 CTW 最主要的歧义来源。
 * 挖空器现在把它们当 1 字母词一样跳过（保留完整、不参与交替）。
 */

const { applyBlanking, BLANK_SKIP_WORDS } = require("../lib/readingGen/cTestBlanker");
const fs = require("fs");
const path = require("path");

const DEMONSTRATIVES = ["this", "that", "these", "those"];

test("BLANK_SKIP_WORDS 恰为四个指示代词", () => {
  expect([...BLANK_SKIP_WORDS].sort()).toEqual([...DEMONSTRATIVES].sort());
});

test("含大量指示代词的段落，挖空结果不含任何指示代词", () => {
  const passage =
    "Scientists study the night sky with great care and patience every single evening. " +
    "This powerful telescope reveals distant spiral galaxies clearly through its enormous curved mirror. " +
    "That remarkable discovery changed the whole field of modern astronomy forever after publication. " +
    "These careful findings strongly support the widely accepted expanding universe theory today. " +
    "Those sensitive instruments accurately measure the faint light arriving from ancient distant stars.";
  const r = applyBlanking(passage);
  expect(r.error).toBeFalsy();
  expect(r.blanks).toHaveLength(10);
  const blankedWords = r.blanks.map(b => (b.original_word || "").toLowerCase());
  for (const d of DEMONSTRATIVES) expect(blankedWords).not.toContain(d);
});

test("live CTW 库中除 2 个已知残留外，没有指示代词被挖空", () => {
  // ctw_gen_1780213257230_008 / ctw_1784923353142_894331：重挖会触发长度/生僻词门，
  // 保留原挖空（歧义仅 1/10 空，低危），见 FULL-AUDIT 报告残留项。
  const KNOWN_RESIDUAL = new Set(["ctw_gen_1780213257230_008", "ctw_1784923353142_894331"]);
  const bank = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../data/reading/bank/ctw.json"), "utf8")
  );
  const offenders = bank.items
    .filter(it => !KNOWN_RESIDUAL.has(it.id))
    .filter(it => (it.blanks || []).some(b => DEMONSTRATIVES.includes((b.original_word || "").toLowerCase())))
    .map(it => it.id);
  expect(offenders).toEqual([]);
});
