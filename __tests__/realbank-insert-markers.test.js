/**
 * 真题阅读「插入句题 ■ 标记」找回链（scripts/realbank/insert_markers.js
 * + restore_insert_markers.py + insert_markers_apply.mjs）。
 *
 * 这条链决定「一段带 ■ 的正文能不能替换掉库里的材料」。判错一次就会把**另一篇文章**
 * 的正文塞进这道题（用户看到的材料与题目对不上），所以四条判据在这里逐条锁死：
 *   1. 恰好 4 个 ■，且不在首尾、不连着；
 *   2. 与原材料 token 覆盖率 ≥0.92（多重集合口径，虚词刷不上去）；
 *   3. 查表**按文本不按 id**（插入题被丢会让 build_bank 生成的 id 漂移）；
 *   4. 段落分隔（\n\n）要还原；还原不了就标 paragraphs_lost，不许静默压成一坨。
 */
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  normalizeForMatch,
  coverage,
  validateMarked,
  findMarkedPassage,
  applyMarkers,
  decideInsertMaterial,
} = require("../scripts/realbank/insert_markers.js");

const SCRIPTS = path.join(__dirname, "..", "scripts", "realbank");
const RESTORE_PY = path.join(SCRIPTS, "restore_insert_markers.py");
const APPLY_MJS = path.join(SCRIPTS, "insert_markers_apply.mjs");

/** 一段够长的正文（覆盖率是多重集合口径，太短的样本改一个词就掉 10 个点）。 */
const BODY_WORDS = [
  "Coral", "reefs", "grow", "slowly", "over", "many", "centuries", "and", "shelter", "countless",
  "species", "of", "fish", "warm", "shallow", "water", "helps", "the", "polyps", "build",
  "their", "limestone", "skeletons", "storms", "occasionally", "break", "large", "sections",
  "apart", "recovery", "then", "takes", "several", "decades", "scientists", "monitor",
  "the", "whole", "process", "with", "underwater", "cameras", "and", "regular", "surveys",
  "of", "the", "surrounding", "seabed", "today",
];
const PLAIN = BODY_WORDS.join(" ") + ".";

/** 在第 10/20/30/40 个词后插入 ■ —— 四个位置互相隔开远超 3 个词。 */
function markedFrom(words, at = [10, 20, 30, 40]) {
  const out = [];
  words.forEach((w, i) => {
    out.push(w);
    if (at.includes(i + 1)) out.push("■");
  });
  return out.join(" ") + ".";
}
const MARKED = markedFrom(BODY_WORDS);

describe("insert_markers · normalizeForMatch", () => {
  test("先去 ■ 与 [A]~[D]，再小写、只留字母数字、压空白", () => {
    expect(normalizeForMatch("Coral  reefs [A] grow ■ slowly.\n\nWarm-water HELPS (2026)! [ b ] end"))
      .toBe("coral reefs grow slowly warm water helps 2026 end");
  });

  test("[A] 必须在压标点之前删掉，否则会多出一个孤零零的词 a", () => {
    expect(normalizeForMatch("alpha [A] beta")).toBe("alpha beta");
    expect(normalizeForMatch("alpha (A) beta")).toBe("alpha a beta"); // 圆括号不是插入位标记
  });

  test("带标记版与不带标记版归一化后完全相同", () => {
    expect(normalizeForMatch(MARKED)).toBe(normalizeForMatch(PLAIN));
  });

  test("null / 数字等非字符串输入不炸", () => {
    expect(normalizeForMatch(null)).toBe("");
    expect(normalizeForMatch(undefined)).toBe("");
    expect(normalizeForMatch(42)).toBe("42");
  });
});

describe("insert_markers · coverage（多重集合口径）", () => {
  test("同一段文本覆盖率 1.0", () => {
    expect(coverage(MARKED, PLAIN)).toBe(1);
  });

  test("重复词只能领走一次：the/the/cat 对 the/cat 是 2/3 而不是 1.0", () => {
    expect(coverage("the cat", "the the cat")).toBeCloseTo(2 / 3, 10);
  });

  test("material 为空 → 0（不许当成满分放行）", () => {
    expect(coverage(MARKED, "")).toBe(0);
  });

  test("另一篇文章覆盖率很低", () => {
    expect(coverage("completely different sentences about railway signalling", PLAIN)).toBeLessThan(0.2);
  });
});

describe("insert_markers · validateMarked", () => {
  test("正常的四方块版本通过", () => {
    const v = validateMarked(MARKED, PLAIN);
    expect(v.ok).toBe(true);
    expect(v.squares).toBe(4);
    expect(v.problems).toEqual([]);
  });

  test("3 个 ■ 不收", () => {
    const v = validateMarked(markedFrom(BODY_WORDS, [10, 20, 30]), PLAIN);
    expect(v.ok).toBe(false);
    expect(v.squares).toBe(3);
    expect(v.problems).toContain("squares=3!=4");
  });

  test("5 个 ■ 同样不收", () => {
    const v = validateMarked(markedFrom(BODY_WORDS, [8, 16, 24, 32, 40]), PLAIN);
    expect(v.ok).toBe(false);
    expect(v.problems).toContain("squares=5!=4");
  });

  test("■ 在开头 / 结尾不收", () => {
    const head = validateMarked(`■ ${markedFrom(BODY_WORDS, [10, 20, 30])}`, PLAIN);
    expect(head.problems).toContain("square_at_start");
    const tail = validateMarked(`${markedFrom(BODY_WORDS, [10, 20, 30])} ■`, PLAIN);
    expect(tail.problems).toContain("square_at_end");
  });

  test("两个 ■ 之间不足 3 个词（含连着的）不收", () => {
    const glued = validateMarked(markedFrom(BODY_WORDS, [10, 11, 30, 40]), PLAIN);
    expect(glued.ok).toBe(false);
    expect(glued.problems.some((p) => p.startsWith("squares_too_close"))).toBe(true);
    // 正好 3 个词的间隔是允许的（边界向内）
    const ok = validateMarked(markedFrom(BODY_WORDS, [10, 13, 30, 40]), PLAIN);
    expect(ok.ok).toBe(true);
  });

  test("覆盖率边界：0.92 是收/不收的分界", () => {
    // 50 个词的正文，砍掉 3 个 = 覆盖率 0.94（收）；砍掉 5 个 = 0.90（不收）。
    const drop3 = markedFrom(BODY_WORDS.slice(0, 47));
    const v3 = validateMarked(drop3, PLAIN);
    expect(coverage(drop3, PLAIN)).toBeCloseTo(0.94, 5);
    expect(v3.ok).toBe(true);

    const drop5 = markedFrom(BODY_WORDS.slice(0, 45));
    const v5 = validateMarked(drop5, PLAIN);
    expect(coverage(drop5, PLAIN)).toBeCloseTo(0.90, 5);
    expect(v5.ok).toBe(false);
    expect(v5.problems.some((p) => p.startsWith("coverage="))).toBe(true);
  });

  test("完全另一篇文章：4 个 ■ 也不收（覆盖率兜底）", () => {
    const other = "railway ■ signalling systems ■ evolved from ■ mechanical levers ■ to relays";
    expect(validateMarked(other, PLAIN).ok).toBe(false);
  });
});

describe("insert_markers · findMarkedPassage（按文本，不按 id）", () => {
  const table = [
    { set: "3.10新托福真题", module: 1, q_number: 25, bank_id: "real_ap_310_1_21", marked: MARKED },
  ];

  test("归一化逐字相同 → 命中", () => {
    expect(findMarkedPassage(PLAIN, table)).toBe(table[0]);
  });

  test("bank_id 对不上也照样命中（id 会因为本次修复而漂移，不能当键）", () => {
    const hit = findMarkedPassage(PLAIN, [{ ...table[0], bank_id: "real_ap_310_1_25" }]);
    expect(hit).not.toBeNull();
    expect(hit.marked).toBe(MARKED);
  });

  test("id 一样但文本是另一篇 → 不命中", () => {
    const other = [{ ...table[0], marked: "railway ■ signalling ■ systems ■ and ■ relays" }];
    expect(findMarkedPassage(PLAIN, other)).toBeNull();
  });

  test("非逐字相同但覆盖率 ≥0.95 且唯一 → 命中", () => {
    const near = [{ ...table[0], marked: markedFrom(BODY_WORDS.slice(0, 49)) }];
    expect(findMarkedPassage(PLAIN, near)).toBe(near[0]);
  });

  test("两条都够像（都不是逐字相同）→ 不猜，返回 null", () => {
    const ambiguous = [
      { ...table[0], marked: markedFrom(BODY_WORDS.slice(0, 49)) },
      { ...table[0], q_number: 26, marked: markedFrom(BODY_WORDS.slice(0, 48)) },
    ];
    expect(findMarkedPassage(PLAIN, ambiguous)).toBeNull();
  });

  test("多条都够像、但带 ■ 原文逐字相同（同一份源文件在两场考试各录一次）→ 取第一条", () => {
    const dup = [
      { ...table[0], set: "3.21新托福真题", marked: markedFrom(BODY_WORDS.slice(0, 49)) },
      { ...table[0], set: "4.1新托福真题", marked: markedFrom(BODY_WORDS.slice(0, 49)) },
    ];
    expect(findMarkedPassage(PLAIN, dup)).toBe(dup[0]);
  });

  test("词完全一样但 ■ 挪了一个位置 → 仍然不猜", () => {
    const moved = [
      { ...table[0], marked: markedFrom(BODY_WORDS.slice(0, 49)) },
      { ...table[0], q_number: 26, marked: markedFrom(BODY_WORDS.slice(0, 49), [11, 20, 30, 40]) },
    ];
    expect(findMarkedPassage(PLAIN, moved)).toBeNull();
  });

  test("逐字相同优先于覆盖率兜底：有精确命中就不管还有几条很像", () => {
    const mixed = [
      { ...table[0], q_number: 26, marked: markedFrom(BODY_WORDS.slice(0, 49)) },
      { ...table[0], marked: MARKED },
    ];
    expect(findMarkedPassage(PLAIN, mixed)).toBe(mixed[1]);
  });

  test("空表 / 非数组 / 空材料 → null", () => {
    expect(findMarkedPassage(PLAIN, [])).toBeNull();
    expect(findMarkedPassage(PLAIN, null)).toBeNull();
    expect(findMarkedPassage("", table)).toBeNull();
  });
});

describe("insert_markers · applyMarkers（段落分隔还原）", () => {
  const p1 = "Coral reefs grow slowly over many centuries and shelter countless species of fish.";
  const p2 = "Warm shallow water helps the polyps build their limestone skeletons each year.";
  const p3 = "Storms occasionally break large sections apart and recovery then takes decades.";
  const multi = [p1, p2, p3].join("\n\n");
  const flatMarked = `${p1} ■ ${p2} ■ ${p3.replace("apart", "apart ■")} ■`
    .replace(/ ■$/, " and scientists ■ keep watching.");

  test("原材料多段、marked 一整块 → 段界按句尾锚点还原回去", () => {
    const one = `${p1} ■ ${p2} ■ ${p3} ■ Scientists ■ monitor the seabed.`;
    const r = applyMarkers(multi, one);
    expect(r.paragraphs_lost).toBe(false);
    const paras = r.text.split(/\n{2,}/);
    expect(paras).toHaveLength(3);
    expect(paras[0].startsWith("Coral reefs")).toBe(true);
    // 句号右边的那个 ■ 跟着上一段走（同一个插入点，归上一段更像原版面）
    expect(paras[0].endsWith("fish. ■")).toBe(true);
    expect(paras[1].startsWith("Warm shallow")).toBe(true);
    expect(paras[2].startsWith("Storms")).toBe(true);
    // 还原段落不许弄丢方块
    expect((r.text.match(/■/g) || []).length).toBe(4);
  });

  test("原材料本来就是一段 → 原样返回", () => {
    const r = applyMarkers(PLAIN, MARKED);
    expect(r).toEqual({ text: MARKED, paragraphs_lost: false });
  });

  test("marked 自己已经带段落分隔 → 不动它", () => {
    const already = `${p1} ■\n\n${p2} ■\n\n${p3} ■ and ■ more.`;
    const r = applyMarkers(multi, already);
    expect(r.text).toBe(already);
    expect(r.paragraphs_lost).toBe(false);
  });

  test("锚点找不回来（marked 把段尾改写了）→ 原样返回并标 paragraphs_lost", () => {
    const rewritten = "Totally rewritten ■ opening line here. Second ■ line differs. "
      + "Third ■ line differs too. Fourth ■ line as well.";
    const r = applyMarkers(multi, rewritten);
    expect(r.text).toBe(rewritten);
    expect(r.paragraphs_lost).toBe(true);
  });

  test("flatMarked 这类带尾巴的文本也能还原前两段", () => {
    const r = applyMarkers(multi, flatMarked);
    expect(r.paragraphs_lost).toBe(false);
    expect(r.text.split(/\n{2,}/)).toHaveLength(3);
  });
});

describe("insert_markers · decideInsertMaterial（三种结局）", () => {
  test("表里没有 → restored:false，材料原样返回", () => {
    const d = decideInsertMaterial(PLAIN, []);
    expect(d).toEqual({ material: PLAIN, restored: false, entry: null, problems: ["no_entry"] });
  });

  test("查得到但校验不过 → restored:false，材料原样返回，problems 说明原因", () => {
    const bad = [{ set: "s", module: 1, q_number: 25, marked: markedFrom(BODY_WORDS, [10, 20, 30]) }];
    const d = decideInsertMaterial(PLAIN, bad);
    expect(d.restored).toBe(false);
    expect(d.material).toBe(PLAIN);
    expect(d.entry).toBe(bad[0]);
    expect(d.problems).toContain("squares=3!=4");
  });

  test("查得到且校验通过 → restored:true，材料换成带 ■ 的版本", () => {
    const table = [{ set: "s", module: 1, q_number: 25, marked: MARKED, by: "qwen3-vl", verified: true }];
    const d = decideInsertMaterial(PLAIN, table);
    expect(d.restored).toBe(true);
    expect((d.material.match(/■/g) || []).length).toBe(4);
    expect(normalizeForMatch(d.material)).toBe(normalizeForMatch(PLAIN));
    expect(d.problems).toEqual([]);
  });

  test("段落还原不了仍然救题，但把 paragraphs_lost 报出来", () => {
    const multi = "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu.\n\n"
      + "Nu xi omicron pi rho sigma tau upsilon phi chi psi omega done.";
    // Qwen 把第一段末尾那个词转错了（mu → mv）→ 段尾锚点找不回来，但覆盖率 24/25 仍够。
    const rewritten = "Alpha beta ■ gamma delta epsilon zeta eta theta iota kappa lambda mv "
      + "nu xi ■ omicron pi rho sigma ■ tau upsilon phi chi psi ■ omega done.";
    const d = decideInsertMaterial(multi, [{ marked: rewritten }]);
    expect(d.restored).toBe(true);
    expect(d.problems).toContain("paragraphs_lost");
    expect(d.material).toBe(rewritten);
  });
});

/* ── 两个 CLI：python 自检 + apply --dry-run ─────────────────────────────── */
function findPython() {
  for (const exe of [process.env.PYTHON, "D:/python/python", "python", "python3"]) {
    if (!exe) continue;
    const probe = spawnSync(exe, ["-c", "import sys; assert sys.version_info >= (3, 8)"], { encoding: "utf8" });
    if (probe.status === 0) return exe;
  }
  return null;
}

const PY = findPython();
const maybePy = PY ? test : test.skip;

describe("insert_markers · CLI", () => {
  maybePy("restore_insert_markers.py --self-test（todo 抽取 / 候选初检 / 跨语言 normalize）", () => {
    const out = execFileSync(PY, ["-X", "utf8", RESTORE_PY, "--self-test"], { encoding: "utf8" });
    expect(out).toContain("SELF-TEST OK");
  });

  test("insert_markers_apply.mjs --dry-run：过校验的收、不过的报原因，且不写任何文件", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "insmark-"));
    try {
      const bankDir = path.join(dir, "bank");
      fs.mkdirSync(bankDir);
      fs.writeFileSync(path.join(bankDir, "ap.json"),
        JSON.stringify({ items: [{ id: "real_ap_x_1_21", passage: PLAIN }] }), "utf8");
      fs.writeFileSync(path.join(bankDir, "rdl.json"), JSON.stringify({ items: [] }), "utf8");

      const table = path.join(bankDir, "insert-markers.json");
      fs.writeFileSync(table, JSON.stringify({ _purpose: "t", entries: [] }, null, 2), "utf8");

      const cands = path.join(dir, "candidates.json");
      fs.writeFileSync(cands, JSON.stringify({
        candidates: [
          { set: "卷A", module: 1, q_number: 25, bank_id: "real_ap_x_1_21", marked: MARKED, model: "qwen3-vl-plus", source_page: "p3 #1" },
          { set: "卷A", module: 2, q_number: 30, bank_id: "real_ap_x_1_21", marked: markedFrom(BODY_WORDS, [10, 11, 30, 40]) },
          { set: "卷A", module: 2, q_number: 31, bank_id: "real_ap_missing", marked: MARKED },
        ],
      }), "utf8");

      const out = execFileSync(process.execPath,
        [APPLY_MJS, "--dry-run", "--candidates", cands, "--table", table, "--bank-dir", bankDir],
        { encoding: "utf8", cwd: dir });
      expect(out).toContain("卷A|M1|Q25");
      expect(out).toMatch(/squares_too_close/);
      expect(out).toMatch(/real_ap_missing/);
      expect(out).toContain("新增 1");
      expect(out).toContain("拒收 2");
      // --dry-run 不许动表
      expect(JSON.parse(fs.readFileSync(table, "utf8")).entries).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("insert_markers_apply.mjs 真跑：写表、同键覆盖、保留 _purpose", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "insmark-"));
    try {
      const bankDir = path.join(dir, "bank");
      fs.mkdirSync(bankDir);
      fs.writeFileSync(path.join(bankDir, "ap.json"),
        JSON.stringify({ items: [{ id: "real_ap_x_1_21", passage: PLAIN }] }), "utf8");

      const table = path.join(bankDir, "insert-markers.json");
      fs.writeFileSync(table, JSON.stringify({
        _purpose: "keep me",
        entries: [
          { set: "卷A", module: 1, q_number: 25, marked: "旧的", by: "人工", verified: false },
          { set: "卷B", module: 1, q_number: 9, marked: "别动我", by: "人工", verified: true },
        ],
      }, null, 2), "utf8");

      const cands = path.join(dir, "candidates.json");
      fs.writeFileSync(cands, JSON.stringify({
        candidates: [{ set: "卷A", module: 1, q_number: 25, bank_id: "real_ap_x_1_21", marked: MARKED }],
      }), "utf8");

      execFileSync(process.execPath,
        [APPLY_MJS, "--candidates", cands, "--table", table, "--bank-dir", bankDir],
        { encoding: "utf8", cwd: dir });

      const after = JSON.parse(fs.readFileSync(table, "utf8"));
      expect(after._purpose).toBe("keep me");
      expect(after.entries).toHaveLength(2);
      const hit = after.entries.find((e) => e.set === "卷A" && e.q_number === 25);
      expect(hit.marked).toBe(MARKED);
      expect(hit.by).toBe("qwen3-vl");
      expect(hit.verified).toBe(true);
      expect(after.entries.find((e) => e.set === "卷B").marked).toBe("别动我");

      // 写出来的表能被 decideInsertMaterial 直接消费
      const d = decideInsertMaterial(PLAIN, after.entries);
      expect(d.restored).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("insert-markers.json 初始表", () => {
  test("形状合法：带 _purpose/_format/_workflow，entries 是数组", () => {
    const t = JSON.parse(fs.readFileSync(
      path.join(__dirname, "..", "data", "realBank", "reading", "insert-markers.json"), "utf8"));
    expect(typeof t._purpose).toBe("string");
    expect(typeof t._format).toBe("string");
    expect(typeof t._workflow).toBe("string");
    expect(Array.isArray(t.entries)).toBe(true);
    // 表里的每条都得过自校验（marked 恰好 4 个 ■）
    for (const e of t.entries) {
      expect(validateMarked(e.marked, e.marked).squares).toBe(4);
    }
  });

  test("空表时 decideInsertMaterial 不改材料（接线前后行为一致）", () => {
    const d = decideInsertMaterial(PLAIN, []);
    expect(d.material).toBe(PLAIN);
    expect(d.restored).toBe(false);
  });
});

describe("insert_markers · labelSquares（■ → [A]~[D]）", () => {
  const { labelSquares, INSERT_LABELS } = require("../scripts/realbank/insert_markers.js");

  test("恰好 4 个 ■ 按出现顺序标成 [A]~[D]", () => {
    const out = labelSquares(MARKED);
    expect(out).not.toMatch(/■/);
    const at = INSERT_LABELS.map((l) => out.indexOf(l));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test("不是恰好 4 个 ■ → 原样返回，不猜", () => {
    const three = markedFrom(BODY_WORDS, [10, 20, 30]);
    expect(labelSquares(three)).toBe(three);
  });
});

describe("insert_markers · promoteInsertItem（0 选项被判 flagged 的插入题转正）", () => {
  const { promoteInsertItem } = require("../scripts/realbank/insert_markers.js");
  const STEM = "There are four locations [■] in the passage that indicate where the following sentence could be added.";
  const TABLE = [{ set: "卷A", module: 1, q_number: 35, marked: MARKED, by: "qwen3-vl", verified: true }];

  test("标记表有这段材料 → 材料标 [A]~[D]、选项固定 [A]~[D]、按答案页字母盖下标", () => {
    const r = promoteInsertItem({ stem: STEM, material: PLAIN, options: [], answer_key: "c" }, TABLE, "c");
    expect(r.ok).toBe(true);
    expect(r.item.options).toEqual(["[A]", "[B]", "[C]", "[D]"]);
    expect(r.item.answer_index).toBe(2);
    expect(r.item.answer_text).toBe("[C]");
    expect(r.item.material).toMatch(/\[A\][\s\S]*\[B\][\s\S]*\[C\][\s\S]*\[D\]/);
    expect(r.item.material).not.toMatch(/■/);
    expect(r.item.stem).toMatch(/four locations \[A\]-\[D\]/);
    expect(r.item.insert_restored.by).toBe("qwen3-vl");
  });

  test("标记表里没有 → 不转正（与 build_bank 换材料同一套判据，fail-closed）", () => {
    const r = promoteInsertItem({ stem: STEM, material: PLAIN }, [], "c");
    expect(r.ok).toBe(false);
    expect(r.problems).toContain("no_entry");
  });

  test("答案页不是 a~d 单字母 → 不转正", () => {
    expect(promoteInsertItem({ stem: STEM, material: PLAIN }, TABLE, "e").ok).toBe(false);
    expect(promoteInsertItem({ stem: STEM, material: PLAIN }, TABLE, "").ok).toBe(false);
    expect(promoteInsertItem({ stem: STEM, material: PLAIN }, TABLE, "ab").ok).toBe(false);
  });
});
