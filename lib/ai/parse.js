import { buildAnnotationSegments, countAnnotations, parseAnnotations } from "../annotations/parseAnnotations.js";

function fallbackReport(reason) {
  return {
    score: null,
    band: null,
    summary: "Scoring parse failed. Please retry.",
    goals: [],
    goals_met: [],
    patterns: [],
    actions: [],
    annotationRaw: "",
    annotationSegments: [],
    annotationCounts: { red: 0, orange: 0, blue: 0, spelling: 0 },
    correctedText: "",
    comparison: { modelEssay: "", points: [], raw: "" },
    sections: {},
    sectionStates: {},
    weaknesses: [],
    strengths: [],
    grammar_issues: [],
    vocabulary_note: "",
    next_steps: [],
    key_problems: [],
    score_confidence: null,
    confidence_state: null,
    rubric: null,
    errorTriage: null,
    signals: null,
    sample: "",
    engages_professor: false,
    engages_students: false,
    error: true,
    errorReason: reason,
  };
}

function stripFence(rawText) {
  return String(rawText || "").replace(/```json/gi, "").replace(/```/g, "").trim();
}

function parseJsonReport(cleaned) {
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI returned non-object response");
  }
  const parsedScore = Number(parsed.score);
  if (!Number.isFinite(parsedScore)) {
    throw new Error("AI response missing score field");
  }
  parsed.score = parsedScore;
  const parsedBand = Number(parsed.band);
  parsed.band = Number.isFinite(parsedBand) ? parsedBand : null;
  if (!Array.isArray(parsed.key_problems)) parsed.key_problems = [];
  if (!parsed.score_confidence || typeof parsed.score_confidence !== "object") parsed.score_confidence = null;
  if (!parsed.confidence_state || typeof parsed.confidence_state !== "object") parsed.confidence_state = null;
  if (!parsed.rubric || typeof parsed.rubric !== "object") parsed.rubric = null;
  if (!parsed.errorTriage || typeof parsed.errorTriage !== "object") parsed.errorTriage = null;
  return parsed;
}

// 导出供 lib/ai/lessonParse.js 复用（讲评输出用同一套 ===SECTION=== 约定）。
// 只加 export，逻辑一字未改。
export function extractSections(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  const re = /^===([A-Z_]+)===$/gm;
  const markers = [];
  let m = re.exec(text);
  while (m) {
    markers.push({ name: m[1], start: m.index, bodyStart: re.lastIndex });
    m = re.exec(text);
  }
  const sections = {};
  for (let i = 0; i < markers.length; i += 1) {
    const cur = markers[i];
    const end = i + 1 < markers.length ? markers[i + 1].start : text.length;
    sections[cur.name] = text.slice(cur.bodyStart, end).trim();
  }
  return sections;
}

function parseSignalsSection(text) {
  const src = String(text || "");
  const getBool = (key) => {
    const m = src.match(new RegExp(`${key}\\s*:\\s*(true|false)`, "i"));
    return m ? m[1].toLowerCase() === "true" : null;
  };
  return {
    stance_clear: getBool("stance_clear"),
    has_example: getBool("has_example"),
    engages_discussion: getBool("engages_discussion"),
  };
}

// prompt 要求模型写「维度-任务完成: 4.5 三个目标均完成且有细节」——分数之后同一
// 行的余文就是那句理由。旧正则只抓数字，模型每次都写的理由被整段丢掉，报告里
// 只剩三个光秃秃的分数。这里连理由一起取回；数值处理与之前逐字节一致。
function parseDimensionScore(src, label) {
  const re = new RegExp(`${label}\\s*[:：]\\s*([0-5](?:\\.\\d+)?)([^\\n]*)`, "i");
  const m = src.match(re);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const reason = String(m[2] || "")
    .replace(/^[\s·—–\-、,，.。:：]+/, "")
    .trim();
  return { score: Math.max(0, Math.min(5, v)), reason };
}

function parseScoreSection(text) {
  const src = String(text || "");
  const scoreMatch = src.match(/(?:score|分数)\s*[:：]\s*([0-5](?:\.\d+)?)/i);
  const bandMatch = src.match(/(?:band|档位)\s*[:：]\s*([0-9]+(?:\.[0-9]+)?)/i);
  const summaryMatch = src.match(/(?:summary|总评)\s*[:：]\s*(.+)$/im);
  const score = scoreMatch ? Number(scoreMatch[1]) : null;

  // Extract dimension scores + 一句话理由 (任务完成/组织连贯/语言使用)
  const taskDim = parseDimensionScore(src, "维度-任务完成");
  const orgDim = parseDimensionScore(src, "维度-组织连贯");
  const langDim = parseDimensionScore(src, "维度-语言使用");
  const hasDimensions = taskDim !== null || orgDim !== null || langDim !== null;
  // 维度缺失时仍保留 { score: null }：normalizeRubric 的 `?? fallbackScore`
  // 依赖它回落到 holistic 分，写成 0 会改分。
  const dimOf = (d) => ({ score: d ? d.score : null, reason: d ? d.reason : "" });

  return {
    score: Number.isFinite(score) ? Math.max(0, Math.min(5, score)) : null,
    band: bandMatch ? Number(bandMatch[1]) : null,
    summary: summaryMatch ? summaryMatch[1].trim() : "",
    rubric: hasDimensions ? {
      dimensions: {
        task_fulfillment: dimOf(taskDim),
        organization_coherence: dimOf(orgDim),
        language_use: dimOf(langDim),
      },
    } : null,
  };
}

function splitAfterLabelColon(line) {
  // 取第一个「不在括号内」的冒号之后的内容：标签自带的括号说明里可能有冒号。
  let depth = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "（" || ch === "(") depth += 1;
    else if (ch === "）" || ch === ")") depth = Math.max(0, depth - 1);
    else if ((ch === ":" || ch === "：") && depth === 0) return line.slice(i + 1).trim();
  }
  return "";
}

function cleanErrorIssue(text) {
  return String(text || "")
    // 「（是否妨碍理解: 是；是否系统性失控: 否）」这类判定括号已被抽成布尔，正文里去掉
    .replace(/[（(][^（()）]*(?:妨碍理解|系统性失控)[^（()）]*[)）]/g, "")
    // 模型偶尔不加括号直接写判定
    .replace(/(?:是否)?妨碍理解\s*[:：]\s*[是否]/g, "")
    .replace(/(?:是否)?系统性失控\s*[:：]\s*[是否]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[；;、，,\s]+/, "")
    .replace(/[；;、，,\s]+$/, "")
    .trim();
}

function stripOuterBrackets(text) {
  const v = String(text || "").trim();
  if (/^\[[\s\S]*\]$/.test(v)) return v.slice(1, -1).trim();
  if (/^「[\s\S]*」$/.test(v)) return v.slice(1, -1).trim();
  return v;
}

// ===ERRORS=== 段是模型对「哪些错真的压分」的逐条判定（② 类压分 / ① 类限时小错），
// prompt 每次都要求它先写这一段再定分，但前端此前从不读取。解析成结构化对象后，
// 报告才能把「影响分数的错误」与「不压分的小错」分开呈现，而不是把一堆小错
// 一视同仁地砸给用户。任何异常一律返回空结构，绝不抛错打断整份报告。
export function parseErrorsSection(text) {
  const empty = { capped: [], minorSummary: "", verdict: "" };
  try {
    const src = String(text || "");
    if (!src.trim()) return empty;
    const lines = src.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim());

    let cappedIdx = -1;
    let minorIdx = -1;
    let verdictIdx = -1;
    lines.forEach((line, i) => {
      if (!line) return;
      if (/^判定/.test(line)) {
        if (verdictIdx < 0) verdictIdx = i;
        return;
      }
      // 「不压分」里含「压分」——必须先判不压分，否则 ① 行会被当成 ② 标题。
      if (line.includes("不压分") || line.includes("①")) {
        if (minorIdx < 0) minorIdx = i;
        return;
      }
      if (cappedIdx < 0 && (line.includes("压分") || line.includes("②"))) cappedIdx = i;
    });

    // ② 条目区间：② 标题行之后 → 下一个 ①/判定 行之前（标题缺失时从头扫）。
    const start = cappedIdx >= 0 ? cappedIdx + 1 : 0;
    const after = cappedIdx >= 0 ? cappedIdx : -1;
    const bounds = [minorIdx, verdictIdx].filter((i) => i > after);
    const end = bounds.length > 0 ? Math.min(...bounds) : lines.length;

    const capped = [];
    lines.slice(start, Math.max(start, end)).forEach((line) => {
      if (!/^[-–—•*]\s*/.test(line)) return;
      const body = line.replace(/^[-–—•*]+\s*/, "").trim();
      if (!body || /^(无|none)[。.]?$/i.test(body)) return;
      const arrow = body.match(/→|->/);
      let quote = "";
      let issue = body;
      if (arrow) {
        const at = body.indexOf(arrow[0]);
        quote = body.slice(0, at).trim();
        issue = body.slice(at + arrow[0].length).trim();
      }
      const impedesM = body.match(/(?:是否)?妨碍理解\s*[:：]\s*(是|否)/);
      const systemicM = body.match(/(?:是否)?系统性失控\s*[:：]\s*(是|否)/);
      capped.push({
        quote: stripOuterBrackets(quote),
        issue: cleanErrorIssue(issue),
        impedes: impedesM ? impedesM[1] === "是" : null,
        systemic: systemicM ? systemicM[1] === "是" : null,
      });
    });

    const minorSummary = minorIdx >= 0 ? stripOuterBrackets(splitAfterLabelColon(lines[minorIdx])) : "";
    const verdict = verdictIdx >= 0 ? splitAfterLabelColon(lines[verdictIdx]) : "";

    return { capped, minorSummary, verdict };
  } catch {
    return empty;
  }
}

function parseGoalsSection(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const goals = [];
  lines.forEach((line) => {
    const m = line.match(/^Goal\s*(\d+)\s*[:：]\s*(OK|PARTIAL|MISSING)\s*(.*)$/i);
    if (!m) return;
    goals.push({
      index: Number(m[1]),
      status: m[2].toUpperCase(),
      reason: String(m[3] || "").trim(),
    });
  });
  goals.sort((a, b) => a.index - b.index);
  return goals;
}

function parseAnnotationSection(text) {
  const raw = String(text || "");
  const parsed = parseAnnotations(raw);
  const segments = buildAnnotationSegments(parsed);
  const counts = countAnnotations(parsed.annotations);
  return { raw, parsed, segments, counts };
}

function parsePatternsSection(text) {
  const raw = String(text || "").trim();
  if (!raw) return { items: [], parsed: false };

  try {
    const parsedWhole = JSON.parse(raw);
    if (Array.isArray(parsedWhole)) return { items: parsedWhole, parsed: true };
    if (parsedWhole && Array.isArray(parsedWhole.patterns)) return { items: parsedWhole.patterns, parsed: true };
    if (parsedWhole && parsedWhole.tag) return { items: [parsedWhole], parsed: true };
  } catch {
    // fall through to line-based parser
  }

  const out = [];
  const lines = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  lines.forEach((line) => {
    try {
      const parsed = JSON.parse(line);
      if (Array.isArray(parsed)) out.push(...parsed);
      else if (parsed && Array.isArray(parsed.patterns)) out.push(...parsed.patterns);
      else if (parsed && parsed.tag) out.push(parsed);
    } catch {
      // section fallback handled by caller
    }
  });
  return { items: out, parsed: out.length > 0 };
}

function parseComparisonSection(text) {
  const raw = String(text || "");
  const modelMatch = raw.match(/\[(?:范文|Model)\]([\s\S]*?)(?=\[(?:对比|Comparison)\]|$)/i);
  const modelEssay = modelMatch ? modelMatch[1].trim() : "";
  const pointsBodyMatch = raw.match(/\[(?:对比|Comparison)\]([\s\S]*)$/i);
  const pointsBody = pointsBodyMatch ? pointsBodyMatch[1].trim() : "";

  const points = [];
  const pointRe = /(?:^|\n)\s*(\d+)[\.\)）]\s*(.+?)\n([\s\S]*?)(?=(?:\n\s*\d+[\.\)）]\s+)|$)/g;
  let m = pointRe.exec(pointsBody);
  while (m) {
    const block = m[3];
    const yours = (block.match(/(?:你的|Yours)\s*[:：]\s*(.+)$/im) || [])[1] || "";
    const model = (block.match(/(?:范文|Model)\s*[:：]\s*(.+)$/im) || [])[1] || "";
    const difference = (block.match(/(?:差异|Difference)\s*[:：]\s*([\s\S]+)$/im) || [])[1] || "";
    points.push({
      index: Number(m[1]),
      title: m[2].trim(),
      yours: String(yours || "").trim(),
      model: String(model || "").trim(),
      difference: String(difference || "").trim(),
    });
    m = pointRe.exec(pointsBody);
  }

  return { modelEssay, points, raw };
}

// 短板卡一律照搬模型写的内容。旧实现在任一字段不含中文时把整段替换成三句固定
// 文案（「语言与任务表达可提升」…），把模型真正写的建议降级成括号里的「原建议」，
// 是用户感知到的「套话」最集中的一处。langOk 仅作日后度量用（模型漏写中文的比例），
// 前端不显示，也不参与任何渲染判断。
function parseActionSection(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const hasCjk = (s) => /[\u4e00-\u9fff]/.test(String(s || ""));

  const blocks = raw
    .split(/(?=(?:短板\d*|Action\d+)\s*[:：])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const actions = blocks
    .map((block) => {
      const title =
        (block.match(/(?:短板\d*|Action\d+)\s*[:：]\s*(.+)$/im) || [])[1] || "";
      const importance =
        (block.match(/(?:重要性|Importance)\s*[:：]\s*([\s\S]*?)(?=\n(?:行动|Action|短板\d+|Action\d+)\s*[:：]|$)/im) || [])[1] || "";
      const action =
        (block.match(/(?:行动|Action)\s*[:：]\s*([\s\S]*?)(?=\n(?:短板\d+|Action\d+)\s*[:：]|$)/im) || [])[1] || "";

      if (!title && !importance && !action) return null;
      const t = String(title || "").trim();
      const imp = String(importance || "").trim();
      const act = String(action || "").trim();
      return {
        title: t,
        importance: imp,
        action: act,
        langOk: hasCjk(t) && hasCjk(imp) && hasCjk(act),
      };
    })
    .filter(Boolean);

  return actions.slice(0, 2);
}

function buildCompatFields({ goals, patterns, annotation, actions, comparison, score }) {
  const goalsMet = (goals || []).map((g) => g.status === "OK");
  const weaknesses = (patterns || [])
    .filter((p) => Number(p?.count || 0) > 0)
    .slice(0, 3)
    .map((p) => `${p.tag}: ${p.summary}`);
  const grammarIssues = (annotation?.segments || [])
    .filter((s) => s.type === "mark" && (s.level === "red" || s.level === "orange"))
    .slice(0, 5)
    .map((s) => s.note);
  const nextSteps = (actions || []).map((a) => a.action).filter(Boolean);
  const engagementPattern = (patterns || []).find((p) =>
    String(p.tag || "").toLowerCase().includes("no engagement")
  );

  return {
    goals_met: goalsMet,
    weaknesses,
    strengths: [],
    grammar_issues: grammarIssues,
    vocabulary_note: "",
    next_steps: nextSteps,
    sample: comparison?.modelEssay || "",
    engages_professor: score >= 3,
    engages_students: engagementPattern ? Number(engagementPattern.count || 0) === 0 : score >= 3,
  };
}

export function parseReport(rawText) {
  try {
    const cleaned = stripFence(rawText);
    if (!cleaned) return fallbackReport("Empty AI response");

    if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
      return parseJsonReport(cleaned);
    }

    const sections = extractSections(cleaned);
    if (!Object.keys(sections).length) {
      return fallbackReport("Missing section markers");
    }

    const scorePart = parseScoreSection(sections.SCORE || "");
    if (scorePart.score === null) {
      return fallbackReport("SCORE section missing valid score");
    }

    const goals = parseGoalsSection(sections.GOALS || "");
    const annotation = parseAnnotationSection(sections.ANNOTATION || "");
    const patternsState = parsePatternsSection(sections.PATTERNS || "");
    const patterns = patternsState.items;
    const comparison = parseComparisonSection(sections.COMPARISON || "");
    const actions = parseActionSection(sections.ACTION || "");
    const errorTriage = sections.ERRORS ? parseErrorsSection(sections.ERRORS) : null;

    // Corrected version of the user's essay — produced by AI per the
    // ===CORRECTED=== section. Used by lib/postWritingPractice.js to build
    // drill prompts on a clean text instead of the user's error-ridden one.
    // Strip any accidental markdown fences or labels.
    const correctedText = String(sections.CORRECTED || "")
      .replace(/^```[a-zA-Z]*\s*/m, "")
      .replace(/```\s*$/m, "")
      .trim();

    const sectionStates = {
      SCORE: { ok: true, raw: sections.SCORE || "" },
      GOALS: { ok: !sections.GOALS || goals.length > 0, raw: sections.GOALS || "" },
      ANNOTATION: {
        ok:
          !sections.ANNOTATION ||
          !annotation.parsed.parseError ||
          Number(annotation.counts.red + annotation.counts.orange + annotation.counts.blue) > 0,
        raw: sections.ANNOTATION || "",
      },
      CORRECTED: { ok: !sections.CORRECTED || correctedText.length > 0, raw: sections.CORRECTED || "" },
      PATTERNS: {
        ok: !sections.PATTERNS || patternsState.parsed,
        raw: sections.PATTERNS || "",
      },
      COMPARISON: {
        ok: !sections.COMPARISON || Boolean(comparison.modelEssay || comparison.points.length > 0),
        raw: sections.COMPARISON || "",
      },
      ACTION: { ok: !sections.ACTION || actions.length > 0, raw: sections.ACTION || "" },
      ERRORS: {
        ok:
          !sections.ERRORS ||
          Boolean(
            errorTriage &&
              (errorTriage.capped.length > 0 || errorTriage.minorSummary || errorTriage.verdict)
          ),
        raw: sections.ERRORS || "",
      },
    };

    const compat = buildCompatFields({
      goals,
      patterns,
      annotation,
      actions,
      comparison,
      score: scorePart.score,
    });

    return {
      score: scorePart.score,
      band: scorePart.band,
      summary: scorePart.summary || "评分报告已生成。",
      goals,
      patterns,
      actions,
      annotationRaw: annotation.raw,
      annotationParsed: annotation.parsed,
      annotationSegments: annotation.segments,
      annotationCounts: annotation.counts,
      correctedText,
      comparison,
      sections,
      sectionStates,
      rubric: scorePart.rubric || null,
      errorTriage,
      signals: parseSignalsSection(sections.SIGNALS || ""),
      ...compat,
      key_problems: [],
      score_confidence: null,
      confidence_state: null,
      error: false,
      errorReason: "",
    };
  } catch (e) {
    return fallbackReport(e.message || "Parse failed");
  }
}

export function parseScoreReport(rawText, taskType) {
  const parsed = parseReport(rawText);
  return {
    score: parsed.score,
    band: parsed.band,
    summary: parsed.summary,
    goals: taskType === "email" ? parsed.goals : null,
    annotation: parsed.annotationSegments,
    patterns: parsed.patterns,
    comparison: parsed.comparison,
    actions: parsed.actions,
    raw: rawText,
    error: parsed.error,
    errorReason: parsed.errorReason,
  };
}

