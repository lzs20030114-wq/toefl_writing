#!/usr/bin/env node
/**
 * azure-pa-spike.mjs — pilot spike for Azure Pronunciation Assessment against
 * the TOEFL speaking "Listen and Repeat" (repeat) task.
 *
 * GOAL: prove we can feed {audio + reference text} to Azure and get back
 * sentence / word / phoneme pronunciation scores + Prosody, and answer three
 * questions our docs couldn't:
 *   1) Does webm/opus need transcoding? (which containers does the REST API take?)
 *   2) What does ReferenceText="" (unscripted) actually return?
 *   3) The full raw response JSON shape.
 *
 * USAGE:
 *   node scripts/azure-pa-spike.mjs                 # all clips in the manifest
 *   node scripts/azure-pa-spike.mjs --only s1-A     # one clip id
 *   node scripts/azure-pa-spike.mjs --manifest <path>
 *
 * ENV (read from .env.local then .env; real env vars win):
 *   AZURE_SPEECH_KEY      — Speech resource key (KEY 1 from portal)
 *   AZURE_SPEECH_REGION   — region id, e.g. "eastus" / "southeastasia"
 *
 * If the key/region are missing this prints an onboarding guide and exits 0
 * (so the spike is a no-op until the Azure resource exists).
 *
 * OUTPUT (only when a key is present):
 *   data/claudeGen/reports/azure-pa-spike-raw-<ts>.json  — full raw responses
 *   data/claudeGen/reports/azure-pa-spike-<ts>.md         — summary + mapping draft
 */

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SPIKE_DIR = path.join(ROOT, "data/claudeGen/spike-audio");
const REPORT_DIR = path.join(ROOT, "data/claudeGen/reports");

// ── minimal .env parser (no dependency) ──
function loadEnvFile(p, into) {
  if (!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p, "utf8");
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in into)) into[k] = v; // first file (.env.local) wins over later (.env)
  }
}

function resolveAzureCreds() {
  const merged = {};
  // real process env wins
  if (process.env.AZURE_SPEECH_KEY) merged.AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
  if (process.env.AZURE_SPEECH_REGION) merged.AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION;
  loadEnvFile(path.join(ROOT, ".env.local"), merged);
  loadEnvFile(path.join(ROOT, ".env"), merged);
  return { key: merged.AZURE_SPEECH_KEY, region: merged.AZURE_SPEECH_REGION };
}

function printOnboarding() {
  console.log(`
────────────────────────────────────────────────────────────────────────
  Azure Pronunciation Assessment spike — NO CREDENTIALS FOUND
────────────────────────────────────────────────────────────────────────
  AZURE_SPEECH_KEY / AZURE_SPEECH_REGION are not set. Nothing was called.

  How to get them (free F0 tier is enough for this spike):
   1. portal.azure.com → "Create a resource" → search "Speech service"
      (a.k.a. Azure AI Speech / Cognitive Services - Speech).
   2. Pricing tier: F0 (Free) — 5 audio hours/month, plenty for the spike.
      Region: pick one close to you, e.g. eastus / eastasia / southeastasia.
      (Note the region ID — it becomes {region}.stt.speech.microsoft.com.)
   3. After it deploys → resource → "Keys and Endpoint" → copy KEY 1 and the
      Location/Region.
   4. Put them in .env.local (git-ignored):
         AZURE_SPEECH_KEY=<KEY 1>
         AZURE_SPEECH_REGION=<region id, e.g. southeastasia>

  Then run:
     node scripts/azure-pa-make-clips.mjs   # generate test audio (once)
     node scripts/azure-pa-spike.mjs        # run the assessment

  See scripts/azure-pa-spike.README.md for the full walkthrough.
────────────────────────────────────────────────────────────────────────
`);
}

// ── request builder ──
function paHeader(referenceText) {
  const pa = {
    ReferenceText: referenceText || "",
    GradingSystem: "HundredMark",
    Granularity: "Phoneme",
    EnableMiscue: true,
    EnableProsodyAssessment: true,
    Dimension: "Comprehensive",
  };
  return { json: pa, b64: Buffer.from(JSON.stringify(pa), "utf8").toString("base64") };
}

function contentTypeFor(clip) {
  if (clip.contentFormat === "wav") return `audio/wav; codecs=audio/pcm; samplerate=${clip.sampleRate || 16000}`;
  if (clip.contentFormat === "ogg") return "audio/ogg; codecs=opus";
  if (clip.contentFormat === "webm") return "audio/webm; codecs=opus";
  throw new Error("unknown contentFormat " + clip.contentFormat);
}

async function assess({ region, key, clip, audioBytes }) {
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
  const { json: paJson, b64 } = paHeader(clip.referenceText);
  const ct = contentTypeFor(clip);
  const started = Date.now();
  let httpStatus = null;
  let body = null;
  let errText = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": ct,
        "Pronunciation-Assessment": b64,
        Accept: "application/json",
      },
      body: audioBytes,
    });
    httpStatus = res.status;
    const raw = await res.text();
    try {
      body = JSON.parse(raw);
    } catch {
      body = { _nonJson: raw };
    }
  } catch (e) {
    errText = e.message;
  }
  return {
    clipId: clip.id,
    request: { url, contentType: ct, referenceText: clip.referenceText, paHeaderJson: paJson },
    ms: Date.now() - started,
    httpStatus,
    error: errText,
    response: body,
  };
}

// ── response extraction ──
function summarize(result) {
  const r = result.response;
  const nb = r && Array.isArray(r.NBest) && r.NBest[0];
  const out = {
    clipId: result.clipId,
    httpStatus: result.httpStatus,
    recognitionStatus: r && r.RecognitionStatus,
    displayText: r && r.DisplayText,
    sentence: null,
    errorTypeCounts: null,
    words: null,
    phonemeLows: null,
    error: result.error || null,
  };
  if (!nb) return out;
  // REST detailed 格式把分数平铺在 NBest[0] 上；SDK JSON 才嵌套在 PronunciationAssessment 里。两者都兼容。
  const pa = nb.PronunciationAssessment || nb;
  out.sentence = {
    AccuracyScore: pa.AccuracyScore,
    FluencyScore: pa.FluencyScore,
    CompletenessScore: pa.CompletenessScore,
    ProsodyScore: pa.ProsodyScore,
    PronScore: pa.PronScore,
  };
  const words = Array.isArray(nb.Words) ? nb.Words : [];
  const counts = {};
  out.words = words.map((w) => {
    const wpa = w.PronunciationAssessment || w;
    const et = wpa.ErrorType || "None";
    counts[et] = (counts[et] || 0) + 1;
    return { word: w.Word, errorType: et, accuracy: wpa.AccuracyScore };
  });
  out.errorTypeCounts = counts;
  const phonemes = [];
  for (const w of words) {
    for (const ph of w.Phonemes || []) {
      const acc = (ph.PronunciationAssessment && ph.PronunciationAssessment.AccuracyScore) ?? ph.AccuracyScore;
      if (typeof acc === "number") phonemes.push({ word: w.Word, phoneme: ph.Phoneme, accuracy: acc });
    }
  }
  phonemes.sort((a, b) => a.accuracy - b.accuracy);
  out.phonemeLows = phonemes.slice(0, 5);
  return out;
}

// ── DRAFT mapping: Azure signals → our official 0-5 Listen-and-Repeat band ──
// Rationale keyed to data/speakingScoring/officialRubrics.json → listenAndRepeat.
// This is a PROPOSAL to calibrate against real learner audio + human L&R scores;
// TTS clips only stress the omission/insertion axis, not intelligibility.
const FUNCTION_WORDS = new Set([
  "the","a","an","to","of","for","with","on","in","at","and","or","but","your","our","its",
  "this","that","these","those","it","is","are","was","were","be","will","can","you","we","i",
  "before","after","by","as","such","up","out","own",
]);

function proposeLrBand(summary, referenceText) {
  const s = summary.sentence;
  if (!s || summary.recognitionStatus === "NoMatch") {
    return { band: 0, rationale: "No recognizable English / no match → rubric score 0." };
  }
  const counts = summary.errorTypeCounts || {};
  const omissions = counts.Omission || 0;
  const insertions = counts.Insertion || 0;
  const mispron = counts.Mispronunciation || 0;
  const completeness = s.CompletenessScore == null ? 100 : s.CompletenessScore;
  const accuracy = s.AccuracyScore == null ? 0 : s.AccuracyScore;

  // split omissions into function vs content using the reference tokens
  const refTokens = String(referenceText || "")
    .toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
  const omittedWords = (summary.words || []).filter((w) => w.errorType === "Omission").map((w) => w.word.toLowerCase());
  const contentOmissions = omittedWords.filter((w) => !FUNCTION_WORDS.has(w)).length;
  const functionOmissions = omittedWords.length - contentOmissions;

  const totalMiscue = omissions + insertions + mispron;

  let band, rationale;
  if (completeness < 30 || accuracy < 40) {
    band = 1;
    rationale = `Minimal/mostly-unintelligible: Completeness ${completeness}, Accuracy ${accuracy} → rubric 1.`;
  } else if (completeness < 60) {
    band = 2;
    rationale = `Large portion missing (Completeness ${completeness} < 60) → rubric 2 (fragmentary).`;
  } else if (contentOmissions >= 2 || mispron >= 2 || (contentOmissions >= 1 && functionOmissions >= 2)) {
    band = 3;
    rationale = `Full sentence but meaning altered: contentOmissions ${contentOmissions}, mispron ${mispron}, functionOmissions ${functionOmissions} → rubric 3.`;
  } else if (totalMiscue >= 1) {
    band = 4;
    rationale = `Meaning captured, not exact: omissions ${omissions} (fn ${functionOmissions}/content ${contentOmissions}), insertions ${insertions}, mispron ${mispron} → rubric 4.`;
  } else if (accuracy >= 92) {
    band = 5;
    rationale = `Exact repetition, fully intelligible: Accuracy ${accuracy}, 0 miscues → rubric 5.`;
  } else {
    band = 4;
    rationale = `No miscue but Accuracy ${accuracy} < 92 (intelligibility slightly soft) → rubric 4.`;
  }
  return {
    band,
    rationale,
    signals: { completeness, accuracy, omissions, functionOmissions, contentOmissions, insertions, mispron, prosody: s.ProsodyScore },
    refTokenCount: refTokens.length,
  };
}

// ── report writers ──
function fmtScore(v) {
  return v == null ? "  –  " : String(v).padStart(5);
}

function writeMarkdown(tsLabel, summaries, rawResults, manifest) {
  const lines = [];
  lines.push(`# Azure Pronunciation Assessment — spike results (${tsLabel})`);
  lines.push("");
  lines.push("Generated by `scripts/azure-pa-spike.mjs`. Raw responses: `azure-pa-spike-raw-" + tsLabel + ".json`.");
  lines.push("");
  lines.push("> TTS clips are NATIVE-accent. Numbers below validate pipeline + miscue detection, NOT L2 pronunciation-score quality.");
  lines.push("");

  // sentence-level table
  lines.push("## Sentence-level scores");
  lines.push("");
  lines.push("| clip | http | status | Accuracy | Fluency | Complete | Prosody | Pron | errorTypes |");
  lines.push("|------|------|--------|----------|---------|----------|---------|------|------------|");
  for (const s of summaries) {
    const se = s.sentence || {};
    const et = s.errorTypeCounts ? Object.entries(s.errorTypeCounts).map(([k, v]) => `${k}:${v}`).join(" ") : "";
    lines.push(
      `| ${s.clipId} | ${s.httpStatus ?? "ERR"} | ${s.recognitionStatus ?? (s.error ? "error" : "-")} | ${fmtScore(se.AccuracyScore)} | ${fmtScore(se.FluencyScore)} | ${fmtScore(se.CompletenessScore)} | ${fmtScore(se.ProsodyScore)} | ${fmtScore(se.PronScore)} | ${et} |`
    );
  }
  lines.push("");

  // per-clip detail
  lines.push("## Per-clip detail (word errors + lowest phonemes + L&R band draft)");
  lines.push("");
  const mById = Object.fromEntries(manifest.map((c) => [c.id, c]));
  for (const s of summaries) {
    const clip = mById[s.clipId] || {};
    lines.push(`### ${s.clipId} — ${clip.variant || ""} (${clip.contentFormat || ""})`);
    lines.push("");
    lines.push(`- reference: \`${clip.referenceText === "" ? "(empty / unscripted)" : clip.referenceText || ""}\``);
    lines.push(`- spoken:    \`${clip.spokenText || ""}\``);
    lines.push(`- expected:  ${clip.expected || ""}`);
    if (s.error) lines.push(`- transport error: ${s.error}`);
    if (s.words && s.words.length) {
      const flagged = s.words.filter((w) => w.errorType && w.errorType !== "None");
      lines.push(`- words flagged: ${flagged.length ? flagged.map((w) => `${w.word}[${w.errorType}${w.accuracy != null ? " " + w.accuracy : ""}]`).join(", ") : "none"}`);
    }
    if (s.phonemeLows && s.phonemeLows.length) {
      lines.push(`- lowest phonemes: ${s.phonemeLows.map((p) => `/${p.phoneme}/@${p.word}=${p.accuracy}`).join(", ")}`);
    }
    if (clip.variant !== "unscripted" && s.sentence) {
      const m = proposeLrBand(s, clip.referenceText);
      lines.push(`- **L&R band (draft): ${m.band}** — ${m.rationale}`);
    }
    lines.push("");
  }

  // question answers scaffold
  lines.push("## The three open questions — evidence from this run");
  lines.push("");
  const wavOk = summaries.find((s) => mById[s.clipId] && mById[s.clipId].contentFormat === "wav" && s.httpStatus === 200);
  const webm = summaries.filter((s) => mById[s.clipId] && mById[s.clipId].contentFormat === "webm");
  lines.push("### 1) webm/opus transcoding");
  lines.push(`- WAV 16k PCM: ${wavOk ? "accepted (HTTP 200 with scores)" : "see table"}.`);
  for (const s of webm) {
    lines.push(`- webm clip \`${s.clipId}\`: HTTP ${s.httpStatus ?? "ERR"} / ${s.recognitionStatus ?? s.error ?? "-"} → ${s.httpStatus === 200 ? "accepted directly" : "REJECTED — must transcode browser webm → wav/ogg server-side"}.`);
  }
  lines.push("");
  lines.push("### 2) ReferenceText empty (unscripted)");
  const uns = summaries.find((s) => s.clipId === "unscripted");
  if (uns) {
    lines.push(`- HTTP ${uns.httpStatus ?? "ERR"} / ${uns.recognitionStatus ?? uns.error ?? "-"}.`);
    if (uns.sentence) lines.push(`- returned: Accuracy ${uns.sentence.AccuracyScore}, Fluency ${uns.sentence.FluencyScore}, Completeness ${uns.sentence.CompletenessScore}, Prosody ${uns.sentence.ProsodyScore}. errorTypes: ${JSON.stringify(uns.errorTypeCounts)}.`);
    lines.push(`- (Note: EnableMiscue was left true with an empty ReferenceText — if this errored, retry with EnableMiscue:false for unscripted mode.)`);
  }
  lines.push("");
  lines.push("### 3) Raw JSON shape → see the -raw-*.json file (one object per clip).");
  lines.push("");

  // mapping section
  lines.push("## Draft mapping: Azure signals → official 0–5 Listen-and-Repeat band");
  lines.push("");
  lines.push("Keyed to `data/speakingScoring/officialRubrics.json` → `listenAndRepeat`. PROPOSAL — calibrate against real learner audio + human scores before shipping.");
  lines.push("");
  lines.push("| band | official label | Azure rule (draft) |");
  lines.push("|------|----------------|--------------------|");
  lines.push("| 5 | exact repetition | 0 Omission/Insertion/Mispron AND AccuracyScore ≥ ~92 AND Completeness ≥ ~98 |");
  lines.push("| 4 | meaning captured, not exact | ≥1 miscue but only 1–2 function words and/or ≤1 content word; meaning preserved |");
  lines.push("| 3 | full sentence, meaning altered | ≥2 content omissions OR ≥2 Mispronunciation OR (1 content + ≥2 function omissions) |");
  lines.push("| 2 | large portion missing | CompletenessScore < ~60 |");
  lines.push("| 1 | minimal / unintelligible | CompletenessScore < ~30 OR AccuracyScore < ~40 |");
  lines.push("| 0 | no/irrelevant/no English | RecognitionStatus NoMatch or no English |");
  lines.push("");

  fs.writeFileSync(path.join(REPORT_DIR, `azure-pa-spike-${tsLabel}.md`), lines.join("\n"));
}

// ── main ──
async function main() {
  const { key, region } = resolveAzureCreds();
  if (!key || !region) {
    printOnboarding();
    process.exit(0);
  }

  const args = process.argv.slice(2);
  let manifestPath = path.join(SPIKE_DIR, "manifest.json");
  let onlyId = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--manifest") manifestPath = args[++i];
    else if (args[i] === "--only") onlyId = args[++i];
  }

  if (!fs.existsSync(manifestPath)) {
    console.error(`[spike] manifest not found: ${manifestPath}\n       run: node scripts/azure-pa-make-clips.mjs`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  let clips = manifest.clips;
  if (onlyId) clips = clips.filter((c) => c.id === onlyId);
  if (!clips.length) {
    console.error(`[spike] no clips${onlyId ? " matching --only " + onlyId : ""}.`);
    process.exit(1);
  }

  console.log(`[spike] region=${region}  clips=${clips.length}  endpoint=${region}.stt.speech.microsoft.com`);
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const rawResults = [];
  const summaries = [];
  for (const clip of clips) {
    const audioPath = path.join(SPIKE_DIR, clip.audio);
    if (!fs.existsSync(audioPath)) {
      console.warn(`  ${clip.id.padEnd(12)} SKIP — audio missing (${clip.audio})`);
      continue;
    }
    const audioBytes = fs.readFileSync(audioPath);
    const result = await assess({ region, key, clip, audioBytes });
    rawResults.push(result);
    const s = summarize(result);
    summaries.push(s);
    const se = s.sentence || {};
    const tag = s.httpStatus === 200 ? `Pron=${se.PronScore ?? "-"} Acc=${se.AccuracyScore ?? "-"} Prosody=${se.ProsodyScore ?? "-"}` : `HTTP ${s.httpStatus ?? "ERR"} ${s.error || (s.recognitionStatus || "")}`;
    console.log(`  ${clip.id.padEnd(12)} ${clip.contentFormat.padEnd(4)} ${tag}`);
    await new Promise((r) => setTimeout(r, 250)); // gentle pacing
  }

  const ts = new Date();
  const tsLabel = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, "0")}${String(ts.getDate()).padStart(2, "0")}-${String(ts.getHours()).padStart(2, "0")}${String(ts.getMinutes()).padStart(2, "0")}`;
  fs.writeFileSync(
    path.join(REPORT_DIR, `azure-pa-spike-raw-${tsLabel}.json`),
    JSON.stringify({ generated: ts.toISOString(), region, clips: rawResults }, null, 2)
  );
  writeMarkdown(tsLabel, summaries, rawResults, manifest.clips);

  console.log(`\n[spike] wrote:`);
  console.log(`  data/claudeGen/reports/azure-pa-spike-raw-${tsLabel}.json`);
  console.log(`  data/claudeGen/reports/azure-pa-spike-${tsLabel}.md`);
}

main().catch((e) => {
  console.error("[spike] fatal:", e);
  process.exit(1);
});
