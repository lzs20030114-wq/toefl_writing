function fallbackReport(reason) {
  return {
    score: null,
    band: null,
    summary: "评分解析失败，请重试",
    goals: [],
    goals_met: [],
    patterns: [],
    actions: [],
    annotationRaw: "",
    annotationSegments: [],
    annotationCounts: { red: 0, orange: 0, blue: 0 },
    comparison: { modelEssay: "", points: [], raw: "" },
    sections: {},
    weaknesses: [],
    strengths: [],
    grammar_issues: [],
    vocabulary_note: "",
    next_steps: [],
    sample: "",
    engages_professor: false,
    engages_students: false,
    error: true,
    errorReason: reason,
  };
}

function stripFence(rawText) {
  return String(rawText || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function parseLegacyJson(cleaned) {
  const parsed = JSON.parse(cleaned);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("AI returned non-object response");
  }
  if (typeof parsed.score !== "number") {
    throw new Error("AI response missing score field");
  }
  return parsed;
}

function extractSections(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  const re = /^===([A-Z_]+)===$/gm;
  const matches = [];
  let m = re.exec(text);
  while (m) {
    matches.push({ name: m[1], start: m.index, bodyStart: re.lastIndex });
    m = re.exec(text);
  }
  const out = {};
  for (let i = 0; i < matches.length; i += 1) {
    const cur = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length;
    out[cur.name] = text.slice(cur.bodyStart, end).trim();
  }
  return out;
}

function parseScoreSection(text) {
  const scoreMatch = String(text || "").match(/(?:分数|score)\s*[:：]\s*([0-5])/i);
  const bandMatch = String(text || "").match(/band\s*[:：]\s*([0-9]+(?:\.[0-9]+)?)/i);
  const summaryMatch = String(text || "").match(/(?:总评|summary)\s*[:：]\s*(.+)$/im);
  return {
    score: scoreMatch ? Number(scoreMatch[1]) : null,
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
    const m = line.match(/^Goal\s*(\d+)\s*:\s*(OK|PARTIAL|MISSING)\s*(.*)$/i);
    if (!m) return;
    goals.push({
      index: Number(m[1]),
      status: m[2].toUpperCase(),
      reason: (m[3] || "").trim(),
    });
  });
  goals.sort((a, b) => a.index - b.index);
  return goals;
}

function parseAnnotation(text) {
  const segments = [];
  const raw = String(text || "");
  const regex = /<r>([\s\S]*?)<\/r>\s*<n\s+level="(red|orange|blue)"\s+fix="([^"]*)">([\s\S]*?)<\/n>/gi;
  let lastIndex = 0;
  let m = regex.exec(raw);
  while (m) {
    if (m.index > lastIndex) {
      segments.push({ type: "text", text: raw.slice(lastIndex, m.index) });
    }
    segments.push({
      type: "mark",
      text: m[1].trim(),
      level: m[2],
      fix: m[3].trim(),
      note: m[4].trim(),
    });
    lastIndex = m.index + m[0].length;
    m = regex.exec(raw);
  }
  if (lastIndex < raw.length) {
    segments.push({ type: "text", text: raw.slice(lastIndex) });
  }
  const counts = segments.reduce(
    (acc, seg) => {
      if (seg.type === "mark") acc[seg.level] += 1;
      return acc;
    },
    { red: 0, orange: 0, blue: 0 }
  );
  return { raw, segments, counts };
}

function parsePatterns(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const lines = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const patterns = [];
  lines.forEach((line) => {
    try {
      const parsed = JSON.parse(line);
      if (Array.isArray(parsed)) patterns.push(...parsed);
      else if (parsed && Array.isArray(parsed.patterns)) patterns.push(...parsed.patterns);
      else if (parsed && parsed.tag) patterns.push(parsed);
    } catch {
      // Ignore malformed lines and keep graceful fallback.
    }
  });
  return patterns;
}

function parseComparison(text) {
  const raw = String(text || "");
  const modelMatch = raw.match(/\[(?:范文|Model)\]([\s\S]*?)(?=\[(?:对比|Comparison)\]|$)/i);
  const modelEssay = modelMatch ? modelMatch[1].trim() : "";
  const compBodyMatch = raw.match(/\[(?:对比|Comparison)\]([\s\S]*)$/i);
  const compBody = compBodyMatch ? compBodyMatch[1].trim() : "";
  const points = [];
  const re = /(?:^|\n)\s*(\d+)\.\s*(.+?)\n([\s\S]*?)(?=(?:\n\s*\d+\.\s+)|$)/g;
  let m = re.exec(compBody);
  while (m) {
    const block = m[3];
    const yours = (block.match(/(?:你的|Yours)\s*[:：]\s*(.+)$/im) || [])[1] || "";
    const model = (block.match(/(?:范文|Model)\s*[:：]\s*(.+)$/im) || [])[1] || "";
    const difference = (block.match(/(?:差异|Difference)\s*[:：]\s*([\s\S]+)$/im) || [])[1] || "";
    points.push({
      index: Number(m[1]),
      title: m[2].trim(),
      yours: yours.trim(),
      model: model.trim(),
      difference: difference.trim(),
    });
    m = re.exec(compBody);
  }
  return { modelEssay, points, raw };
}

function parseActions(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const blocks = raw
    .split(/(?=(?:短板\d+|Action\d+)\s*[:：])/)
    .map((s) => s.trim())
    .filter(Boolean);
  return blocks
    .map((block) => {
      const title = (block.match(/(?:短板\d+|Action\d+)\s*[:：]\s*(.+)$/im) || [])[1] || "";
      const importance = (block.match(/(?:重要性|Importance)\s*[:：]\s*([\s\S]*?)(?=\n(?:行动|Action|短板\d+|Action\d+)\s*[:：]|$)/im) || [])[1] || "";
      const action = (block.match(/(?:行动|Action)\s*[:：]\s*([\s\S]*?)(?=\n(?:短板\d+|Action\d+)\s*[:：]|$)/im) || [])[1] || "";
      if (!title && !importance && !action) return null;
      return {
        title: title.trim(),
        importance: importance.trim(),
        action: action.trim(),
      };
    })
    .filter(Boolean)
    .slice(0, 2);
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
  const engagementPattern = (patterns || []).find((p) => String(p.tag || "").includes("未回应他人观点"));

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
      return parseLegacyJson(cleaned);
    }

    const sections = extractSections(cleaned);
    if (!Object.keys(sections).length) return fallbackReport("Missing section markers");

    const scorePart = parseScoreSection(sections.SCORE || "");
    if (scorePart.score === null) return fallbackReport("SCORE section missing valid score");

    const goals = parseGoalsSection(sections.GOALS || "");
    const annotation = parseAnnotation(sections.ANNOTATION || "");
    const patterns = parsePatterns(sections.PATTERNS || "");
    const comparison = parseComparison(sections.COMPARISON || "");
    const actions = parseActions(sections.ACTION || "");
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
      summary: scorePart.summary || "已生成评分报告，请查看各板块详情。",
      goals,
      patterns,
      actions,
      annotationRaw: annotation.raw,
      annotationSegments: annotation.segments,
      annotationCounts: annotation.counts,
      comparison,
      sections,
      ...compat,
      error: false,
      errorReason: "",
    };
  } catch (e) {
    return fallbackReport(e.message || "Parse failed");
  }
}

export function parseScoreReport(rawText, taskType) {
  const parsed = parseReport(rawText);
  const out = {
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
  return out;
}
