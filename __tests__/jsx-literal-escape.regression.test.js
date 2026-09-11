/**
 * 回归锁：JSX 文本里不得出现 \uXXXX 字面量。
 *
 * 事故现场（2026-09-11，真题邮件写作提交后）：ScoringWaitCard 的两行中文被写成
 * `AI 正在评分…`。JSX 文本不是 JS 字符串字面量，\uXXXX 不会被解码，
 * 页面上直接渲染出一长串不可断行的 ASCII —— 它的 min-content 顶穿了写作双栏
 * `1fr 1fr` 里右栏的份额，把左边题面挤成一条窄缝（用户截图即此）。
 *
 * 两条防线：这里禁掉源头，WritingTask 的 minmax(0, 1fr) 兜住撑爆。
 */
const fs = require("fs");
const path = require("path");

const ROOTS = ["app", "components"];
const SKIP_DIRS = new Set(["node_modules", ".next"]);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

// 一行 JSX 文本的近似判据：出现 \uXXXX，且整行不是注释、不含引号/反引号、也不是
// 带 = 或 ; 的语句（真字符串与正则里的 \uXXXX 是合法转义，例如 CJK_RE）。
function offendingLines(src) {
  const bad = [];
  src.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!/\\u[0-9a-fA-F]{4}/.test(t)) return;
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    if (/["'`=;]/.test(t)) return;
    bad.push(`${i + 1}: ${t.slice(0, 80)}`);
  });
  return bad;
}

describe("JSX 文本不得含 \\uXXXX 字面量", () => {
  const files = ROOTS.flatMap((r) => walk(path.join(process.cwd(), r)));

  it("扫到了文件", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("全部 JSX 文本都是真字符，不是转义串", () => {
    const hits = [];
    for (const f of files) {
      const bad = offendingLines(fs.readFileSync(f, "utf8"));
      if (bad.length) hits.push(`${path.relative(process.cwd(), f)}\n  ${bad.join("\n  ")}`);
    }
    expect(hits.join("\n")).toBe("");
  });
});
