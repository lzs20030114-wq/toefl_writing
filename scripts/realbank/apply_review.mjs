#!/usr/bin/env node
/**
 * 真题录入 —— 人工/独立复核结论落地（build_bank 之后的最后一道闸）。
 *
 * 读 data/realBank/review-holds.json，对已落库的 data/realBank/** 做两件事：
 *   1. patches：对个别字段做确定性文本修补（截掉串进来的无关尾巴、补句号、改错字）；
 *   2. holds：把复核判定「不能上线」的条目下架 —— 整条(unit) / 单题(question) /
 *      单句(sentence) / 单个面试问题(iq) 三种粒度。
 * 然后重算 CTW 的派生字段（word_count / blanked_text）和各科 counts.json。
 *
 * 为什么不是改 build_bank 的输入：复核是对**成品**做的（盲解 + 结构体检），结论按成品 id 记；
 * 源料在 .codex-tmp（不在 git 里），下一次 build_bank 重跑会把这些条目原样再产出来，
 * 所以 build_bank 末尾会自动调一次本脚本，holds 文件才是长期有效的「不上线清单」。
 * __tests__/real-bank-review-holds.test.js 锁死：清单里的 id 不许出现在成品里。
 *
 * 幂等：重复跑无副作用（patch 用 from→to 精确替换，找不到 from 就跳过并提示）。
 *
 * 用法: node scripts/realbank/apply_review.mjs [--dry]
 */
import fs from "fs";
import path from "path";

const FILES = {
  "reading/ctw": "reading", "reading/rdl": "reading", "reading/ap": "reading",
  "listening/lcr": "listening", "listening/lc": "listening", "listening/la": "listening", "listening/lat": "listening",
  "speaking/repeat": "speaking", "speaking/interview": "speaking",
  "writing/bs": "writing", "writing/email": "writing", "writing/discussion": "writing",
};
const COUNTS = {
  reading: ["ctw", "rdl", "ap"],
  listening: ["lcr", "lc", "la", "lat"],
  speaking: ["repeat", "interview"],
};

const stripTrailingPunct = (w) => String(w || "").replace(/[.,;:!?]+$/, "");

/** CTW：passage 改动后按 blanks 重算 word_count / blanked_text（与 build_bank.buildCtw 同一口径）。 */
function refreshCtw(item) {
  const toks = String(item.passage || "").trim().split(/\s+/).filter(Boolean);
  item.passage = toks.join(" ");
  item.word_count = toks.length;
  for (const b of item.blanks) {
    if (b.position >= toks.length) throw new Error(`[apply_review] ${item.id}: blank position ${b.position} 越界（patch 把挖空的词截掉了）`);
    const ow = stripTrailingPunct(toks[b.position]);
    if (ow !== b.original_word) throw new Error(`[apply_review] ${item.id}: blank@${b.position} 词变了 ${b.original_word} → ${ow}`);
  }
  const bt = toks.slice();
  for (const b of item.blanks) bt[b.position] = `${b.displayed_fragment}${"_".repeat(Math.max(1, b.hidden_length))}`;
  item.blanked_text = bt.join(" ");
}

// 路径段以 # 开头 = 在数组里按 id 找元素（"sentences.#real_repeat_x_s3.sentence"）。
// 复述句 / 面试题会被 sentence/iq 级下架过滤，下标会漂，所以带 id 的数组一律按 id 寻址。
const step = (o, k) => (o == null ? undefined : k.startsWith("#") && Array.isArray(o) ? o.find((x) => x?.id === k.slice(1)) : o[k]);
function getPath(obj, p) { return p.split(".").reduce(step, obj); }
function setPath(obj, p, v) { const ks = p.split("."); const last = ks.pop(); const o = ks.reduce(step, obj); if (o == null) throw new Error(`[apply_review] 路径 ${p} 不存在`); o[last] = v; }

function applyPatch(item, patch, log) {
  const cur = getPath(item, patch.path);
  if (patch.op === "set") { // 整个字段赋值（非字符串字段，如 distractors 数组）
    if (JSON.stringify(cur) === JSON.stringify(patch.to)) return false;
    setPath(item, patch.path, patch.to);
    return true;
  }
  if (typeof cur !== "string") { log.push(`  ! ${item.id} ${patch.path}: 不是字符串，跳过`); return false; }
  let next = cur;
  switch (patch.op) {
    case "replace":
      if (!cur.includes(patch.from)) return false; // 已修过（幂等）

      next = cur.replace(patch.from, patch.to);
      break;
    case "trim_tail": // 从 from 首次出现处截到末尾
      if (!cur.includes(patch.from)) return false; // 已修过
      next = cur.slice(0, cur.indexOf(patch.from)).trimEnd();
      break;
    case "trim_head": // 截掉开头的 from
      if (!cur.startsWith(patch.from)) return false; // 已修过
      next = cur.slice(patch.from.length).trimStart();
      break;
    case "append":
      if (cur.endsWith(patch.to)) return false;
      next = cur + patch.to;
      break;
    case "strip_insert_markers": // 无插句题却带着 [A]~[D] 位置标记：纯视觉噪声
      next = cur.replace(/\s*\[[A-D]\]\s*/g, " ").replace(/[ \t]{2,}/g, " ").replace(/ \n/g, "\n").trim();
      if (next === cur) return false;
      break;
    default:
      throw new Error(`[apply_review] 未知 op ${patch.op}`);
  }
  setPath(item, patch.path, next);
  return true;
}

/**
 * 真题音频一律是自家 TTS 按口播文本配的（render_real_audio.mjs），音频内容 == 配音时的文本。
 * patch 改了口播文本，桶里那条 mp3 就过期了：清掉 audio_url、标 audio_pending，前端回退浏览器朗读
 * （文本是对的），render_real_audio.mjs 下次只补这几条（它只挑没有 audio_url 的）。
 * 口播字段：LAT transcript / LA announcement / LCR speaker / LC conversation[].text /
 *           repeat sentences[].sentence / interview questions[].question。题干、选项不发音，不算。
 */
function markAudioStale(item, patchPath) {
  const m = patchPath.match(/^(sentences|questions)\.#([^.]+)\.(sentence|question)$/);
  const owner = m ? (item[m[1]] || []).find((x) => x?.id === m[2]) : /^(transcript|announcement|speaker|conversation(\.\d+\.text)?)$/.test(patchPath) ? item : null;
  if (!owner || !owner.audio_url) return false;
  owner.audio_url = null;
  owner.audio_pending = true;
  return true;
}

export function applyReview({ root = process.cwd(), dry = false } = {}) {
  const bankDir = path.join(root, "data", "realBank");
  const holdsFile = path.join(bankDir, "review-holds.json");
  if (!fs.existsSync(holdsFile)) { console.warn(`[apply_review] 没有 ${holdsFile}，跳过`); return null; }
  const review = JSON.parse(fs.readFileSync(holdsFile, "utf8"));
  const holds = review.holds || [];
  const patches = review.patches || [];
  const log = [];
  const stats = { patched: 0, patchGone: 0, holdGone: 0, audioStale: 0, units: 0, questions: 0, sentences: 0, iqs: 0 };

  const holdByFile = {};
  for (const h of holds) (holdByFile[h.file] = holdByFile[h.file] || []).push(h);
  const patchByFile = {};
  for (const p of patches) (patchByFile[p.file] = patchByFile[p.file] || []).push(p);

  const unknown = [...holds, ...patches].filter((x) => !FILES[x.file]).map((x) => x.file);
  if (unknown.length) throw new Error(`[apply_review] 未知 file: ${[...new Set(unknown)].join(", ")}`);

  for (const file of Object.keys(FILES)) {
    const p = path.join(bankDir, `${file}.json`);
    if (!fs.existsSync(p)) continue;
    const bank = JSON.parse(fs.readFileSync(p, "utf8"));
    const byId = new Map(bank.items.map((it) => [it.id, it]));
    const isCtw = file === "reading/ctw";

    for (const patch of patchByFile[file] || []) {
      const it = byId.get(patch.id);
      if (!it) { stats.patchGone += 1; continue; } // 条目已下架（holds 里同一条），patch 自然作废
      if (getPath(it, patch.path) === undefined) { stats.patchGone += 1; continue; } // 目标句/题已被 sentence/iq 级下架
      if (applyPatch(it, patch, log)) {
        stats.patched += 1;
        if (isCtw && patch.path === "passage") refreshCtw(it);
        if (markAudioStale(it, patch.path)) stats.audioStale += 1;
      }
    }

    const unitHold = new Set();
    const qHold = new Map(); // id → Set(下标)；同一条多题下架必须一次性按下标过滤，逐个 filter 会错位
    for (const h of holdByFile[file] || []) {
      const it = byId.get(h.id);
      if (!it) { stats.holdGone += 1; continue; } // 上一次已下架：幂等重跑的正常情况
      switch (h.scope) {
        case "unit": unitHold.add(h.id); break;
        case "question": (qHold.get(h.id) || qHold.set(h.id, new Set()).get(h.id)).add(h.q); break;
        case "sentence": {
          const before = it.sentences.length;
          it.sentences = it.sentences.filter((s) => s.id !== h.sid);
          if (it.sentences.length !== before) stats.sentences += 1;
          if (it.sentences.length === 0) unitHold.add(h.id);
          break;
        }
        case "iq": {
          const before = it.questions.length;
          it.questions = it.questions.filter((q) => q.id !== h.qid);
          if (it.questions.length !== before) stats.iqs += 1;
          if (it.questions.length === 0) unitHold.add(h.id);
          break;
        }
        default: throw new Error(`[apply_review] 未知 scope ${h.scope}`);
      }
    }
    for (const [id, idx] of qHold) {
      const it = byId.get(id);
      // 幂等：靠 q_number/source_q 之外没有稳定键，所以 holds 里 question 级条目要带 stem 前缀核对，
      // 已经扣掉的题 stem 对不上就跳过，不会误扣下一题。
      const before = it.questions.length;
      const wanted = holds.filter((h) => h.file === file && h.id === id && h.scope === "question");
      it.questions = it.questions.filter((q, i) => {
        const h = wanted.find((w) => w.q === i);
        if (!h) return true;
        if (h.stem && !String(q.stem || "").startsWith(h.stem)) { stats.holdGone += 1; return true; } // 已扣过，下标漂到了别的题：不许误扣
        return false;
      });
      stats.questions += before - it.questions.length;
      if (it.questions.length === 0) { unitHold.add(id); log.push(`  · ${id} 题全被扣光，整条下架`); }
    }
    const kept = bank.items.filter((it) => !unitHold.has(it.id));
    stats.units += bank.items.length - kept.length;
    bank.items = kept;
    bank.count = kept.length;
    if (!dry) fs.writeFileSync(p, JSON.stringify(bank, null, 2), "utf8");
  }

  // counts.json 镜像（首页卡片只 import 这几十字节）
  for (const [dir, keys] of Object.entries(COUNTS)) {
    const c = {};
    for (const k of keys) {
      const p = path.join(bankDir, dir, `${k}.json`);
      if (fs.existsSync(p)) c[k] = JSON.parse(fs.readFileSync(p, "utf8")).items.length;
    }
    if (!dry) fs.writeFileSync(path.join(bankDir, dir, "counts.json"), JSON.stringify(c, null, 2), "utf8");
  }
  return { stats, log };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const dry = process.argv.includes("--dry");
  const r = applyReview({ dry });
  if (r) {
    console.log(`■ apply_review${dry ? "（--dry）" : ""}：patch ${r.stats.patched} 处；下架 整条 ${r.stats.units} / 单题 ${r.stats.questions} / 复述句 ${r.stats.sentences} / 面试题 ${r.stats.iqs}`
      + `（清单里已不在库的 ${r.stats.holdGone} 条、随整条下架作废的 patch ${r.stats.patchGone} 处）`);
    if (r.stats.audioStale) console.log(`  口播文本改动 → ${r.stats.audioStale} 条音频作废（audio_pending），本机跑 render_real_audio.mjs 补配`);
    for (const l of r.log) console.log(l);
  }
}
