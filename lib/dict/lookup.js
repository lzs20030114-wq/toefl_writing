"use client";
import { normalizeWord, naiveStems, shardOf, resolveFromShard } from "./core";

// 划词词典的前端查询层。
//
// 词库由 scripts/dict/build-dict.mjs 从 ECDICT 裁剪而来，按首字母分片放在
// public/dict/<a-z>.json（非字母开头的收进 _.json）。屈折变形在构建期就并进了
// 分片（studies → study），所以运行时不需要词形还原表，一次 fetch 一片即可；
// 只有词库压根没收录的词才落到 naiveStems 的后缀剥离兜底。

const shardCache = new Map(); // letter -> Promise<Record<string, entry|string>>

function loadShard(letter) {
  // 没有 fetch 的环境（jsdom 测试、老 WebView）直接退成空表：`fetch(...)` 会同步抛
  // ReferenceError，下面的 .catch 根本接不住，不拦住就会把整棵渲染树带崩。
  if (typeof fetch !== "function") return Promise.resolve({});
  if (!shardCache.has(letter)) {
    shardCache.set(
      letter,
      fetch(`/dict/${letter}.json`)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}))
    );
  }
  return shardCache.get(letter);
}

export { normalizeWord };

/**
 * 查词。返回 { word, p, t, g, queried } 或 null（查无此词）。
 * word = 词库里的原形（学生查 studies 时显示 study），queried = 实际命中的键。
 */
export async function lookupWord(raw) {
  const w = normalizeWord(raw);
  if (!w || w.length > 40) return null;

  const shard = await loadShard(shardOf(w));
  const direct = resolveFromShard(shard, w);
  if (direct) return direct;

  // 连字符词：查不到就试 breakdown / break down
  if (w.includes("-")) {
    for (const alt of [w.replace(/-/g, ""), w.replace(/-/g, " ")]) {
      const hit = resolveFromShard(await loadShard(shardOf(alt)), alt);
      if (hit) return hit;
    }
  }

  for (const stem of naiveStems(w)) {
    const hit = resolveFromShard(shard, stem);
    if (hit) return hit;
  }

  // 多词短语查不到时，退回查最后一个词（多半是想查中心词）
  if (w.includes(" ")) {
    const last = w.split(" ").pop();
    if (last && last !== w) return lookupWord(last);
  }
  return null;
}

/** 预热分片——复盘页挂载时按文章首字母提前拉，点词时就不等网络了。 */
export function prefetchShards(letters) {
  (letters || []).forEach((l) => {
    if (/^[a-z_]$/.test(l)) loadShard(l);
  });
}
