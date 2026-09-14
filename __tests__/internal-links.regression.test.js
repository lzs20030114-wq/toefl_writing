/**
 * 回归锁：站内链接必须指向真实存在的路由。
 *
 * 事故现场（2026-09-13，单词本上线当天）：空状态那颗「去阅读复盘查词」按钮写的是
 * `/progress/reading`，而真实路由是 `/reading/progress`——两段写反了。代码能编译、
 * 测试能过、build 能过，点下去 404。这类错误在用户点它之前完全不可见，靠人眼复查
 * 也很难发现（两个词都对，只是顺序反了）。
 *
 * 所以这里把不变量钉死：源码里每一个写死的站内 href，都得能在 app/ 下找到对应的
 * page.js。动态段（[id] / [...path]）按通配处理。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SCAN_DIRS = ["app", "components"];
const SKIP_DIRS = new Set(["node_modules", ".next"]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** app/ 下的 page.js → 路由表。路由组 (x) 剥掉，动态段留着待匹配。 */
function collectRoutes() {
  const routes = [];
  for (const file of walk(path.join(ROOT, "app"))) {
    const base = path.basename(file);
    if (base !== "page.js" && base !== "page.jsx" && base !== "route.js") continue;
    const rel = path.relative(path.join(ROOT, "app"), path.dirname(file));
    const segs = rel === "" ? [] : rel.split(path.sep).filter((s) => !/^\(.*\)$/.test(s));
    routes.push("/" + segs.join("/"));
  }
  // public/ 下的静态文件也是合法的 href 目标（robots.txt 之类）
  for (const entry of fs.readdirSync(path.join(ROOT, "public"), { withFileTypes: true })) {
    if (entry.isFile()) routes.push("/" + entry.name);
  }
  return routes;
}

function toMatcher(route) {
  const parts = route.split("/").filter(Boolean);
  return {
    route,
    test(target) {
      const segs = target.split("/").filter(Boolean);
      let i = 0;
      for (const p of parts) {
        if (/^\[\.\.\..*\]$/.test(p)) return true; // catch-all 吃掉剩余全部
        if (i >= segs.length) return false;
        if (/^\[.*\]$/.test(p)) { i += 1; continue; } // 动态段吃一节
        if (p !== segs[i]) return false;
        i += 1;
      }
      return i === segs.length;
    },
  };
}

/** 源码里写死的站内 href。模板串取 ${ 之前的静态前缀（querySuffix 这类只加 query）。 */
function collectLinks() {
  const found = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const src = fs.readFileSync(file, "utf8");
      const lines = src.split("\n");
      lines.forEach((line, idx) => {
        for (const m of line.matchAll(/href=(?:"(\/[^"]*)"|\{`(\/[^`]*)`\})/g)) {
          let raw = m[1] ?? m[2];
          raw = raw.split("${")[0].split("?")[0].split("#")[0];
          if (!raw.startsWith("/") || raw === "/") continue;
          found.push({ href: raw, file: path.relative(ROOT, file), line: idx + 1 });
        }
      });
    }
  }
  return found;
}

describe("站内链接不得指向不存在的路由", () => {
  const matchers = collectRoutes().map(toMatcher);
  const links = collectLinks();

  test("扫到了链接（扫描器本身没瞎）", () => {
    expect(links.length).toBeGreaterThan(5);
    expect(matchers.length).toBeGreaterThan(10);
  });

  test("每个写死的站内 href 都有对应路由", () => {
    const dead = links.filter((l) => !matchers.some((m) => m.test(l.href)));
    const report = dead.map((d) => `  ${d.file}:${d.line} → ${d.href}`).join("\n");
    expect(report).toBe("");
  });
});
