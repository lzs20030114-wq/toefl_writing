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
  return String(rawText || "").replace(/```json/gi, "").replace(/```/g, "").trim();
}

function parseLegacyJson(cleaned) {
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
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

function parseScoreSection(text) {
  const src = String(text || "");
  const scoreMatch = src.match(/score\s*[:]\s*([0-5])/i);
  const bandMatch = src.match(/band\s*[:]\s*([0-9]+(?:\.[0-9]+)?)/i);
  const summaryMatch = src.match(/summary\s*[:]\s*(.+)$/im);
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
      reason: String(m[3] || "").trim(),
    });
  });
  goals.sort((a, b) => a.index - b.index);
  return goals;
}

function parseAnnotationSection(text) {
  const raw = String(text || "");
  const segments = [];
  const re = /<r>([\s\S]*?)<\/r>\s*<n\s+level="(red|orange|blue)"\s+fix="([^"]*)">([\s\S]*?)<\/n>/gi;

  let last = 0;
  let m = re.exec(raw);
  while (m) {
    if (m.index > last) {
      segments.push({ type: "text", text: raw.slice(last, m.index) });
    }
    segments.push({
      type: "mark",
      text: m[1].trim(),
      level: m[2],
      fix: m[3].trim(),
      note: m[4].trim(),
    });
    last = re.lastIndex;
    m = re.exec(raw);
  }
  if (last < raw.length) {
    segments.push({ type: "text", text: raw.slice(last) });
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

function parsePatternsSection(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const lines = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  lines.forEach((line) => {
    try {
      const parsed = JSON.parse(line);
      if (Array.isArray(parsed)) out.push(...parsed);
      else if (parsed && Array.isArray(parsed.patterns)) out.push(...parsed.patterns);
      else if (parsed && parsed.tag) out.push(parsed);
    } catch {
      // Keep section-level fallback behavior.
    }
  });
  return out;
}

function parseComparisonSection(text) {
  const raw = String(text || "");
  const modelMatch = raw.match(/\[(?:Model)\]([\s\S]*?)(?=\[(?:Comparison)\]|$)/i);
  const modelEssay = modelMatch ? modelMatch[1].trim() : "";
  const pointsBodyMatch = raw.match(/\[(?:Comparison)\]([\s\S]*)$/i);
  const pointsBody = pointsBodyMatch ? pointsBodyMatch[1].trim() : "";

  const points = [];
  const pointRe = /(?:^|\n)\s*(\d+)\.\s*(.+?)\n([\s\S]*?)(?=(?:\n\s*\d+\.\s+)|$)/g;
  let m = pointRe.exec(pointsBody);
  while (m) {
    const block = m[3];
    const yours = (block.match(/(?:Yours)\s*[:]\s*(.+)$/im) || [])[1] || "";
    const model = (block.match(/(?:Model)\s*[:]\s*(.+)$/im) || [])[1] || "";
    const difference = (block.match(/(?:Difference)\s*[:]\s*([\s\S]+)$/im) || [])[1] || "";
    points.push({
      index: Number(m[1]),
      title: m[2].trim(),
      yours: yours.trim(),
      model: model.trim(),
      difference: difference.trim(),
    });
    m = pointRe.exec(pointsBody);
  }

  return { modelEssay, points, raw };
}

function parseActionSection(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const blocks = raw
    .split(/(?=(?:Action\d+)\s*[:])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const actions = blocks
    .map((block) => {
      const title = (block.match(/(?:Action\d+)\s*[:]\s*(.+)$/im) || [])[1] || "";
      const importance =
        (block.match(
          /(?:Importance)\s*[:]\s*([\s\S]*?)(?=\n(?:Action|Action\d+)\s*[:]|$)/im
        ) || [])[1] || "";
      const action =
        (block.match(/(?:Action)\s*[:]\s*([\s\S]*?)(?=\n(?:Action\d+)\s*[:]|$)/im) || [])[1] || "";
      if (!title && !importance && !action) return null;
      return {
        title: title.trim(),
        importance: importance.trim(),
        action: action.trim(),
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
      return parseLegacyJson(cleaned);
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
    const patterns = parsePatternsSection(sections.PATTERNS || "");
    const comparison = parseComparisonSection(sections.COMPARISON || "");
    const actions = parseActionSection(sections.ACTION || "");
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
      summary: scorePart.summary || "Scoring report generated. See detailed sections below.",
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
