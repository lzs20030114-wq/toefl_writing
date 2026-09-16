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
    // 别名循环在盲审闸（if (passedKeys)）之前
    expect(dup.indexOf("itemAliasEdges.push(dupEdge(")).toBeLessThan(dup.indexOf("if (passedKeys) {"));
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
      // 闸必须在**去重记别名之后**：放前面会把整套被闸空的重复卷的别名也丢掉，
      // 那一卷的槽位反而更空（2026-09-16 实测 8 套这么丢的）
      const dedup = src.indexOf(`seenS.set(sk, \`${"${setname}"}/${"${id}"}\`);`, src.indexOf(`real_${kind}_`));
      expect([kind, dedup > 0 && dedup < at]).toEqual([kind, true]);
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
