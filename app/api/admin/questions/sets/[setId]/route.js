import { isAdminAuthorized } from "../../../../../../lib/adminAuth";

const { getRepoFile, putRepoFile } = require("../../../../../../lib/githubApi");

const BANK_PATH = "data/buildSentence/questions.json";

// DELETE /api/admin/questions/sets/[setId] — 从正式题库删除一套题
export async function DELETE(request, { params }) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { setId } = params;

  try {
    const bank = await getRepoFile(BANK_PATH);
    if (!bank) {
      return Response.json({ error: "题库文件不存在" }, { status: 500 });
    }

    const existing = bank.content;
    const sets = Array.isArray(existing.question_sets) ? existing.question_sets : [];
    const idx = sets.findIndex(s => String(s.set_id) === String(setId));

    if (idx === -1) {
      return Response.json({ error: `套题 #${setId} 不存在` }, { status: 404 });
    }

    const updatedSets = sets.filter((_, i) => i !== idx);
    await putRepoFile(
      BANK_PATH,
      { ...existing, generated_at: new Date().toISOString(), question_sets: updatedSets },
      bank.sha,
      `feat: delete BS question set #${setId} from bank`
    );

    return Response.json({ ok: true, deletedSetId: setId, remainingSets: updatedSets.length });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
