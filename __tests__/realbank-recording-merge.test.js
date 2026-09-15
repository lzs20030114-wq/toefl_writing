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
 *   · 旁白被词级时间戳错挂到上一岛尾巴 → 挪回下一岛
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

  test("dup_of 只记别名、不登记去重锚点；没挂上原声的整块录音题不收", () => {
    expect(src).toContain('const RECORDING_MERGER = "merge_recording_asr-v1"');
    const dup = src.slice(src.indexOf("if (r.dup_of) {"), src.indexOf("const kept = [];", src.indexOf("if (r.dup_of) {")));
    expect(dup).toContain("itemAliasEdges.push(dupEdge(");
    expect(dup).not.toContain("seenL.set(");
    expect(src).toContain('code: "lDroppedNoOriginalAudio"');
    const { DROP_CODES } = require("../scripts/realbank/drop_ledger.js");
    expect(DROP_CODES.lDroppedNoOriginalAudio).toMatchObject({ scope: "unit", section: "listening" });
  });
});
