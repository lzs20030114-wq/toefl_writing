/**
 * 防退化：Serverless 函数打包范围不许再塞整个 data/ 或 scripts/。
 *
 * 2026-10-05 Vercel 报 Function Storage 10 GB 用满：next.config.js 给 /api/admin/questions 和
 * /api/admin/generate-bs 写了 `./data/**\/*` + `./scripts/**\/*`，5 个函数各背 55 MB 同一份题库，
 * 一次部署函数包合计 464 MB（收紧后 191 MB）。这里卡住两件事：
 *   1. include 里不能出现整目录通配（只允许具体文件或某个 bank/staging 子目录的 *.json）；
 *   2. 用 readdirSync 列目录的两条后台内容路由，不能再用 join(process.cwd(), …) 拼路径——
 *      追踪器会把整个项目根目录拖进函数包（字体、截图、测试夹具…90 MB）。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const config = require(path.join(ROOT, "next.config.js"));

const BROAD = /^\.\/(data|scripts|public|lib|app|components)\/\*\*\/\*$/;

describe("next.config.js outputFileTracingIncludes", () => {
  const includes = config.experimental?.outputFileTracingIncludes || {};

  test("每个路由的 include 都是具体文件或 bank/staging 子目录的 *.json，不含整目录通配", () => {
    for (const [route, globs] of Object.entries(includes)) {
      for (const g of globs) {
        expect({ route, glob: g, broad: BROAD.test(g) }).toEqual({ route, glob: g, broad: false });
        expect(g.startsWith("./data/")).toBe(true);
        expect(/\.json$/.test(g)).toBe(true);
      }
    }
  });

  test("只通过 GitHub API 读写题库的路由不需要本地文件", () => {
    expect(Object.keys(includes).some((k) => k.includes("generate-bs"))).toBe(false);
    expect(Object.keys(includes).some((k) => k.includes("questions/sets"))).toBe(false);
  });

  test("include 的具体文件都真实存在（避免改名后静默丢失）", () => {
    for (const globs of Object.values(includes)) {
      for (const g of globs) {
        if (g.includes("*")) continue;
        expect({ file: g, exists: fs.existsSync(path.join(ROOT, g)) }).toEqual({ file: g, exists: true });
      }
    }
  });
});

describe("后台内容路由不再用 join(process.cwd(), …) 触发整目录追踪", () => {
  const routes = ["app/api/admin/content/route.js", "app/api/admin/content/staging/route.js"];
  test.each(routes)("%s", (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const offending = src
      .split("\n")
      .map((line, i) => ({ line: i + 1, text: line.trim() }))
      .filter((l) => !l.text.startsWith("//") && /join\(\s*process\.cwd\(\)/.test(l.text));
    expect(offending).toEqual([]);
  });
});
