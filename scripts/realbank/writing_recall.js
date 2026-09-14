/**
 * 第一来源（截图卷）的邮件 / 学术讨论补录 —— 纯函数，无 IO。
 * build_bank.mjs 与 recall_writing.mjs 做读写，jest 直接测这里。
 *
 * ── 为什么要有这一支（2026-09-14 丢题回收核出来的）──
 * 真题专区的邮件 / 学术讨论此前**只有** parse_reformatted.py（rf/rp 第二来源 docx）产出。
 * 第一来源 52 套截图卷一道都没有，而且不是「跑失败了」，是**从来没被处理过**：
 *   · structure_set 靠答案页的题号对题，邮件 / 讨论没有标准答案 → 对齐层不给它们生成题块；
 *   · routeType 对写作块也只会判 build。所以 `--only-failed --sections writing` 重扫多少遍都是空转。
 * 但同一批卷的这两道题早在 2026-05 做校准时抽过一次（OCR + DeepSeek 结构化），
 * 落在 data/realExam2026/writing/{email,academicDiscussion}.json，只是一直没接进真题专区。
 * 讨论那份只存了教授最后一句提问；整段原话 36 条在 scripts/research/ad_eval/prof_posts_real.json
 * （逐字转写），其余对着原卷截图补。
 *
 * 核过的内容落在 data/realBank/writing-recall.json（每套卷一条，带与该卷 OCR 的覆盖率），
 * build_bank 只读那份账本 —— 不在构建时依赖 .codex-tmp 里的 OCR（云端 Worker 不一定有），
 * 核对在本机离线做、结论进 git。
 *
 * ── 三条硬约束 ──
 * 1. **只追加**：已入库的 rf/rp 题排在前面、id 不动。前端「第 N 套」按入库顺序编号，
 *    练习记录按 id 记；插到前面 = 老题序号整体漂移，改 id = 用户的已练记录失联。
 * 2. **同一道题只收一条**：不同日期考同一道题很常见（52 套里邮件只有 33 道不同的题）。
 *    已入库的优先；都没入库时取卷名排序最靠前、且过得了闸的那一套；
 *    其余卷记成别名（from → to），assemble_sets 靠别名把「这一场也考了这道题」还回原卷槽位。
 * 3. **闸门**：字段结构闸（与 lib/realBank.js 的前端过滤同口径、再严一点）+
 *    账本里记录的 OCR 覆盖率闸（防止抽取阶段编造 / 串卷的内容上线）。
 */

// 与 structure_set.mjs 同一份判据（那边是模块内常量，没导出）。
const CJK = /[一-鿿]/;
const WATERMARK = /闲鱼|盗卖|退款|店铺|甜茶|满分小屋|唯一闲/;

/**
 * OCR 覆盖率的放行线（连续三个词拼接后在该卷 OCR 粘连文本里能找到的比例）。
 *
 * 实测（2026-09-14，realExam2026 51 邮件 + 43 条整段教授原话 + 49 组学生帖，逐条对自己那套卷的 OCR）：
 *   自己那套卷：邮件最低 0.811 / 中位 0.933；教授原话最低 0.725 / 中位 1.0；学生帖最低 0.61 / 中位 0.941
 *   别的卷（排除同一道题、同一份 PDF 复制进两个文件夹的）：p90 ≤ 0.16，最高 0.163
 * 两团之间空着一大截，0.5 放在中间。它挡得住「整段编的 / 串了别的卷」，
 * 挡不住「五句里编一句」—— 那种要靠人对原卷抽查，这道闸不假装能做到。
 */
const OCR_TRIGRAM_MIN = 0.5;

/**
 * 两道题算不算同一道：实质词（≥4 字母、去掉模板虚词）的 Jaccard。
 * 实测邮件两两之间：同一道题 ≥ 0.6，不同题 ≤ 0.36（话题相近的「借笔记」两道 0.357），中间是空的；
 * 教授原话更干净：不是 1.0 就是 < 0.2。取 0.5。
 */
const SAME_PROMPT_JACCARD = 0.5;

const STOP = new Set((
  "the a an and or of to in on for with is are be you your that this it as at by from have has will can do does not "
  + "what which who why how their they them we our us i my me he she his her its was were been would should could "
  + "about into than then so if but more most some others other also think believe argue discussing"
).split(" "));

const countWords = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

function words(s) {
  return String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
}

/** OCR 常把单词粘在一起（"havenoticedsomeissues"），比对前两边都去掉一切非字母数字。 */
function glue(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function contentWords(s) {
  return new Set(words(s).filter((w) => w.length >= 4 && !STOP.has(w)));
}

function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/**
 * 连续三词覆盖率。单词级覆盖率没有区分度（整卷 OCR 里什么常用词都有，实测自己 / 别人都≈1.0），
 * 三词连起来才带得出「这句话确实在这张卷上」的信息。
 * @returns {{hit:number,total:number,ratio:number}} 不足三词时 total=0、ratio=1（不据此判死）
 */
function trigramCoverage(text, ocrGlued) {
  const ws = words(text);
  let hit = 0, total = 0;
  for (let i = 0; i + 2 < ws.length; i += 1) {
    total += 1;
    if (ocrGlued.includes(ws[i] + ws[i + 1] + ws[i + 2])) hit += 1;
  }
  return { hit, total, ratio: total ? hit / total : 1 };
}

/* ── 形状 ─────────────────────────────────────────────────────────────── */

/**
 * 排版归一：弯引号 → 直引号、连续空白 → 一个空格。
 * 原卷截图常用弯撇号（We’ve / room’s）、句号后双空格；库里现有的写作题（rf/rp + realExam2026）
 * 全是直撇号 —— 转写照屏幕原样抄回来会让同一个库两种撇号混用。只动排版，不动字。
 */
function tidy(s) {
  return String(s || "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

/**
 * realExam2026 的邮件条目 → 账本里的内容形状（与 data/realBank/writing/email.json 的 item 对齐，不含 meta）。
 * direction 优先用对着原卷转写的整句：原卷常带收件人身份（"Write an email to the lost and found manager,
 * Ms. Davis."），前端 WritingPromptPanel 把这句当要求栏标题显示，身份丢了题意就缺一块。
 * 没转写过的才照 rf 题的写法补成 "Write an email to X."。前端没有 direction 的整条不显示。
 */
function emailFromGt(gt) {
  const to = tidy(gt?.recipient || gt?.to);
  return {
    to,
    subject: tidy(gt?.subject),
    scenario: tidy(gt?.scenario),
    direction: tidy(gt?.direction) || (to ? `Write an email to ${to}.` : ""),
    goals: (Array.isArray(gt?.bullets) ? gt.bullets : Array.isArray(gt?.goals) ? gt.goals : [])
      .map(tidy).filter(Boolean),
  };
}

/**
 * 左栏课程句 → 课程名（大小写照原卷）。认不出返回空串。三种句式都见过：
 *   "Your professor is teaching a class on art history."        （绝大多数）
 *   "Your professor is teaching a course on social psychology."  （3.25）
 *   "Your professor is teaching an art history class."          （5.23）
 */
function courseFromLine(line) {
  const s = tidy(line);
  const on = s.match(/teaching\s+a\s+(?:class|course)\s+on\s+(.+?)\s*\.?$/i);
  if (on) return on[1].trim();
  const pre = s.match(/teaching\s+an?\s+(.+?)\s+class\s*\.?$/i);
  return pre ? pre[1].trim() : "";
}

/** 讨论题内容形状（与 discussion.json 的 item 对齐，不含 meta）。 */
function discussionShape({ course, professor, students }) {
  return {
    course: tidy(course),
    professor: { name: tidy(professor?.name), text: tidy(professor?.text) },
    students: (Array.isArray(students) ? students : [])
      .map((s) => ({ name: tidy(s?.name), text: tidy(s?.text) }))
      .filter((s) => s.name || s.text),
  };
}

/* ── 结构闸 ───────────────────────────────────────────────────────────── */

function textProblems(blob) {
  const p = [];
  if (CJK.test(blob)) p.push("英文字段里混入中文");
  if (WATERMARK.test(blob)) p.push("水印未清干净");
  if (/�/.test(blob)) p.push("含替换字符 U+FFFD（编码丢字）");
  if (/\[\?\]/.test(blob)) p.push("含看不清的占位 [?]");
  return p;
}

function emailProblems(e) {
  const p = [];
  if (countWords(e.scenario) < 15) p.push(`情境过短（${countWords(e.scenario)} 词）`);
  if (!e.to) p.push("缺收件人");
  else if (countWords(e.to) > 6) p.push(`收件人不像人名（${e.to}）`);
  if (!e.subject) p.push("缺主题");
  if (!e.direction) p.push("缺 direction");
  if (e.goals.length !== 3) p.push(`要求不是 3 条（${e.goals.length}）`);
  e.goals.forEach((g, i) => { if (countWords(g) < 3) p.push(`第 ${i + 1} 条要求过短`); });
  p.push(...textProblems([e.to, e.subject, e.scenario, ...e.goals].join(" ")));
  return p;
}

/**
 * @param {object} d  discussionShape 的结果
 * @param {string} [question] realExam2026 抽到的教授提问句：整段原话里必须找得到它，
 *                            否则多半是配错了卷（原话按日期手工对应，有串的风险）。
 */
function discussionProblems(d, question) {
  const p = [];
  // 前端 WritingPromptPanel 没有课程名时显示 "a class on social studies" —— 等于替原卷编一门课
  if (!d.course) p.push("缺课程名（原卷看不到就别上，前端会补成默认的 social studies）");
  if (!d.professor.name) p.push("缺教授署名");
  const pw = countWords(d.professor.text);
  if (pw < 25) p.push(`教授发言过短（${pw} 词，多半只抽到了提问句）`);
  if (!d.professor.text.includes("?")) p.push("教授发言里没有问句");
  const q = glue(question);
  if (q.length >= 20 && !glue(d.professor.text).includes(q.slice(0, Math.min(q.length, 60)))) {
    p.push("教授原话里找不到已抽到的提问句（疑似配错卷）");
  }
  if (d.students.length < 2) p.push(`学生帖不足 2 条（${d.students.length}）`);
  d.students.slice(0, 2).forEach((s, i) => {
    if (!s.name) p.push(`第 ${i + 1} 位同学缺署名`);
    if (countWords(s.text) < 15) p.push(`第 ${i + 1} 位同学的帖子过短（${countWords(s.text)} 词，疑似截断）`);
  });
  p.push(...textProblems([d.course, d.professor.name, d.professor.text, ...d.students.map((s) => `${s.name} ${s.text}`)].join(" ")));
  return p;
}

/* ── OCR 核对（离线，结论写进账本）────────────────────────────────────── */

/**
 * 逐字段算覆盖率。整体比例低于放行线直接判死；单个长字段（≥5 个三词组）一个都对不上也判死 ——
 * 防的是「整体被别的字段拉高、某一段整个是编的」。
 * @param {Array<[string,string]>} fields  [[字段名, 文本], ...]
 */
function ocrVerdict(fields, ocrGlued, min = OCR_TRIGRAM_MIN) {
  let hit = 0, total = 0;
  const perField = {};
  const problems = [];
  for (const [name, text] of fields) {
    const c = trigramCoverage(text, ocrGlued);
    perField[name] = c.total ? +c.ratio.toFixed(3) : null;
    hit += c.hit; total += c.total;
    if (c.total >= 5 && c.hit === 0) problems.push(`${name} 在该卷 OCR 里一句都对不上`);
  }
  const ratio = total ? hit / total : 0;
  if (!total) problems.push("没有可核对的文本");
  else if (ratio < min) problems.push(`与该卷 OCR 的三词覆盖率 ${ratio.toFixed(3)} < ${min}`);
  return { ratio: +ratio.toFixed(3), perField, ok: problems.length === 0, problems };
}

function emailFields(e) {
  return [["scenario", e.scenario], ["subject", e.subject], ...e.goals.map((g, i) => [`goals[${i}]`, g])];
}

function discussionFields(d) {
  return [["professor.text", d.professor.text], ...d.students.map((s, i) => [`students[${i}].text`, s.text])];
}

/* ── 同一道题判等 ─────────────────────────────────────────────────────── */

function sameEmail(a, b) {
  return jaccard(contentWords(`${a.scenario} ${a.subject}`), contentWords(`${b.scenario} ${b.subject}`)) >= SAME_PROMPT_JACCARD;
}

/** 讨论：整段原话的实质词 Jaccard；任一边只有提问句时退回「一边的提问句包含在另一边里」。 */
function sameDiscussion(a, b) {
  const ta = a.professor?.text || "", tb = b.professor?.text || "";
  if (jaccard(contentWords(ta), contentWords(tb)) >= SAME_PROMPT_JACCARD) return true;
  const ga = glue(ta), gb = glue(tb);
  const short = ga.length <= gb.length ? ga : gb, long = ga.length <= gb.length ? gb : ga;
  return short.length >= 40 && long.includes(short.slice(-Math.min(short.length, 80)));
}

/* ── 写作整科被扣时，补录还收不收 ─────────────────────────────────────── */

/**
 * 源料体检把一套卷的写作整科扣下（severity=blocking）时，邮件 / 讨论补录照收的扣留码。
 * 这两条说的都是**答案页**或**造句题面**的毛病，而邮件 / 讨论没有答案页、也不走造句那条链路，
 * 内容来自逐条对过原卷截图的补录账本：
 *   · ingest_blocker     答案页解析出现无科目头的题号重启块（fail-closed 忽略了一段答案）；
 *   · section_no_stems   写作科 OCR 里找不到造句题块（配对 0 题）。
 * 造句照旧整科扣着 —— 答案页有问题正会让造句答案出错。不在清单里的扣留码，补录也不收。
 * 2026-09-14 用户拍板：6 套被扣的写作卷（2.23 / 2.8 / 3.10 / 3.24 / 3.29 / 4.18）放行邮件与讨论。
 */
const RECALL_IGNORES_HOLD = Object.freeze(["ingest_blocker", "section_no_stems"]);

/** @param {string[]} heldBy  holdDecision 返回的扣留码 */
function recallAllowedDespiteHold(heldBy) {
  return Array.isArray(heldBy) && heldBy.length > 0 && heldBy.every((c) => RECALL_IGNORES_HOLD.includes(c));
}

/* ── 编排：谁进库、谁记别名、谁丢 ─────────────────────────────────────── */

/**
 * @param {object}   opts
 * @param {"email"|"discussion"} opts.type
 * @param {Array}    opts.existing    本次构建里已经从结构化产物收下的同类题（rf/rp），带 id
 * @param {Array}    opts.candidates  按卷名排序的补录候选：{ set, id, item, problems: string[] }
 *                                    item = 内容 + meta（已带 id）；problems 非空 = 过不了闸
 * @returns {{accepted: Array, aliases: Array<{from,to,from_type,to_type,reason}>, dropped: Array<{set,id,code,detail}>}}
 */
function planRecall({ type, existing, candidates }) {
  const same = type === "email" ? sameEmail : sameDiscussion;
  const aliasType = type === "email" ? "email" : "disc";
  const accepted = [];
  const aliases = [];
  const dropped = [];
  for (const c of candidates) {
    if (c.problems && c.problems.length) {
      dropped.push({ set: c.set, id: c.id, code: "recall_gate", detail: c.problems.join("；") });
      continue;
    }
    const live = (existing || []).find((x) => same(x, c.item));
    if (live) {
      aliases.push({ from: c.id, to: live.id, from_type: aliasType, to_type: aliasType, reason: "duplicate_of_live" });
      dropped.push({ set: c.set, id: c.id, code: "duplicate_of_live", detail: `与已入库的 ${live.id} 是同一道题` });
      continue;
    }
    const prior = accepted.find((x) => same(x, c.item));
    if (prior) {
      aliases.push({ from: c.id, to: prior.id, from_type: aliasType, to_type: aliasType, reason: "duplicate_prompt" });
      dropped.push({ set: c.set, id: c.id, code: "duplicate_prompt", detail: `与 ${prior.source} 的 ${prior.id} 是同一道题` });
      continue;
    }
    accepted.push(c.item);
  }
  return { accepted, aliases, dropped };
}

module.exports = {
  OCR_TRIGRAM_MIN, SAME_PROMPT_JACCARD, RECALL_IGNORES_HOLD, recallAllowedDespiteHold,
  glue, trigramCoverage, contentWords, jaccard,
  emailFromGt, courseFromLine, discussionShape, emailProblems, discussionProblems,
  ocrVerdict, emailFields, discussionFields,
  sameEmail, sameDiscussion, planRecall,
};
