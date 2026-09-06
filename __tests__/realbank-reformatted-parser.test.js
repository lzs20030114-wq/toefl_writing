/**
 * 重排版真题解析器（scripts/realbank/parse_reformatted.py）的回归测试。
 *
 * 解析器是 Python（源料是 docx，Python 侧读 OOXML 最省事），所以这里用 jest 驱动一个
 * 子进程跑它，再断言产物 —— 测的是**真正会被跑的那个脚本**，不是一份 JS 复刻实现。
 *
 * fixture 是 tests/fixtures/realbank/reformatted-mini/9.9（5 KB 的手写最小 docx 套题，
 * 由同目录 make_fixture.py 生成）。刻意不碰桌面上的真实套题：那些不在仓库里，
 * 引用它们的测试在别的机器上必然红。
 *
 * 覆盖的四处「坏了最贵」的地方：
 *   1. CTW 挖空还原：`kite h _ _` + 答案 "had" → passage 补回原词、blanks 前缀/长度都对；
 *   2. 造句：模板 + 词库 → chunks / distractors（词库里没被答案用到的块）；
 *   3. Answers 文本解析：行内分号式与 `Sentence Construction Qn:` 式都要认；
 *   4. 听力题号 → 逐题音频路径映射，且状态必须是 deferred（本期不许落库）。
 */
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "realbank", "reformatted-mini", "9.9");
const SCRIPT = path.join(ROOT, "scripts", "realbank", "parse_reformatted.py");
// 产物落到独立的临时目录：默认目录 .codex-tmp/realbank 是 build_bank 的输入，
// fixture 的假卷混进去会被当成真题汇进题库。
const OUT_DIR = path.join(ROOT, ".codex-tmp", "realbank-test");
const OUT = path.join(OUT_DIR, "rf0909.structured.json");

function pythonBin() {
  for (const bin of ["python", "python3", "py"]) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (!r.error && r.status === 0) return bin;
  }
  return null;
}

const PY = pythonBin();
const maybe = PY ? describe : describe.skip;

maybe("重排版真题解析器", () => {
  let data;

  beforeAll(() => {
    execFileSync(PY, [SCRIPT, FIXTURE, "--out-dir", OUT_DIR], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  });

  const byType = (type) => data.results.filter((r) => r.type === type);

  test("setkey 用 rf 前缀，与旧源的中文卷名 key 空间不相交", () => {
    expect(data.set).toBe("rf0909");
    expect(data.model).toBe("reformatted-parser-v1");
  });

  test("CTW：`词 _ _` 还原成完整词，blanks 的前缀与隐藏长度都对得上", () => {
    const ctw = byType("ctw");
    expect(ctw).toHaveLength(1);
    expect(ctw[0].status).toBe("ok");
    const item = ctw[0].items[0];
    expect(item.blanks).toEqual([
      { word: "had", given: "h" },
      { word: "long", given: "lo" },
      { word: "pull", given: "pu" },
    ]);
    // 回填后的段落里不许再有下划线占位，且三个答案词都要在
    expect(item.passage).not.toMatch(/_/);
    expect(item.passage).toContain("Each kite had a light frame");
    expect(item.passage).toContain("two long tails");
    expect(item.passage).toContain("would pull them into the wind");
    // build_bank.buildCtw 的硬契约：答案词必须以屏幕上给定的前缀开头
    for (const b of item.blanks) {
      expect(b.word.toLowerCase().startsWith(b.given.toLowerCase())).toBe(true);
      expect(b.word.length).toBeGreaterThan(b.given.length);
    }
  });

  test("RDL：表格里的材料被收进来，答案字母盖成 answer_index", () => {
    const rdl = byType("rdl");
    expect(rdl).toHaveLength(1);
    expect(rdl[0].status).toBe("ok");
    expect(rdl[0].items).toHaveLength(2);
    const q21 = rdl[0].items.find((x) => x.q_number_raw === 21);
    expect(q21.material).toContain("The main library will close at six o'clock");
    expect(q21.options).toHaveLength(4);
    expect(q21.answer_key).toBe("B");
    expect(q21.answer_index).toBe(1);
    expect(q21.answer_text).toBe("At six o'clock");
    // 题号带 module 前缀（module*100+q），保证 audit 的 `reading#<q>` 键跨 module 不撞
    expect(q21.q_number).toBe(121);
  });

  test("AP：学术短文标题起新块，材料不与前一道 RDL 混淆", () => {
    const ap = byType("ap");
    expect(ap).toHaveLength(1);
    const item = ap[0].items[0];
    expect(item.material).toContain("Researchers studying memory");
    expect(item.material).not.toContain("Library Hours Notice");
    expect(item.answer_key).toBe("B");
  });

  test("造句：模板 + 词库 → chunks / distractors，答案来自答案页", () => {
    const build = byType("build");
    expect(build).toHaveLength(1);
    expect(build[0].status).toBe("ok");
    const [q1, q2] = build[0].items;
    expect(q1.id).toBe("bs_rf0909_01");
    expect(q1.prompt).toBe("Are you planning to attend the seminar next week?");
    expect(q1.answer).toBe("I have no intention of going to the seminar.");
    expect(q1.blanks).toMatch(/^_{5}( _{5}){6}\.$/);
    expect(q1.chunks).toContain("no intention");
    expect(q1.distractors).toEqual([]); // 七个块全被答案用掉了
    // 词库里有一块 "were" 在答案里找不到 → 干扰项
    expect(q2.answer).toBe("Unfortunately I missed the early bus.");
    expect(q2.distractors).toEqual(["were"]);
    expect(q2.blanks).toContain("I");
  });

  test("邮件：情境 / 三条要求 / 收件人 / 主题都从表格里抠出来", () => {
    const email = byType("email");
    expect(email[0].status).toBe("ok");
    const item = email[0].items[0];
    expect(item.to).toBe("Nina");
    expect(item.subject).toBe("Request for laboratory handouts");
    expect(item.scenario).toContain("missed a laboratory session");
    expect(item.goals).toHaveLength(3);
    expect(item.goals[0]).toBe("Explain why you missed the laboratory session.");
  });

  test("听力：题号映射到逐题音频，且整块 deferred（本期不落库）", () => {
    const listening = data.results.filter((r) => r.section === "listening");
    expect(listening.length).toBeGreaterThan(0);
    for (const r of listening) expect(r.status).toBe("deferred");
    const lcr = listening.find((r) => r.type === "lcr" || r.type === "listening_mcq");
    expect(lcr.items[0].audio_path).toBe("audio/item_level/listening_m1_q01_choose_response.mp3");
    const lc = listening.find((r) => r.type === "lc");
    expect(lc.items.map((x) => x.q_number_raw)).toEqual([13, 14]);
    expect(lc.items[0].audio_path).toBe(
      "audio/item_level/listening_m1_q13_q14_conversation_trip.mp3"
    );
    expect(lc.items[0].transcript).toContain("Should we take the train");
  });

  test("缺文件 fail-soft：没有 Speaking.docx 只记 problem，不炸整套", () => {
    const speaking = data.results.filter((r) => r.section === "speaking");
    expect(speaking).toHaveLength(1);
    expect(speaking[0].status).toBe("flagged");
    expect(speaking[0].problems.join(" ")).toContain("缺 Speaking 文档");
    // 其余科目照常产出
    expect(data.tally.ok).toBeGreaterThanOrEqual(5);
  });
});
