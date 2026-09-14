/**
 * 造句落库顺序（scripts/realbank/bs_order.js）。
 *
 * 前端按 bs.json 里各卷第一次出现的顺序给造句分批编号（real-bs-set-N），已练标记挂在批次号上；
 * 落库去重「先出现的留下」。所以补进卷名更靠前的卷（2026-09-14 补 1~2 月合订卷）时：
 *   · 新卷不许插到老卷前面（否则老批次号整体后移，已练标记全错位）；
 *   · 重复题留下的必须是已上线那份（否则已上线的 id 被换掉）。
 */
const { orderByPrevious } = require("../scripts/realbank/bs_order.js");

const q = (id, source) => ({ id, source, answer: id });

describe("orderByPrevious", () => {
  test("上一版有的按上一版顺序在前，新题按原遍历顺序追加在后", () => {
    // 遍历顺序按卷名：1.21A（新）排在 3.4（老）前面
    const items = [q("bs_121a_01", "1.21A"), q("bs_121a_02", "1.21A"), q("bs_34_01", "3.4"), q("bs_rf0610_01", "rf0610")];
    const prev = ["bs_34_01", "bs_rf0610_01"];
    expect(orderByPrevious(items, prev).map((x) => x.id))
      .toEqual(["bs_34_01", "bs_rf0610_01", "bs_121a_01", "bs_121a_02"]);
  });

  test("按答案句去重「先出现的留下」时，留下的是已上线那份", () => {
    const items = [q("bs_121a_03", "1.21A"), q("bs_34_03", "3.4")];
    items[0].answer = items[1].answer = "same sentence";
    const ordered = orderByPrevious(items, ["bs_34_03"]);
    const seen = new Set();
    const kept = ordered.filter((x) => !seen.has(x.answer) && seen.add(x.answer));
    expect(kept.map((x) => x.id)).toEqual(["bs_34_03"]);
  });

  test("没有上一版 / 全是新题：顺序原样不动（首次构建与改动前一致）", () => {
    const items = [q("a"), q("b"), q("c")];
    expect(orderByPrevious(items, []).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(orderByPrevious(items, undefined).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  test("上一版里后来消失的 id 不影响其余题的相对顺序；不改入参", () => {
    const items = [q("x"), q("b"), q("a")];
    const copy = items.map((x) => x.id);
    expect(orderByPrevious(items, ["a", "gone", "b"]).map((x) => x.id)).toEqual(["a", "b", "x"]);
    expect(items.map((x) => x.id)).toEqual(copy);
  });
});
