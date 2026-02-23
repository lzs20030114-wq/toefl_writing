function decodeEntities(s) {
  return String(s || "")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseAttrs(attrText) {
  const attrs = {};
  const re = /([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*"([^"]*)"/g;
  let m = re.exec(attrText);
  while (m) {
    attrs[m[1]] = decodeEntities(m[2]);
    m = re.exec(attrText);
  }
  return attrs;
}

function asLevel(value) {
  const v = String(value || "").toLowerCase();
  if (v === "red" || v === "orange" || v === "blue") return v;
  return null;
}

function removeTagsFallback(raw) {
  return String(raw || "")
    .replace(/<\s*\/?\s*n\b[^>]*>/gi, "")
    .replace(/<\s*\/?\s*r\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "");
}

function buildRegexFallbackAnnotations(raw) {
  const source = String(raw || "");
  const plainText = decodeEntities(removeTagsFallback(source));
  const annotations = [];
  const used = [];

  function occupied(start, end) {
    return used.some((u) => !(end <= u.start || start >= u.end));
  }

  function reserve(start, end) {
    used.push({ start, end });
  }

  function findSpan(text, fromPos = 0) {
    const needle = decodeEntities(String(text || "")).trim();
    if (!needle) return null;
    const idx = plainText.indexOf(needle, Math.max(0, fromPos));
    if (idx < 0) return null;
    return { start: idx, end: idx + needle.length };
  }

  let cursor = 0;
  const pairRe = /<r>([\s\S]*?)<\/r>\s*<n\b([^>]*)>([\s\S]*?)<\/n>/gi;
  let m = pairRe.exec(source);
  while (m) {
    const attrs = parseAttrs(m[2] || "");
    const level = asLevel(attrs.level);
    const marked = decodeEntities(m[1] || "").trim();
    const note = decodeEntities(m[3] || "").trim();
    if (level && marked) {
      const span = findSpan(marked, cursor);
      if (span && !occupied(span.start, span.end)) {
        annotations.push({
          level,
          message: note,
          fix: String(attrs.fix || "").trim(),
          start: span.start,
          end: span.end,
        });
        reserve(span.start, span.end);
        cursor = span.end;
      }
    }
    m = pairRe.exec(source);
  }

  cursor = 0;
  const inlineRe = /<n\b([^>]*)>([\s\S]*?)<\/n>/gi;
  let n = inlineRe.exec(source);
  while (n) {
    const attrs = parseAttrs(n[1] || "");
    const level = asLevel(attrs.level);
    const body = decodeEntities(n[2] || "").trim();
    if (level && body) {
      const span = findSpan(body, cursor);
      if (span && !occupied(span.start, span.end)) {
        annotations.push({
          level,
          message: body,
          fix: String(attrs.fix || "").trim(),
          start: span.start,
          end: span.end,
        });
        reserve(span.start, span.end);
        cursor = span.end;
      }
    }
    n = inlineRe.exec(source);
  }

  return { plainText, annotations };
}

export function parseAnnotations(rawText) {
  const raw = String(rawText || "");
  const annotations = [];
  let plainText = "";
  let cursor = 0;
  let parseError = false;

  function appendText(text) {
    plainText += decodeEntities(text);
  }

  try {
    while (cursor < raw.length) {
      const lt = raw.indexOf("<", cursor);
      if (lt < 0) {
        appendText(raw.slice(cursor));
        break;
      }
      appendText(raw.slice(cursor, lt));

      const tagEnd = raw.indexOf(">", lt + 1);
      if (tagEnd < 0) {
        appendText(raw.slice(lt));
        break;
      }

      const tagBody = raw.slice(lt + 1, tagEnd).trim();

      if (/^r\s*$/i.test(tagBody)) {
        const closeR = raw.indexOf("</r>", tagEnd + 1);
        if (closeR < 0) {
          parseError = true;
          cursor = tagEnd + 1;
          continue;
        }

        const marked = decodeEntities(raw.slice(tagEnd + 1, closeR));
        const start = plainText.length;
        plainText += marked;
        const end = plainText.length;

        cursor = closeR + 4;
        const ws = raw.slice(cursor).match(/^\s*/);
        if (ws) cursor += ws[0].length;

        const nOpen = raw.slice(cursor).match(/^<n\b([^>]*)>/i);
        if (nOpen) {
          const attrs = parseAttrs(nOpen[1] || "");
          const level = asLevel(attrs.level);
          const nBodyStart = cursor + nOpen[0].length;
          const nClose = raw.indexOf("</n>", nBodyStart);
          if (nClose < 0) {
            parseError = true;
            continue;
          }
          const message = decodeEntities(raw.slice(nBodyStart, nClose).trim());
          if (level) {
            annotations.push({
              level,
              message,
              fix: String(attrs.fix || "").trim(),
              start,
              end,
            });
          }
          cursor = nClose + 4;
        }
        continue;
      }

      const nOpenFull = raw.slice(lt, tagEnd + 1).match(/^<n\b([^>]*)>$/i);
      if (nOpenFull) {
        const attrs = parseAttrs(nOpenFull[1] || "");
        const level = asLevel(attrs.level);
        const closeN = raw.indexOf("</n>", tagEnd + 1);
        if (closeN < 0) {
          parseError = true;
          cursor = tagEnd + 1;
          continue;
        }
        const body = decodeEntities(raw.slice(tagEnd + 1, closeN));
        const start = plainText.length;
        plainText += body;
        const end = plainText.length;
        if (level) {
          annotations.push({
            level,
            message: body.trim(),
            fix: String(attrs.fix || "").trim(),
            start,
            end,
          });
        }
        cursor = closeN + 4;
        continue;
      }

      cursor = tagEnd + 1;
    }
  } catch {
    parseError = true;
  }

  if (parseError) {
    const recovered = buildRegexFallbackAnnotations(raw);
    const merged = [...annotations, ...(Array.isArray(recovered.annotations) ? recovered.annotations : [])];
    const dedup = [];
    const seen = new Set();
    merged.forEach((a) => {
      if (!a) return;
      const key = `${a.level}|${a.start}|${a.end}|${a.message}|${a.fix}`;
      if (seen.has(key)) return;
      seen.add(key);
      dedup.push(a);
    });
    return {
      plainText: recovered.plainText || decodeEntities(removeTagsFallback(raw)),
      annotations: dedup,
      parseError: true,
      hasMarkup: /<\s*n\b/i.test(raw),
    };
  }

  return {
    plainText,
    annotations,
    parseError: false,
    hasMarkup: /<\s*n\b/i.test(raw),
  };
}

export function buildAnnotationSegments(parsed) {
  const plainText = String(parsed?.plainText || "");
  const marks = Array.isArray(parsed?.annotations) ? parsed.annotations : [];
  if (!plainText) return [];
  if (marks.length === 0) return [{ type: "text", text: plainText }];

  const sorted = [...marks]
    .filter(
      (m) =>
        m &&
        Number.isInteger(m.start) &&
        Number.isInteger(m.end) &&
        m.start >= 0 &&
        m.end > m.start &&
        m.end <= plainText.length &&
        (m.level === "red" || m.level === "orange" || m.level === "blue")
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (sorted.length === 0) return [{ type: "text", text: plainText }];

  const segments = [];
  let pos = 0;
  sorted.forEach((m) => {
    if (m.start < pos) return;
    if (m.start > pos) segments.push({ type: "text", text: plainText.slice(pos, m.start) });
    segments.push({
      type: "mark",
      text: plainText.slice(m.start, m.end),
      level: m.level,
      fix: m.fix || "",
      note: m.message || "",
      start: m.start,
      end: m.end,
    });
    pos = m.end;
  });
  if (pos < plainText.length) segments.push({ type: "text", text: plainText.slice(pos) });
  return segments;
}

export function countAnnotations(annotations) {
  return (Array.isArray(annotations) ? annotations : []).reduce(
    (acc, a) => {
      if (a?.level === "red") acc.red += 1;
      else if (a?.level === "orange") acc.orange += 1;
      else if (a?.level === "blue") acc.blue += 1;
      return acc;
    },
    { red: 0, orange: 0, blue: 0 }
  );
}
