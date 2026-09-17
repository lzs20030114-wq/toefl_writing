/**
 * 数字卷「整块录音、没有听力原文」听力合流（scripts/realbank/merge_recording_asr.py）的防退化闸。
 *
 * 合流本体是 Python（要复用 merge_first_source_asr.build_listening 与 merge_vendor_asr 的基频 / 归一化工具），
 * 所以断言写在脚本自己的 `--self-test` 里（纯函数 + 合成词序列 / 合成正弦，不碰真实录音 / 网络），
 * 这里只负责把它接进 `npx jest`：闸坏了 → self-test 非 0 退出 → 这条测试红。
 *
 * 覆盖的闸（详见脚本 self_test）：
 *   · 蓝图总题数（M1 32 / M2 A、B 型 15）
 *   · 断句（缩写不断）、ETS 旁白认题材（最先出现的关键词 / 缺 "Listen" 也认 / 问句与长句不认）
 *   · 按静音切岛 → 开场提示 / LCR / 材料三类标签；"Can you turn down the volume?" 不被当成音量提示
 *   · 按「LCR → 材料」切 module；蓝图对照：缺旁白按位置补、旁白与蓝图矛盾 / LCR 数不对 / 校验和不对 / 怪岛 各自扣下
 *   · 旁白被词级时间戳错挂到上一岛尾巴 → 挪回下一岛（下一岛自带旁白时不挪）；没说完的尾巴挪到下一岛
 *   · 开场音量提示的变体说法；旁白与正文之间没句号时按停顿切；续写片段拼词不加空格
 *   · 录音暂停切开（句末收尾 + 大写开头）并回、半句断开（断流）不并；正文缺失 / 幻觉循环 / 远短于真题下限 → 单组扣下
 *   · 录音整段缺一条材料：唯一异常空档（对话/通知/LCR 之后 >60s）处插占位；两处空档不猜、讲座后的长留白不当缺段
 *   · 句级基频分角色：同一人连说 7 句不误杀、只有一个人 / 连说 10 句判不出
 *   · 题干引原话反查角色：原话落在另一个人那一轮 → 扣下
 *   · 跨卷近似重复：LCR 逐字 / 听错一词但选项一致；对话词级相似度 + 长度比；本卷自己的条目不算
 *
 * 另外钉住 build_bank 这边的两条配套约定（源码级断言，改名/删掉会红）：
 *   · `--only-audio` 口子必须做音频沿用 + 面试拆套 + 原声回挂（2026-09-16 实测漏了会把全库听力音频清空）
 *   · 整块录音来源的题没挂上原声不收（lDroppedNoOriginalAudio 已登记进丢弃账本）
 *
 * 环境里没有 python / numpy 就跳过（CI 不装 python 时不该把整条测试链拖红）。
 */
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SCRIPT = path.join(__dirname, "..", "scripts", "realbank", "merge_recording_asr.py");
const BUILD_BANK = path.join(__dirname, "..", "scripts", "realbank", "build_bank.mjs");

function findPython() {
  for (const exe of [process.env.PYTHON, "D:/python/python", "python", "python3"]) {
    if (!exe) continue;
    const probe = spawnSync(exe, ["-c", "import fitz, numpy"], { encoding: "utf8" });
    if (probe.status === 0) return exe;
  }
  return null;
}

const PY = findPython();
const maybe = PY ? describe : describe.skip;

maybe("realbank 整块录音听力合流", () => {
  test("--self-test 全过（切岛/旁白/蓝图/分角色/近似重复各闸）", () => {
    const out = execFileSync(PY, ["-X", "utf8", SCRIPT, "--self-test"], {
      encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    expect(out).toContain("SELF-TEST OK");
  });
});

describe("build_bank 与整块录音合流的配套约定", () => {
  const src = fs.readFileSync(BUILD_BANK, "utf8");

  test("--only-audio 口子做音频沿用、复核后二次沿用、面试拆套、原声回挂", () => {
    const start = src.indexOf('if (process.argv.includes("--only-audio")) {');
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf('if (process.argv.includes("--only-writing-recall")) {', start);
    const branch = src.slice(start, end);
    for (const call of ["carryAudioUrls(", "recarryOnDisk(", "applyInterviewSplitsOnDisk(", "mountOriginalAudio()"]) {
      expect([call, branch.includes(call)]).toEqual([call, true]);
    }
  });

  test("dup_of 只记别名、不登记去重锚点、不依赖本卷盲审；没挂上原声的整块录音题不收", () => {
    expect(src).toContain('const RECORDING_MERGER = "merge_recording_asr-v1"');
    const start = src.indexOf("|| !r.dup_of || !out[r.type]) continue;");
    expect(start).toBeGreaterThan(0);
    const dup = src.slice(start, src.indexOf("const kept = [];", start));
    expect(dup).toContain("itemAliasEdges.push(dupEdge(");
    expect(dup).not.toContain("seenL.set(");
    // 别名循环在盲审闸（if (passedKeys && !listeningHeld)）之前
    expect(dup.indexOf("itemAliasEdges.push(dupEdge(")).toBeLessThan(dup.indexOf("if (passedKeys && !listeningHeld) {"));
    expect(src).toContain('code: "lDroppedNoOriginalAudio"');
    const { DROP_CODES } = require("../scripts/realbank/drop_ledger.js");
    expect(DROP_CODES.lDroppedNoOriginalAudio).toMatchObject({ scope: "unit", section: "listening" });
  });
  test("口语也过「切不出原声就不上线」这道闸（复述按句、面试按题）", () => {
    // 闸只拦整块录音来源，且 --keep-unbound-recording 那一趟（先落库再切片）不拦
    const fn = src.slice(src.indexOf("function keepSpeaking("), src.indexOf("function dupEdge("));
    expect(fn).toContain("if (!recordingMerged || KEEP_UNBOUND_RECORDING) return true;");
    expect(fn).toContain("hasOriginalAudio(kind, u)");
    expect(fn).toContain('code: "sDroppedNoOriginalAudio"');
    // 闸完剩不下一套就整套不收（复述 validator 的硬线是 5 句）
    expect(fn).toContain("const v = validate(set);");
    for (const kind of ["repeat", "interview"]) {
      const at = src.indexOf(`keepSpeaking("${kind}"`);
      expect([kind, at > 0]).toEqual([kind, true]);
      const branch = src.slice(src.lastIndexOf(`real_${kind}_`, at), at + 900);
      const gateAt = branch.indexOf(`keepSpeaking("${kind}"`);
      // ① 查重复在原声闸之前：重复卷只记别名，不需要自己的音频 —— 闸放前面会把它们的别名一起丢
      //   （2026-09-16 实测 8 套）
      expect([kind, branch.indexOf("if (seenS.has(sk))") >= 0 && branch.indexOf("if (seenS.has(sk))") < gateAt]).toEqual([kind, true]);
      // ② 登记保留方在原声闸之后：过不了闸的卷不许占着保留方位置 —— 否则后面内容相同、自带干净原声的卷
      //   被当重复跳过，两边都没了（3.27 只切出 3 句 → 挡掉 rf0808 整套 7 句，2026-09-17）
      const regAt = branch.indexOf("seenS.set(sk,");
      expect([kind, regAt > gateAt]).toEqual([kind, true]);
      // ③ 过不了闸的卷记下来，等同内容的保留方登记时补成别名（它那一卷的槽位也能回来）
      expect([kind, branch.indexOf("gatedOutS.set(sk,") > gateAt && branch.indexOf("adoptGatedOut(sk,") > regAt]).toEqual([kind, true]);
    }
    const { DROP_CODES } = require("../scripts/realbank/drop_ledger.js");
    expect(DROP_CODES.sDroppedNoOriginalAudio).toMatchObject({ scope: "unit", section: "speaking" });
  });
});

maybe("面试题干（ASR + 四道机械闸）", () => {
  test("闸都在 --self-test 里（认旁白 / 恰好 4 道 / 剥应答词不剥前提句 / 词数与句末标点）", () => {
    const out = execFileSync(PY, ["-X", "utf8", SCRIPT, "--self-test"], {
      encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    expect(out).toContain("SELF-TEST OK");
  });

  test("落库时 from_asr 立旗，且第四道闸（切不出原声不上线）对面试同样生效", () => {
    const src = fs.readFileSync(BUILD_BANK, "utf8");
    expect(src).toContain('from_asr: (it.problems || []).includes("stem_from_asr")');
    expect(src).toContain('keepSpeaking("interview"');
  });
});

/**
 * 源料体检 blocking 的**逐科**判定（2026-09-17）。
 * 以前是 `lHold.held && sHold.held` 一条整卷条件，面试被顺带扣着：2.8 / 3.24 / 4.18 的
 * ingest_blocker detail 写的是**阅读 / 听力**答案页的题号重启块，3.8 是 section_gap[listening]，
 * 说的都不是口语面试 —— 而面试题干既不在答案页也不在题面屏上，只在录音里。
 */
describe("build_bank：听力 / 复述 / 面试逐科判 blocking", () => {
  const src = fs.readFileSync(BUILD_BANK, "utf8");
  const block = src.slice(src.indexOf("const lHold = holdFor(setname"), src.indexOf("// ── 口语 ──"));

  test("听力按自己的 lHold 判（并可逐 module 收窄），复述沿用原来那条整卷条件（口径不放宽）", () => {
    // 2026-09-17 再加一层：flag 带 `modules: [2]` 时只扣那个 module（3.8 听力 M2 在答案源里整个缺席）。
    // 「整科扣下」= 每个 module 都被扣 —— 没有 modules 字段的 flag 逐 module 问结果与整科问一样，老行为不变。
    expect(block).toContain("const listeningHeld = lHold.held && LISTENING_MODULES.every((m) => listeningHeldIn(m));");
    expect(block).toContain("const repeatHeld = lHold.held && sHold.held;");
    // 听力三处出口都带上 listeningHeld：盲审缺失的记账、dup_of 别名循环、盲审闸主循环
    expect(block).toContain("if (!passedKeys && !listeningHeld) {");
    expect(block).toContain("for (const r of listeningHeld ? [] : st.results || []) {");
    expect(block).toContain("if (passedKeys && !listeningHeld) {");
  });

  test("复述被 repeatHeld 拦、面试不被任何 hold 拦（题干只在录音里，四道机械闸照旧）", () => {
    const spk = src.slice(src.indexOf("// ── 口语 ──"), src.indexOf("stats.itemAliases = aliasEntries("));
    expect(spk).toContain('if (r.type === "repeat" && repeatHeld) continue;');
    expect(spk).not.toContain("interview\" && repeatHeld");
    expect(spk).not.toContain("sHold");        // 面试那一支不许再挂上 speaking 的 hold
  });

  test("整卷跳过那条 continue 已经拆掉（否则面试还是被连坐）", () => {
    expect(src).not.toContain("if (lHold.held && sHold.held) {");
  });
});

/**
 * 口语补录路径撞上跨卷重复时也要记别名（2026-09-17）。
 * 主路径（dupEdge / adoptGatedOut）早就记了，补录那一路以前只 continue ——
 * 2.1C 的复述 7 句就是这么丢的（内容一直躺在 rf0622 上）。
 */
describe("build_bank：口语补录的跨卷重复也记别名", () => {
  const src = fs.readFileSync(BUILD_BANK, "utf8");

  test("recallSpeaking 收到别名数组，撞重复时 push 一条 dupEdge", () => {
    expect(src).toContain("function recallSpeaking(spk, seenS, stats, itemAliasEdges = []) {");
    const fn = src.slice(src.indexOf("function recallSpeaking("), src.indexOf("const REPEAT_DIFF ="));
    const dupAt = fn.indexOf('code: "sDroppedDupSet", detail: `补录内容与');
    expect(dupAt).toBeGreaterThan(0);
    expect(fn.indexOf("itemAliasEdges.push(dupEdge(id, seenS.get(sk), type, setname));")).toBeGreaterThan(dupAt);
  });

  test("账本在 recallSpeaking 之后才结算（排在前面补录那几条会被漏掉）", () => {
    expect(src.indexOf("recallSpeaking(spk, seenS, stats, itemAliasEdges);"))
      .toBeLessThan(src.indexOf("stats.itemAliases = aliasEntries(itemAliasEdges);"));
  });
});

/**
 * 商家逐题 mp3 的卷「文档没印题干」时也收 ASR（2026-09-17）——
 * 与整段录音卷同一把尺（trim_interview_stem 已搬到 merge_vendor_asr，两边共用），四道机械闸整组判。
 */
const VENDOR = path.join(__dirname, "..", "scripts", "realbank", "merge_vendor_asr.py");
const IV_PROBE = String.raw`
import json, sys
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
import merge_vendor_asr as V

def seg(*texts):
    return {"segments": [{"text": t} for t in texts]}

files = ["speaking_take_interview_q%02d.mp3" % i for i in range(1, 5)]
n = {f: i + 1 for i, f in enumerate(files)}
good = [
    seg("Take an interview. An interviewer will ask you questions.",
        "You have volunteered for a research study about public parks.",
        "Thank you for participating in this study.",
        "First, can you tell me about a memorable visit you made to a park?"),
    seg("I see. Do you think parks matter more for adults or for children? Why?"),
    seg("Interesting. Some people believe parks promote community health.",
        "What are your thoughts on this? Do you agree or disagree?"),
    seg("Good points. Finally, cities must choose between parks and housing.",
        "Do you think housing matters more than parks? Why?"),
]
out = {}
out["ok"] = V.interview_asr_group(files, n, dict(zip(files, good)))
out["only3"] = V.interview_asr_group(files[:3], {f: n[f] for f in files[:3]},
                                     dict(zip(files[:3], good[:3])))
noq = list(good); noq[1] = seg("I see. Describe a park you like.")
out["no_question_mark"] = V.interview_asr_group(files, n, dict(zip(files, noq)))
short = list(good); short[1] = seg("I see. Why?")
out["too_short"] = V.interview_asr_group(files, n, dict(zip(files, short)))
long_ = list(good); long_[1] = seg("I see. " + " ".join(["word"] * 70) + " right?")
out["too_long"] = V.interview_asr_group(files, n, dict(zip(files, long_)))
split = list(good)
# Whisper 把一句话断在词中间：拼成整段再断句才剥得干净（rf0708 Q1 实测）
split[0] = seg("You have signed up for a study run by a university group that is investigating public",
               "parks and recreation.",
               "Thank you for participating in this study.",
               "First, can you tell me about a memorable visit you made to a park?")
out["glued"] = V.interview_asr_group(files, n, dict(zip(files, split)))
print(json.dumps(out, ensure_ascii=False))
`;

maybe("商家逐题 mp3 的面试题干（文档没印时收 ASR）", () => {
  let r;
  beforeAll(() => {
    const out = execFileSync(PY, ["-X", "utf8", "-c", IV_PROBE, path.dirname(VENDOR)], {
      encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" },
    });
    r = JSON.parse(out.trim().split(/\r?\n/).pop());
  });

  test("四道题都过闸才收，剥掉指令 / 场景 / 应答词，前提句留着", () => {
    expect(Object.keys(r.ok)).toEqual(["1", "2", "3", "4"]);
    expect(r.ok["1"]).toBe("Can you tell me about a memorable visit you made to a park?");
    expect(r.ok["2"]).toBe("Do you think parks matter more for adults or for children? Why?");
    expect(r.ok["3"]).toMatch(/^Some people believe parks promote community health\./);
  });

  test("不是恰好 4 个逐题文件 / 少一个问号 / 词数越界 → 整组不收（不给半套）", () => {
    for (const k of ["only3", "no_question_mark", "too_short", "too_long"]) {
      expect([k, r[k]]).toEqual([k, {}]);
    }
  });

  test("Whisper 把句子断在词中间也剥得干净（拼成整段再断句）", () => {
    expect(r.glued["1"]).toBe("Can you tell me about a memorable visit you made to a park?");
  });
});

describe("build_bank：题干来自 ASR 的面试组一律过原声闸", () => {
  test("不再只看 recordingMerged —— 商家逐题 mp3 的卷不是它，早先会绕过第四道闸", () => {
    const src = fs.readFileSync(BUILD_BANK, "utf8");
    expect(src).toContain("const ivFromAsr = questions.some((q) => q.from_asr);");
    expect(src).toContain('keepSpeaking("interview", set, "questions", questions, recordingMerged || ivFromAsr,');
  });
});
