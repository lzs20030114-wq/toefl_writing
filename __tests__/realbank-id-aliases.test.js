/**
 * 真题阅读 id 别名账本的锁（scripts/realbank/id_aliases.js → data/realBank/reading/id-aliases.json）。
 *
 * 前端靠它把练习记录 / 错题本里「已经不存在的旧 id」接到新 id 上；apply_review 靠它把复核清单搬到归位后的
 * 条目上；assemble_sets 靠它把被合并掉的 id 原位还回原场次。三处都要求：链收敛到**活着的** id、
 * 跨重建累积不丢条目、合并链绝不当成「同一份材料换了 id」。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildIdAliases, reclassifiedRedirects, typeOfId } = require("../scripts/realbank/id_aliases.js");

const by = (ledger) => Object.fromEntries(ledger.aliases.map((a) => [a.from, a]));

describe("buildIdAliases", () => {
  test("契约形状 + 按 from 升序", () => {
    const l = buildIdAliases({
      edges: [
        { from: "real_ap_53_1_32", to: "real_ap_128a_1_27", reason: "consolidated" },
        { from: "real_ap_310_1_25", to: "real_rdl_310_1_25", reason: "reclassified" },
      ],
      liveIds: ["real_ap_128a_1_27", "real_rdl_310_1_25"],
      generated: "2026-09-13",
    });
    expect(l).toEqual({
      generated_by: "scripts/realbank/build_bank.mjs",
      generated: "2026-09-13",
      aliases: [
        { from: "real_ap_310_1_25", to: "real_rdl_310_1_25", from_type: "ap", to_type: "rdl", reason: "reclassified" },
        { from: "real_ap_53_1_32", to: "real_ap_128a_1_27", from_type: "ap", to_type: "ap", reason: "consolidated" },
      ],
    });
  });

  test("链收敛：归位之后又被合并 → 一路指到活着的那条，原因记 consolidated", () => {
    const l = by(buildIdAliases({
      edges: [
        { from: "real_ap_41_1_25", to: "real_rdl_41_1_25", reason: "reclassified" },
        { from: "real_rdl_41_1_25", to: "real_rdl_311_1_25", reason: "consolidated" },
      ],
      liveIds: ["real_rdl_311_1_25"],
    }));
    expect(l.real_ap_41_1_25).toMatchObject({ to: "real_rdl_311_1_25", to_type: "rdl", reason: "consolidated" });
    expect(l.real_rdl_41_1_25).toMatchObject({ to: "real_rdl_311_1_25", reason: "consolidated" });
  });

  test("跨重建累积：上一版的条目保留并重新收敛（上一版的 to 这一版又被合掉了）", () => {
    const prev = { aliases: [{ from: "real_ap_a_1_31", to: "real_ap_b_1_31", from_type: "ap", to_type: "ap", reason: "consolidated" }] };
    const l = by(buildIdAliases({
      prev,
      edges: [{ from: "real_ap_b_1_31", to: "real_ap_c_1_31", reason: "consolidated" }],
      liveIds: ["real_ap_c_1_31"],
    }));
    expect(l.real_ap_a_1_31.to).toBe("real_ap_c_1_31");
    expect(l.real_ap_b_1_31.to).toBe("real_ap_c_1_31");
  });

  test("收敛不到活 id → to: null（条目本身不删）", () => {
    const prev = { aliases: [{ from: "real_ap_gone_1_31", to: "real_ap_held_1_31", from_type: "ap", to_type: "ap", reason: "consolidated" }] };
    const l = by(buildIdAliases({ prev, edges: [], liveIds: ["real_ap_other_1_31"] }));
    expect(l.real_ap_gone_1_31).toEqual({ from: "real_ap_gone_1_31", to: null, from_type: "ap", to_type: null, reason: "consolidated" });
    // 再累积一轮，null 的条目照样保留
    const again = by(buildIdAliases({ prev: { aliases: Object.values(l) }, edges: [], liveIds: [] }));
    expect(again.real_ap_gone_1_31.to).toBeNull();
  });

  test("旧 id 又活过来了（上一版合掉的副本这一版成了代表）→ to 指向它自己", () => {
    const prev = { aliases: [{ from: "real_ap_a_1_31", to: "real_ap_b_1_31", from_type: "ap", to_type: "ap", reason: "consolidated" }] };
    const l = by(buildIdAliases({ prev, edges: [{ from: "real_ap_b_1_31", to: "real_ap_a_1_31", reason: "consolidated" }], liveIds: ["real_ap_a_1_31"] }));
    expect(l.real_ap_a_1_31.to).toBe("real_ap_a_1_31");
    expect(l.real_ap_b_1_31.to).toBe("real_ap_a_1_31");
  });

  test("复核清单里带 dup_of 的整条下架也是边：归位 → 被 dup_of 下架 → 收敛到保留方（不是 null）", () => {
    // real_rdl_x_1_23 归位成 real_ap_x_1_23，复核清单按旧 id 判它是 real_ap_keep_1_31 的跨套重复、整条下架
    const l = by(buildIdAliases({
      edges: [{ from: "real_rdl_x_1_23", to: "real_ap_x_1_23", reason: "reclassified" }],
      holds: [{ file: "reading/rdl", id: "real_rdl_x_1_23", scope: "unit", dup_of: "real_ap_keep_1_31", reason: "跨套重复" }],
      liveIds: ["real_ap_keep_1_31"],
    }));
    expect(l.real_rdl_x_1_23).toEqual({ from: "real_rdl_x_1_23", to: "real_ap_keep_1_31", from_type: "rdl", to_type: "ap", reason: "consolidated" });
    // 归位出来的中间 id 只用来走链，不单独出条目（从没上过线，没有用户记录挂在它上面）
    expect(l.real_ap_x_1_23).toBeUndefined();
  });

  test("没有归位、直接被 dup_of 下架的旧 id → 收敛到保留方；保留方自己归位了也跟着走", () => {
    const l = by(buildIdAliases({
      edges: [{ from: "real_ap_keep_1_25", to: "real_rdl_keep_1_25", reason: "reclassified" }],
      holds: [{ file: "reading/ap", id: "real_ap_dup_1_25", scope: "unit", dup_of: "real_ap_keep_1_25", reason: "跨套重复" }],
      liveIds: ["real_rdl_keep_1_25"],
    }));
    expect(l.real_ap_dup_1_25).toMatchObject({ to: "real_rdl_keep_1_25", to_type: "rdl", reason: "consolidated" });
  });

  test("没有 dup_of 的整条下架（材料坏了、没有保留方）仍然是 null", () => {
    const l = by(buildIdAliases({
      edges: [{ from: "real_rdl_bad_1_33", to: "real_ap_bad_1_33", reason: "reclassified" }],
      holds: [{ file: "reading/rdl", id: "real_rdl_bad_1_33", scope: "unit", reason: "全篇丢空格不可读" }],
      liveIds: ["real_ap_other_1_31"],
    }));
    expect(l.real_rdl_bad_1_33).toMatchObject({ to: null, to_type: null, reason: "reclassified" });
  });

  test("清单边不压过本次重建的边；单题下架 / 非阅读题型的清单条目不算边", () => {
    const l = by(buildIdAliases({
      edges: [{ from: "real_ap_a_1_31", to: "real_ap_b_1_31", reason: "consolidated" }],
      holds: [
        { file: "reading/ap", id: "real_ap_a_1_31", scope: "unit", dup_of: "real_ap_c_1_31", reason: "x" },
        { file: "reading/ap", id: "real_ap_q_1_31", scope: "question", q: 1, stem: "Q", dup_of: "real_ap_c_1_31", reason: "y" },
        { file: "listening/lc", id: "real_lc_z_1_13", scope: "unit", dup_of: "real_lc_k_1_13", reason: "z" },
      ],
      liveIds: ["real_ap_b_1_31", "real_ap_c_1_31"],
    }));
    expect(l.real_ap_a_1_31.to).toBe("real_ap_b_1_31");
    expect(l.real_ap_q_1_31).toBeUndefined();
    expect(l.real_lc_z_1_13).toBeUndefined();
  });

  test("清单边是 consolidated：apply_review 的重定向表不收它（绝不沿跨套重复把保留方删掉）", () => {
    const ledger = buildIdAliases({
      edges: [],
      holds: [{ file: "reading/ap", id: "real_ap_dup_1_25", scope: "unit", dup_of: "real_ap_keep_1_25", reason: "跨套重复" }],
      liveIds: ["real_ap_keep_1_25"],
    });
    expect(reclassifiedRedirects(ledger).size).toBe(0);
  });

  test("成环不死循环", () => {
    const l = by(buildIdAliases({
      edges: [{ from: "real_ap_a_1_1", to: "real_ap_b_1_1", reason: "consolidated" }, { from: "real_ap_b_1_1", to: "real_ap_a_1_1", reason: "consolidated" }],
      liveIds: [],
    }));
    expect(l.real_ap_a_1_1.to).toBeNull();
  });

  test("typeOfId", () => {
    expect(typeOfId("real_rdl_310_1_25")).toBe("rdl");
    expect(typeOfId("real_ctw_310_1_1")).toBeNull();
  });
});

describe("reclassifiedRedirects：只沿「同一份材料换了 id」的链搬", () => {
  test("consolidated / to 为 null 的一律不进重定向表", () => {
    const r = reclassifiedRedirects({ aliases: [
      { from: "real_ap_310_1_25", to: "real_rdl_310_1_25", from_type: "ap", to_type: "rdl", reason: "reclassified" },
      { from: "real_ap_53_1_32", to: "real_ap_128a_1_27", from_type: "ap", to_type: "ap", reason: "consolidated" },
      { from: "real_ap_x_1_25", to: null, from_type: "ap", to_type: null, reason: "reclassified" },
    ] });
    expect([...r.keys()]).toEqual(["real_ap_310_1_25"]);
    expect(r.get("real_ap_310_1_25")).toEqual({ file: "reading/rdl", id: "real_rdl_310_1_25", fromType: "ap" });
  });
});

/* ── apply_review 经别名生效（端到端，临时目录）─────────────────────────── */

describe("applyReview：条目归位 / 合并后，清单照样生效", () => {
  const { applyReview } = require("../scripts/realbank/apply_review.mjs");
  let root;
  const bankDir = () => path.join(root, "data", "realBank");
  const write = (rel, obj) => { const p = path.join(bankDir(), rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj)); };
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(bankDir(), rel), "utf8"));
  const q = (n, stem) => ({ question_type: "detail", stem, options: { A: `a${n}`, B: `b${n}`, C: `c${n}`, D: `d${n}` }, correct_answer: "A", q_number: n });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "realbank-review-alias-"));
    // 归位后的产物：通知从 ap 挪到了 rdl；另一篇被合并进 keep
    write("reading/ap.json", { items: [
      { id: "real_ap_keep_1_31", passage: "Title\n\nBody one. Body two.", paragraphs: ["Title", "Body one. Body two."], questions: [q(31, "Keep question?")] },
    ] });
    write("reading/rdl.json", { items: [
      { id: "real_rdl_323_1_28", text: "Rules and Regulations\n\nNo pets allowd.", genre: "notice", questions: [q(28, "Who can use the gym?"), q(29, "What is banned?")] },
      { id: "real_rdl_other_1_21", text: "Other", genre: "notice", questions: [q(21, "Other?")] },
    ] });
    write("reading/ctw.json", { items: [] });
    // applyReview 末尾会重算各科 counts.json（目录得在）
    for (const d of ["listening", "speaking"]) fs.mkdirSync(path.join(bankDir(), d), { recursive: true });
    write("review-holds.json", {
      holds: [
        // 记在归位前的旧 file+id 上：必须搬过去生效
        { file: "reading/ap", id: "real_ap_323_1_28", scope: "question", q: 1, stem: "What is banned", reason: "歧义" },
        { file: "reading/ap", id: "real_ap_other_1_21", scope: "unit", reason: "材料串了" },
        // 记在被合并掉的副本上：绝不能搬到保留方头上把它删掉
        { file: "reading/ap", id: "real_ap_dropped_1_31", scope: "unit", reason: "副本坏了", dup_of: "real_ap_keep_1_31" },
      ],
      patches: [
        { file: "reading/ap", id: "real_ap_323_1_28", path: "passage", op: "replace", from: "allowd", to: "allowed" },
      ],
    });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const aliases = { aliases: [
    { from: "real_ap_323_1_28", to: "real_rdl_323_1_28", from_type: "ap", to_type: "rdl", reason: "reclassified" },
    { from: "real_ap_other_1_21", to: "real_rdl_other_1_21", from_type: "ap", to_type: "rdl", reason: "reclassified" },
    { from: "real_ap_dropped_1_31", to: "real_ap_keep_1_31", from_type: "ap", to_type: "ap", reason: "consolidated" },
  ] };

  test("归位：单题下架 / 整条下架 / patch（passage → text）都搬到新 file+id", () => {
    const r = applyReview({ root, aliases });
    const rdl = read("reading/rdl.json").items;
    const notice = rdl.find((x) => x.id === "real_rdl_323_1_28");
    expect(notice.questions.map((x) => x.stem)).toEqual(["Who can use the gym?"]);
    expect(notice.text).toContain("No pets allowed.");
    expect(rdl.some((x) => x.id === "real_rdl_other_1_21")).toBe(false);
    expect(r.stats).toMatchObject({ patched: 1, units: 1, questions: 1, redirected: 3 });
  });

  test("合并：记在副本上的整条下架不许搬到保留方", () => {
    applyReview({ root, aliases });
    expect(read("reading/ap.json").items.map((x) => x.id)).toEqual(["real_ap_keep_1_31"]);
  });

  test("没有传账本就读磁盘上的 id-aliases.json", () => {
    write("reading/id-aliases.json", aliases);
    const r = applyReview({ root });
    expect(r.stats.redirected).toBe(3);
    expect(read("reading/rdl.json").items.find((x) => x.id === "real_rdl_323_1_28").questions).toHaveLength(1);
  });

  test("单题下架按 stem 前缀定位：题目下标漂了（前面挂上了一道新题）照样扣对那一道", () => {
    const ap = read("reading/ap.json");
    ap.items[0].questions = [q(30, "A brand new question?"), q(31, "Keep question?"), q(32, "Ambiguous one?")];
    write("reading/ap.json", ap);
    const holds = read("review-holds.json");
    holds.holds.push({ file: "reading/ap", id: "real_ap_keep_1_31", scope: "question", q: 1, stem: "Ambiguous one", reason: "歧义（记账时它排第 2）" });
    write("review-holds.json", holds);
    applyReview({ root, aliases });
    expect(read("reading/ap.json").items[0].questions.map((x) => x.stem)).toEqual(["A brand new question?", "Keep question?"]);
  });

  test("AP 的 passage 被 patch 过，paragraphs 跟着重切（点选句子题按 paragraphs 定位）", () => {
    const holds = read("review-holds.json");
    holds.patches.push({ file: "reading/ap", id: "real_ap_keep_1_31", path: "passage", op: "replace", from: "Body two.", to: "Body two fixed." });
    write("review-holds.json", holds);
    applyReview({ root, aliases });
    expect(read("reading/ap.json").items[0].paragraphs).toEqual(["Title", "Body one. Body two fixed."]);
  });
});

/* ── 按题号认领 → 别名账本 → apply_review（端到端）─────────────────────── */

describe("按题号认领的清单 id：补题改名 / 换了题型之后，下架照样落地", () => {
  const { applyReview } = require("../scripts/realbank/apply_review.mjs");
  const { claimReferencedIds } = require("../scripts/realbank/id_carry.js");
  let root;
  const bankDir = () => path.join(root, "data", "realBank");
  const write = (rel, obj) => { const p = path.join(bankDir(), rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj)); };
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(bankDir(), rel), "utf8"));
  const qn = (n) => ({ question_type: "detail", stem: `Question ${n}?`, options: { A: `a${n}`, B: `b${n}`, C: `c${n}`, D: `d${n}` }, correct_answer: "A", q_number: n });

  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "realbank-claim-")); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  /** 模拟 build_bank：认领 → 算账本 → 落盘 → applyReview。返回 applyReview 的统计。 */
  const buildLike = (bundle, review) => {
    const claim = claimReferencedIds(bundle, review);
    write("reading/ap.json", { items: bundle.ap });
    write("reading/rdl.json", { items: bundle.rdl });
    write("reading/ctw.json", { items: [] });
    for (const d of ["listening", "speaking"]) fs.mkdirSync(path.join(bankDir(), d), { recursive: true });
    write("review-holds.json", review);
    const aliases = buildIdAliases({ edges: claim.edges, holds: review.holds, liveIds: [...bundle.ap, ...bundle.rdl].map((x) => x.id) });
    return { claim, stats: applyReview({ root, aliases }).stats };
  };

  test("补题改名（_30 → _28）：清单按旧 id 记的整条下架仍然把它删掉", () => {
    const review = { holds: [{ file: "reading/rdl", id: "real_rdl_128b_1_30", scope: "unit", reason: "内容缺陷（Trendie Boutique）" }], patches: [] };
    const { stats } = buildLike({ ap: [], rdl: [{ id: "real_rdl_128b_1_28", text: "Trendie Boutique", genre: "ad", questions: [qn(28), qn(29), qn(30)] }] }, review);
    expect(read("reading/rdl.json").items).toEqual([]);
    expect(stats.units).toBe(1);
  });

  test("kind 也变了（清单记 ap，条目归位成 rdl）：顺着认领记的 reclassified 边搬到 rdl 删掉", () => {
    const review = { holds: [{ file: "reading/ap", id: "real_ap_46_2_13", scope: "unit", reason: "P2 结尾被截" }], patches: [] };
    const bundle = { ap: [], rdl: [{ id: "real_rdl_46_2_11", text: "Video Evidence in U.S. Courts", genre: "article", questions: [qn(11), qn(13)] }] };
    const { claim, stats } = buildLike(bundle, review);
    expect(claim.edges).toEqual([{ from: "real_ap_46_2_13", to: "real_rdl_46_2_13", reason: "reclassified" }]);
    expect(read("reading/rdl.json").items).toEqual([]);
    expect(stats).toMatchObject({ units: 1, redirected: 1 });
  });

  test("按 id 记的 patch 跟着认领落地（改名后照样打上）", () => {
    const review = { holds: [], patches: [{ file: "reading/ap", id: "real_ap_325_1_23", path: "passage", op: "replace", from: "Award Winnr", to: "Award Winner" }] };
    const bundle = { ap: [{ id: "real_ap_325_1_21", passage: "Award Winnr Returns", paragraphs: ["Award Winnr Returns"], questions: [qn(21), qn(23)] }], rdl: [] };
    buildLike(bundle, review);
    expect(read("reading/ap.json").items[0]).toMatchObject({ id: "real_ap_325_1_23", passage: "Award Winner Returns" });
  });
});
