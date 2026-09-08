/**
 * 第一来源（自带「听力原文」逐字稿）听力/口语合流桥接的防退化闸。
 *
 * 桥接本体是 Python（要复用 merge_vendor_asr.py 的 sim / diarize / strip_framing），
 * 所以断言写在脚本自己的 `--self-test` 里（纯函数 + 小 fixture，不碰真实音频/网络），
 * 这里只负责把它接进 `npx jest`：闸坏了 → self-test 非 0 退出 → 这条测试红。
 *
 * 覆盖的闸（详见 scripts/realbank/merge_first_source_asr.py 的 self_test）：
 *   · 对齐正确（逐段命中 1.0、区间单调）
 *   · 顺序颠倒的稿子扣下
 *   · 区间倒序 / 塌陷 / 缺失各自扣下
 *   · 屏幕分组（材料屏 → 题号区间）
 *   · 屏幕组数与逐字稿段数不符 → 整组扣下
 *   · 对话无说话人标签 / A0B 标签但没音频可判性别 → 扣下
 *   · 逐字稿解析：LCR 编号句、题号行截断、框架句剥离、Module 分界、Man/Woman 定性别
 *
 * 环境里没有 python 就跳过（CI 不装 python 时不该把整条测试链拖红）。
 */
const { execFileSync, spawnSync } = require("child_process");
const path = require("path");

const SCRIPT = path.join(__dirname, "..", "scripts", "realbank", "merge_first_source_asr.py");

function findPython() {
  for (const exe of [process.env.PYTHON, "D:/python/python", "python", "python3"]) {
    if (!exe) continue;
    const probe = spawnSync(exe, ["-c", "import fitz"], { encoding: "utf8" });
    if (probe.status === 0) return exe;
  }
  return null;
}

const PY = findPython();
const maybe = PY ? describe : describe.skip;

maybe("realbank 第一来源合流桥接", () => {
  test("--self-test 全过（对齐/分组/角色/解析各闸）", () => {
    const out = execFileSync(PY, ["-X", "utf8", SCRIPT, "--self-test"], { encoding: "utf8" });
    expect(out).toContain("SELF-TEST OK");
  });
});
