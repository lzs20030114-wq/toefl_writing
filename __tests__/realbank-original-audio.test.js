/**
 * 真题听力「原声优先」的切点 / 过闸 / 回挂判据（scripts/realbank/original_audio.js）。
 *
 * 这条链路一旦判错，用户听到的就是：开头被剧透题型的旁白（"Listen to a conversation."）、
 * 结尾接上作答倒计时的「咔」、或者一段根本不是这道题的音频。上传 + 回挂是不可逆的
 * （TTS 文件还在，但库里的 audio_url 已经换了），所以判据必须锁死在单测里。
 *
 * 锁的五条：
 *   ① 旁白剥离：切片从旁白之后的第一个正文词起，不是从对齐起点起；
 *   ② 不越界：终点夹在下一组（的旁白）起点之前；
 *   ③ lcr 逐句唯一定位：同一段音频里内容相近的多句短应答，各切各的；
 *   ④ 覆盖率 / 词速闸：对不上的、念太慢太快的一律不用原声；
 *   ⑤ 回挂：sha1 对不上（口播文本变了）就不挂，退回 TTS。
 */
const OA = require("../scripts/realbank/original_audio.js");

/** 把 "a b c" 这样的词串造成带时间戳的 ASR 词序列（每词 dur 秒，间隔 gap 秒）。 */
function mkWords(text, { from = 0, dur = 0.3, gap = 0.05 } = {}) {
  const out = [];
  let t = from;
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    out.push({ w, start: Math.round(t * 1000) / 1000, end: Math.round((t + dur) * 1000) / 1000 });
    t += dur + gap;
  }
  return out;
}

/** 等距能量探针：loudAt 里列出的秒数处给一声 −30 dB，其余 −90 dB。 */
function mkProbes(from, to, loudAt = []) {
  const probes = [];
  for (let t = from; t < to - 1e-9; t += 0.02) {
    const tt = Math.round(t * 1000) / 1000;
    const loud = loudAt.some((x) => Math.abs(x - tt) < 0.011);
    probes.push({ t: tt, db: loud ? -30 : -90 });
  }
  return probes;
}

describe("normTokens", () => {
  test("小写、去标点、连字符合并（mid-term 与 midterm 是同一个词）", () => {
    expect(OA.normTokens("Her mid-term presentation?")).toEqual(["her", "midterm", "presentation"]);
    expect(OA.normTokens("midterm")).toEqual(["midterm"]);
  });

  test("数字里的逗号不制造新词", () => {
    expect(OA.normTokens("about 1,500 words")).toEqual(["about", "1500", "words"]);
  });
});

describe("findNarration —— 只认 ETS 旁白，不认正文里的 listen to", () => {
  test("认出 Listen to a conversation. 并给出起止下标", () => {
    const words = mkWords("Listen to a conversation. Have you heard about the concert?");
    const n = OA.findNarration(words, 0, words.length);
    expect(n).toEqual({ start: 0, end: 4 });
  });

  test("认出带学科后缀的长旁白", () => {
    const words = mkWords("Listen to part of a lecture in an art history class. We've been talking about inertia.");
    const n = OA.findNarration(words, 0, words.length);
    expect(n.start).toBe(0);
    expect(words.slice(n.end)[0].w).toBe("We've");
  });

  test("正文里的 'to listen to the recording' 不算旁白（句中 + 没有任务名词）", () => {
    const words = mkWords("Can I borrow your headphones to listen to the recording?");
    expect(OA.findNarration(words, 0, words.length)).toBeNull();
  });

  test("句首但没有任务名词也不算（防把正文当旁白）", () => {
    const words = mkWords("Listen to me carefully.");
    expect(OA.findNarration(words, 0, words.length)).toBeNull();
  });
});

describe("computeCut ① 旁白剥离", () => {
  const target = OA.normTokens("Have you heard about the concert?");
  // 真题里旁白与正文之间有 ~2s 的停顿（1.21B la：旁白收在 250.23s，正文起于 252.7s）
  const withNarration = [
    ...mkWords("Listen to a conversation."),
    ...mkWords("Have you heard about the concert?", { from: 3 }),
  ];

  test("切片起点落在旁白之后，而不是旁白上", () => {
    const cut = OA.computeCut({ words: withNarration, targetTokens: target });
    expect(cut.ok).toBe(true);
    expect(cut.narration).toBe("stripped");
    expect(cut.contentStart).toBeCloseTo(3, 3);
    expect(cut.start).toBeCloseTo(3 - OA.DEFAULTS.headPad, 3);
    // 旁白最后一个词收在 1.35s，切片起点必须在它之后
    expect(cut.start).toBeGreaterThan(withNarration[3].end);
  });

  test("旁白贴着正文（间隙比收声余量还短）也不许削掉正文第一个词", () => {
    const tight = mkWords("Listen to a conversation. Have you heard about the concert?");
    const cut = OA.computeCut({ words: tight, targetTokens: target });
    expect(cut.ok).toBe(true);
    expect(cut.start).toBeLessThanOrEqual(cut.contentStart);
  });

  test("没有旁白时起点就是正文第一个词往前 headPad", () => {
    const words = mkWords("Have you heard about the concert?", { from: 5 });
    const cut = OA.computeCut({ words, targetTokens: target });
    expect(cut.ok).toBe(true);
    expect(cut.narration).toBe("absent");
    expect(cut.start).toBeCloseTo(5 - OA.DEFAULTS.headPad, 3);
  });

  test("逐字稿漏收的引入语（旁白与正文之间的几个词）跟着切进来", () => {
    const words = mkWords("Listen to an announcement in a classroom. For your upcoming project, please write a detailed report.");
    const t = OA.normTokens("Please write a detailed report.");
    const cut = OA.computeCut({ words, targetTokens: t });
    expect(cut.ok).toBe(true);
    expect(cut.narration).toBe("stripped");
    // "For" 是旁白之后第一个词，切片必须从它开始，而不是从 "please"
    const forWord = words.find((w) => w.w === "For");
    expect(cut.contentStart).toBeCloseTo(forWord.start, 3);
  });

  test("lcr 关掉引入语补收：target 就是整句，前面多出来的一定不是它", () => {
    const words = mkWords("Listen to a conversation. Something unrelated here. Where is the wellness center?");
    const t = OA.normTokens("Where is the wellness center?");
    const cut = OA.computeCut({ words, targetTokens: t, allowLeadIn: false });
    expect(cut.ok).toBe(true);
    const whereWord = words.find((w) => w.w === "Where");
    expect(cut.contentStart).toBeCloseTo(whereWord.start, 3);
  });

  test("旁白横在正文中间（多半是对到了下一组）：不会放行", () => {
    const words = mkWords("Have you heard Listen to a conversation. about the concert?");
    const cut = OA.computeCut({ words, targetTokens: target });
    expect(cut.ok).toBe(false);
    expect(["narration_inside", "locate_failed", "anchor_mismatch"]).toContain(cut.reason);
  });
});

describe("computeCut 首尾锚点 —— 半截音频不许放行", () => {
  test("开头一段对不上时，对齐器会跳过它 —— 锚点必须把这种切片拦下来", () => {
    // target 的前 8 个词在音频里根本没有：如果只看覆盖率（26/34 = 0.76…）还可能蒙混，
    // 但切出来的音频少了开头一整句。
    const target = OA.normTokens(
      "This opening sentence is missing from the audio. "
      + "Sediment builds up along the delta each spring and summer, "
      + "which changes how the river channel migrates over time.");
    const words = mkWords(
      "Sediment builds up along the delta each spring and summer, "
      + "which changes how the river channel migrates over time.");
    const cut = OA.computeCut({ words, targetTokens: target });
    expect(cut.ok).toBe(false);
    expect(["anchor_mismatch", "locate_failed"]).toContain(cut.reason);
  });

  test("首尾都对得上就放行", () => {
    const text = "Sediment builds up along the delta each spring and summer, "
      + "which changes how the river channel migrates over time.";
    const cut = OA.computeCut({ words: mkWords(text), targetTokens: OA.normTokens(text) });
    expect(cut.ok).toBe(true);
  });

  test("anchorOk 直接判：起点跳过了 target 的开头 → 不通过", () => {
    const target = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
    const asr = ["epsilon", "zeta", "eta", "theta"];
    expect(OA.anchorOk(target, asr, 0, asr.length).ok).toBe(false);
    expect(OA.anchorOk(target, target, 0, target.length).ok).toBe(true);
  });

  test("复合词被 ASR 合写（sea water → seawater）不算错位：字符级兜底放行", () => {
    const target = OA.normTokens("hot volcanic lava coming in contact with cold sea water");
    const asr = OA.normTokens("hot volcanic lava coming in contact with cold seawater");
    const al = OA.alignTokens(target, asr);
    // 词级上末尾连掉两个（sea / water 都对不上 seawater）
    expect(OA.anchorOk(target, asr, al.a, al.b).tail.tok).toBeLessThan(4);
    expect(OA.anchorOk(target, asr, al.a, al.b).ok).toBe(true);
  });

  test("首尾 5 个词里错一个（ASR 听岔）仍算对上", () => {
    const target = OA.normTokens("Sediment builds up along the delta each spring and summer here");
    const asr = OA.normTokens("Settlement builds up along the delta each spring and summer here");
    const al = OA.alignTokens(target, asr);
    expect(OA.anchorOk(target, asr, al.a, al.b).ok).toBe(true);
  });
});

describe("computeCut ② 不越界", () => {
  test("ceiling 把终点夹住（下一组起点已由调用方减去 nextGuard）", () => {
    const words = mkWords("Have you heard about the concert?", { from: 2 });
    const t = OA.normTokens("Have you heard about the concert?");
    const noCeil = OA.computeCut({ words, targetTokens: t });
    const capped = OA.computeCut({ words, targetTokens: t, ceiling: noCeil.contentEnd + 0.1 });
    expect(noCeil.end).toBeCloseTo(noCeil.contentEnd + OA.DEFAULTS.tailPad, 3);
    expect(capped.end).toBeCloseTo(noCeil.contentEnd + 0.1, 3);
  });

  test("gateDecision：终点越过下一组起点 → overruns_next", () => {
    const g = OA.gateDecision({ coverage: 1, wpm: 150, start: 0, end: 10, nextStart: 10.0 });
    expect(g.pass).toBe(false);
    expect(g.reasons).toContain("overruns_next");
  });

  test("gateDecision：终点超出源文件时长 → overruns_file", () => {
    const g = OA.gateDecision({ coverage: 1, wpm: 150, start: 0, end: 12, fileDuration: 11 });
    expect(g.pass).toBe(false);
    expect(g.reasons).toContain("overruns_file");
  });
});

describe("computeCut ③ lcr 逐句唯一定位", () => {
  // 同一段音频里的四句短应答，两两用词高度重叠 —— 顺序单调（光标只往前走）是唯一性的来源。
  const asr = mkWords(
    "Who is presenting our project? Who will be attending the conference? "
    + "Can you turn down the volume? What is the status of our club registration?");
  const sentences = [
    "Who is presenting our project?",
    "Who will be attending the conference?",
    "Can you turn down the volume?",
    "What is the status of our club registration?",
  ];

  test("四句各切各的，区间严格递增、互不重叠", () => {
    let cursor = 0;
    const spans = [];
    for (const s of sentences) {
      const win = asr.slice(cursor);
      const cut = OA.computeCut({ words: win, targetTokens: OA.normTokens(s), allowLeadIn: false });
      expect(cut.ok).toBe(true);
      expect(cut.coverage).toBe(1);
      spans.push([cursor + cut.aIdx, cursor + cut.bIdx]);
      cursor += cut.bIdx;
    }
    for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);
    // 第二句必须落在 "Who will be…" 上，而不是回头对到第一句的 "Who"
    expect(asr[spans[1][0]].w).toBe("Who");
    expect(asr[spans[1][0] + 1].w).toBe("will");
  });

  test("定位覆盖率过低 → locate_failed，不硬切", () => {
    const cut = OA.computeCut({
      words: asr, targetTokens: OA.normTokens("Completely different sentence about badgers and hats."),
    });
    expect(cut.ok).toBe(false);
    expect(cut.reason).toBe("locate_failed");
  });
});

describe("gateDecision ④ 覆盖率 / 词速 / 时长", () => {
  test("长文本按比例：覆盖率 0.84 不过", () => {
    const g = OA.gateDecision({ coverage: 0.84, matched: 168, targetTokens: 200, wpm: 150, start: 0, end: 60 });
    expect(g.pass).toBe(false);
    expect(g.reasons).toContain("coverage_low");
  });

  test("短句豁免：5 个词漏 1 个（0.8）仍算过 —— 那是 ASR 噪声不是数据问题", () => {
    const g = OA.gateDecision({ coverage: 0.8, matched: 4, targetTokens: 5, wpm: 150, start: 0, end: 3 });
    expect(g.pass).toBe(true);
  });

  test("短句漏 2 个就不过", () => {
    const g = OA.gateDecision({ coverage: 0.6, matched: 3, targetTokens: 5, wpm: 150, start: 0, end: 3 });
    expect(g.pass).toBe(false);
    expect(g.reasons).toContain("coverage_low");
  });

  test("词速出界（太慢 / 太快）不过", () => {
    expect(OA.gateDecision({ coverage: 1, wpm: 49, start: 0, end: 9 }).reasons).toContain("wpm_out_of_range");
    expect(OA.gateDecision({ coverage: 1, wpm: 400, start: 0, end: 9 }).reasons).toContain("wpm_out_of_range");
    expect(OA.gateDecision({ coverage: 1, wpm: 150, start: 0, end: 9 }).pass).toBe(true);
  });

  test("太短（< 1s）不过", () => {
    const g = OA.gateDecision({ coverage: 1, wpm: 150, start: 0, end: 0.8 });
    expect(g.pass).toBe(false);
    expect(g.reasons).toContain("too_short");
  });

  test("尾巴不干净不过", () => {
    const g = OA.gateDecision({ coverage: 1, wpm: 150, start: 0, end: 5, tailClean: false });
    expect(g.pass).toBe(false);
    expect(g.reasons).toContain("tail_not_clean");
  });
});

describe("resolveTail —— 收声时刻 + 计时音", () => {
  test("词末时间戳偏早时，按能量找到真正的收声时刻", () => {
    // 正文末词标到 10.0，实际声音响到 10.14（10.00–10.12 还是 −30 dB）
    const probes = mkProbes(10, 12, [10.0, 10.02, 10.04, 10.06, 10.08, 10.1, 10.12]);
    const r = OA.resolveTail({ contentEnd: 10, probes });
    expect(r.ok).toBe(true);
    expect(r.speechEnd).toBeCloseTo(10.14, 2);
    expect(r.end).toBeCloseTo(10.14 + OA.DEFAULTS.tailPad, 2);
  });

  test("作答段的计时「咔」：终点收到它之前", () => {
    const probes = mkProbes(2.24, 3.4, [2.56, 2.6, 2.64]);
    const r = OA.resolveTail({ contentEnd: 2.24, probes });
    expect(r.ok).toBe(true);
    expect(r.trimmed).toBe(true);
    expect(r.end).toBeLessThan(2.56);
    expect(r.end).toBeGreaterThan(2.24 + OA.DEFAULTS.tailPadMin);
  });

  test("「咔」紧贴收声（留不出 tailPadMin）→ 判尾巴不干净", () => {
    const probes = mkProbes(5, 6, [5.16, 5.18]);
    const r = OA.resolveTail({ contentEnd: 5, probes });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("tail_not_clean");
  });

  test("正文一直响到探针尽头（没找到收声）→ fail-closed", () => {
    const loud = [];
    for (let t = 9; t < 10.5; t += 0.02) loud.push(Math.round(t * 1000) / 1000);
    const r = OA.resolveTail({ contentEnd: 9, probes: mkProbes(9, 10.5, loud) });
    expect(r.ok).toBe(false);
  });

  test("源文件正好在正文结束处收尾：文件末尾就是终点", () => {
    const loud = [];
    for (let t = 9; t < 9.17; t += 0.02) loud.push(Math.round(t * 1000) / 1000);
    const r = OA.resolveTail({
      contentEnd: 9, probes: mkProbes(9, 9.17, loud), ceiling: 9.17, atCeiling: true,
    });
    expect(r.ok).toBe(true);
    expect(r.atFileEnd).toBe(true);
    expect(r.end).toBeCloseTo(9.17, 3);
  });
});

describe("cleanNarration / narrationTextFor —— 旁白拼回去", () => {
  test("句尾粘着正文第一个词：切到句子结束为止", () => {
    expect(OA.cleanNarration("Listen to an announcement in a classroom. I"))
      .toBe("Listen to an announcement in a classroom.");
    expect(OA.cleanNarration("Listen to a talk in a chemistry class. Back"))
      .toBe("Listen to a talk in a chemistry class.");
    expect(OA.cleanNarration(
      "Listen to a talk on a social sciences podcast. One of the most fascinating aspects of human culture is gift -giving."))
      .toBe("Listen to a talk on a social sciences podcast.");
  });

  test("没有句号：补一个；专有名词的大小写原样保留", () => {
    expect(OA.cleanNarration("Listen to a talk on a History of Technology podcast"))
      .toBe("Listen to a talk on a History of Technology podcast.");
  });

  test("首字母大写、空格规整", () => {
    expect(OA.cleanNarration("  listen to a conversation .  Hey there"))
      .toBe("Listen to a conversation.");
  });

  test("缩写里的句号不算句子结束（否则会切成 'Listen to a talk in a U.'）", () => {
    expect(OA.cleanNarration("Listen to a talk in a U.S. history class. Have"))
      .toBe("Listen to a talk in a U.S. history class.");
  });

  test("lcr 不加旁白（真考没有）", () => {
    expect(OA.narrationTextFor("lcr", "Listen to something.")).toBeNull();
  });

  test("lc 一律通用句（53 条实测清一色）", () => {
    expect(OA.narrationTextFor("lc", "Listen to a conversation. Hey")).toBe("Listen to a conversation.");
    expect(OA.narrationTextFor("lc", null)).toBe("Listen to a conversation.");
  });

  test("la / lat 用原句；还原不到就退回通用句", () => {
    expect(OA.narrationTextFor("la", "Listen to an announcement on a campus radio station. Due"))
      .toBe("Listen to an announcement on a campus radio station.");
    expect(OA.narrationTextFor("la", null)).toBe("Listen to an announcement.");
    expect(OA.narrationTextFor("lat", "Listen to a talk on a biology podcast. Have"))
      .toBe("Listen to a talk on a biology podcast.");
    expect(OA.narrationTextFor("lat", null)).toBe("Listen to a talk.");
  });

  test("洗出来的句子不像旁白（没有任务名词 / 不以 Listen 起头）也退回通用句", () => {
    expect(OA.narrationTextFor("lat", "Back in the nineteenth century, chemists believed."))
      .toBe("Listen to a talk.");
    expect(OA.narrationTextFor("la", "Listen to me carefully now.")).toBe("Listen to an announcement.");
  });

  test("切句没切干净、连上正文的残句一律退回通用句（不能把正文半句念出来）", () => {
    // 两条都是实测还原出来的：结构上像旁白，但带了人称 / 指示代词 / 问号
    expect(OA.narrationTextFor("la", "Listen to an announcement at a time when you're ready."))
      .toBe("Listen to an announcement.");
    expect(OA.narrationTextFor("lat", "Listen to a talk in a mask that you completely missed something obvious?"))
      .toBe("Listen to a talk.");
    // 太长的也不要
    expect(OA.narrationTextFor("lat",
      "Listen to a talk in an art history class about the many different painters of the northern renaissance."))
      .toBe("Listen to a talk.");
  });

  test("真旁白里最长 / 最刁的几条要放行", () => {
    for (const s of [
      "Listen to an announcement at a gathering of student club leaders.",
      "Listen to part of a talk in a psychology class.",
      "Listen to a talk on a History of Technology podcast.",
      "Listen to a campus radio announcement.",
    ]) expect(OA.narrationTextFor(s.includes("announcement") ? "la" : "lat", s)).toBe(s);
  });
});

describe("resolveHead —— 头部不许带别人的声音", () => {
  test("正文前隔着安静的那一声「咔」：起点挪到它后面", () => {
    // 正文起于 6.30，计时音在 5.90–6.10，中间 6.12–6.28 是安静的
    const probes = mkProbes(6.05, 6.3, [6.06, 6.08]);
    const r = OA.resolveHead({ start: 6.05, contentStart: 6.3, probes });
    expect(r.trimmed).toBe(true);
    expect(r.start).toBeGreaterThan(6.08);
    expect(r.start).toBeLessThanOrEqual(6.3 - OA.DEFAULTS.headPadMin + 1e-9);
  });

  test("紧贴正文的那点能量是正文自己的起音：不动，免得削掉第一个音", () => {
    const probes = mkProbes(6.05, 6.3, [6.24, 6.26, 6.28]);
    const r = OA.resolveHead({ start: 6.05, contentStart: 6.3, probes });
    expect(r.trimmed).toBe(false);
    expect(r.start).toBeCloseTo(6.05, 3);
  });

  test("头部本来就安静：原样返回", () => {
    const r = OA.resolveHead({ start: 6.05, contentStart: 6.3, probes: mkProbes(6.05, 6.3) });
    expect(r.trimmed).toBe(false);
    expect(r.start).toBeCloseTo(6.05, 3);
  });
});

describe("applyOriginalAudio ⑤ 回挂", () => {
  const spokenText = (kind, it) => {
    if (kind === "lcr") return String(it.speaker || "");
    if (kind === "la") return String(it.announcement || "");
    return "";
  };

  test("sha1 一致：挂原声 URL、打 audio_source、去掉 audio_pending", () => {
    const item = { id: "real_lcr_x_1_01", speaker: "Hello there.", audio_url: null, audio_pending: true };
    const manifest = { entries: { real_lcr_x_1_01: { url: "https://cdn/real_orig/lcr/a.mp3?v=1", text_sha1: OA.sha1("Hello there.") } } };
    const res = OA.applyOriginalAudio({ lcr: [item] }, manifest, spokenText);
    expect(res.mounted).toBe(1);
    expect(item.audio_url).toBe("https://cdn/real_orig/lcr/a.mp3?v=1");
    expect(item.audio_source).toBe("original");
    expect(item.audio_pending).toBeUndefined();
  });

  test("sha1 不一致（口播文本被复核 patch 改过）：不挂，原样留给 TTS", () => {
    const item = { id: "real_la_x_1_19", announcement: "Rewritten text.", audio_url: "https://cdn/real/la/x.mp3", audio_source: undefined };
    delete item.audio_source;
    const manifest = { entries: { real_la_x_1_19: { url: "https://cdn/real_orig/la/x.mp3", text_sha1: OA.sha1("Original text.") } } };
    const res = OA.applyOriginalAudio({ la: [item] }, manifest, spokenText);
    expect(res.mounted).toBe(0);
    expect(res.mismatched).toEqual(["real_la_x_1_19"]);
    expect(item.audio_url).toBe("https://cdn/real/la/x.mp3");
    expect(item.audio_source).toBeUndefined();
  });

  test("清单里没有的条目不动（TTS 兜底不加 audio_source，保持向后兼容）", () => {
    const item = { id: "real_lcr_y_1_02", speaker: "Untouched.", audio_url: "https://cdn/real/lcr/y.mp3" };
    const res = OA.applyOriginalAudio({ lcr: [item] }, { entries: {} }, spokenText);
    expect(res.mounted).toBe(0);
    expect(item.audio_source).toBeUndefined();
    expect(item.audio_url).toBe("https://cdn/real/lcr/y.mp3");
  });

  test("清单里有、库里已下架的条目：报出来但不报错", () => {
    const manifest = { entries: { gone_id: { url: "u", text_sha1: "s" } } };
    const res = OA.applyOriginalAudio({ lcr: [] }, manifest, spokenText);
    expect(res.missing).toEqual(["gone_id"]);
  });
});
