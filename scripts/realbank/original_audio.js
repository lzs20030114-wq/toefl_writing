/**
 * 真题听力「原声优先」的**纯逻辑**（无 IO，可单测）。
 *
 * 背景：`data/realBank/listening/*.json` 的音频原本一律是我们自己用 gpt-4o-mini-tts 配的
 * （`render_real_audio.mjs` → `real/<type>/<id>.mp3`）。商家源料里其实带着**真人原声**，
 * 只是没法直接用：
 *   · 前面有 ETS 固定旁白「Listen to a conversation.」——播出来等于提前剧透题型；
 *   · 后面内嵌**作答时间**，而且不是静音：每 ~0.65s 一声 −31 dBFS 的计时「咔」，
 *     静音阈值裁不掉（实测 6.10 q01：正文 0.24–2.24s，2.55–2.65s 就有一声咔）；
 *   · 第一来源只有整块 ListeningModule1/2.mp3，structured 里的 `audio_span_sec`
 *     **尾巴不准**（1.21B lc Q13 记到 138.38s，实际 126s 就结束了，越进了下一段），
 *     lcr 更是 12 句短应答两两共用一个粗区间，根本不能直接切。
 *
 * 所以切点只能**按词级时间戳算**，而且每条都要过闸；过不了就退回 TTS，不赌。
 * 这个文件放的就是「算切点」和「过闸」的判据本身 —— 与 ffmpeg / faster-whisper / Supabase
 * 全部解耦，`bind_original_audio.mjs`（切片+上传）与 `build_bank.mjs`（重建时回挂）共用，
 * 单测在 `__tests__/realbank-original-audio.test.js`。
 */

const crypto = require("crypto");

/* ── 阈值（改这里等于改判据，配套单测会跟着红） ─────────────────────────── */
const DEFAULTS = {
  headPad: 0.25,        // 正文第一个词之前留多少秒
  headPadMin: 0.05,     // 头部被外来声音逼近时最少还要留多少秒
  tailPad: 0.5,         // 正文最后一个词之后留多少秒
  tailPadMin: 0.15,     // 尾巴被计时音逼近时最少还要留多少秒（少于这个就判不干净）
  nextGuard: 0.1,       // 终点必须早于下一组起点这么多秒
  minCoverage: 0.85,    // 切片内 ASR 文本对题库口播文本的 token 覆盖率下限
  maxMissTokens: 1,     // 覆盖率不够时的短句豁免：漏词不超过这么多个也算过
  locateCoverage: 0.7,  // 认定「定位成功」的覆盖率下限（比过闸松：定位靠顺序单调兜底）
  anchorTokens: 5,      // 首尾锚点各查几个 token（见 anchorOk）
  anchorCharCover: 0.6, // 锚点的字符级兜底：最长公共子串占比达到这个数也算对上
  minWpm: 90,
  maxWpm: 320,
  minDuration: 1.0,
  tailFloorDb: -40,     // 尾巴里允许的最大能量（dBFS）
  binSec: 0.02,         // 能量探针的分箱宽度
  quietDb: -45,         // 低于这个算「安静」
  // 连续这么多个安静分箱（× binSec = 0.16s）才算真的收声了。太短会被词内的瞬时低谷骗到：
  // 实测 1.21B la Q19 的 "symposium." 在 244.75 有 0.05s 的谷（−48 dB），
  // 紧接着 244.80–244.90 又回到 −24 dB，真正的收声在 244.95。
  quietRun: 8,
  maxDecay: 0.8,        // 末词时间戳之后最多允许多久才收声（超了 = 正文没念完）
  decayFloor: 0.15,     // 旁白 / 上一组的收声余量：地板要比它们的末词时间戳再往后推这么久
  // 旁白拼回去的节奏：旁白末词 → 正文首词 2.4s（三类题型实测中位 2.37–2.45s），
  // 旁白之前再留 0.3s 静音（不让第一个音贴着文件头）。
  narrationGapSec: 2.4,
  narrationPreRollSec: 0.3,
};

/* ── 文本归一化 ─────────────────────────────────────────────────────────── */

/**
 * 口播文本 → 可比对的 token 序列（小写、去标点、数字里的逗号去掉）。
 * 连字符**合并**而不是拆开：Whisper 把 "mid-term" 听成 "midterm"，
 * 拆成 mid / term 会凭空多出一个对不上的 token（实测 rf0610 lcr M2 Q3 因此掉到 0.75）。
 */
function normTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/[‘’']/g, "")
    .replace(/([a-z0-9])[-–—]([a-z0-9])/g, "$1$2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * 题库条目里**会被念出来**的那段纯文本（用于对齐 / 覆盖率）。
 * 注意与 build_bank.mjs 的 `spokenText()` 不是一回事：那个是**指纹**（lc 还把
 * speakers[].gender 拼进去，因为音色由性别决定），这个是**口播内容**（lc 只要台词）。
 */
function spokenPlainText(kind, item) {
  if (!item) return "";
  if (kind === "lcr") return String(item.speaker || "");
  if (kind === "la") return String(item.announcement || "");
  if (kind === "lat") return String(item.transcript || "");
  if (kind === "lc") return (item.conversation || []).map((t) => t.text).join(" ");
  return "";
}

function sha1(s) {
  return crypto.createHash("sha1").update(String(s), "utf8").digest("hex");
}

/* ── 序列对齐 ───────────────────────────────────────────────────────────── */

/**
 * 半全局对齐：target 必须整条对上，asr 两端的多余词免费跳过。
 *
 * 「两端免费」正是旁白剥离与尾巴裁剪的机制本身 —— 旁白词不在 target 里，
 * 于是被算进前置免费间隙；下一组的开头同理落进后置免费间隙。
 *
 * @param {string[]} target 题库口播文本的 token
 * @param {string[]} asr    候选区间内 ASR 词的 token
 * @returns {{a:number,b:number,cost:number,matched:number,coverage:number}|null}
 *          a/b = 对上的 asr 下标区间 [a, b)（b 为开区间）
 */
function alignTokens(target, asr) {
  const n = target.length;
  const m = asr.length;
  if (!n || !m) return null;

  // 滚动两行 DP。cost=编辑距离；origin=这条对齐路径在 asr 里的起点；match=精确命中数。
  let prevCost = new Int32Array(m + 1);
  let prevOrigin = new Int32Array(m + 1);
  let prevMatch = new Int32Array(m + 1);
  let curCost = new Int32Array(m + 1);
  let curOrigin = new Int32Array(m + 1);
  let curMatch = new Int32Array(m + 1);

  for (let j = 0; j <= m; j++) { prevCost[j] = 0; prevOrigin[j] = j; prevMatch[j] = 0; }

  for (let i = 1; i <= n; i++) {
    curCost[0] = i; curOrigin[0] = 0; curMatch[0] = 0;
    const t = target[i - 1];
    for (let j = 1; j <= m; j++) {
      const hit = t === asr[j - 1];
      let best = prevCost[j - 1] + (hit ? 0 : 1);
      let origin = prevOrigin[j - 1];
      let matched = prevMatch[j - 1] + (hit ? 1 : 0);
      const del = prevCost[j] + 1;                 // target 这个词没被念到
      if (del < best) { best = del; origin = prevOrigin[j]; matched = prevMatch[j]; }
      const ins = curCost[j - 1] + 1;              // asr 这个词是多出来的
      if (ins < best) { best = ins; origin = curOrigin[j - 1]; matched = curMatch[j - 1]; }
      curCost[j] = best; curOrigin[j] = origin; curMatch[j] = matched;
    }
    [prevCost, curCost] = [curCost, prevCost];
    [prevOrigin, curOrigin] = [curOrigin, prevOrigin];
    [prevMatch, curMatch] = [curMatch, prevMatch];
  }

  let bestJ = 1;
  for (let j = 1; j <= m; j++) if (prevCost[j] < prevCost[bestJ]) bestJ = j;
  return {
    a: prevOrigin[bestJ],
    b: bestJ,
    cost: prevCost[bestJ],
    matched: prevMatch[bestJ],
    coverage: prevMatch[bestJ] / n,
  };
}

/** 最长公共子序列长度（只用在 ≤10 个 token 的小窗上）。 */
function lcsLen(a, b) {
  const dp = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prevDiag + 1 : Math.max(dp[j], dp[j - 1]);
      prevDiag = tmp;
    }
  }
  return dp[b.length];
}

/** 最长公共**子串**（连续）长度，用在 ≤100 字符的小串上。 */
function lcsubstrLen(a, b) {
  let best = 0;
  let prev = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Int32Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) { cur[j] = prev[j - 1] + 1; if (cur[j] > best) best = cur[j]; }
    }
    prev = cur;
  }
  return best;
}

/**
 * 首尾锚点：切片必须**从正文第一句开始、到正文最后一句结束**。
 *
 * 半全局对齐两端的间隙是免费的 —— 这正是旁白能被跳过的原因，但同一个机制也意味着：
 * 如果一段长讲座开头几句音频里根本没有（商家给的音频与逐字稿不是同一版），对齐器会算出
 * 「把那几十个词当删除」更便宜，于是起点直接跳到后面，切出来的音频少了开头一整句，
 * 覆盖率却还有 0.96 —— 闸放行、用户听到的是从半截开始的讲座（实测 1.28B lat Q29：
 * 逐字稿开头 "Have you ever been so engrossed…" 在音频里一个词都找不到）。
 *
 * 两条判据满足其一即算对上，各自挡不同的噪声：
 *   · **词级** LCS ≥ k−1：容忍首尾 k 个词里有一个被 ASR 听错；
 *   · **字符级**最长公共子串 ≥ 60%：容忍复合词被拆合（"sea water" vs "seawater"），
 *     那种情况词级会连掉两个、看着像错位，其实逐字一模一样。
 */
function anchorOk(target, asr, a, b, opt) {
  const O = { ...DEFAULTS, ...(opt || {}) };
  const k = Math.min(O.anchorTokens, target.length);
  const need = Math.max(1, k - 1);
  const headT = target.slice(0, k);
  const tailT = target.slice(target.length - k);
  const headA = asr.slice(a, a + k + 5);
  const tailA = asr.slice(Math.max(a, b - k - 5), Math.min(asr.length, b + 3));
  const score = (t, h) => {
    const tok = lcsLen(t, h);
    const ts = t.join("");
    const chr = ts.length ? lcsubstrLen(ts, h.join("")) / ts.length : 0;
    return { tok, chr, ok: tok >= need || chr >= O.anchorCharCover };
  };
  const head = score(headT, headA);
  const tail = score(tailT, tailA);
  return { ok: head.ok && tail.ok, head, tail, need };
}

/* ── 旁白定位 ───────────────────────────────────────────────────────────── */

/** 旁白最长多少个词（"Listen to part of a lecture in an art history class." = 11 词）。 */
const NARRATION_MAX_WORDS = 16;
/** ETS 旁白里必定出现的任务名词。缺了就不是旁白（见下）。 */
const NARRATION_NOUNS = new Set([
  "conversation", "conversations", "announcement", "announcements",
  "lecture", "lectures", "talk", "talks", "discussion", "discussions", "seminar",
]);

/**
 * 在 [from, upTo) 这段 ASR 词里找**最后一句** ETS 旁白（"Listen to a conversation." /
 * "Listen to part of a lecture in an art history class." …）。
 * 返回 `{start, end}`：start = "listen" 的下标，end = 旁白之后第一个词的下标。找不到返回 null。
 *
 * 两道约束缺一不可，否则正文自己会被当成旁白：
 *   · "listen" 必须在**句首**（前一个词以句末标点收尾，或它就是第一个词）；
 *   · 这句话里必须出现 conversation / announcement / lecture / talk / discussion 之一。
 * 反例是真的：1.21B lcr M2 Q3 的题干是
 * "Can I borrow your headphones to listen to the recording?" —— 两条都不满足，
 * 早先只认 "listen"+"to" 的版本把它判成「旁白落在正文里」，白白扣了一条能用的原声。
 */
function findNarration(words, from, upTo) {
  const lo = Math.max(0, from | 0);
  const hi = Math.min(words.length, upTo == null ? words.length : upTo);
  let found = null;
  for (let i = lo; i < hi - 1; i++) {
    if ((normTokens(words[i].w)[0] || "") !== "listen") continue;
    if ((normTokens(words[i + 1].w)[0] || "") !== "to") continue;
    if (i > 0 && !/[.!?]["')\]]?$/.test(String(words[i - 1].w).trim())) continue;
    let end = -1;
    let noun = false;
    for (let j = i + 1; j < Math.min(hi, i + NARRATION_MAX_WORDS); j++) {
      if (NARRATION_NOUNS.has(normTokens(words[j].w)[0] || "")) noun = true;
      if (/[.!?]["')\]]?$/.test(String(words[j].w).trim())) { end = j + 1; break; }
    }
    if (end > 0 && noun) found = { start: i, end };
  }
  return found;
}

/** 兼容旧签名：只要旁白之后第一个词的下标。 */
function findNarrationEnd(words, from, upTo) {
  const n = findNarration(words, from, upTo);
  return n ? n.end : -1;
}

/* ── 切点 ───────────────────────────────────────────────────────────────── */

/**
 * 算一条题的原声切点。
 *
 * @param {object} p
 * @param {{w:string,start:number,end:number}[]} p.words 候选区间内的 ASR 词（带时间戳）
 * @param {string[]} p.targetTokens 题库口播文本的 token
 * @param {number} [p.floor]     起点不得早于（上一组的终点 / 文件开头）
 * @param {number} [p.ceiling]   终点不得晚于（文件时长 / 下一组起点，调用方先算好）
 * @param {boolean} [p.allowLeadIn] 允许把「旁白之后、对齐起点之前」的几个词也切进来
 *        （逐字稿漏收的正文）。lcr 要关掉：那种题的 target 就是整句话，
 *        前面多出来的一定不是它的内容。
 * @param {object} [opt] 覆盖 DEFAULTS
 * @returns {{ok:boolean, reason?:string, start?:number, end?:number, coverage?:number,
 *            narration?:"stripped"|"absent", contentStart?:number, contentEnd?:number,
 *            aIdx?:number, bIdx?:number, narrStartIdx?:number}}
 */
function computeCut(p, opt) {
  const O = { ...DEFAULTS, ...(opt || {}) };
  const words = p.words || [];
  const target = p.targetTokens || [];
  if (!words.length) return { ok: false, reason: "asr_empty" };
  if (!target.length) return { ok: false, reason: "target_empty" };

  const asrTokens = words.map((w) => normTokens(w.w)[0] || "");
  const al = alignTokens(target, asrTokens);
  if (!al) return { ok: false, reason: "align_failed" };
  if (al.coverage < O.locateCoverage) {
    return { ok: false, reason: "locate_failed", coverage: al.coverage, aIdx: al.a, bIdx: al.b };
  }
  const anc = anchorOk(target, asrTokens, al.a, al.b, O);
  if (!anc.ok) {
    return { ok: false, reason: "anchor_mismatch", coverage: al.coverage, aIdx: al.a, bIdx: al.b };
  }

  const narr = findNarration(words, 0, al.a + 1);
  if (findNarration(words, al.a + 1, al.b)) {
    // 旁白落在「正文区间」里 = 定位对到了下一组，宁可不要
    return { ok: false, reason: "narration_inside", coverage: al.coverage };
  }

  // 起点：默认是对上的第一个词。但旁白若就挤在正文前面（中间 ≤10 个词），
  // 那几个词多半是 PDF 逐字稿漏收的正文 —— 实测 1.21B la Q19 音频念的是
  // 「…in a classroom. For your upcoming project, please write…」，逐字稿只从
  // "Please write" 起头，按对齐起点切会把半句真内容削掉、听上去像从中间接上的。
  let startIdx = al.a;
  let narration = "absent";
  if (narr && narr.end <= al.a) {
    narration = "stripped";
    if (p.allowLeadIn !== false && al.a - narr.end <= 10) startIdx = narr.end;
  }

  const first = words[startIdx];
  const last = words[al.b - 1];
  if (!first || !last) return { ok: false, reason: "align_failed", coverage: al.coverage };

  // 旁白最后一个词的 end 是起点的硬地板：headPad 不许倒灌回旁白里。
  // 再加 decayFloor —— Whisper 的词末时间戳偏早，旁白真正的收声还在它之后。
  const narrFloor = narr && narr.end <= startIdx && words[narr.end - 1]
    ? words[narr.end - 1].end + O.decayFloor : -Infinity;
  let start = first.start - O.headPad;
  start = Math.max(start, narrFloor, p.floor == null ? 0 : p.floor, 0);
  // 地板再高也不许越过正文第一个词 —— 宁可带一点旁白余响，也不能把开头削掉。
  start = Math.min(start, first.start);

  const contentEnd = last.end;
  let end = contentEnd + O.tailPad;
  const ceiling = p.ceiling == null ? Infinity : p.ceiling;
  if (end > ceiling) end = ceiling;

  if (!(end > start)) return { ok: false, reason: "empty_span", coverage: al.coverage };
  return {
    ok: true, start: round3(start), end: round3(end),
    contentStart: round3(first.start), contentEnd: round3(contentEnd),
    coverage: al.coverage, matched: al.matched, targetTokens: target.length,
    narration, aIdx: startIdx, bIdx: al.b,
    narrStartIdx: narr && narr.end <= startIdx ? narr.start : null,
  };
}

const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * 尾巴定界。两件事一起做，因为它们纠缠在一起：
 *
 * ① **真正的收声时刻**。Whisper 给的词末时间戳系统性偏早 —— 实测 1.21B la Q23
 *    末词标到 318.76s，实际声音一直响到 318.90s（318.82 处还有 −2.5 dBFS）。
 *    直接拿 contentEnd 当终点会把最后一个词削掉半截。所以从 contentEnd 往后扫，
 *    找**第一处持续安静**（连续 `quietRun` 个分箱 ≤ quietDb）当作 speechEnd；
 *    `maxDecay` 秒内还没安静下来 = 正文其实没念完（对齐提前收了），fail-closed。
 *
 * ② **计时音**。作答段不是静音，每 ~0.65s 一声 ~−31 dBFS 的「咔」（实测 6.10 q01：
 *    正文 0.24–2.24s，2.55–2.65s 就有一声），`speechEnd + tailPad` 经常正好罩住
 *    第一声。所以在 (speechEnd, end) 里找第一处超过 tailFloorDb 的分箱，
 *    把终点收到它之前；收到 tailPadMin 还超标就判尾巴不干净、这条不用原声。
 *
 * @param {{contentEnd:number, probes:{t:number,db:number}[], ceiling?:number}} p
 *        probes = 从 contentEnd 起的等距分箱（t 是分箱**起点**秒数）
 * @returns {{ok:boolean, reason?:string, speechEnd:number, end:number, trimmed:boolean,
 *            offenderAt:number|null, maxDb:number|null}}
 */
function resolveTail(p, opt) {
  const O = { ...DEFAULTS, ...(opt || {}) };
  const probes = (p.probes || []).filter((x) => x.t >= p.contentEnd);
  const ceiling = p.ceiling == null ? Infinity : p.ceiling;

  // ① 收声时刻
  let speechEnd = null;
  for (let i = 0; i < probes.length; i++) {
    if (probes[i].t - p.contentEnd > O.maxDecay) break;
    if (probes[i].db > O.quietDb) continue;
    let quiet = true;
    for (let k = i; k < i + O.quietRun; k++) {
      if (!probes[k] || probes[k].db > O.quietDb) { quiet = false; break; }
    }
    if (quiet) { speechEnd = probes[i].t; break; }
  }
  if (speechEnd == null) {
    // 源文件正好在正文结束处收尾（逐题 mp3 的讲座常这样：132.13s 的正文、132.30s 的文件），
    // 根本没有「持续安静」可找。这时文件末尾就是终点，也不可能混进计时音。
    if (p.atCeiling && ceiling - p.contentEnd <= O.tailPad + O.binSec * O.quietRun) {
      return { ok: true, speechEnd: round3(ceiling), end: round3(ceiling), trimmed: false,
        offenderAt: null, maxDb: null, atFileEnd: true };
    }
    return { ok: false, reason: "tail_not_clean", speechEnd: round3(p.contentEnd),
      end: round3(p.contentEnd), trimmed: false, offenderAt: null, maxDb: null };
  }

  // ② 计时音
  let end = Math.min(speechEnd + O.tailPad, ceiling);
  let worst = null;
  let offender = null;
  for (const x of probes) {
    if (x.t < speechEnd + O.binSec || x.t >= end) continue;
    if (worst == null || x.db > worst) worst = x.db;
    if (x.db > O.tailFloorDb) { offender = x; break; }
  }
  if (!offender) {
    return { ok: true, speechEnd: round3(speechEnd), end: round3(end), trimmed: false,
      offenderAt: null, maxDb: worst };
  }
  const cut = round3(offender.t - 0.02);
  if (cut - speechEnd < O.tailPadMin) {
    return { ok: false, reason: "tail_not_clean", speechEnd: round3(speechEnd), end: round3(end),
      trimmed: false, offenderAt: round3(offender.t), maxDb: offender.db };
  }
  return { ok: true, speechEnd: round3(speechEnd), end: cut, trimmed: true,
    offenderAt: round3(offender.t), maxDb: offender.db };
}

/**
 * 头部定界：把切片起点从「别人的声音」后面挪开。
 *
 * 逐题 mp3 的正文不一定贴着文件开头 —— 实测 6.10 q12 的正文在 6.3s，之前 1.0–6.2s
 * 全是每 0.7s 一声的计时「咔」，`contentStart − headPad` 正好罩住最后一声。
 * 第一来源的 lcr 更直接：十二句背靠背，前一句的尾音离下一句只有 0.18s。
 *
 * 判据与尾巴对称：只有当「响的那一段」与正文之间**隔着一段安静**（≥ quietRun 个分箱）
 * 时才认定它是外来声音、把起点挪到它后面；紧贴着正文的那点能量是正文自己的起音
 * （Whisper 的词首时间戳偶尔偏晚），挪了就会把第一个音削掉。
 *
 * @param {{start:number, contentStart:number, probes:{t:number,db:number}[]}} p
 * @returns {{start:number, trimmed:boolean, offenderAt:number|null}}
 */
function resolveHead(p, opt) {
  const O = { ...DEFAULTS, ...(opt || {}) };
  const probes = (p.probes || []).filter((x) => x.t >= p.start && x.t < p.contentStart - O.binSec / 2);
  if (!probes.length) return { start: round3(p.start), trimmed: false, offenderAt: null };
  let q = -1;
  for (let i = probes.length - 1; i >= 0; i--) { if (probes[i].db > O.tailFloorDb) { q = i; break; } }
  if (q < 0) return { start: round3(p.start), trimmed: false, offenderAt: null };
  if (probes.length - 1 - q < O.quietRun) {
    // 响到贴着正文 —— 那是正文自己的起音，不动
    return { start: round3(p.start), trimmed: false, offenderAt: null };
  }
  const cut = Math.min(probes[q].t + O.binSec + 0.02, p.contentStart - O.headPadMin);
  return { start: round3(Math.max(cut, p.start)), trimmed: cut > p.start, offenderAt: round3(probes[q].t) };
}

/* ── 旁白（ETS 固定播报）───────────────────────────────────────────────────
 * 切片时把源头的旁白剥掉了（见 computeCut），但真考**是有旁白的** —— 只是逐题型不同：
 *   lcr 没有（385 条过闸原声里 215 条 lcr 一条旁白都没有）；
 *   lc  清一色 "Listen to a conversation."（53 条实测）；
 *   la / lat 带场景、逐条不同（la 22 种、lat 39 种），所以按**原句**还原，
 *     还原不到才退回通用句。原句来自词级缓存实测（narration_survey.json）。
 * 剥掉再自己配回来而不是留着源头那段，是因为源头旁白的电平、与正文的间隔都不统一，
 * 而且 la/lat 有些卷的旁白与正文粘在同一个 ASR 段里、切点切不干净。
 */

const NARRATION_DEFAULTS = { lc: "Listen to a conversation.", la: "Listen to an announcement.", lat: "Listen to a talk." };

/**
 * 把实测抄下来的旁白原句洗干净：**取到第一个句子结束为止**。
 *
 * survey 里的原句是按「ASR 词序列」抄的，句尾常粘着正文第一个词
 * （"…in a classroom. I" / "…podcast. One of the most fascinating…" / "…class. Back"），
 * 直接拿去合成就会把正文第一个词念两遍。
 *
 * 判据是「句号 + 前面至少两个小写字母」而不是「第一个句号」—— 后者会被缩写切断
 * （"…in a U.S. history class." 会被切成 "Listen to a talk in a U."）。
 */
function cleanNarration(raw) {
  // 先把「词与标点之间的空格」收掉再切句 —— ASR 抄下来的原句有 "conversation ." 这种写法，
  // 不先规整，句子结束的判据（两个小写字母 + 句号）就认不出来。
  let s = String(raw || "").replace(/\s+/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();
  if (!s) return "";
  const m = /^(.*?[a-z]{2}[.!?])(?:\s|$)/.exec(s);
  if (m) s = m[1];
  s = s.trim();
  if (!s) return "";
  s = s[0].toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += ".";
  return s;
}

/**
 * 旁白里不可能出现的词。真旁白是一个纯名词短语（"Listen to an announcement at a school
 * art exhibit."），没有人称、没有指示代词、没有疑问词 —— 实测 62 条真旁白一个都没有。
 * 这是把「切句没切干净、连上了正文」的残句挡在外面最有效的一条：
 * 实测还原出过 "Listen to an announcement at a time when you're ready." 和
 * "Listen to a talk in a mask that you completely missed something obvious?"
 * 两条，结构上都像旁白，但一个有 you're、一个有 that + you。
 */
const NARRATION_STOPWORDS = new Set([
  "you", "your", "youre", "yours", "i", "im", "ive", "we", "were", "weve", "they", "theyre",
  "he", "hes", "she", "shes", "it", "its", "me", "my", "our", "us",
  "that", "this", "these", "those", "what", "how", "why", "when", "who", "which",
]);
/** 真旁白最长 11 个词（"Listen to an announcement at a gathering of student club leaders."）。 */
const NARRATION_WORD_CAP = 13;

/**
 * 这道题该念哪句旁白。lcr 返回 null（真考没有）。
 * la/lat 用原句；洗不出**合法**旁白就退回通用句 —— 宁可少一句场景，也不能把
 * 正文的半句话当旁白念出来（那会直接剧透答案所在的那句）。
 */
function narrationTextFor(type, raw) {
  if (type === "lcr") return null;
  if (type === "lc") return NARRATION_DEFAULTS.lc;      // 53 条实测清一色，不逐条还原
  const def = NARRATION_DEFAULTS[type] || null;
  const s = cleanNarration(raw);
  if (!s) return def;
  const toks = normTokens(s);
  const ok = toks[0] === "listen"
    && s.endsWith(".")                                   // 真旁白全是陈述句
    && toks.length <= NARRATION_WORD_CAP
    && toks.some((t) => NARRATION_NOUNS.has(t))
    && !toks.some((t) => NARRATION_STOPWORDS.has(t));
  return ok ? s : def;
}

/**
 * TTS 兜底条目「这一轮要不要重拼旁白、用哪句」的判据。
 *
 * 背景（真实事故，2026-09-11）：`bind_original_audio.mjs --set="1.28新托福真题A卷"` 这样
 * 按卷增量跑时，TTS 兜底那一步没按 --set 收窄，把 8 条和 1.28A 毫不相干的条目一起重处理了；
 * 更糟的是这一轮的 narration_survey / plan 只覆盖 1.28A，那 8 条的旁白**还原不到**，
 * 于是退回通用句、重编码、重传同路径换了 ?v= —— 线上音频从
 * 「Listen to an announcement at the university bookstore.」退化成「Listen to an announcement.」，
 * 台账时长各短了 0.8–2.3s。丢的是真考的场景信息，而且是静默丢的。
 *
 * 所以判据落三条铁律：
 *   ① 范围外一律不碰（连下载都不下）；
 *   ② 台账里已有的具体旁白是**基线**，本轮还原不到就沿用台账，绝不退化成通用句；
 *   ③ 只有本轮还原出一句**更具体**（非通用句）且与台账不同的，才允许更新。
 *
 * @param {object} p
 * @param {object|null} p.existing  台账里已有的条目（tts-narration.json 的 entries[id]）
 * @param {string|null} p.recovered 本轮还原出来的旁白（可能为通用句，也可能 null）
 * @param {string|null} p.generic   这个题型的通用句（NARRATION_DEFAULTS[type]）
 * @param {boolean} p.inScope       本轮 --set / --ids / --only 是否覆盖这条
 * @param {string} [p.sha]          本轮口播文本 sha1（对不上说明正文改了，要重拼）
 * @param {string} [p.url]          题库里现在的 audio_url（对不上说明被别的流程动过）
 * @param {boolean} [p.redo]        --redo-tts-narration：强制重拼，但**不许换掉**基线旁白
 * @returns {{action:"skip"|"keep"|"update", text:string|null, why:string}}
 *   skip   = 什么都不做；keep = 用台账原来那句重拼；update = 用新的（更具体的）那句拼
 */
function decideTtsNarration(p) {
  const generic = p.generic || null;
  const existing = p.existing || null;
  const prevText = existing && existing.narration_text ? existing.narration_text : null;
  const recovered = p.recovered || null;
  const isGeneric = (s) => !s || (generic != null && s === generic);

  if (!p.inScope) return { action: "skip", text: prevText, why: "out_of_scope" };

  let text;
  let why;
  if (prevText) {
    if (recovered && !isGeneric(recovered) && recovered !== prevText) {
      text = recovered; why = "recovered_more_specific";
    } else {
      text = prevText; why = isGeneric(recovered) ? "keep_ledger_over_generic" : "ledger_unchanged";
    }
  } else {
    text = recovered || generic;
    why = recovered ? "recovered_new" : "generic_new";
  }
  if (!text) return { action: "skip", text: null, why: "no_text" };

  const matches = !!existing && existing.narration_text === text
    && (p.sha == null || existing.text_sha1 === p.sha)
    && (p.url == null || existing.url === p.url);
  if (matches && !p.redo) return { action: "skip", text, why: "unchanged" };
  if (!existing) return { action: "update", text, why };
  return { action: prevText === text ? "keep" : "update", text, why };
}

/* ── 逐条过闸 ───────────────────────────────────────────────────────────── */

/**
 * 任一条不过 → 这条不用原声（保持 TTS 现状）。返回 {pass, reasons[]}。
 * @param {object} m 量出来的值
 */
function gateDecision(m, opt) {
  const O = { ...DEFAULTS, ...(opt || {}) };
  const reasons = [];
  const dur = m.end - m.start;
  // 覆盖率：长文本按比例，短句按**漏词个数**。lcr 的口播就 5–11 个词，
  // Whisper 一个误听（"advisor"→"advice"、"studies"→"study"）就把比例打到 0.8，
  // 那不是数据有问题、是 ASR 噪声，不该毙掉一条能用的原声。
  const missed = m.targetTokens == null ? null : m.targetTokens - (m.matched || 0);
  const covOk = m.coverage >= O.minCoverage || (missed != null && missed <= O.maxMissTokens);
  if (!covOk) reasons.push("coverage_low");
  if (!(m.wpm >= O.minWpm && m.wpm <= O.maxWpm)) reasons.push("wpm_out_of_range");
  if (m.nextStart != null && m.end > m.nextStart - O.nextGuard + 1e-6) reasons.push("overruns_next");
  if (m.fileDuration != null && m.end > m.fileDuration + 1e-6) reasons.push("overruns_file");
  if (m.tailClean === false) reasons.push("tail_not_clean");
  if (!(dur >= O.minDuration)) reasons.push("too_short");
  return { pass: reasons.length === 0, reasons };
}

/** 口播词数 ÷ 切片时长 → WPM。 */
function wpmOf(words, seconds) {
  if (!(seconds > 0)) return 0;
  return (words / seconds) * 60;
}

/* ── 清单回挂（build_bank 重建时用） ─────────────────────────────────────── */

/**
 * 按清单把原声 URL 挂回**全量重建**出来的题库。
 *
 * build_bank 每次都重造条目对象（audio_url: null），清单是唯一能把原声接回来的东西。
 * 判据是 `sha1(spokenText(kind, item))` —— 口播文本变了（复核 patch 改了台词、
 * 换了说话人性别…）就**不挂**：那条原声对应的已经不是现在这道题了，宁可退回 TTS。
 *
 * @param {Record<string, object[]>} bundle {lcr: items[], lc: […], …}
 * @param {{entries: Record<string, {url:string, text_sha1:string}>}} manifest
 * @param {(kind:string, item:object)=>string} spokenTextFn build_bank 的口播指纹函数
 * @returns {{mounted:number, mismatched:string[], missing:string[]}}
 */
function applyOriginalAudio(bundle, manifest, spokenTextFn) {
  const entries = (manifest && manifest.entries) || {};
  const out = { mounted: 0, mismatched: [], missing: [] };
  const seen = new Set();
  for (const [kind, items] of Object.entries(bundle || {})) {
    for (const it of items || []) {
      const e = entries[it.id];
      if (!e || !e.url) continue;
      seen.add(it.id);
      if (sha1(spokenTextFn(kind, it)) !== e.text_sha1) { out.mismatched.push(it.id); continue; }
      it.audio_url = e.url;
      it.audio_source = "original";
      delete it.audio_pending;
      out.mounted += 1;
    }
  }
  for (const id of Object.keys(entries)) if (!seen.has(id)) out.missing.push(id);
  return out;
}

module.exports = {
  DEFAULTS,
  NARRATION_MAX_WORDS,
  NARRATION_DEFAULTS,
  cleanNarration,
  narrationTextFor,
  decideTtsNarration,
  normTokens,
  spokenPlainText,
  sha1,
  alignTokens,
  anchorOk,
  findNarration,
  findNarrationEnd,
  computeCut,
  resolveHead,
  resolveTail,
  gateDecision,
  wpmOf,
  applyOriginalAudio,
};
