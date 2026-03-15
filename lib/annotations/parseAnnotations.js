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

function asErrorType(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "";
  return v;
}

const SPELLING_NOTE_RE = /(拼写|spelling|misspell|misspelled|typo)/i;
const SINGLE_WORD_RE = /^[A-Za-z][A-Za-z'-]*$/;

function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function inferErrorType({ errorType, level, message, fix, markedText }) {
  const explicit = asErrorType(errorType);
  if (explicit) return explicit;
  if (String(level || "").toLowerCase() !== "red") return "";
  const noteText = String(message || "").trim();
  const wrongText = String(markedText || "").trim();
  const fixText = String(fix || "").trim();

  // Explicit mention of spelling in the note
  if (SPELLING_NOTE_RE.test(noteText) || SPELLING_NOTE_RE.test(fixText)) {
    if (SINGLE_WORD_RE.test(wrongText) && SINGLE_WORD_RE.test(fixText)) {
      if (wrongText.toLowerCase() !== fixText.toLowerCase()) return "spelling";
    }
  }

  // Heuristic: single-word red mark where the fix is a similar word (edit distance <= 2)
  // This catches spelling errors the AI didn't explicitly label
  if (SINGLE_WORD_RE.test(wrongText) && SINGLE_WORD_RE.test(fixText)) {
    const wl = wrongText.toLowerCase();
    const fl = fixText.toLowerCase();
    if (wl !== fl && wl.length >= 3 && fl.length >= 3) {
      const dist = editDistance(wl, fl);
      if (dist <= 2 && dist / Math.max(wl.length, fl.length) < 0.4) return "spelling";
    }
  }

  return "";
}

function removeTagsFallback(raw) {
  return String(raw || "")
    .replace(/<\s*\/?\s*n\b[^>]*>/gi, "")
    .replace(/<\s*\/?\s*r\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "");
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return !(aEnd <= bStart || aStart >= bEnd);
}

function normalizeDetachedAnnotationLines(inputText, inputAnnotations) {
  const text = String(inputText || "");
  const annotations = Array.isArray(inputAnnotations) ? [...inputAnnotations] : [];
  if (!text || annotations.length === 0) return { plainText: text, annotations };

  const removals = [];
  const dropAnnotationIndexSet = new Set();

  const sorted = annotations
    .map((a, idx) => ({ ...a, _idx: idx }))
    .filter((a) => Number.isInteger(a.start) && Number.isInteger(a.end) && a.end > a.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  sorted.forEach((a) => {
    const markText = text.slice(a.start, a.end);
    const trimmedMark = markText.trim();
    if (!trimmedMark) return;

    const lineStart = text.lastIndexOf("\n", a.start - 1) + 1;
    const lineEndRaw = text.indexOf("\n", a.end);
    const lineEnd = lineEndRaw >= 0 ? lineEndRaw : text.length;
    const lineText = text.slice(lineStart, lineEnd);
    if (lineText.trim() !== trimmedMark) return;

    const prevSlice = text.slice(0, lineStart);
    const targetStart = prevSlice.lastIndexOf(trimmedMark);
    if (targetStart < 0) {
      // Can't find the text earlier — this is a correctly positioned
      // inline annotation that happens to occupy a full line, not an
      // orphan echo. Leave it as-is.
      return;
    }
    const targetEnd = targetStart + trimmedMark.length;

    const conflict = annotations.some((x, i) => {
      if (i === a._idx) return false;
      if (!Number.isInteger(x?.start) || !Number.isInteger(x?.end)) return false;
      return rangesOverlap(x.start, x.end, targetStart, targetEnd);
    });
    if (!conflict) {
      annotations[a._idx] = {
        ...annotations[a._idx],
        start: targetStart,
        end: targetEnd,
      };
    } else {
      dropAnnotationIndexSet.add(a._idx);
    }
    removals.push({ start: lineStart, end: lineEndRaw >= 0 ? lineEndRaw + 1 : lineEnd });
  });

  // Fallback sweep: remove any standalone line that equals a marked text and already appears earlier.
  if (removals.length === 0) {
    const markTexts = new Set(
      annotations
        .map((a) => {
          if (!Number.isInteger(a?.start) || !Number.isInteger(a?.end)) return "";
          return text.slice(a.start, a.end).trim();
        })
        .filter(Boolean)
    );
    if (markTexts.size > 0) {
      const lines = text.split("\n");
      let cursor = 0;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const lineTrim = line.trim();
        if (lineTrim && markTexts.has(lineTrim)) {
          const lineStart = cursor;
          const lineEnd = lineStart + line.length;
          const prev = text.slice(0, lineStart);
          if (prev.includes(lineTrim)) {
            const rowStart = text.lastIndexOf("\n", lineStart - 1) + 1;
            const rowEndRaw = text.indexOf("\n", lineEnd);
            const rowEnd = rowEndRaw >= 0 ? rowEndRaw + 1 : lineEnd;
            removals.push({ start: rowStart, end: rowEnd });
            annotations.forEach((a, idx) => {
              if (!Number.isInteger(a?.start) || !Number.isInteger(a?.end)) return;
              if (a.start >= rowStart && a.end <= rowEnd) dropAnnotationIndexSet.add(idx);
            });
          }
        }
        cursor += line.length + 1;
      }
    }
  }

  if (removals.length === 0) return { plainText: text, annotations };

  removals.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of removals) {
    const last = merged[merged.length - 1];
    if (!last || r.start > last.end) merged.push({ ...r });
    else if (r.end > last.end) last.end = r.end;
  }

  let nextText = "";
  let pos = 0;
  merged.forEach((r) => {
    if (r.start > pos) nextText += text.slice(pos, r.start);
    pos = Math.max(pos, r.end);
  });
  if (pos < text.length) nextText += text.slice(pos);

  const mapPos = (p) => {
    let offset = 0;
    for (const r of merged) {
      if (p >= r.end) {
        offset += r.end - r.start;
      } else if (p >= r.start) {
        return r.start - offset;
      } else {
        break;
      }
    }
    return p - offset;
  };

  const nextAnnotations = annotations
    .map((a, idx) => {
      if (dropAnnotationIndexSet.has(idx)) return null;
      if (!Number.isInteger(a?.start) || !Number.isInteger(a?.end)) return null;
      const start = mapPos(a.start);
      const end = mapPos(a.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      if (end > nextText.length) return null;
      return { ...a, start, end };
    })
    .filter(Boolean);

  return { plainText: nextText, annotations: nextAnnotations };
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
          const pairEnd = nClose + 4;
          const lineStart = raw.lastIndexOf("\n", lt - 1) + 1;
          const lineEndRaw = raw.indexOf("\n", pairEnd);
          const lineEnd = lineEndRaw >= 0 ? lineEndRaw + 1 : pairEnd;
          const pairText = raw.slice(lt, pairEnd).trim();
          const currentLine = raw.slice(lineStart, lineEndRaw >= 0 ? lineEndRaw : pairEnd).trim();
          const needle = String(marked || "").trim();
          const detachedLine = currentLine && currentLine === pairText && needle && plainText.includes(needle);

          if (detachedLine) {
            // Detached marker line: bind this mark to the already rendered original text.
            const mappedStart = needle ? plainText.lastIndexOf(needle) : -1;
            if (level && mappedStart >= 0) {
              annotations.push({
                level,
                message,
                fix: String(attrs.fix || "").trim(),
                errorType: inferErrorType({
                  errorType: attrs.error_type || attrs.kind || attrs.category,
                  level,
                  message,
                  fix: String(attrs.fix || "").trim(),
                  markedText: needle,
                }),
                start: mappedStart,
                end: mappedStart + needle.length,
              });
            }
            cursor = lineEnd;
            continue;
          }

          // Trailing annotation: the marked text already appears as plain
          // text earlier on the same raw line before the <r> tag — anchor
          // the annotation to that existing occurrence without duplicating.
          if (needle && raw.slice(lineStart, lt).includes(needle)) {
            const mappedStart = plainText.lastIndexOf(needle);
            if (level && mappedStart >= 0) {
              annotations.push({
                level,
                message,
                fix: String(attrs.fix || "").trim(),
                errorType: inferErrorType({
                  errorType: attrs.error_type || attrs.kind || attrs.category,
                  level,
                  message,
                  fix: String(attrs.fix || "").trim(),
                  markedText: needle,
                }),
                start: mappedStart,
                end: mappedStart + needle.length,
              });
            }
            cursor = pairEnd;
            continue;
          }

          const start = plainText.length;
          plainText += marked;
          const end = plainText.length;
          if (level) {
            annotations.push({
              level,
              message,
              fix: String(attrs.fix || "").trim(),
              errorType: inferErrorType({
                errorType: attrs.error_type || attrs.kind || attrs.category,
                level,
                message,
                fix: String(attrs.fix || "").trim(),
                markedText: marked,
              }),
              start,
              end,
            });
          }
          cursor = pairEnd;
          continue;
        }
        // No <n> follows: treat <r> as plain inline text.
        plainText += marked;
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
            errorType: inferErrorType({
              errorType: attrs.error_type || attrs.kind || attrs.category,
              level,
              message: body.trim(),
              fix: String(attrs.fix || "").trim(),
              markedText: body,
            }),
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
    const normalized = normalizeDetachedAnnotationLines(
      recovered.plainText || decodeEntities(removeTagsFallback(raw)),
      dedup
    );
    return {
      plainText: normalized.plainText,
      annotations: normalized.annotations,
      parseError: true,
      hasMarkup: /<\s*n\b/i.test(raw),
    };
  }

  const normalized = normalizeDetachedAnnotationLines(plainText, annotations);
  return {
    plainText: normalized.plainText,
    annotations: normalized.annotations,
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
      errorType: asErrorType(m.errorType),
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
      if (a?.level === "red") {
        acc.red += 1;
        if (String(a.errorType || "").toLowerCase() === "spelling") acc.spelling += 1;
      } else if (a?.level === "orange") acc.orange += 1;
      else if (a?.level === "blue") acc.blue += 1;
      return acc;
    },
    { red: 0, orange: 0, blue: 0, spelling: 0 }
  );
}
