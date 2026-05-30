// Email eval-spec measurer. Runs detectors over REAL (recalled n=51) vs GENERATED (n=139).
// Usage: node scripts/research/email_measure.mjs [--dump <dimension>]
import fs from "node:fs";

const REAL = JSON.parse(fs.readFileSync("data/realExam2026/writing/email.json", "utf8")).items;
const GEN = JSON.parse(fs.readFileSync("data/emailWriting/prompts.json", "utf8"));

// Normalize both to a common shape: {id, scenario, recipient, subject, bullets[], direction}
function normReal(it) {
  return { id: it.id, scenario: it.scenario, recipient: it.recipient, subject: it.subject, bullets: it.bullets, direction: null };
}
function normGen(it) {
  return { id: it.id, scenario: it.scenario, recipient: it.to, subject: it.subject, bullets: it.goals, direction: it.direction };
}
const real = REAL.map(normReal);
const gen = GEN.map(normGen);

const round = (x, d = 1) => Number(x.toFixed(d));
function wordCount(s) { return (s || "").trim().split(/\s+/).filter(Boolean).length; }
function pct(n, d) { return round((100 * n) / d, 1); }

// ---------- D1: bullet count ----------
function bulletCount(set) {
  const dist = {};
  for (const it of set) { const k = it.bullets.length; dist[k] = (dist[k] || 0) + 1; }
  return dist;
}

// ---------- D2: bullet leading action-verb ----------
// Map first word of each bullet to a canonical action-type.
const VERB_MAP = {
  describe: "Describe", explain: "Explain", suggest: "Suggest", ask: "Ask",
  thank: "Thank", request: "Request", offer: "Offer", mention: "Mention",
  provide: "Provide", tell: "Tell", give: "Give", make: "Make",
  inquire: "Inquire", express: "Express", reiterate: "Reiterate",
  propose: "Propose", identify: "Identify", apologize: "Apologize",
  argue: "Argue", acknowledge: "Acknowledge", discuss: "Discuss",
  emphasize: "Emphasize", report: "Report", detail: "Detail",
  "point": "Point out", remind: "Remind",
};
function leadVerb(bullet) {
  const w = bullet.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
  return VERB_MAP[w] || `?${w}`;
}
function verbDist(set) {
  const dist = {};
  let total = 0;
  for (const it of set) for (const b of it.bullets) { const v = leadVerb(b); dist[v] = (dist[v] || 0) + 1; total++; }
  return { dist, total };
}
// All-distinct-verbs ratio (do the 3 bullets each start with a different verb?)
function distinctVerbRatio(set) {
  let ok = 0;
  for (const it of set) {
    const vs = it.bullets.map(leadVerb);
    if (new Set(vs).size === vs.length) ok++;
  }
  return { ok, n: set.length, pct: pct(ok, set.length) };
}

// ---------- D3: macro communicative function (the bullet TRIAD pattern) ----------
// Classify the whole item by its blend of bullet intents.
function classifyMacro(it) {
  const verbs = it.bullets.map(leadVerb);
  const text = (it.scenario + " " + it.bullets.join(" ")).toLowerCase();
  const has = (re) => re.test(text);
  const hasV = (v) => verbs.includes(v);
  const issue = has(/issue|problem|broke|broken|damage|wrong|poor|malfunction|not work|leak|delay|crack|defect|missing|slow|disconnect|complaint|concern/);
  const thanks = hasV("Thank") || has(/appreciat|enjoy|grateful|helpful|excellent|thank/);
  const reqFix = hasV("Request") || has(/replacement|refund|compensation|repair|resolve|fix|address|improve/);
  const suggest = hasV("Suggest") || hasV("Propose") || hasV("Offer");
  const askInfo = hasV("Ask") || hasV("Inquire") || has(/inquire|ask about|details|information|process|cost|turnaround|options/);
  const advice = has(/advice|stress|workload|health|overwhelmed|difficulty|modify|tips|strategies/);
  const planning = has(/plan|organi[sz]e|event|trip|itinerary|party|book|reservation|arrange|fundraising|retreat|accommodation/);
  // priority order
  if (advice && (askInfo || suggest) && !issue) return "advice-seeking";
  if (planning && (askInfo || suggest) && !issue) return "planning/coordination";
  if (thanks && issue && (suggest || reqFix)) return "mixed-feedback (praise+problem+suggest)";
  if (issue && reqFix) return "complaint+request-fix";
  if (issue && suggest) return "problem+suggestion";
  if (askInfo && !issue) return "information-request";
  if (suggest && !issue) return "proposal/suggestion";
  if (thanks && !issue) return "appreciation";
  return "other";
}
function macroDist(set) {
  const dist = {};
  for (const it of set) { const m = classifyMacro(it); dist[m] = (dist[m] || 0) + 1; }
  return dist;
}

// ---------- D4: recipient FORM ----------
function recipientForm(r) {
  const s = (r || "").trim();
  if (!s) return "EMPTY";
  if (/^(mr|ms|mrs|miss|dr|prof|professor)\.?\s+[A-Z]/i.test(s)) return "title+surname";
  // role / department (multi-word, no leading title, contains org words OR is generic)
  if (/office|department|services|service|team|management|desk|support|reservations|dining|council|admissions|housing|library|coordinator|manager|company|firm|hall|claims|billing|returns|warranty/i.test(s)) {
    // but if it ALSO begins with a first name + comma + org -> still role-ish
    return "role/org";
  }
  const words = s.split(/\s+/);
  if (words.length === 1 && /^[A-Z][a-z]+$/.test(words[0])) return "first-name-only";
  if (words.length === 2 && /^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(s)) return "full-name (first+last)";
  return "other";
}
function formDist(set) {
  const dist = {};
  const examples = {};
  for (const it of set) {
    const f = recipientForm(it.recipient);
    dist[f] = (dist[f] || 0) + 1;
    (examples[f] = examples[f] || []).push(`${it.id}:${it.recipient}`);
  }
  return { dist, examples };
}

// ---------- D5: recipient ROLE / power-relationship ----------
// RECIPIENT-ANCHORED: find the phrase in the scenario that introduces THIS recipient,
// then read the role-noun attached to it. Do NOT use loose scenario keywords
// ("favorite professor" must NOT make a bakery-owner email count as academic).
function recipientRole(it) {
  const recipient = (it.recipient || "").trim();
  const sc = it.scenario;
  // surname / first token of recipient
  const surname = recipient.replace(/^(Mr|Ms|Mrs|Miss|Dr|Prof|Professor)\.?\s+/i, "").split(/[\s,]/)[0];
  // 1) Look for an appositive role-noun bound to the recipient name in the scenario.
  //    e.g. "the gym manager, Ms. Taylor" / "your landlord, Mr. Thompson" / "the instructor, Ms. Martinez"
  //    e.g. "group leader, Julia" / "your friend, Alex" / "a classmate, Maria"
  let roleNoun = null;
  if (surname) {
    const re = new RegExp("([a-z][a-z ]{2,40}?),?\\s+(?:Mr|Ms|Mrs|Miss|Dr|Prof|Professor)?\\.?\\s*" + surname + "\\b", "i");
    const m = sc.match(re);
    if (m) roleNoun = m[1].toLowerCase().trim();
    // also "NAME, the gym manager" order
    if (!roleNoun) {
      const re2 = new RegExp(surname + "\\b,?\\s+(?:the|a|your|our)\\s+([a-z ]{2,40})", "i");
      const m2 = sc.match(re2);
      if (m2) roleNoun = m2[1].toLowerCase().trim();
    }
  }
  const recLower = (recipient + " " + (roleNoun || "")).toLowerCase();
  // 2) Classify from the recipient-bound role noun + recipient string ONLY.
  // professor/faculty: academic teaching/advising authority
  if (/\bprofessor\b|\bprof\.?\b|\bdr\.?\b|faculty|academic advisor|\bta\b|teaching assistant|department (chair|coordinator|head)/.test(recLower)) {
    // but a fitness/yoga "instructor" or "advisor" of a club is NOT faculty -> handled below
    if (!/yoga|fitness|gym|club|dance|swim/.test(recLower)) return "professor/instructor";
  }
  if (/instructor/.test(recLower) && /yoga|fitness|gym|class/.test((sc).toLowerCase())) return "staff/service/authority";
  if (/instructor/.test(recLower)) return "professor/instructor";
  // peer: friend/classmate/roommate/coworker bound to the recipient
  if (/\bfriend\b|classmate|roommate|coworker|fellow student|study partner|lab partner/.test(recLower)) return "peer (friend/classmate/coworker)";
  // staff/service/authority: manager/landlord/owner/coordinator/director/org/desk...
  if (/manager|landlord|owner|coordinator|director|representative|agent|engineer|librarian|recruiter|chair|president|planner|supervisor|specialist|office|department|services?|desk|team|reservations|council|housing|admissions|claims|billing|returns?|warranty|management|customer (service|support|care)|hotel|restaurant|catering|print shop|gym|resort|company|firm|store/.test(recLower)) {
    return "staff/service/authority";
  }
  // 3) Fallback by FORM when scenario gives no role noun.
  const form = recipientForm(recipient);
  if (form === "first-name-only" || form === "full-name (first+last)") {
    // first-name recipient with no role noun: in real exam these are peers; but a few are staff
    // (e.g. "the booking coordinator, Hana"). If we got here, no role noun was found -> treat as peer.
    return "peer (friend/classmate/coworker)";
  }
  if (form === "role/org") return "staff/service/authority";
  if (form === "title+surname") return "staff/service/authority"; // title+surname w/o role noun -> polite authority
  return "staff/service/authority";
}
function roleDist(set) {
  const dist = {};
  const examples = {};
  for (const it of set) { const ro = recipientRole(it); dist[ro] = (dist[ro] || 0) + 1; (examples[ro]=examples[ro]||[]).push(it.id); }
  return { dist, examples };
}

// ---------- D6: scenario opener ----------
function opener(s) {
  const t = (s || "").trim();
  if (/^You are\b/.test(t)) return "You are…";
  if (/^You recently\b/.test(t)) return "You recently…";
  if (/^You and your\b/.test(t)) return "You and your…";
  if (/^Your\b/.test(t)) return "Your [person/thing]…";
  if (/^You'?ve\b|^You have\b/.test(t)) return "You have…";
  if (/^You [a-z]/.test(t)) return "You [other verb]…";
  return "other/3rd-person";
}
function openerDist(set) {
  const dist = {};
  for (const it of set) { const o = opener(it.scenario); dist[o] = (dist[o] || 0) + 1; }
  return dist;
}

// ---------- D7: scenario length ----------
function lenStats(set, field, getter) {
  const arr = set.map(getter).map(wordCount);
  arr.sort((a, b) => a - b);
  const sum = arr.reduce((a, b) => a + b, 0);
  return {
    min: arr[0], max: arr[arr.length - 1], mean: round(sum / arr.length, 1),
    median: arr[Math.floor(arr.length / 2)],
    p10: arr[Math.floor(arr.length * 0.1)], p90: arr[Math.floor(arr.length * 0.9)],
  };
}
// scenario sentence count
function sentCount(s) { return (s.match(/[.!?](\s|$)/g) || []).length; }
function sentStats(set) {
  const arr = set.map((it) => sentCount(it.scenario));
  arr.sort((a, b) => a - b);
  const sum = arr.reduce((a, b) => a + b, 0);
  const dist = {};
  for (const v of arr) dist[v] = (dist[v] || 0) + 1;
  return { mean: round(sum / arr.length, 1), dist };
}

// ---------- D8: bullet word length ----------
function bulletLen(set) {
  const arr = [];
  for (const it of set) for (const b of it.bullets) arr.push(wordCount(b));
  arr.sort((a, b) => a - b);
  const sum = arr.reduce((a, b) => a + b, 0);
  return { min: arr[0], max: arr[arr.length-1], mean: round(sum/arr.length,1), median: arr[Math.floor(arr.length/2)] };
}

// ---------- D9: subject length ----------
function subjectStats(set) {
  return lenStats(set, "subject", (it) => it.subject);
}

// ---------- D10: scenario specificity — named proper-noun brand/place ----------
function hasQuotedName(it) { return /['"'']/.test(it.scenario); } // 'Home Essentials', 'Coastal Retreat'
function specificityDist(set) {
  let quoted = 0;
  for (const it of set) if (hasQuotedName(it)) quoted++;
  return { quotedNameItems: quoted, n: set.length, pct: pct(quoted, set.length) };
}

// ---------- D11: RECIPIENT-TOPIC COHERENCE (generated-bank bug A) ----------
// The recipient ORG must plausibly own the scenario problem. Flag when the recipient
// names an institution clearly unrelated to the scenario domain
// (e.g. a tablet-warranty complaint addressed to "City Council Office").
const RECIP_DOMAIN = [
  ["consumer-retail", /customer (service|support|care)|returns?|warranty|billing|retailer|support team|seller|electronics|peripherals|furniture|audio|appliance store/i],
  ["housing", /landlord|property|housing office|building (manag|management)|leasing|maintenance/i],
  ["civic", /city council|transportation|parks and recreation|parks & recreation|neighborhood association/i],
  ["campus-dining", /dining services|cafeteria/i],
  ["library", /library services|library/i],
  ["hotel", /hotel|reservations|booking/i],
];
function recipientDomain(recipient) {
  for (const [name, re] of RECIP_DOMAIN) if (re.test(recipient)) return name;
  return null;
}
function scenarioDomainStrict(sc) {
  const t = sc.toLowerCase();
  // consumer-retail wins whenever a product was purchased/ordered/shipped, even if the
  // buyer "moved into an apartment" as flavor — the PROBLEM is the product/order/delivery.
  if (/purchased|ordered|bought|online (store|reseller|retailer|shop)|warranty|the product|the device|the seller|the item|charging|engrav|shipping|shipment|delivered|delivery|subscription|double-charged|moving company|relocations/.test(t)) return "consumer-retail";
  // housing only when the dwelling/fixtures themselves are the problem and no purchase frame.
  if (/landlord|tenant|kitchen sink|heating|boiler|hot water|plumbing|lease|window (lock|that)|water (shut|will be shut)|the unit's|maintenance (office|work)/.test(t)) return "housing";
  return null;
}
function recipientCoherence(set) {
  const mismatches = [];
  for (const it of set) {
    const scDom = scenarioDomainStrict(it.scenario);
    const reDom = recipientDomain(it.recipient || "");
    if (scDom && reDom && scDom !== reDom) {
      // genuine cross-domain mismatch (e.g. consumer scenario -> civic/library/dining recipient)
      mismatches.push({ id: it.id, kind: "topic-mismatch", scenarioDomain: scDom, to: it.recipient, recipientDomain: reDom });
    }
  }
  return { mismatches, n: set.length, pct: pct(mismatches.length, set.length) };
}

// ---------- D12: DANGLING REFERENCE in bullets (generated-bank bug B) ----------
// A bullet that says "Thank Jordan" / "Tell the coordinator" / "Thank the specialist"
// where that NAME or ROLE was never established (not the recipient, not in scenario).
function danglingRefs(set) {
  const hits = [];
  for (const it of set) {
    const recipient = (it.recipient || "");
    const recTokens = new Set(recipient.toLowerCase().match(/[a-z]+/g) || []);
    // established context = scenario + direction line ("Write an email to the department's
    // registration coordinator" establishes "coordinator").
    const sc = it.scenario + " " + (it.direction || "");
    for (const b of it.bullets) {
      // (i) "Thank/Tell/Ask/Remind <FirstName>" where FirstName not = recipient and not in scenario
      const nameM = b.match(/\b(?:Thank|Tell|Ask|Remind|Offer)\s+([A-Z][a-z]+)\b/);
      if (nameM) {
        const nm = nameM[1].toLowerCase();
        const common = ["her","him","them","the","you","your"];
        if (!common.includes(nm) && !recTokens.has(nm) && !new RegExp("\\b"+nameM[1]+"\\b").test(sc)) {
          hits.push({ id: it.id, kind: "dangling-name", token: nameM[1], bullet: b, to: recipient });
          continue;
        }
      }
      // (ii) "the coordinator/specialist/manager/..." role-ref not present in recipient or scenario
      const roleM = b.match(/\bthe (coordinator|specialist|manager|director|owner|instructor|professor|landlord|representative|agent|editor)\b/i);
      if (roleM) {
        const role = roleM[1].toLowerCase();
        if (!new RegExp("\\b"+role, "i").test(recipient) && !new RegExp("\\b"+role, "i").test(sc)) {
          hits.push({ id: it.id, kind: "dangling-role", token: roleM[1], bullet: b, to: recipient });
        }
      }
    }
  }
  return { hits, n: set.length, pct: pct(new Set(hits.map(h=>h.id)).size, set.length), itemsAffected: new Set(hits.map(h=>h.id)).size };
}

// ---------- D12: scenario mentions a name absent from bullets but bullets say "thank her" etc ----------
// Also: do bullets reference a name (gender pronoun / first name) that matches recipient?
// (light) skip — covered by coherence.

// ---------- topic SETTING distribution ----------
// Where does the scenario take place / who owns the situation? Mutually-exclusive precedence
// anchored on the most specific scenario noun. (Validated by hand against all 51 real items.)
function topicDomain(it) {
  const sc = it.scenario.toLowerCase();
  const all = (it.scenario + " " + it.bullets.join(" ") + " " + (it.recipient || "")).toLowerCase();
  // 1) CONSUMER: a purchased product / order / warranty / subscription (most specific frame)
  if (/purchased|bought|ordered|online (store|reseller|retailer|shop)|the product|the device|warranty|subscription|double-charged|engrav|a store called|appliance|from .* store|meal kit|bakery|a cake/.test(sc)) return "consumer/retail";
  // 2) HOUSING: dwelling & fixtures
  if (/apartment|landlord|tenant|\bdorm\b|moved into|kitchen sink|heating|boiler|hot water|plumbing|\blease\b|window (lock|that)|the unit/.test(sc)) return "housing";
  // 3) EVENTS/LEISURE bookings & venues: hotel/restaurant/gym/concert/trip/party planning/print/campus events
  if (/hotel|stayed at|\bresort\b|restaurant|\bdinner\b|catering|concert|orchestra|choir|\bgym\b|yoga|fitness class|print shop|travel (agency|agent)|kayaking|\btour\b|pet boarding|surprise (birthday )?party|fundraising|team-building retreat|trip (to|with)|itinerary|class field trip|promotional materials|awareness event|career workshop|career fair|student organization|drama club/.test(sc)) return "events/services/leisure";
  // 4) ACADEMIC: course/professor/study mechanics
  if (/professor|\bdr\.|thesis|lecture|quiz|midterm|seminar|registration|scholarship|\bgrade\b|the course|assignment|tutor|\bta\b|\bexam\b|class notes|missed (an |a )?(important |recent )?(lecture|class)|library book|academic advisor|financial aid|override|recommendation letter|proctor|group project/.test(sc)) return "academic/campus-study";
  // 5) WORKPLACE: job/colleague/internship
  if (/colleague|coworker|supervisor|internship|\bintern\b|conference|\bfirm\b|agency|onboarding|sprint|client|the office|\bmanager\b|career fair|recruiter|team lead|started a (new )?(remote )?(job|position)|on campus/.test(sc)) return "workplace/internship";
  // 6) COMMUNITY civic/neighborhood/library/volunteer
  if (/library|community|neighborhood|\bgarden\b|recreation|rec center|volunteer|\bpark\b|block party|streetlight|astronomy|stargazing|food bank|youth center|arts center|city council|association/.test(sc)) return "community/civic";
  // 7) PEER/SOCIAL: friend/roommate personal
  if (/\bfriend\b|roommate|carpool|borrowed|lent|hiking|camping|game/.test(sc)) return "peer/social";
  return "other";
}
function topicDist(set) {
  const dist = {};
  for (const it of set) { const t = topicDomain(it); dist[t] = (dist[t] || 0) + 1; }
  return dist;
}

// ---------- bullet POSITION patterns: which verb in slot 1/2/3 ----------
function slotVerbs(set) {
  const slots = [{}, {}, {}];
  for (const it of set) {
    it.bullets.slice(0, 3).forEach((b, i) => { const v = leadVerb(b); slots[i][v] = (slots[i][v] || 0) + 1; });
  }
  return slots;
}

function sortDist(d) {
  return Object.entries(d).sort((a, b) => b[1] - a[1]);
}
function printDist(label, d, total) {
  console.log(`  ${label}:`);
  for (const [k, v] of sortDist(d)) console.log(`    ${k.padEnd(38)} ${v}  (${pct(v, total)}%)`);
}

// ===================== RUN =====================
const arg = process.argv[2];
const dumpArg = process.argv.indexOf("--dump") >= 0 ? process.argv[process.argv.indexOf("--dump") + 1] : null;

function runAll(label, set) {
  console.log(`\n################## ${label} (n=${set.length}) ##################`);
  console.log("\n[D1] bullet count:", JSON.stringify(bulletCount(set)));
  const vd = verbDist(set);
  printDist(`[D2] bullet lead-verb (total ${vd.total})`, vd.dist, vd.total);
  console.log("[D2b] distinct-verbs-per-item:", JSON.stringify(distinctVerbRatio(set)));
  printDist("[D3] macro communicative function", macroDist(set), set.length);
  const fd = formDist(set);
  printDist("[D4] recipient FORM", fd.dist, set.length);
  printDist("[D5] recipient ROLE (power)", roleDist(set).dist, set.length);
  printDist("[D6] scenario opener", openerDist(set), set.length);
  console.log("[D7] scenario word count:", JSON.stringify(lenStats(set, "scenario", (it) => it.scenario)));
  console.log("[D7b] scenario sentence count:", JSON.stringify(sentStats(set)));
  console.log("[D8] bullet word length:", JSON.stringify(bulletLen(set)));
  console.log("[D9] subject word count:", JSON.stringify(subjectStats(set)));
  console.log("[D10] scenario quoted brand/place name:", JSON.stringify(specificityDist(set)));
  printDist("[D-topic] topic domain", topicDist(set), set.length);
  const slots = slotVerbs(set);
  console.log("[D-slot] verb in slot1:", JSON.stringify(sortDist(slots[0]).slice(0, 5)));
  console.log("[D-slot] verb in slot2:", JSON.stringify(sortDist(slots[1]).slice(0, 5)));
  console.log("[D-slot] verb in slot3:", JSON.stringify(sortDist(slots[2]).slice(0, 5)));
  const coh = recipientCoherence(set);
  console.log(`[D11] recipient-topic mismatches: ${coh.mismatches.length}/${coh.n} (${coh.pct}%)`);
  if (coh.mismatches.length) console.log("     ", JSON.stringify(coh.mismatches.slice(0, 20)));
  const dang = danglingRefs(set);
  console.log(`[D12] dangling-reference items: ${dang.itemsAffected}/${dang.n} (${dang.pct}%)`);
  if (dang.hits.length) console.log("     ", JSON.stringify(dang.hits.slice(0, 20)));
}

if (dumpArg) {
  // dump a specific detector's per-item output for hand-validation
  const setSel = arg === "gen" ? gen : real;
  if (dumpArg === "verb") for (const it of setSel) console.log(it.id, "::", it.bullets.map(leadVerb).join(" | "), "::", JSON.stringify(it.bullets));
  else if (dumpArg === "macro") for (const it of setSel) console.log(it.id, "::", classifyMacro(it), "::", it.scenario.slice(0, 70));
  else if (dumpArg === "form") for (const it of setSel) console.log(it.id, "::", recipientForm(it.recipient), "::", it.recipient);
  else if (dumpArg === "role") for (const it of setSel) console.log(it.id, "::", recipientRole(it), "::", it.recipient, "::", it.scenario.slice(0,60));
  else if (dumpArg === "opener") for (const it of setSel) console.log(it.id, "::", opener(it.scenario), "::", it.scenario.slice(0, 60));
  else if (dumpArg === "topic") for (const it of setSel) console.log(it.id, "::", topicDomain(it), "::", it.scenario.slice(0, 60));
  else if (dumpArg === "coh") { const c = recipientCoherence(setSel); console.log(JSON.stringify(c.mismatches, null, 2)); }
  else if (dumpArg === "dang") { const c = danglingRefs(setSel); console.log(JSON.stringify(c.hits, null, 2)); }
} else {
  runAll("REAL (recalled 2026)", real);
  runAll("GENERATED (current bank)", gen);
}
