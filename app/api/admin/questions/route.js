import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { readFileSync } from "fs";
import { join } from "path";

function readJson(relPath) {
  try {
    const abs = join(process.cwd(), relPath);
    const text = readFileSync(abs, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function GET(request) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const academic = readJson("data/academicWriting/prompts.json");
  const email = readJson("data/emailWriting/prompts.json");
  const buildSentence = readJson("data/buildSentence/questions.json");

  return Response.json({
    academic: academic ?? [],
    email: email ?? [],
    buildSentence: buildSentence ?? { question_sets: [] },
  });
}
