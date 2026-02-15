function fallbackReport(reason) {
  return {
    score: null,
    band: null,
    summary: "评分解析失败，请重试",
    goals_met: [],
    weaknesses: [],
    strengths: [],
    grammar_issues: [],
    vocabulary_note: "",
    next_steps: [],
    sample: "",
    engages_professor: false,
    engages_students: false,
    patterns: [],
    actions: [],
    annotationRaw: "",
    annotationSegments: [],
    comparison: { modelEssay: "", points: [] },
    sections: {},
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
    matches.push({ name: m[1], index: m.index, end: re.lastIndex });
    m = re.exec(text);
  }
  const out = {};
  for (let i = 0; i < matches.length; i += 1) {
    const cur = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : text.length;
    out[cur.name] = text.slice(cur.end, nextStart).trim();
  }
  return out;
}

function parseScoreSection(text) {
  const scoreMatch = String(text || "").match(/分数\s*[:：]\s*([0-5])/);
  const bandMatch = String(text || "").match(/band\s*[:：]\s*([0-9]+(?:\.[0-9]+)?)/i);
  const summaryMatch = String(text || "").match(/总评\s*[:：]\s*(.+)$/m);
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

function parseAnnotationSection(text) {
  const raw = String(text || "");
  const segments = [];
  const notes = [];
  const re = /<r>([\s\S]*?)<\/r>\s*<n\s+level="(red|orange|blue)"\s+fix="([\s\S]*?)">([\s\S]*?)<\/n>/gi;
  let last = 0;
  let m = re.exec(raw);
  while (m) {
    if (m.index > last) {
      segments.push({ type: "text", text: raw.slice(last, m.index) });
    }
    const marked = {
      type: "mark",
      text: m[1].trim(),
      level: m[2],
      fix: m[3].trim(),
      note: m[4].trim(),
    };
    segments.push(marked);
    notes.push(marked);
    last = re.lastIndex;
    m = re.exec(raw);
  }
  if (last < raw.length) {
    segments.push({ type: "text", text: raw.slice(last) });
  }
  const counts = notes.reduce(
    (acc, n) => ({ ...acc, [n.level]: (acc[n.level] || 0) + 1 }),
    { red: 0, orange: 0, blue: 0 }
  );
  return { raw, segments, notes, counts };
}

function tryJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parsePatternsSection(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  const asObj = tryJson(raw);
  if (asObj && Array.isArray(asObj.patterns)) return asObj.patterns;
  if (Array.isArray(asObj)) return asObj;

  const lines = raw
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  lines.forEach((line) => {
    const parsed = tryJson(line);
    if (Array.isArray(parsed)) out.push(...parsed);
    if (parsed && Array.isArray(parsed.patterns)) out.push(...parsed.patterns);
  });
  return out;
}

function parseComparisonSection(text) {
  const raw = String(text || "");
  const modelSplit = raw.split(/\[范文\]/);
  const withModel = modelSplit.length > 1 ? modelSplit.slice(1).join("[范文]") : raw;
  const parts = withModel.split(/\[对比\]/);
  const modelEssay = (parts[0] || "").trim();
  const pointsRaw = (parts[1] || "").trim();

  const points = [];
  const re = /(?:^|\n)\s*(\d+)\.\s*(.+?)\n([\s\S]*?)(?=(?:\n\s*\d+\.\s+)|$)/g;
  let m = re.exec(pointsRaw);
  while (m) {
    const block = m[3];
    const yours = (block.match(/你的\s*[:：]\s*(.+)$/m) || [])[1] || "";
    const model = (block.match(/范文\s*[:：]\s*(.+)$/m) || [])[1] || "";
    const diff = (block.match(/差异\s*[:：]\s*([\s\S]+)$/m) || [])[1] || "";
    points.push({
      index: Number(m[1]),
      title: m[2].trim(),
      yours: yours.trim(),
      model: model.trim(),
      difference: diff.trim(),
    });
    m = re.exec(pointsRaw);
  }
  return { modelEssay, points, raw };
}

function parseActionSection(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const blocks = raw.split(/(?=短板\d+\s*[:：])/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  blocks.forEach((block) => {
    const title = (block.match(/短板\d+\s*[:：]\s*(.+)$/m) || [])[1] || "";
    const importance = (block.match(/重要性\s*[:：]\s*([\s\S]*?)(?=\n(?:行动|短板\d+)\s*[:：]|$)/m) || [])[1] || "";
    const action = (block.match(/行动\s*[:：]\s*([\s\S]*?)(?=\n短板\d+\s*[:：]|$)/m) || [])[1] || "";
    if (!title && !importance && !action) return;
    out.push({
      title: title.trim(),
      importance: importance.trim(),
      action: action.trim(),
    });
  });
  return out.slice(0, 2);
}

function buildCompatFields(data) {
  const goalsMet = (data.goals || []).map((g) => g.status === "OK");
  const weaknesses = (data.patterns || [])
    .filter((p) => Number(p?.count) > 0)
    .slice(0, 3)
    .map((p) => `${p.tag}: ${p.summary}`);
  const grammarIssues = (data.annotation?.notes || [])
    .filter((n) => n.level === "red" || n.level === "orange")
    .slice(0, 5)
    .map((n) => n.note);
  const nextSteps = (data.actions || []).map((a) => a.action).filter(Boolean);

  const engagementPattern = (data.patterns || []).find((p) => String(p.tag || "").includes("未回应他人观点"));
  const engagesStudents = engagementPattern ? Number(engagementPattern.count || 0) === 0 : data.score >= 3;
  const engagesProfessor = data.score >= 3;

  return {
    goals_met: goalsMet,
    weaknesses,
    strengths: [],
    grammar_issues: grammarIssues,
    vocabulary_note: "",
    next_steps: nextSteps,
    sample: data.comparison?.modelEssay || "",
    engages_professor: Boolean(engagesProfessor),
    engages_students: Boolean(engagesStudents),
  };
}

export function parseReport(rawText) {
  try {
    const cleaned = stripFence(rawText);
    if (!cleaned) return fallbackReport("Empty AI response");

    // Backward compatibility with old JSON-only response.
    if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
      const legacy = parseLegacyJson(cleaned);
      return legacy;
    }

    const sections = extractSections(cleaned);
    if (Object.keys(sections).length === 0) {
      return fallbackReport("Missing section markers");
    }

    const scorePart = parseScoreSection(sections.SCORE || "");
    if (scorePart.score === null) return fallbackReport("SCORE section missing valid score");

    const goals = parseGoalsSection(sections.GOALS || "");
    const annotation = parseAnnotationSection(sections.ANNOTATION || "");
    const patterns = parsePatternsSection(sections.PATTERNS || "");
    const comparison = parseComparisonSection(sections.COMPARISON || "");
    const actions = parseActionSection(sections.ACTION || "");

    const compat = buildCompatFields({
      score: scorePart.score,
      goals,
      annotation,
      patterns,
      comparison,
      actions,
    });

    return {
      score: scorePart.score,
      band: scorePart.band,
      summary: scorePart.summary || "已生成评分报告，请查看各板块详情。",
      ...compat,
      goals,
      patterns,
      actions,
      annotationRaw: annotation.raw,
      annotationSegments: annotation.segments,
      annotationCounts: annotation.counts,
      comparison,
      sections,
      error: false,
      errorReason: "",
    };
  } catch (e) {
    return fallbackReport(e.message || "解析失败");
  }
}
