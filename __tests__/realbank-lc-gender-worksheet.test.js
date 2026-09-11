/**
 * 对话说话人性别人工标注链（scripts/realbank/lc_gender_worksheet.py + merge_first_source_asr.py 的覆盖表读取）。
 *
 * 断言写在两个脚本自己的 `--self-test` 里（纯 fixture，不碰 .codex-tmp / 音频）；这里只把它们接进 jest。
 * worksheet 脚本只依赖标准库，有 python 就跑；merge 脚本的 self-test 已由 realbank-first-source-merge.test.js 覆盖
 * （那条要 PyMuPDF），这里再跑一次是为了在没装 fitz 的机器上也能锁住覆盖表读取逻辑——
 * merge 脚本本身 import 时不需要 fitz。
 */
const { execFileSync, spawnSync } = require("child_process");
const path = require("path");

const WORKSHEET = path.join(__dirname, "..", "scripts", "realbank", "lc_gender_worksheet.py");
const MERGE = path.join(__dirname, "..", "scripts", "realbank", "merge_first_source_asr.py");

function findPython() {
  for (const exe of [process.env.PYTHON, "D:/python/python", "python", "python3"]) {
    if (!exe) continue;
    const probe = spawnSync(exe, ["-c", "import sys; assert sys.version_info >= (3, 8)"], { encoding: "utf8" });
    if (probe.status === 0) return exe;
  }
  return null;
}

const PY = findPython();
const maybe = PY ? describe : describe.skip;

maybe("realbank 对话性别人工标注链", () => {
  test("lc_gender_worksheet.py --self-test（清单筛选 / CSV 往返 / 回填合并）", () => {
    const out = execFileSync(PY, ["-X", "utf8", WORKSHEET, "--self-test"], { encoding: "utf8" });
    expect(out).toContain("SELF-TEST OK");
  });

  test("merge_first_source_asr.py --self-test（含人工覆盖放行 / 不推翻文档标签 / 覆盖表按卷读取）", () => {
    const out = execFileSync(PY, ["-X", "utf8", MERGE, "--self-test"], { encoding: "utf8" });
    expect(out).toContain("SELF-TEST OK");
  });
});
