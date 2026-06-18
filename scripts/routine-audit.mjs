#!/usr/bin/env node
/**
 * routine-audit.mjs  — independent MCQ answer auditor for the nightly routine
 *
 * Subcommands:
 *   extract   Read SID/R2SID staging files → data/.audit-blind.json (no answers)
 *   apply     Read data/.audit-solved.json → compare → drop mismatched items
 *             from staging files → write data/.audit-report.json
 *
 * Audited types:  reading ap / rdl   +   listening la / lat / lc / lcr
 * NOT audited:    ctw, bs, discussion, email, speaking (no MCQ key at extract time)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const META_PATH  = join(ROOT, 'data/.routine-meta.json');
const BLIND_PATH = join(ROOT, 'data/.audit-blind.json');
const SOLVED_PATH= join(ROOT, 'data/.audit-solved.json');
const REPORT_PATH= join(ROOT, 'data/.audit-report.json');

function readJSON(p, fallback = null) {
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch { return fallback; }
}

// ── helpers ────────────────────────────────────────────────────────────────

function stagingDirs() {
  return [
    join(ROOT, 'data/reading/staging'),
    join(ROOT, 'data/listening/staging'),
  ];
}

function filesForSession(sid) {
  const matches = [];
  for (const dir of stagingDirs()) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter(f => f.endsWith('.json') && f.includes(sid));
    for (const f of files) {
      matches.push(join(dir, f));
    }
  }
  return matches;
}

function prefixOf(filename) {
  // e.g. "ap-routine-..." → "ap", "rdl-routine-...-short.json" → "rdl",
  //      "la-routine-..." → "la", "lcr-routine-..." → "lcr"
  const base = basename(filename, '.json');
  return base.split('-')[0];
}

function shouldAudit(filename) {
  const p = prefixOf(filename);
  return ['ap', 'rdl', 'la', 'lat', 'lc', 'lcr'].includes(p);
}

// Normalise the answer field: different staging types use 'answer' vs 'correct_answer'
function getMarkedAnswer(q) {
  return q.correct_answer || q.answer || '';
}

// ── EXTRACT ────────────────────────────────────────────────────────────────

function doExtract() {
  const meta = readJSON(META_PATH);
  if (!meta || !meta.session_id) {
    console.log('extract: no meta / no session_id — nothing to do');
    process.exit(0);
  }

  const SID  = meta.session_id;
  const R2SID = meta.r2_session_id || null;

  const sessions = [SID];
  if (R2SID) sessions.push(R2SID);

  const questions = [];

  for (const sid of sessions) {
    const files = filesForSession(sid);
    for (const fpath of files) {
      if (!shouldAudit(fpath)) continue;

      const data = readJSON(fpath);
      if (!data) continue;
      const items = data.items || (Array.isArray(data) ? data : []);
      const fileStem = basename(fpath, '.json');
      const prefix = prefixOf(fpath);

      if (prefix === 'lcr') {
        // Each LCR item IS the question
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          questions.push({
            key:      `${fileStem}:${i}`,
            file:     fpath,
            item_idx: i,
            q_idx:    null,
            type:     'lcr',
            context:  `[Situation: ${it.situation || ''}]\nSpeaker: "${it.speaker || ''}"`,
            stem:     it.speaker || it.situation || '(see context)',
            options:  it.options || {},
          });
        }
      } else {
        // Items with nested questions array
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const qs = it.questions || [];

          // Build the context string (passage / transcript / announcement / text)
          let context = '';
          if (it.passage)      context = it.passage;
          else if (it.transcript) context = it.transcript;
          else if (it.announcement) context = it.announcement;
          else if (it.text)    context = it.text;
          else if (it.conversation) {
            context = it.conversation.map(t => `${t.speaker}: ${t.text}`).join('\n');
          }

          const subtopic = it.subtopic || it.topic || it.subject || it.situation || it.genre || '';

          for (let j = 0; j < qs.length; j++) {
            const q = qs[j];
            questions.push({
              key:      `${fileStem}:${i}:${j}`,
              file:     fpath,
              item_idx: i,
              q_idx:    j,
              type:     prefix,
              subtopic,
              context,
              stem:     q.stem || '',
              options:  q.options || {},
            });
          }
        }
      }
    }
  }

  const out = {
    session:    SID,
    r2_session: R2SID,
    extracted_at: new Date().toISOString(),
    total: questions.length,
    questions,
  };

  writeFileSync(BLIND_PATH, JSON.stringify(out, null, 2), 'utf8');
  console.log(`extract: wrote ${questions.length} questions to .audit-blind.json`);
  if (questions.length === 0) console.log('extract: 0 questions — nothing to audit');
}

// ── APPLY ─────────────────────────────────────────────────────────────────

function doApply() {
  const blind  = readJSON(BLIND_PATH);
  const solved = readJSON(SOLVED_PATH);

  if (!blind || !solved) {
    console.error('apply: missing .audit-blind.json or .audit-solved.json');
    process.exit(1);
  }

  const myAnswers = solved.answers || {};
  const questions  = blind.questions || [];

  // Map key → question metadata
  const qMap = {};
  for (const q of questions) qMap[q.key] = q;

  // ── compare ──────────────────────────────────────────────────────────────
  // Track mismatches per (file, item_idx)
  const itemMismatches = {};   // `${file}:${item_idx}` → [{question details}]
  let totalAnswered = 0, totalMatched = 0, totalMismatched = 0;

  for (const [key, myAns] of Object.entries(myAnswers)) {
    const q = qMap[key];
    if (!q) continue;  // stale key, skip

    totalAnswered++;

    // Retrieve marked answer from the staging file
    const data = readJSON(q.file);
    if (!data) continue;
    const items = data.items || (Array.isArray(data) ? data : []);
    const it = items[q.item_idx];
    if (!it) continue;

    let markedAns;
    if (q.type === 'lcr') {
      markedAns = getMarkedAnswer(it);
    } else {
      const qs = it.questions || [];
      const qq = qs[q.q_idx];
      markedAns = qq ? getMarkedAnswer(qq) : '';
    }

    const match = myAns.trim().toUpperCase() === markedAns.trim().toUpperCase();
    if (match) {
      totalMatched++;
    } else {
      totalMismatched++;
      const ikey = `${q.file}:${q.item_idx}`;
      if (!itemMismatches[ikey]) itemMismatches[ikey] = [];
      itemMismatches[ikey].push({
        question_index: q.q_idx,
        key,
        stem_preview: (q.stem || '').substring(0, 80),
        marked: markedAns,
        mine: myAns,
      });
    }
  }

  // Skipped = questions we received but didn't answer (shouldn't happen ideally)
  const answeredKeys = new Set(Object.keys(myAnswers));
  const totalQuestions = questions.length;
  const skipped = questions.filter(q => !answeredKeys.has(q.key)).length;

  // ── drop mismatched items from staging files ──────────────────────────────
  // Group drop instructions by file
  const dropsByFile = {};
  for (const ikey of Object.keys(itemMismatches)) {
    const colonIdx = ikey.lastIndexOf(':');
    const file     = ikey.substring(0, colonIdx);
    const itemIdx  = parseInt(ikey.substring(colonIdx + 1), 10);
    if (!dropsByFile[file]) dropsByFile[file] = new Set();
    dropsByFile[file].add(itemIdx);
  }

  const droppedItems = [];

  for (const [file, dropSet] of Object.entries(dropsByFile)) {
    const data = readJSON(file);
    if (!data) continue;

    const itemsBefore = data.items || (Array.isArray(data) ? data : []);
    const itemsAfter  = itemsBefore.filter((it, idx) => !dropSet.has(idx));

    for (const idx of dropSet) {
      const it = itemsBefore[idx];
      const fileStem = basename(file, '.json');
      droppedItems.push({
        file:     fileStem,
        item_index: idx,
        subtopic: it ? (it.subtopic || it.topic || it.subject || it.situation || it.genre || '') : '',
        mismatches: itemMismatches[`${file}:${idx}`] || [],
      });
    }

    // Overwrite the staging file with dropped items removed
    let updated;
    if (Array.isArray(data)) {
      updated = itemsAfter;
    } else {
      updated = { ...data, items: itemsAfter };
    }
    writeFileSync(file, JSON.stringify(updated, null, 2), 'utf8');
    console.log(`apply: dropped ${dropSet.size} item(s) from ${basename(file)}`);
  }

  // ── write receipt ─────────────────────────────────────────────────────────
  const agreementPct = totalAnswered > 0
    ? Math.round((totalMatched / totalAnswered) * 1000) / 10
    : 100;

  const report = {
    session:         blind.session,
    r2_session:      blind.r2_session,
    audited_at:      new Date().toISOString(),
    total_questions: totalQuestions,
    answered:        totalAnswered,
    matched:         totalMatched,
    mismatched:      totalMismatched,
    skipped,
    items_dropped:   droppedItems.length,
    agreement_pct:   agreementPct,
    dropped:         droppedItems,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(`apply: ${totalMatched}/${totalAnswered} matched (${agreementPct}%), ${droppedItems.length} item(s) dropped`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────

const cmd = process.argv[2];
if (cmd === 'extract') doExtract();
else if (cmd === 'apply') doApply();
else {
  console.error('Usage: node scripts/routine-audit.mjs extract|apply');
  process.exit(1);
}
