/**
 * 源料体检的判定（scripts/realbank/source_survey.mjs）。
 *
 * 这支脚本存在的意义只有一条：**开工前先知道这卷这科为什么没跑**。
 * 账本只说「整科没跑过」，而「没 ingest 过」「商家没给音频」「已结构化只差合库」
 * 这三种情况的下一步完全不同 —— 其中「没音频」在不自己配音的前提下压根不该开工。
 * 所以判定顺序是有意的：先看音频，再看结构化到哪一步。
 */
const { classify } = require("../scripts/realbank/source_survey.mjs");

const audio = (n, complete = true) => Array.from({ length: n }, (_, i) => ({ file: `a${i}.mp3`, mb: 10, complete }));
const results = (section, statuses) => ({ results: statuses.map((status) => ({ section, status, type: "lc" })) });

describe("源料体检：一卷一科的处境判定", () => {
  test("连 ingest 记录都没有 → not_ingested", () => {
    expect(classify({ ingest: null, structured: null, section: "listening" }).verdict).toBe("not_ingested");
  });

  test("听力：ingest 过但一个音频都没有 → no_audio（压倒结构化进度）", () => {
    const r = classify({ ingest: { audio: [] }, structured: results("listening", ["ok", "ok"]), section: "listening" });
    expect(r.verdict).toBe("no_audio");
    expect(r.audioFiles).toBe(0);
  });

  test("听力：音频全是没下完的 → incomplete_audio", () => {
    const r = classify({ ingest: { audio: audio(3, false) }, structured: null, section: "listening" });
    expect(r.verdict).toBe("incomplete_audio");
    expect(r.audioMb).toBe(30);
  });

  test("阅读/写作不看音频：没音频照样按结构化进度判", () => {
    expect(classify({ ingest: { audio: [] }, structured: results("reading", ["ok"]), section: "reading" }).verdict)
      .toBe("ready_to_build");
    expect(classify({ ingest: { audio: [] }, structured: null, section: "writing" }).verdict)
      .toBe("needs_structure");
  });

  test("有音频 + 这科有 ok 的结构化结果 → ready_to_build（只差合库）", () => {
    const r = classify({ ingest: { audio: audio(2) }, structured: results("listening", ["ok", "deferred"]), section: "listening" });
    expect(r.verdict).toBe("ready_to_build");
    expect(r.statuses).toEqual({ ok: 1, deferred: 1 });
  });

  test("有音频但这科一条结构化结果都没有 → needs_structure", () => {
    expect(classify({ ingest: { audio: audio(2) }, structured: results("reading", ["ok"]), section: "listening" }).verdict)
      .toBe("needs_structure");
  });

  test("有音频、结构化跑过但全是 deferred → deferred_only", () => {
    const r = classify({ ingest: { audio: audio(1) }, structured: results("listening", ["deferred", "error"]), section: "listening" });
    expect(r.verdict).toBe("deferred_only");
    expect(r.why).toMatch(/deferred/);
  });
});
