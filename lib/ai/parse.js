import { buildAnnotationSegments, countAnnotations, parseAnnotations } from "../annotations/parseAnnotations";

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
  return parsed;
}

function extractSections(raw) {
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

function parseScoreSection(text) {
  const src = String(text || "");
  const scoreMatch = src.match(/(?:score|分数)\s*[:：]\s*([0-5](?:\.\d+)?)/i);
  const bandMatch = src.match(/(?:band|档位)\s*[:：]\s*([0-9]+(?:\.[0-9]+)?)/i);
  const summaryMatch = src.match(/(?:summary|总评)\s*[:：]\s*(.+)$/im);
  const score = scoreMatch ? Number(scoreMatch[1]) : null;
  return {
    score: Number.isFinite(score) ? Math.max(0, Math.min(5, score)) : null,
    band: bandMatch ? Number(bandMatch[1]) : null,
    summary: summaryMatch ? summaryMatch[1].trim() : "",
  };
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

function parseActionSection(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const hasCjk = (s) => /[\u4e00-\u9fff]/.test(String(s || ""));
  const fallbackTitle = "语言与任务表达可提升";
  const fallbackImportance = "该问题会直接影响任务完成度和语言准确性，从而拉低最终分数。";
  const fallbackAction = "先按逐句批注改写，再重写一版完整答案；下次作答时优先修正同类错误，至少落实 3 处。";
  const ensureZh = (value, fallback) => {
    const v = String(value || "").trim();
    if (!v) return fallback;
    if (hasCjk(v)) return v;
    return `${fallback}（原建议：${v}）`;
  };

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
      return {
        title: ensureZh(title, fallbackTitle),
        importance: ensureZh(importance, fallbackImportance),
        action: ensureZh(action, fallbackAction),
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
      PATTERNS: {
        ok: !sections.PATTERNS || patternsState.parsed,
        raw: sections.PATTERNS || "",
      },
      COMPARISON: {
        ok: !sections.COMPARISON || Boolean(comparison.modelEssay || comparison.points.length > 0),
        raw: sections.COMPARISON || "",
      },
      ACTION: { ok: !sections.ACTION || actions.length > 0, raw: sections.ACTION || "" },
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
      comparison,
      sections,
      sectionStates,
      rubric: null,
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

