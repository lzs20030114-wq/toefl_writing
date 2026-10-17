// 真题模考「已见 / 已作答」同步放到后台：题目一出现就能作答，不再停在「正在确认这道题的已见记录…」。
//
// 每份试卷一条串行队列（同一份卷的 seen 调用按出现顺序落地）。网络 / 服务抖动自动退避重试；
// 卷已结束 / 过期 / 不存在这类不可能再成功的错误交给调用方的 onFatal（各壳自己的「重新组卷」错误卡）。
// 题目在不在本卷、算不算已做，开考时组卷已经在服务端预留好了，这里只是把预留转成「已见」：
// 就算某次同步最终没落地，交卷记录里的 seenItemIds 照样会让下次组卷跳过这道题（repository.historicalIds）。
//
// finish 会释放这份卷「还没标已见」的预留，所以交卷后先 flushRealMockSeen 再 finish。

import { markRealMockSeen } from "./client";
import { describeRealMockError } from "./messages";

const queues = new Map(); // attemptId → Promise（队尾）
const DEFAULT_DELAYS = [0, 800, 2000, 5000, 10000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runWithRetry(paper, items, answered, delays, onFatal) {
  let lastError = null;
  for (const delay of delays) {
    if (delay) await sleep(delay);
    try {
      await (answered ? markRealMockSeen(paper, items, { answered: true }) : markRealMockSeen(paper, items));
      return true;
    } catch (error) {
      lastError = error;
      if (describeRealMockError(error).kind !== "transient") break;
    }
  }
  if (lastError && describeRealMockError(lastError).kind !== "transient") onFatal?.(lastError);
  return false;
}

/**
 * 后台记录已见（answered=true 则记已作答）。立即返回，不抛错。
 * 返回的 Promise 在这次同步落地（或放弃）时 resolve 成 true / false，调用方一般不用等。
 */
export function syncRealMockSeen(paper, items, { answered = false, onFatal, delays = DEFAULT_DELAYS } = {}) {
  const attemptId = paper?.attemptId;
  const list = (Array.isArray(items) ? items : [items]).filter(Boolean);
  if (!attemptId || !list.length) return Promise.resolve(false);
  const tail = queues.get(attemptId) || Promise.resolve();
  const job = tail.then(() => runWithRetry(paper, list, answered, delays, onFatal));
  const settled = job.catch(() => false);
  queues.set(attemptId, settled);
  settled.then(() => { if (queues.get(attemptId) === settled) queues.delete(attemptId); });
  return settled;
}

/** 等这份卷所有排队中的同步落地（成功或放弃）。不抛错。 */
export function flushRealMockSeen(paper) {
  return queues.get(paper?.attemptId) || Promise.resolve();
}
