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
    return {
      plainText: removeTagsFallback(raw),
      annotations: [],
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
