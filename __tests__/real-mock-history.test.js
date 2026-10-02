import { historicalIds } from "../lib/realMockExam/repository";
import { collectLocalRealMockDoneIds } from "../lib/realMockExam/client";

test("all old submitted ids are recovered, while unseen mock snapshot items are excluded", () => {
  const ids = historicalIds([
    { details: [{ qid: "real_bs_a" }, { qid: "real_bs_b" }] },
    { details: { itemIds: ["real_lcr_a", "real_lcr_b", "real_lcr_c"] } },
    { details: { realMock: true, seenItemIds: ["real_ctw_seen"], itemIds: ["real_ctw_unseen"], items: [{ id: "real_ctw_unseen" }], paperSnapshot: { items: [{ id: "real_other" }] } } },
  ]);
  expect(ids).toEqual(expect.arrayContaining(["real_bs_a", "real_bs_b", "real_lcr_a", "real_lcr_b", "real_lcr_c", "real_ctw_seen"]));
  expect(ids).not.toContain("real_ctw_unseen");
});

test("local done collection never imports another account's scoped ids or ownerless history", () => {
  localStorage.clear();
  localStorage.setItem("toefl-user-code", "BBBBBB");
  localStorage.setItem("toefl-reading-ctw-done::user:AAAAAA", JSON.stringify(["real_ctw_A"]));
  localStorage.setItem("toefl-reading-ctw-done::user:BBBBBB", JSON.stringify(["real_ctw_B"]));
  localStorage.setItem("toefl-hist", JSON.stringify({ sessions: [
    { userCode: "AAAAAA", details: { itemId: "real_other_A" } },
    { details: { itemId: "real_ownerless" } },
    { userCode: "BBBBBB", details: { itemId: "real_other_B" } },
    { userCode: "BBBBBB", details: { realMock: true, seenItemIds: ["real_seen_B"], itemIds: ["real_unseen_B"] } },
  ] }));
  const ids = collectLocalRealMockDoneIds();
  expect(ids).toEqual(expect.arrayContaining(["real_ctw_B", "real_other_B", "real_seen_B"]));
  expect(ids).not.toEqual(expect.arrayContaining(["real_ctw_A", "real_other_A", "real_ownerless", "real_unseen_B"]));
});
