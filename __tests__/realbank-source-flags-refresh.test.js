/**
 * 陈旧源料体检 flag 的重算（scripts/realbank/refresh_source_flags.mjs）+ 按 module 收窄的扣留。
 *
 * 背景：source-flags.json 是 2026-09-06 的一次性快照，而 ingest 解析器此后修过两处
 * （认得「第二部份 / 另一套加试」表头、`resolve_orphan_chains` 按题号形状给无头答案块定科）。
 * blocking 的后果是**整科不入库** —— 陈旧 flag 就等于凭旧解析器扣着今天认得出来的答案。
 *
 * 钉死的不变量：
 *   · 只移除**已不成立**的 flag，从不新增、从不把一个坏 code 改写成另一个坏 code；
 *   · 扫描产物读不出 / 认不出形态 → 原样保留（fail-closed 到「照旧扣着」）；
 *   · `ingest_blocker` 只认「题号重启块」形态，且必须有当前扫描的痕迹佐证才判为陈旧；
 *   · `section_gap` 真成立时不删，只在「某 module 在答案源里整个缺席」时收窄到那个 module；
 *   · 「纯 a–d 字母块不可能是阅读」这条 fail-closed 断言（Python 侧 self-test）。
 */
const { execFileSync, spawnSync } = require("child_process");
const path = require("path");
const R = require("../scripts/realbank/refresh_source_flags.mjs");
const { holdDecision } = require("../scripts/realbank/hold_policy.js");

const scanOf = (alignment, blockers) => ({ alignment, blockers });
const mod = (module, total, matched) =>
  ({ module, total, matched: Array.from({ length: matched }, (_, i) => ({ n: i + 1 })) });
const sec = (status, matched_count, modules) => ({ status, matched_count, modules: modules || [] });

describe("状态类 flag（section_no_answers / section_no_stems / section_blocked）", () => {
  const flag = (code, section) => ({ code, severity: "blocking", sections: [section], detail: "旧快照" });

  test("3.29 形态：答案页漏打「听力」表头，现在孤儿块已定科 47/47 → 删掉 section_no_answers", () => {
    const scan = scanOf({ listening: sec("ok", 47, [mod(1, 32, 32), mod(2, 15, 15)]) }, []);
    const { flags, changes } = R.refreshSetAll("3.29新托福真题", [flag("section_no_answers", "listening")], scan);
    expect(flags).toEqual([]);
    expect(changes[0]).toMatchObject({ action: "删除", code: "section_no_answers", section: "listening" });
  });

  test("还是 0 题 / 还是坏状态 → 保留（换个坏法不等于好了）", () => {
    const f = flag("section_no_stems", "speaking");
    for (const s of [sec("no_stems", 0, []), sec("blocked", 0, [mod(1, 11, 0)]), sec("ok", 0, [])]) {
      expect(R.refreshSetAll("x", [f], scanOf({ speaking: s }, [])).flags).toEqual([f]);
    }
  });

  test("扫描产物缺失 / 没有这一科 → 原样保留", () => {
    const f = flag("section_blocked", "speaking");
    expect(R.refreshSetAll("x", [f], null).flags).toEqual([f]);
    expect(R.refreshSetAll("x", [f], scanOf({ reading: sec("ok", 50, []) }, [])).flags).toEqual([f]);
  });
});

describe("ingest_blocker（只认「题号重启块」形态）", () => {
  const restart = (file, line) => ({
    code: "ingest_blocker", severity: "blocking", sections: ["*"],
    detail: `[${file}] 答案页第 ${line} 行出现无科目头的题号重启块（当前科目 reading），已忽略(fail-closed)：1d 2b 3c`,
  });

  test("2.8 形态：解析器认得表头了，当前扫描那一行不再报 → 删", () => {
    const { flags, changes } = R.refreshSetAll("2.8新托福真题", [restart("2.8 套一 答案.pdf", 8)], scanOf({}, []));
    expect(flags).toEqual([]);
    expect(changes[0].why).toMatch(/不再出现题号重启块/);
  });

  test("3.29 形态：孤儿块已「已采用」定科 → 删", () => {
    const blockers = [
      "[3.29 答案.pdf] 答案页第 9 行出现无科目头的题号重启块（上一个科目 reading），已扣下开孤儿块待题号形状推断：1d 2b",
      "[3.29 答案.pdf] 答案页第 9 行起有 2 块答案没写科目头，按题号形状唯一推断为 listening module1-2，已采用——请人工确认",
    ];
    expect(R.refreshSetAll("3.29新托福真题", [restart("3.29 答案.pdf", 9)], scanOf({}, blockers)).flags).toEqual([]);
  });

  test("孤儿块还扣着（只有「待推断」没有「已采用」）→ 保留", () => {
    const f = restart("OG.pdf", 1796);
    const blockers = ["[OG.pdf] 答案页第 1796 行出现无科目头的题号重启块（上一个科目 reading），已扣下开孤儿块待题号形状推断：1. What"];
    expect(R.refreshSetAll("OG", [f], scanOf({}, blockers)).flags).toEqual([f]);
  });

  test("别的文件的「已采用」救不了本文件仍扣着的那一块（文件名 + 行号都要对上）", () => {
    const f = restart("3.29 答案.pdf", 9);
    const blockers = [
      "[3.29 答案.pdf] 答案页第 9 行出现无科目头的题号重启块（上一个科目 reading），已扣下开孤儿块待题号形状推断：1d 2b",
      "[别的卷.pdf] 答案页第 9 行起有 1 块答案没写科目头…已采用——请人工确认",
    ];
    expect(R.refreshSetAll("x", [f], scanOf({}, blockers)).flags).toEqual([f]);
  });

  test("当前扫描里这个文件这一行一条痕迹都没有 → 判为陈旧（blockers 是本卷本轮的完整记录）", () => {
    const f = restart("3.29 答案.pdf", 9);
    expect(R.refreshSetAll("x", [f], scanOf({}, ["[别的卷.pdf] 答案页第 9 行…已扣下开孤儿块待题号形状推断"])).flags)
      .toEqual([]);
  });

  test("不是「题号重启块」那一种 / 拿不到 blockers → 一个字不动", () => {
    const other = { code: "ingest_blocker", severity: "blocking", sections: ["*"], detail: "[x.pdf] 答案 PDF 整份读不出" };
    expect(R.refreshSetAll("x", [other], scanOf({}, [])).flags).toEqual([other]);
    const f = restart("x.pdf", 3);
    expect(R.refreshSetAll("x", [f], { alignment: {} }).flags).toEqual([f]);
  });
});

describe("section_gap：真缺不删，只按「整个 module 缺席」收窄", () => {
  const gap = (section, detail) => ({ code: "section_gap", severity: "blocking", sections: [section], detail });

  test("3.8 形态：答案源里只有听力 M1、M2 整个没有 → 收窄成 modules:[2]，不删", () => {
    const scan = scanOf({ listening: sec("partial", 32, [mod(1, 32, 32)]) }, []);
    const { flags, changes } = R.refreshSetAll("3.8新托福真题",
      [gap("listening", "listening 科缺 15 题（配对 32／满分 47）。")], scan);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ code: "section_gap", severity: "blocking", modules: [2] });
    expect(changes.find((c) => c.action === "收窄")).toBeTruthy();
  });

  test("3.24 形态：答案 module 在、只是路由不上题面（matched 0）→ **不**收窄", () => {
    const scan = scanOf({ reading: sec("partial", 35, [mod(1, 35, 35), mod(2, 15, 0), mod(3, 15, 0)]) }, []);
    const { flags } = R.refreshSetAll("3.24新托福真题", [gap("reading", "reading 科缺 15 题。")], scan);
    expect(flags[0].modules).toBeUndefined();
  });

  test("在场 module 没配满 / 多出蓝图没有的 module → 不收窄", () => {
    expect(R.absentModules(scanOf({ listening: sec("partial", 30, [mod(1, 32, 30)]) }, []), "listening")).toBeNull();
    expect(R.absentModules(scanOf({ listening: sec("partial", 32, [mod(1, 32, 32), mod(3, 15, 15)]) }, []), "listening")).toBeNull();
  });

  test("两个 module 都缺席 → 不收窄（收窄成整科等于没收窄）", () => {
    expect(R.absentModules(scanOf({ listening: sec("no_answers", 0, []) }, []), "listening")).toBeNull();
  });
});

describe("holdDecision 认 flag 上的 modules", () => {
  const f = { code: "section_gap", severity: "blocking", sections: ["listening"], detail: "缺 15", modules: [2] };
  const ctx = (extra) => ({ set: "3.8新托福真题", allow: [], ...extra });

  test("被点名的 module 照扣，别的 module 放行", () => {
    expect(holdDecision([f], "listening", ctx({ module: 2 })).held).toBe(true);
    const m1 = holdDecision([f], "listening", ctx({ module: 1 }));
    expect(m1.held).toBe(false);
    expect(m1.notes.join("")).toMatch(/扣留范围只含 module 2/);
  });

  test("不问 module（老调用方）→ 照旧整科扣下，fail-closed 到老行为", () => {
    expect(holdDecision([f], "listening", ctx()).held).toBe(true);
  });

  test("没有 modules 字段的 flag：逐 module 问与整科问结果一样", () => {
    const plain = { ...f };
    delete plain.modules;
    for (const m of [undefined, 1, 2]) {
      expect(holdDecision([plain], "listening", ctx({ module: m })).held).toBe(true);
    }
  });
});

describe("build_bank 逐 module 扣留的接线（源码级断言）", () => {
  const src = require("fs").readFileSync(
    path.join(__dirname, "..", "scripts", "realbank", "build_bank.mjs"), "utf8");

  test("整科扣下要求每个 module 都被扣；两个收题循环都逐 module 再问一遍", () => {
    expect(src).toContain("const listeningHeld = lHold.held && LISTENING_MODULES.every((m) => listeningHeldIn(m));");
    expect(src.match(/listeningHeldIn\(r\.module\)/g) || []).toHaveLength(2);
  });
});

function findPython() {
  for (const exe of [process.env.PYTHON, "D:/python/python", "python", "python3"]) {
    if (!exe) continue;
    if (spawnSync(exe, ["-c", "import re"], { encoding: "utf8" }).status === 0) return exe;
  }
  return null;
}
const PY = findPython();
(PY ? describe : describe.skip)("无头答案块定科：纯 a–d 字母块不可能是阅读", () => {
  test("ingest_common.py --self-test 全过", () => {
    const out = execFileSync(PY, ["-X", "utf8",
      path.join(__dirname, "..", "scripts", "realbank", "ingest_common.py"), "--self-test"],
    { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" } });
    expect(out).toContain("SELF-TEST OK");
  });
});
