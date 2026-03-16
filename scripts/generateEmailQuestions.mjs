#!/usr/bin/env node
/**
 * Email prompt generator — produces TPO-aligned email writing questions.
 *
 * Usage:
 *   node scripts/generateEmailQuestions.mjs [count]
 *   node scripts/generateEmailQuestions.mjs 12 --dry-run
 *
 * Default: 6 (one per category). Distribution follows TPO weights:
 *   Academic 30% / Workplace 20% / Community 15% / Peer 15% / Consumer 10% / Housing 10%
 *
 * Each call forces a specific category so the model cannot drift toward academic-only.
 * Output is validated (word count, opening, verbs, no modifiers) and deduplicated
 * against existing prompts.json before appending.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { EMAIL_CATEGORIES, buildEmailGenPrompt } from "../lib/ai/prompts/emailWriting.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROMPTS_PATH = path.join(ROOT, "data", "emailWriting", "prompts.json");

// ── Load env ────────────────────────────────────────────────────────────────
const envPath = path.join(ROOT, ".env.local");
const envRaw = fs.readFileSync(envPath, "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const API_KEY = env.DEEPSEEK_API_KEY;
if (!API_KEY) throw new Error("DEEPSEEK_API_KEY not found in .env.local");

// ── Config ──────────────────────────────────────────────────────────────────
const MAX_RETRIES = 5;
const DRY_RUN = process.argv.includes("--dry-run");
const count = Number(process.argv.find((a) => /^\d+$/.test(a))) || 6;

// ── Name pool — bypasses DeepSeek's narrow naming vocabulary ────────────────
const NAME_POOL = {
  professor: [
    "Professor Lane", "Professor Nakamura", "Professor Delgado", "Professor Whitfield",
    "Professor Okonkwo", "Professor Lindqvist", "Professor Castillo", "Professor Huang",
    "Dr. Patel", "Dr. Moreau", "Dr. Fitzgerald", "Dr. Yamamoto", "Dr. Sorensen",
    "Dr. Alvarez", "Dr. Kimura", "Dr. Novak", "Dr. Reeves", "Dr. Bianchi",
    "Professor Cho", "Professor Bergström", "Professor Hassan", "Professor Kowalski",
  ],
  formal: [
    "Mr. Wallace", "Mr. Reyes", "Mr. Owens", "Mr. Torres", "Mr. Kapoor",
    "Ms. Park", "Ms. Chen", "Ms. Vega", "Ms. Okafor", "Ms. Johansson",
    "Mr. Brennan", "Mr. Tanaka", "Ms. Herrera", "Ms. Dubois", "Mr. Petrov",
    "Ms. Lindgren", "Mr. Achebe", "Ms. Kwan", "Mr. Rossi", "Ms. Andersen",
  ],
  peer: [
    "Daniel", "Sarah", "Marcus", "Emma", "Kevin", "Mia", "Lucas", "Priya",
    "Jasper", "Nora", "Ethan", "Chloe", "Omar", "Lily", "Aiden", "Zoe",
    "Ravi", "Hana", "Felix", "Ingrid", "Carlos", "Yuki", "Theo", "Amara",
  ],
  org: [
    "Customer Service", "Customer Support", "Hotel Reservations", "IT Help Desk",
    "Building Management", "Property Management Office", "City Council Office",
    "Student Housing Office", "Library Services", "Campus Dining Services",
  ],
};

// Pick a random unused name matching the category's recipient type
function pickName(category, usedNormalizedNames, normalizeFn) {
  const key = category.key;
  let pool;
  if (key === "A") pool = NAME_POOL.professor;
  else if (key === "B") pool = [...NAME_POOL.peer, ...NAME_POOL.formal];
  else if (key === "C") pool = NAME_POOL.formal;
  else if (key === "D") pool = NAME_POOL.peer;
  else if (key === "E") pool = NAME_POOL.org;
  else if (key === "F") pool = [...NAME_POOL.formal, ...NAME_POOL.org];
  else pool = NAME_POOL.formal;

  // Shuffle and pick first unused
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  for (const name of shuffled) {
    if (!usedNormalizedNames.has(normalizeFn(name))) return name;
  }
  return null; // all exhausted
}

// ── Category distribution ───────────────────────────────────────────────────
function distributeCounts(total, categories) {
  const raw = categories.map((c) => ({ cat: c, n: Math.max(1, Math.round(total * c.weight)) }));
  let sum = raw.reduce((a, r) => a + r.n, 0);
  while (sum > total) {
    const largest = raw.reduce((best, r) => (r.n > best.n ? r : best), raw[0]);
    largest.n--;
    sum--;
  }
  while (sum < total) {
    const smallest = raw.reduce((best, r) => (r.n < best.n ? r : best), raw[0]);
    smallest.n++;
    sum++;
  }
  return raw.filter((r) => r.n > 0);
}

// ── AI call ─────────────────────────────────────────────────────────────────
async function callDeepSeek(prompt) {
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + API_KEY,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 1.0,
      max_tokens: 600,
    }),
  });
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || "")
    .replace(/\`\`\`json/gi, "")
    .replace(/\`\`\`/g, "")
    .trim();
  return JSON.parse(text);
}

// ── Validation ──────────────────────────────────────────────────────────────
function validate(p) {
  const errs = [];
  if (!p.scenario) {
    errs.push("missing scenario");
  } else {
    const words = p.scenario.split(/\s+/).length;
    if (words < 30) errs.push("scenario too short (" + words + "w)");
    if (words > 55) errs.push("scenario too long (" + words + "w)");
    if (!/^(You are|You recently|Your )/.test(p.scenario)) errs.push("bad opening");
  }
  if (!Array.isArray(p.goals) || p.goals.length !== 3) {
    errs.push("not 3 goals");
  } else {
    const verbs = p.goals.map((g) => g.split(" ")[0]);
    if (new Set(verbs).size < 3) errs.push("dup verb: " + verbs.join(","));
    const badMods = ["specific", "concise", "detailed", "workable", "reasonable", "clear", "thorough"];
    for (const g of p.goals) {
      for (const bw of badMods) {
        if (g.toLowerCase().includes(bw)) errs.push('modifier "' + bw + '"');
      }
    }
  }
  if (!p.to) errs.push("missing to");
  if (!p.subject) errs.push("missing subject");
  return errs;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const existing = JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf8"));
  const maxId = Math.max(0, ...existing.map((p) => Number(p.id.replace("em", "")) || 0));
  const existingSubjects = new Set(existing.map((p) => (p.subject || "").toLowerCase()));

  const plan = distributeCounts(count, EMAIL_CATEGORIES);
  console.log("Generating " + count + " email prompts" + (DRY_RUN ? " (dry run)" : "") + "...");
  console.log("Distribution:", plan.map((p) => p.cat.name + "(" + p.n + ")").join(", "));
  console.log();

  const generated = [];
  let nextId = maxId + 1;

  // Normalize names: strip title prefixes so "Professor Aris Thorne" and "Aris Thorne" are the same
  function normalizeName(to) {
    return (to || "").toLowerCase()
      .replace(/^(professor|dr\.|mr\.|ms\.|mrs\.|miss|coordinator|director|superintendent|manager)\s+/i, "")
      .replace(/,.*$/, "") // strip trailing role/title like ", Parks Committee Chair"
      .trim();
  }

  // Track used names/subjects/verbs across this batch for avoid context
  const usedNames = new Set(existing.map((p) => normalizeName(p.to)));
  const recentSubjects = existing.map((p) => p.subject || "").slice(-5);
  const recentVerbPatterns = [];

  for (const { cat, n } of plan) {
    for (let i = 0; i < n; i++) {
      const avoid = {
        names: [...usedNames].slice(0, 20),
        subjects: recentSubjects.slice(-5),
        verbPatterns: recentVerbPatterns.slice(-3),
      };
      const prompt = buildEmailGenPrompt(cat, avoid);
      let retries = MAX_RETRIES;
      while (retries > 0) {
        try {
          const p = await callDeepSeek(prompt);
          const errs = validate(p);
          if (errs.length > 0) {
            console.log("  x " + cat.name + " validation: " + errs.join(", "));
            retries--;
            continue;
          }
          if (existingSubjects.has((p.subject || "").toLowerCase())) {
            console.log("  x " + cat.name + " dup subject: " + p.subject);
            retries--;
            continue;
          }
          // Replace AI name with a diverse name from the pool
          const poolName = pickName(cat, usedNames, normalizeName);
          if (!poolName) {
            console.log("  x " + cat.name + " name pool exhausted");
            retries--;
            continue;
          }
          const originalTo = p.to;
          const finalTo = poolName;
          // Update direction to use the new name
          const direction = "Write an email to " + finalTo + ". In your email, do the following:";
          // Replace name in scenario if it appears
          let scenario = p.scenario;
          if (originalTo && scenario.includes(originalTo)) {
            scenario = scenario.replace(originalTo, finalTo);
          }

          const norm = normalizeName(finalTo);
          const item = {
            id: "em" + nextId++,
            topic: cat.topic,
            scenario: scenario,
            direction: direction,
            goals: p.goals,
            to: finalTo,
            subject: p.subject,
          };
          generated.push(item);
          existingSubjects.add(p.subject.toLowerCase());
          usedNames.add(norm);
          recentSubjects.push(p.subject);
          recentVerbPatterns.push(p.goals.map((g) => g.split(" ")[0]).join("/"));

          const words = p.scenario.split(/\s+/).length;
          const verbs = p.goals.map((g) => g.split(" ")[0]).join("/");
          console.log("  + " + cat.name + " (" + words + "w, " + verbs + "): " + p.to + " — " + p.subject);
          break;
        } catch (e) {
          console.log("  x " + cat.name + " error: " + e.message);
          retries--;
        }
      }
    }
  }

  console.log("\nGenerated " + generated.length + "/" + count);

  if (generated.length > 0 && !DRY_RUN) {
    const merged = [...existing, ...generated];
    fs.writeFileSync(PROMPTS_PATH, JSON.stringify(merged, null, 2) + "\n", "utf8");
    console.log("Saved to prompts.json (total: " + merged.length + ")");
  } else if (DRY_RUN) {
    console.log("\nDry run — not saved. Generated:");
    for (const g of generated) {
      console.log("  " + g.id + " [" + g.topic + "] " + g.to + ": " + g.subject);
    }
  }

  // Topic distribution summary
  const all = DRY_RUN ? existing : [...existing, ...generated];
  const topics = {};
  for (const p of all) topics[p.topic || "?"] = (topics[p.topic || "?"] || 0) + 1;
  console.log("\nTopic distribution:", JSON.stringify(topics));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
