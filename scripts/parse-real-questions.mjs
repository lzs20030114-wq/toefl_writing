/**
 * Parse the 60 real TOEFL Academic Discussion questions from raw text
 * into the app's structured JSON format.
 *
 * Robust line-by-line state-machine parser.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_PATH = path.join(__dirname, "..", "data", "academicWriting", "real_questions_raw.txt");
const OUT_PATH = path.join(__dirname, "..", "data", "academicWriting", "prompts.json");
const SAMPLE_PATH = path.join(__dirname, "..", "data", "academicWriting", "sample_answers.json");

const raw = fs.readFileSync(RAW_PATH, "utf-8");

// Unescape markdown backslashes
let text = raw;
for (const ch of [".", "-", "(", ")", "!", ",", "'"]) {
  text = text.split("\\" + ch).join(ch);
}
// Remove __ (bold markers)
text = text.replace(/__/g, "");

// Split into sections by ## headings
const sections = [];
let currentH1 = "";
const allLines = text.split("\n");

let secTitle = "";
let secLines = [];

for (const line of allLines) {
  if (line.startsWith("# ") && !line.startsWith("## ")) {
    currentH1 = line.slice(2).trim();
    continue;
  }
  if (line.startsWith("## ")) {
    if (secTitle) {
      sections.push({ title: secTitle, h1: sections.length > 0 ? sections[sections.length - 1]?.h1Ctx || currentH1 : currentH1, body: secLines.join("\n") });
    }
    secTitle = line.slice(3).trim();
    secLines = [];
    // Store h1 context
    sections._nextH1 = currentH1;
  } else {
    secLines.push(line);
  }
}
if (secTitle) {
  sections.push({ title: secTitle, h1: currentH1, body: secLines.join("\n") });
}

// Map H1 categories to normalized course names
const h1ToCourse = {
  "Health and Environment": "public health",
  "Education": "education",
  "Psychology": "psychology",
  "Sociology": "sociology",
  "History&Culture": "history and culture",
  "Technology and Media": "technology and media",
  "Business": "business",
  "Political Science": "political science",
};

function extractCourse(body) {
  const m = body.match(/teaching a class on ([^.]+)\./i);
  if (m) return m[1].trim();
  return null;
}

function parseSection(sec) {
  const { title, h1, body } = sec;
  const course = extractCourse(body) || h1ToCourse[h1] || "social studies";

  // Find professor name and text
  // Patterns:
  // 1. "Professor\n\nProfessor: TEXT"
  // 2. "Professor Name\n\nProfessor: TEXT"
  // 3. "Dr. Name\n\nProfessor: TEXT"
  // 4. "Dr. Name:TEXT" (no space after colon, professor text inline)
  // 5. "Professor Name\n\nProfessor:\n\nTEXT"

  let profName = "Professor";
  let profText = "";

  // Strategy: find the block between "Professor" header and first student
  // The professor section starts after "ten minutes to write." instruction
  const instrEnd = body.indexOf("ten minutes to write.");
  const afterInstr = instrEnd > -1 ? body.slice(instrEnd + 21) : body;

  // Find "Sample Answer" to know where question part ends
  const sampleIdx = afterInstr.indexOf("Sample Answer");
  const questionPart = sampleIdx > -1 ? afterInstr.slice(0, sampleIdx) : afterInstr;

  // Split into paragraphs (double newline separated)
  const paragraphs = questionPart.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  // State machine to find professor and students
  let state = "seek_prof"; // seek_prof -> read_prof -> seek_students
  let profParagraphs = [];
  const studentBlocks = [];
  let currentStudentName = "";
  let currentStudentText = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];

    if (state === "seek_prof") {
      // Look for professor header: "Professor", "Professor Name", "Dr. Name"
      if (/^(?:Professor\s*\w*|Dr\.\s*\w+)\s*$/.test(p)) {
        // This is just the name header, professor text is next
        const nameMatch = p.match(/(?:Professor\s+(\w+)|Dr\.\s*(\w+))/);
        if (nameMatch) {
          profName = nameMatch[1] ? `Professor ${nameMatch[1]}` : `Dr. ${nameMatch[2]}`;
        }
        state = "read_prof";
        continue;
      }
      // Or: "Dr. Name:Text" inline
      const inlineMatch = p.match(/^(?:Dr\.\s*(\w+)|Professor\s+(\w+))\s*:\s*(.+)/s);
      if (inlineMatch) {
        profName = inlineMatch[1] ? `Dr. ${inlineMatch[1]}` : `Professor ${inlineMatch[2]}`;
        profParagraphs.push(inlineMatch[3].trim());
        state = "read_prof";
        continue;
      }
    }

    if (state === "read_prof") {
      // Check if this paragraph starts with "Professor:" or "Dr. Name:" (the actual text)
      const profTextStart = p.match(/^(?:Professor|Dr\.\s*\w+)\s*:\s*\n?(.*)/s);
      if (profTextStart && profParagraphs.length === 0) {
        profParagraphs.push(profTextStart[1].trim());
        continue;
      }

      // Check if this is a student name header (single capitalized word)
      if (/^[A-Z][a-z]+\s*:?\s*$/.test(p) && p.length < 30) {
        // Student header found, switch state
        if (profParagraphs.length === 0) {
          // This might be continued professor text that looks like a name
          // Check if next paragraph has "Name: text"
          if (i + 1 < paragraphs.length && paragraphs[i + 1].startsWith(p.replace(/[:\s]/g, "") + ":")) {
            state = "read_students";
            currentStudentName = p.replace(/[:\s]/g, "");
            continue;
          }
        }
        state = "read_students";
        currentStudentName = p.replace(/[:\s]/g, "");
        continue;
      }

      // Check if this is "Name: text" (student response start)
      const studentStart = p.match(/^([A-Z][a-z]+)\s*:\s*(.+)/s);
      if (studentStart && profParagraphs.length > 0 && studentStart[2].length > 20) {
        state = "read_students";
        currentStudentName = studentStart[1];
        currentStudentText = [studentStart[2].trim()];
        continue;
      }

      // Otherwise, this is professor text
      profParagraphs.push(p);
      continue;
    }

    if (state === "read_students") {
      // Check if this is "Name: text"
      const studentMatch = p.match(/^([A-Z][a-z]+)\s*:\s*(.+)/s);
      if (studentMatch && studentMatch[2].length > 15) {
        // Save previous student if any
        if (currentStudentName && currentStudentText.length > 0) {
          studentBlocks.push({
            name: currentStudentName,
            text: currentStudentText.join(" ").trim(),
          });
        }
        currentStudentName = studentMatch[1];
        currentStudentText = [studentMatch[2].trim()];
        continue;
      }

      // Check if this is just a name header
      if (/^[A-Z][a-z]+\s*:?\s*$/.test(p) && p.length < 30) {
        // Save previous student
        if (currentStudentName && currentStudentText.length > 0) {
          studentBlocks.push({
            name: currentStudentName,
            text: currentStudentText.join(" ").trim(),
          });
          currentStudentText = [];
        }
        currentStudentName = p.replace(/[:\s]/g, "");
        continue;
      }

      // Continuation of current student text
      if (currentStudentName) {
        currentStudentText.push(p);
      }
    }
  }

  // Save last student
  if (currentStudentName && currentStudentText.length > 0) {
    studentBlocks.push({
      name: currentStudentName,
      text: currentStudentText.join(" ").trim(),
    });
  }

  // Assemble professor text
  profText = profParagraphs.join(" ").replace(/\s+/g, " ").trim();

  // Clean student texts
  const students = studentBlocks
    .filter(s => s.name !== "Professor" && s.name !== "Sample" && s.text.length > 20)
    .slice(0, 2)
    .map(s => ({
      name: s.name,
      text: s.text.replace(/\s+/g, " ").replace(/\s*\(\d+ words\)\s*$/, "").trim(),
    }));

  // Extract sample answer
  let sampleAnswer = "";
  const samplePart = afterInstr.slice(sampleIdx > -1 ? sampleIdx : afterInstr.length);
  const saMatch = samplePart.match(/Sample Answer:\s*\n+([\s\S]+?)$/);
  if (saMatch) {
    sampleAnswer = saMatch[1].trim().replace(/\s+/g, " ").replace(/\s*\(\d+ words?\)\s*$/, "").replace(/\s*（\d+）\s*$/, "").trim();
  }

  return { title, course, profName, profText, students, sampleAnswer };
}

const questions = [];
const sampleAnswers = [];

for (const sec of sections) {
  const parsed = parseSection(sec);

  if (!parsed.profText || parsed.profText.length < 40) {
    console.warn(`⚠ Skipping "${parsed.title}" — profText too short (${parsed.profText?.length || 0})`);
    console.warn(`   profText: "${parsed.profText?.slice(0, 100)}..."`);
    continue;
  }
  if (parsed.students.length < 2) {
    console.warn(`⚠ Skipping "${parsed.title}" — only ${parsed.students.length} students found`);
    continue;
  }

  const id = `ad${questions.length + 1}`;
  questions.push({
    id,
    course: parsed.course,
    professor: { name: parsed.profName, text: parsed.profText },
    students: parsed.students,
  });

  if (parsed.sampleAnswer) {
    sampleAnswers.push({ id, sampleAnswer: parsed.sampleAnswer });
  }
}

// Write outputs
fs.writeFileSync(OUT_PATH, JSON.stringify(questions, null, 2) + "\n", "utf-8");
fs.writeFileSync(SAMPLE_PATH, JSON.stringify(sampleAnswers, null, 2) + "\n", "utf-8");

console.log(`\n✅ Parsed ${questions.length} questions → ${OUT_PATH}`);
console.log(`✅ Saved ${sampleAnswers.length} sample answers → ${SAMPLE_PATH}`);

// Print statistics
const courses = {};
for (const q of questions) {
  courses[q.course] = (courses[q.course] || 0) + 1;
}
console.log("\n📊 Course distribution:");
for (const [c, n] of Object.entries(courses).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${c}: ${n}`);
}

// Verify quality
let issues = 0;
for (const q of questions) {
  if (q.professor.text.length < 80) {
    console.warn(`⚠ Short professor text in ${q.id} (${q.professor.text.length}): "${q.professor.text.slice(0, 60)}..."`);
    issues++;
  }
  for (const s of q.students) {
    if (s.text.length < 30) {
      console.warn(`⚠ Short student text in ${q.id} (${s.name}, ${s.text.length}): "${s.text.slice(0, 40)}..."`);
      issues++;
    }
  }
}
if (issues === 0) console.log("\n✅ All questions passed quality checks");
