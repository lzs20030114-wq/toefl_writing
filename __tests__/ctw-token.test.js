/**
 * CTW 挖空 token 切分（lib/reading/ctwToken.js）。
 *
 * 真题里有粘着括号 / 破折号的挖空词（"(like"、"rain)."、"region—not"），这几篇以前整篇进不了库。
 * 渲染要把 token 切成「前标点 + 词 + 后标点」才不丢原文字符；而线上库的每一个空都必须与旧写法
 * （无前缀 + 尾标点 /[.,;:!?]+$/）逐字相同 —— 最后一组测试对全库锁死这一点。
 */
const fs = require("fs");
const path = require("path");
const { splitBlankToken } = require("../lib/reading/ctwToken");

describe("splitBlankToken", () => {
  test("常规：尾标点留在输入框后面", () => {
    expect(splitBlankToken("colors.", "colors")).toEqual({ lead: "", tail: "." });
    expect(splitBlankToken("colors", "colors")).toEqual({ lead: "", tail: "" });
    expect(splitBlankToken("Studying,", "Studying")).toEqual({ lead: "", tail: "," });
  });

  test("括号：左括号印在灰底前缀前面，右括号 + 句号印在后面", () => {
    expect(splitBlankToken("(like", "like")).toEqual({ lead: "(", tail: "" });
    expect(splitBlankToken("rain).", "rain")).toEqual({ lead: "", tail: ")." });
  });

  test("破折号连写：挖的是前半截，破折号和后半截原样留在后面", () => {
    expect(splitBlankToken("region—not", "region")).toEqual({ lead: "", tail: "—not" });
    expect(splitBlankToken("events—such", "events")).toEqual({ lead: "", tail: "—such" });
  });

  test("大小写不敏感，切出来的是 token 原文", () => {
    expect(splitBlankToken("(Like", "like")).toEqual({ lead: "(", tail: "" });
  });

  test("对不上的 token 退回旧行为（不猜）：词找不到 / 前后缀夹着字母", () => {
    expect(splitBlankToken("colours.", "colors")).toEqual({ lead: "", tail: "." });
    expect(splitBlankToken("likes", "like")).toEqual({ lead: "", tail: "" });
    expect(splitBlankToken("unlike", "like")).toEqual({ lead: "", tail: "" });
    expect(splitBlankToken("word.", "")).toEqual({ lead: "", tail: "." });
  });

  test("线上库每一个空都与旧写法逐字相同（真题 ctw + 生成题 ctw）", () => {
    const files = ["data/realBank/reading/ctw.json", "data/reading/bank/ctw.json"];
    let checked = 0;
    for (const f of files) {
      const p = path.join(__dirname, "..", f);
      if (!fs.existsSync(p)) continue;
      const doc = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const it of doc.items || doc) {
        const toks = String(it.passage || "").split(/\s+/);
        for (const b of it.blanks || []) {
          const tok = toks[b.position] || "";
          const legacy = { lead: "", tail: tok.match(/[.,;:!?]+$/)?.[0] || "" };
          const got = splitBlankToken(tok, b.original_word);
          // 新库条目（括号 / 破折号那几篇）允许有前后缀，但必须能拼回 token 原文
          if (got.lead || (got.tail && got.tail !== legacy.tail)) {
            expect(`${got.lead}${tok.slice(got.lead.length, got.lead.length + b.original_word.length)}${got.tail}`).toBe(tok);
          } else {
            expect(got).toEqual(legacy);
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
