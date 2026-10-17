// 真题模考已见同步放后台（lib/realMockExam/seenSync）：串行落地、抖动自动重试、死卷交给 onFatal、flush 等队列清空。
jest.mock("../lib/realMockExam/client", () => ({ markRealMockSeen: jest.fn() }));

import { markRealMockSeen } from "../lib/realMockExam/client";
import { syncRealMockSeen, flushRealMockSeen, resyncRealMockSeen } from "../lib/realMockExam/seenSync";

const err = (code) => Object.assign(new Error(code), { code });
const paper = (id) => ({ attemptId: id });

beforeEach(() => jest.clearAllMocks());

test("one paper's syncs land in order, one at a time", async () => {
  const order = [];
  let releaseFirst;
  markRealMockSeen.mockImplementation((p, items) => {
    order.push(`start ${items[0].id}`);
    if (items[0].id === "a") return new Promise((resolve) => { releaseFirst = () => { order.push("end a"); resolve(); }; });
    order.push(`end ${items[0].id}`);
    return Promise.resolve();
  });
  const p = paper("order");
  syncRealMockSeen(p, [{ id: "a" }]);
  const second = syncRealMockSeen(p, [{ id: "b" }], { answered: true });
  await Promise.resolve();
  expect(order).toEqual(["start a"]);
  releaseFirst();
  await expect(second).resolves.toBe(true);
  expect(order).toEqual(["start a", "end a", "start b", "end b"]);
  expect(markRealMockSeen).toHaveBeenLastCalledWith(p, [{ id: "b" }], { answered: true });
});

test("a network blip is retried; flush waits for it", async () => {
  markRealMockSeen.mockRejectedValueOnce(err("NETWORK_ERROR")).mockResolvedValue({ ok: true });
  const p = paper("retry");
  const onFatal = jest.fn();
  syncRealMockSeen(p, [{ id: "a" }], { onFatal, delays: [0, 1] });
  await flushRealMockSeen(p);
  expect(markRealMockSeen).toHaveBeenCalledTimes(2);
  expect(onFatal).not.toHaveBeenCalled();
});

test("a dead paper is not retried and goes to onFatal; the queue keeps going", async () => {
  markRealMockSeen.mockRejectedValueOnce(err("ATTEMPT_EXPIRED")).mockResolvedValue({ ok: true });
  const p = paper("dead");
  const onFatal = jest.fn();
  await expect(syncRealMockSeen(p, [{ id: "a" }], { onFatal, delays: [0, 1, 1] })).resolves.toBe(false);
  expect(markRealMockSeen).toHaveBeenCalledTimes(1);
  expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ code: "ATTEMPT_EXPIRED" }), "dead");
  await expect(syncRealMockSeen(p, [{ id: "b" }])).resolves.toBe(true);
});

test("giving up on a blip never throws, and flush of an idle paper resolves at once", async () => {
  markRealMockSeen.mockRejectedValue(err("NETWORK_ERROR"));
  const onFatal = jest.fn();
  await expect(syncRealMockSeen(paper("down"), [{ id: "a" }], { onFatal, delays: [0, 1] })).resolves.toBe(false);
  expect(onFatal).not.toHaveBeenCalled();
  await expect(flushRealMockSeen(paper("idle"))).resolves.toBeUndefined();
});

test("resync re-sends only the items the checkpoint recorded as shown", async () => {
  markRealMockSeen.mockResolvedValue({ ok: true });
  const p = paper("resync");
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  await expect(resyncRealMockSeen(p, items, ["c", "a", "zzz"])).resolves.toBe(true);
  expect(markRealMockSeen).toHaveBeenCalledWith(p, [{ id: "a" }, { id: "c" }]);
  await expect(resyncRealMockSeen(p, items, [])).resolves.toBe(false);
  expect(markRealMockSeen).toHaveBeenCalledTimes(1);
});
