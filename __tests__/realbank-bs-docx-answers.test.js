/**
 * 5 月第二来源（docx 卷）的答案句兜底（scripts/realbank/extract_bs_pages.py 的 docx_section_answers）。
 *
 * 为什么要锁：这 6 套的答案页写作段是「一段一句、不编号」，ingest 的编号解析器一条都认不出 →
 * structured 写作段为空 → 识图拿到题面也配不上答案句，整卷 10 题全丢（2026-09-16 前丢题账本记 60 题「管线丢题」）。
 * 兜底读原始答案.docx 的段落；读错一格（把口语复述句当造句、少一句多一句）就会让答案句整体错位。
 *
 * 用 python-docx 现造一份 docx + 转换记录，直接调函数断言。没有 python / python-docx 就跳过。
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SCRIPT_DIR = path.join(__dirname, "..", "scripts", "realbank");

function findPython() {
  for (const exe of [process.env.PYTHON, "D:/python/python", "python", "python3"]) {
    if (!exe) continue;
    const probe = spawnSync(exe, ["-c", "import docx, fitz"], { encoding: "utf8" });
    if (probe.status === 0) return exe;
  }
  return null;
}

const PY = findPython();
const maybe = PY ? describe : describe.skip;

const PROBE = String.raw`
import json, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
import docx
import extract_bs_pages as E
tmp = sys.argv[2]
def make(name, paras):
    src = os.path.join(tmp, "src_" + name); os.makedirs(src, exist_ok=True)
    d = docx.Document()
    for p in paras: d.add_paragraph(p)
    d.save(os.path.join(src, name + " 答案.docx"))
    json.dump({"key": name, "src_dir": src, "out_dir": os.path.join(tmp, "conv", name),
               "files": [{"src": name + " 答案.docx", "out": name + " 答案.pdf", "kind": "answer-text-pdf"}]},
              open(os.path.join(tmp, "_convert_%s.json" % name), "w", encoding="utf-8"))
ten = ["sentence number %d is here" % i for i in range(1, 11)]
seven = ["repeat sentence %d" % i for i in range(1, 8)]
make("卷好", ["阅读", "1a 2b 3c", "加试", "1d", "", "听力", "1a 2c", "", "写作"] + ten + ["", "口语"] + seven)
make("卷少", ["写作"] + ten[:9] + ["口语"] + seven[:6])
make("卷无", ["阅读", "1a", "加试", "a b c"])
E.CONVERTED_DIR = tmp
keys = ("卷好", "卷少", "卷无", "卷不存在")
print(json.dumps({"writing": {k: E.docx_writing_answers(k) for k in keys},
                  "speaking": {k: E.docx_speaking_answers(k) for k in keys}}, ensure_ascii=False))
`;

maybe("docx 卷造句答案句兜底", () => {
  let result;
  beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bs-docx-"));
    const r = spawnSync(PY, ["-X", "utf8", "-c", PROBE, SCRIPT_DIR, tmp], {
      encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" },
    });
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
    result = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  });

  test("写作表头之后、下一个科目表头之前的 10 段，按顺序编号；不吃进口语复述句", () => {
    const w = result.writing;
    expect(Object.keys(w["卷好"])).toHaveLength(10);
    expect(w["卷好"]["1"]).toBe("sentence number 1 is here");
    expect(w["卷好"]["10"]).toBe("sentence number 10 is here");
    expect(Object.values(w["卷好"])).not.toContain("repeat sentence 1");
  });

  test("不是恰好 10 句 / 没有写作段 / 没有转换记录 → 一条都不给（不猜）", () => {
    expect(result.writing["卷少"]).toEqual({});
    expect(result.writing["卷无"]).toEqual({});
    expect(result.writing["卷不存在"]).toEqual({});
  });

  // 同一支读法换个科目、换个句数：5 月 5 套的复述句只有这一条路（structured 里连 repeat 段都没有）
  test("口语表头之后的 7 段按顺序编号；不吃进写作答案句", () => {
    const sp = result.speaking;
    expect(Object.keys(sp["卷好"])).toHaveLength(7);
    expect(sp["卷好"]["1"]).toBe("repeat sentence 1");
    expect(sp["卷好"]["7"]).toBe("repeat sentence 7");
    expect(Object.values(sp["卷好"])).not.toContain("sentence number 1 is here");
  });

  test("口语不是恰好 7 句 / 没有口语段 / 没有转换记录 → 一条都不给（不猜）", () => {
    expect(result.speaking["卷少"]).toEqual({});
    expect(result.speaking["卷无"]).toEqual({});
    expect(result.speaking["卷不存在"]).toEqual({});
  });
});
